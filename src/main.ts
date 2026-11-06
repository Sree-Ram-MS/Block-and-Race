import './style.css';
import {
  applyMove,
  applyResign,
  applyTimeout,
  createGame,
  GameState,
  pathDistance,
  PlayerIndex,
  replay,
  squareToNotation,
  Wall,
  wallLegal,
} from './engine';
import { renderBoard } from './ui/board';
import { chooseAiMove, AiLevel } from './ai/ai';
import { OnlineManager, RoomSnapshot, TimeControl } from './net/online';
import { getAnonName, isFirebaseConfigured, setAnonName } from './net/firebase';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

type Mode = 'local' | 'ai' | 'online';

const TC_OPTIONS: Record<string, TimeControl> = {
  '1+0': { base: 60, inc: 0, label: '1+0' },
  '1+3': { base: 60, inc: 3, label: '1+3' },
  '3+0': { base: 180, inc: 0, label: '3+0' },
  '3+2': { base: 180, inc: 2, label: '3+2' },
  '5+3': { base: 300, inc: 3, label: '5+3' },
  '10+0': { base: 600, inc: 0, label: '10+0' },
  '15+10': { base: 900, inc: 10, label: '15+10' },
};

let state: GameState = createGame();
let mode: Mode = 'local';
let inputMode: 'move' | 'wall' = 'move';
let wallOrientation: 'h' | 'v' = 'h';
let hoverWall: Wall | null = null;
let tc: TimeControl = TC_OPTIONS['5+3'];
let clockMs: [number, number] = [tc.base * 1000, tc.base * 1000];
let clockStarted = false;
let lastTick = 0;
let names: [string, string] = ['South (Amber)', 'North (Cyan)'];
let onlineNames: [string, string] = ['', ''];
let spectating = false;

const online = new OnlineManager({
  onStatus: (msg) => ($('onlineStatus').textContent = msg),
  onRoom: (room) => handleRemoteRoom(room),
  onLobby: (entries) => renderLobby(entries),
  onOnlineCount: (n) => ($('onlineCount').textContent = String(n)),
});

function currentTc(): TimeControl {
  return TC_OPTIONS[($('tcSelect') as HTMLSelectElement).value] ?? TC_OPTIONS['5+3'];
}

function resetClocks(): void {
  tc = currentTc();
  clockMs = [tc.base * 1000, tc.base * 1000];
  clockStarted = false;
}

function newGame(newMode: Mode): void {
  mode = newMode;
  state = createGame();
  inputMode = 'move';
  hoverWall = null;
  spectating = false;
  resetClocks();
  $('modeStatus').textContent =
    newMode === 'local'
      ? 'Mode: local hot-seat. The board flips each turn so the player to move is at the bottom.'
      : newMode === 'ai'
        ? `Mode: vs computer (${($('aiLevel') as HTMLSelectElement).value}). You are South.`
        : 'Mode: online.';
  render();
}

/** Whose perspective is on screen right now? */
function viewer(): PlayerIndex {
  if (mode === 'online') {
    if (spectating) return 0;
    return (online.mySlot ?? 0) as PlayerIndex;
  }
  if (mode === 'ai') return 0;
  return state.turn; // hot-seat: flip so the mover is at the bottom
}

function canAct(): boolean {
  if (state.winner !== null || spectating) return false;
  if (mode === 'ai') return state.turn === 0;
  if (mode === 'online') return online.mySlot !== null && state.turn === online.mySlot;
  return true;
}

function displayNames(): [string, string] {
  if (mode === 'online' && (onlineNames[0] || onlineNames[1]))
    return [onlineNames[0] || 'South', onlineNames[1] || 'North (waiting…)'];
  if (mode === 'ai') return ['You (South)', 'Computer (North)'];
  return names;
}

function fmtClock(ms: number): string {
  const t = Math.max(0, ms);
  const totalSec = Math.floor(t / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (t < 20000) {
    const tenths = Math.floor((t % 1000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function doNotation(notation: string, source: 'local' | 'remote'): boolean {
  const mover = state.turn;
  const res = applyMove(state, notation);
  if (!res.ok) {
    if (source === 'local') $('hint').textContent = res.reason ?? 'Illegal move.';
    return false;
  }
  state = res.state;
  if (!clockStarted) clockStarted = true;
  clockMs[mover] += tc.inc * 1000;
  inputMode = 'move';
  hoverWall = null;
  if (mode === 'online' && source === 'local') {
    void online.appendMove(notation, { p0Ms: clockMs[0], p1Ms: clockMs[1] });
    if (state.winner !== null) void online.finishByGoal(state.winner);
  }
  render();
  maybeAi();
  return true;
}

function maybeAi(): void {
  if (mode !== 'ai' || state.winner !== null || state.turn !== 1) return;
  const level = ($('aiLevel') as HTMLSelectElement).value as AiLevel;
  setTimeout(() => {
    if (mode !== 'ai' || state.winner !== null || state.turn !== 1) return;
    const notation = chooseAiMove(state, level);
    if (notation) doNotation(notation, 'local');
  }, 350);
}

function handleRemoteRoom(room: RoomSnapshot): void {
  mode = 'online';
  spectating = online.spectating;
  if (room.tc) {
    tc = room.tc;
    ($('tcSelect') as HTMLSelectElement).value = room.tc.label;
  }
  onlineNames = [room.players.p0?.name ?? '', room.players.p1?.name ?? ''];
  const rep = replay(room.moves);
  state = rep.state;
  if (room.clock) clockMs = [room.clock.p0Ms, room.clock.p1Ms];
  else if (room.moves.length === 0) clockMs = [tc.base * 1000, tc.base * 1000];
  clockStarted = room.moves.length > 0;
  if (room.result) {
    state = applyResignLike(state, room.result.winner, room.result.reason);
  }
  $('copyLinkBtn').removeAttribute('disabled');
  ($('copyLinkBtn') as HTMLButtonElement).disabled = false;
  ($('leaveRoomBtn') as HTMLButtonElement).disabled = false;
  const seat = spectating
    ? 'spectating'
    : online.mySlot === 0
      ? 'you are South'
      : online.mySlot === 1
        ? 'you are North'
        : 'spectating';
  $('modeStatus').textContent = `Online room ${room.roomId} — ${seat}. Status: ${room.status}.`;
  render();
}

function applyResignLike(s: GameState, winner: 0 | 1, reason: string): GameState {
  if (s.winner !== null) return s;
  const next = { ...s, winner, winReason: (reason as GameState['winReason']) ?? 'resign' };
  return next as GameState;
}

function renderLobby(entries: import('./net/online').LobbyEntry[]): void {
  const ul = $('lobbyList');
  ul.innerHTML = '';
  if (entries.length === 0) {
    ul.innerHTML = '<li class="hint">No open rooms — create one!</li>';
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    li.textContent = `${e.host} · ${e.tc.label} · ${e.mode} · ★${e.rating} `;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Join';
    btn.addEventListener('click', () => void joinOnline(e.roomId, false));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function render(): void {
  const v = viewer();
  renderBoard($('board'), state, {
    viewer: v,
    inputMode,
    wallOrientation,
    showPath: ($('showPath') as HTMLInputElement).checked,
    interactive: canAct(),
    hoverWall,
    onPawnMove: (to) => {
      doNotation(squareToNotation(to), 'local');
    },
    onWallHover: (w) => {
      if ((hoverWall === null) !== (w === null) || (w && hoverWall && (w.r !== hoverWall.r || w.c !== hoverWall.c || w.o !== hoverWall.o))) {
        hoverWall = w;
        render();
      }
    },
    onWallPlace: (w) => {
      const chk = wallLegal(state, state.turn, w);
      if (!chk.ok) {
        $('hint').textContent = chk.reason ?? 'Illegal wall.';
        return;
      }
      doNotation(
        `${'abcdefghi'[w.c]}${9 - w.r}${w.o}`,
        'local',
      );
    },
  });

  // Player cards
  const [n0, n1] = displayNames();
  const playerNames: [string, string] = [n0, n1];
  const wrap = $('players');
  wrap.innerHTML = '';
  (state.pawns as typeof state.pawns).forEach((p, pi) => {
    const idx = pi as PlayerIndex;
    const card = document.createElement('div');
    card.className = `player${state.turn === idx && state.winner === null ? ' active' : ''}`;
    const dist = pathDistance(state.walls, p, state.goals[idx]);
    card.innerHTML = `
      <span class="dot" style="background:${idx === 0 ? '#ffb703' : '#4cc9f0'}"></span>
      <span class="name">${playerNames[idx]}${state.winner === idx ? ' 🏆' : ''}</span>
      <span class="meta">at ${squareToNotation(p)} · walls: ${state.wallsLeft[idx]} · path: ${dist === Infinity ? '∞' : dist}<br>
      <span class="clock${clockMs[idx] < 20000 ? ' low' : ''}" data-clock="${idx}">${fmtClock(clockMs[idx])}</span></span>`;
    wrap.appendChild(card);
  });

  // Banner + hint
  if (state.winner !== null) {
    const reason =
      state.winReason === 'resign'
        ? 'by resignation'
        : state.winReason === 'timeout'
          ? 'on time'
          : 'by reaching the far row';
    $('turnBanner').innerHTML = `🏆 <b>${playerNames[state.winner]}</b> wins ${reason}!`;
    $('hint').textContent = 'Game over — New game / Rematch to play again.';
  } else {
    const who = playerNames[state.turn];
    const mine = canAct();
    $('turnBanner').innerHTML =
      mode === 'ai' && state.turn === 1
        ? `Computer is thinking…`
        : mode === 'online' && !mine && !spectating
          ? `Waiting for <b>${who}</b>…`
          : spectating
            ? `<b>${who}</b> to move (spectating)`
            : `<b>${who}</b> — your turn: move, or place a wall`;
    if (mine) {
      $('hint').textContent =
        inputMode === 'move'
          ? 'Click a highlighted square to move. Or switch to “Place wall”.'
          : `Hover a groove for a preview (green = legal, red = illegal), click to place a ${wallOrientation === 'h' ? 'horizontal' : 'vertical'} wall. Press R to rotate.`;
    }
  }

  // Move list, paired by round
  const ol = $('moveList');
  ol.innerHTML = '';
  for (let i = 0; i < state.moves.length; i += 2) {
    const li = document.createElement('li');
    li.textContent = `${state.moves[i]}${state.moves[i + 1] ? '  ·  ' + state.moves[i + 1] : ''}`;
    ol.appendChild(li);
  }

  ($('moveModeBtn') as HTMLButtonElement).classList.toggle('selected', inputMode === 'move');
  ($('wallModeBtn') as HTMLButtonElement).classList.toggle('selected', inputMode === 'wall');
  ($('rotateBtn') as HTMLButtonElement).disabled = inputMode !== 'wall';
  ($('wallModeBtn') as HTMLButtonElement).disabled =
    state.winner !== null || state.wallsLeft[state.turn] <= 0;
}

// ---------- clocks ----------
setInterval(() => {
  if (!clockStarted || state.winner !== null || document.hidden) {
    lastTick = performance.now();
    return;
  }
  const now = performance.now();
  if (lastTick === 0) lastTick = now;
  const elapsed = now - lastTick;
  lastTick = now;
  const turn = state.turn;
  clockMs[turn] -= elapsed;
  if (clockMs[turn] <= 0) {
    clockMs[turn] = 0;
    state = applyTimeout(state, turn);
    clockStarted = false;
    render();
    return;
  }
  // Cheap update: only the clock text, not a full re-render.
  document.querySelectorAll('[data-clock]').forEach((node) => {
    const idx = Number((node as HTMLElement).dataset.clock);
    node.textContent = fmtClock(clockMs[idx as PlayerIndex]);
    node.classList.toggle('low', clockMs[idx as PlayerIndex] < 20000);
  });
}, 100);

// ---------- online actions ----------
async function joinOnline(roomId: string, spectate: boolean): Promise<void> {
  if (!isFirebaseConfigured()) {
    $('onlineStatus').textContent =
      'Firebase not configured — add VITE_FIREBASE_* secrets / .env (see README).';
    return;
  }
  ($('roomInput') as HTMLInputElement).value = roomId;
  await online.joinRoom(roomId, spectate);
}

function roomLink(roomId: string): string {
  return `${location.origin}${location.pathname}#/room/${roomId}`;
}

async function initOnlineFromUrl(): Promise<void> {
  // HashRouter-friendly: #/room/<id> and legacy ?room=<id>, &spectate=1 either place.
  let roomId: string | null = null;
  let spectate = false;
  const search = new URLSearchParams(location.search);
  if (search.get('room')) roomId = search.get('room');
  if (search.get('spectate') === '1') spectate = true;
  const hashMatch = /^#\/room\/([a-z0-9]+)/i.exec(location.hash);
  if (hashMatch) roomId = hashMatch[1];
  const hashQuery = location.hash.split('?')[1];
  if (hashQuery && new URLSearchParams(hashQuery).get('spectate') === '1') spectate = true;
  if (roomId) {
    ($('roomInput') as HTMLInputElement).value = roomId;
    $('onlineStatus').textContent = isFirebaseConfigured()
      ? `Invite link detected — ${spectate ? 'watching' : 'joining'} room ${roomId}…`
      : 'Invite link detected, but Firebase is not configured (see README).';
    if (isFirebaseConfigured()) await joinOnline(roomId, spectate);
  }
}

// ---------- wire up controls ----------
function init(): void {
  const nameInput = $('onlineName') as HTMLInputElement;
  nameInput.value = getAnonName();
  nameInput.addEventListener('change', () => setAnonName(nameInput.value));

  if (!isFirebaseConfigured()) {
    ($('firebaseWarning') as HTMLElement).hidden = false;
    $('onlineCount').textContent = '–';
  } else {
    void online.connect().catch((e) => {
      $('onlineStatus').textContent = `Firebase connect failed: ${String(e)}`;
    });
  }

  $('moveModeBtn').addEventListener('click', () => { inputMode = 'move'; render(); });
  $('wallModeBtn').addEventListener('click', () => { inputMode = 'wall'; render(); });
  const rotate = () => {
    wallOrientation = wallOrientation === 'h' ? 'v' : 'h';
    hoverWall = null;
    render();
  };
  $('rotateBtn').addEventListener('click', rotate);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && inputMode === 'wall') rotate();
  });
  $('showPath').addEventListener('change', render);
  ($('tcSelect') as HTMLSelectElement).addEventListener('change', () => {
    if (state.ply === 0) resetClocks();
    render();
  });
  ($('aiLevel') as HTMLSelectElement).addEventListener('change', () => {
    if (mode === 'ai') $('modeStatus').textContent = `Mode: vs computer (${($('aiLevel') as HTMLSelectElement).value}). You are South.`;
  });

  $('localBtn').addEventListener('click', () => { void online.leave(); newGame('local'); });
  $('aiBtn').addEventListener('click', () => { void online.leave(); newGame('ai'); });
  $('newGameBtn').addEventListener('click', () => newGame(mode === 'online' ? 'local' : mode));
  $('rematchBtn').addEventListener('click', async () => {
    if (mode === 'online') {
      // Simple rematch: a fresh room, link shared again (both players click it).
      const id = await online.createRoom(currentTc());
      history.replaceState(null, '', `#/room/${id}`);
      $('onlineStatus').textContent = `Rematch room created: ${roomLink(id)} — share this link.`;
      state = createGame();
      resetClocks();
      render();
    } else {
      newGame(mode);
    }
  });
  $('resignBtn').addEventListener('click', async () => {
    if (state.winner !== null) return;
    if (mode === 'online') {
      if (online.mySlot === null) return;
      await online.resign();
      state = applyResign(state, online.mySlot as PlayerIndex);
    } else if (mode === 'ai') {
      state = applyResign(state, 0);
    } else {
      state = applyResign(state, state.turn);
    }
    clockStarted = false;
    render();
  });

  $('createRoomBtn').addEventListener('click', async () => {
    if (!isFirebaseConfigured()) {
      $('onlineStatus').textContent =
        'Firebase not configured — add VITE_FIREBASE_* secrets / .env (see README).';
      return;
    }
    try {
      const id = await online.createRoom(currentTc());
      mode = 'online';
      state = createGame();
      resetClocks();
      history.replaceState(null, '', `#/room/${id}`);
      $('onlineStatus').textContent = `Room ${id} created. Invite link: ${roomLink(id)}`;
      render();
    } catch (e) {
      $('onlineStatus').textContent = `Create failed: ${String(e)}`;
    }
  });
  $('joinRoomBtn').addEventListener('click', async () => {
    const id = ($('roomInput') as HTMLInputElement).value.trim();
    if (id) await joinOnline(id, false);
  });
  $('watchRoomBtn').addEventListener('click', async () => {
    const id = ($('roomInput') as HTMLInputElement).value.trim();
    if (id) await joinOnline(id, true);
  });
  $('leaveRoomBtn').addEventListener('click', async () => {
    await online.leave();
    ($('copyLinkBtn') as HTMLButtonElement).disabled = true;
    ($('leaveRoomBtn') as HTMLButtonElement).disabled = true;
    history.replaceState(null, '', location.pathname);
    newGame('local');
  });
  $('copyLinkBtn').addEventListener('click', async () => {
    if (!online.roomId) return;
    const link = roomLink(online.roomId);
    try {
      await navigator.clipboard.writeText(link);
      $('onlineStatus').textContent = `Invite link copied: ${link}`;
    } catch {
      $('onlineStatus').textContent = `Copy this invite link: ${link}`;
    }
  });

  newGame('local');
  void initOnlineFromUrl();
}

init();
