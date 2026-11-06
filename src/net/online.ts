import {
  FirebaseHandles,
  getAnonName,
  initFirebase,
  isFirebaseConfigured,
} from './firebase';

export interface TimeControl {
  base: number; // seconds
  inc: number; // seconds
  label: string;
}

export interface LobbyEntry {
  roomId: string;
  host: string;
  rating: number;
  tc: TimeControl;
  mode: string;
  createdAt: number;
}

export interface RoomSnapshot {
  roomId: string;
  moves: string[];
  status: 'waiting' | 'active' | 'finished';
  players: { p0?: Seat; p1?: Seat };
  tc: TimeControl;
  result?: { winner: 0 | 1; reason: string } | null;
  clock?: { p0Ms: number; p1Ms: number; lastMoveAt: number };
}

export interface Seat {
  uid: string;
  name: string;
}

export interface OnlineCallbacks {
  onStatus: (msg: string) => void;
  onRoom: (room: RoomSnapshot) => void;
  onLobby: (entries: LobbyEntry[]) => void;
  onOnlineCount: (n: number) => void;
}

export function makeRoomId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

/**
 * Online play (Trust Option A — casual).
 *
 * The room's `moves` list (append-only notation strings) is the ONLY game
 * state that is synced: every client rebuilds the position locally with
 * `replay(moves)` from the shared engine. Seats are claimed with a
 * transaction, presence lives at /presence/{uid} with onDisconnect cleanup,
 * and waiting rooms are listed at /lobby/{roomId} (removed onDisconnect).
 */
export class OnlineManager {
  private fb: FirebaseHandles | null = null;
  private cb: OnlineCallbacks;
  roomId: string | null = null;
  /** 0 = host/South, 1 = guest/North, null = spectator or not in a room. */
  mySlot: 0 | 1 | null = null;
  spectating = false;
  private unsubs: (() => void)[] = [];
  private moveCount = 0;

  constructor(cb: OnlineCallbacks) {
    this.cb = cb;
  }

  get configured(): boolean {
    return isFirebaseConfigured();
  }

  get uid(): string | null {
    return this.fb?.uid ?? null;
  }

  private async ensure(): Promise<FirebaseHandles> {
    if (!this.fb) {
      this.fb = await initFirebase();
      await this.startPresence();
      this.watchLobbyAndPresence();
    }
    return this.fb;
  }

  private async startPresence(): Promise<void> {
    const fb = this.fb!;
    const { ref, set, onDisconnect, serverTimestamp } = fb.api;
    const presenceRef = ref(fb.db, `presence/${fb.uid}`);
    await set(presenceRef, {
      online: true,
      name: getAnonName(),
      lastSeen: serverTimestamp(),
    });
    onDisconnect(presenceRef).remove();
  }

  private watchLobbyAndPresence(): void {
    const fb = this.fb!;
    const { ref, onValue } = fb.api;
    const lobbyUnsub = onValue(ref(fb.db, 'lobby'), (snap: any) => {
      const val = snap.val() ?? {};
      const entries: LobbyEntry[] = Object.entries(val).map(
        ([roomId, e]: [string, any]) => ({
          roomId,
          host: e.host ?? 'anon',
          rating: e.rating ?? 1200,
          tc: e.tc ?? { base: 300, inc: 3, label: '5+3' },
          mode: e.mode ?? 'casual',
          createdAt: e.createdAt ?? 0,
        }),
      );
      entries.sort((a, b) => b.createdAt - a.createdAt);
      this.cb.onLobby(entries);
    });
    const presenceUnsub = onValue(ref(fb.db, 'presence'), (snap: any) => {
      const val = snap.val() ?? {};
      this.cb.onOnlineCount(
        Object.values(val).filter((p: any) => p && p.online).length,
      );
    });
    this.unsubs.push(lobbyUnsub, presenceUnsub);
  }

  /** Start listening to lobby + presence without joining a room. */
  async connect(): Promise<void> {
    await this.ensure();
  }

  async createRoom(tc: TimeControl): Promise<string> {
    const fb = await this.ensure();
    const { ref, set, onDisconnect, serverTimestamp } = fb.api;
    const roomId = makeRoomId();
    const name = getAnonName();
    const room = {
      players: { p0: { uid: fb.uid, name } },
      tc,
      status: 'waiting',
      moves: {},
      clock: { p0Ms: tc.base * 1000, p1Ms: tc.base * 1000, lastMoveAt: Date.now() },
      result: null,
      createdAt: Date.now(),
    };
    await set(ref(fb.db, `rooms/${roomId}`), room);
    const lobbyRef = ref(fb.db, `lobby/${roomId}`);
    await set(lobbyRef, {
      host: name,
      hostUid: fb.uid,
      rating: 1200,
      tc,
      mode: 'casual',
      color: 'south',
      createdAt: Date.now(),
    });
    // If the host tabs out / disconnects while waiting, delist the room.
    onDisconnect(lobbyRef).remove();
    onDisconnect(ref(fb.db, `rooms/${roomId}`)).remove();
    void serverTimestamp;
    this.roomId = roomId;
    this.mySlot = 0;
    this.spectating = false;
    this.moveCount = 0;
    this.listenToRoom(roomId);
    this.cb.onStatus(`Room created. Share the link — you are South and move first.`);
    return roomId;
  }

  /** Join as player 1. Returns 'joined' | 'spectate' | 'full' | 'missing'. */
  async joinRoom(roomId: string, forceSpectate = false): Promise<string> {
    const fb = await this.ensure();
    const { ref, get, set, runTransaction, remove } = fb.api;
    const roomRef = ref(fb.db, `rooms/${roomId}`);
    const snap = await get(roomRef);
    if (!snap.exists()) {
      this.cb.onStatus('Room not found (it may have ended or the host left).');
      return 'missing';
    }
    const room = snap.val();
    const name = getAnonName();
    // Already seated? Reattach.
    if (room.players?.p0?.uid === fb.uid) {
      this.attach(roomId, 0, false);
      return 'joined';
    }
    if (room.players?.p1?.uid === fb.uid) {
      this.attach(roomId, 1, false);
      return 'joined';
    }
    if (forceSpectate || room.players?.p1) {
      this.attach(roomId, null, true);
      this.cb.onStatus('Watching this game (spectator / TV mode).');
      return 'spectate';
    }
    // Claim seat p1 with a transaction so two guests can't take it at once.
    const p1Ref = ref(fb.db, `rooms/${roomId}/players/p1`);
    const tx = await runTransaction(p1Ref, (current: any) => {
      if (current !== null && current !== undefined) return; // abort: taken
      return { uid: fb.uid, name };
    });
    if (!tx.committed) {
      this.attach(roomId, null, true);
      this.cb.onStatus('Seat was just taken — you are spectating instead.');
      return 'spectate';
    }
    await set(ref(fb.db, `rooms/${roomId}/status`), 'active');
    await remove(ref(fb.db, `lobby/${roomId}`));
    void set;
    this.attach(roomId, 1, false);
    this.cb.onStatus('Joined! You are North. South moves first.');
    return 'joined';
  }

  private attach(roomId: string, slot: 0 | 1 | null, spectate: boolean): void {
    this.roomId = roomId;
    this.mySlot = slot;
    this.spectating = spectate;
    this.moveCount = 0;
    this.listenToRoom(roomId);
  }

  private listenToRoom(roomId: string): void {
    const fb = this.fb!;
    const { ref, onValue } = fb.api;
    const unsub = onValue(ref(fb.db, `rooms/${roomId}`), (snap: any) => {
      if (!snap.exists()) {
        this.cb.onStatus('Room closed.');
        return;
      }
      const val = snap.val();
      const movesObj = val.moves ?? {};
      const moves: string[] = Object.keys(movesObj)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => movesObj[k].m);
      this.moveCount = moves.length;
      this.cb.onRoom({
        roomId,
        moves,
        status: val.status ?? 'waiting',
        players: val.players ?? {},
        tc: val.tc,
        result: val.result ?? null,
        clock: val.clock,
      });
    });
    this.unsubs.push(unsub);
  }

  /** Append my move (notation) — only valid on my turn; enforced again by rules. */
  async appendMove(notation: string, clock?: { p0Ms: number; p1Ms: number }): Promise<void> {
    if (!this.fb || !this.roomId || this.mySlot === null) return;
    const fb = this.fb;
    const { ref, set, update, serverTimestamp } = fb.api;
    const n = this.moveCount;
    // Turn parity: even ply = player 0, odd ply = player 1.
    if (n % 2 !== this.mySlot) return;
    await set(ref(fb.db, `rooms/${this.roomId}/moves/${n}`), {
      m: notation,
      t: serverTimestamp(),
    });
    this.moveCount = n + 1;
    if (clock) {
      await update(ref(fb.db, `rooms/${this.roomId}`), {
        clock: { ...clock, lastMoveAt: Date.now() },
      });
    }
  }

  async resign(): Promise<void> {
    if (!this.fb || !this.roomId || this.mySlot === null) return;
    const fb = this.fb;
    const { ref, update } = fb.api;
    await update(ref(fb.db, `rooms/${this.roomId}`), {
      status: 'finished',
      result: { winner: this.mySlot === 0 ? 1 : 0, reason: 'resign' },
    });
  }

  async finishByGoal(winner: 0 | 1): Promise<void> {
    if (!this.fb || !this.roomId) return;
    const fb = this.fb;
    const { ref, update, remove } = fb.api;
    await update(ref(fb.db, `rooms/${this.roomId}`), {
      status: 'finished',
      result: { winner, reason: 'goal' },
    });
    await remove(ref(fb.db, `lobby/${this.roomId}`));
  }

  async leave(): Promise<void> {
    if (this.fb && this.roomId && this.mySlot === 0) {
      const fb = this.fb;
      const { ref, remove } = fb.api;
      await remove(ref(fb.db, `lobby/${this.roomId}`)).catch(() => undefined);
    }
    this.roomId = null;
    this.mySlot = null;
    this.spectating = false;
    this.moveCount = 0;
  }
}
