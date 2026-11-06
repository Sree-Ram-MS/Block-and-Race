import { GameState, PlayerIndex, Pos, Wall } from './types';
import { cloneGame, createGame } from './state';
import { legalMoves } from './moves';
import { wallKey, wallLegal } from './walls';
import { parseMoveNotation, squareToNotation, wallToNotation } from './notation';
import { other } from './types';

export interface ApplyResult {
  ok: boolean;
  reason?: string;
  /** New state when ok; the (unmodified) input state when not ok. */
  state: GameState;
}

function fail(state: GameState, reason: string): ApplyResult {
  return { ok: false, reason, state };
}

function finishTurn(next: GameState, notation: string): GameState {
  next.moves.push(notation);
  next.ply += 1;
  const mover = next.turn;
  if (next.pawns[mover].r === next.goals[mover]) {
    next.winner = mover;
    next.winReason = 'goal';
  } else {
    next.turn = other(mover);
  }
  return next;
}

export function applyPawnMove(state: GameState, to: Pos): ApplyResult {
  if (state.winner !== null) return fail(state, 'Game is over.');
  const legal = legalMoves(state, state.turn);
  if (!legal.some((m) => m.r === to.r && m.c === to.c))
    return fail(state, 'Illegal pawn move.');
  const next = cloneGame(state);
  next.pawns[next.turn] = { r: to.r, c: to.c };
  return { ok: true, state: finishTurn(next, squareToNotation(to)) };
}

export function applyWall(state: GameState, wall: Wall): ApplyResult {
  if (state.winner !== null) return fail(state, 'Game is over.');
  const chk = wallLegal(state, state.turn, wall);
  if (!chk.ok) return fail(state, chk.reason ?? 'Illegal wall.');
  const next = cloneGame(state);
  next.walls.add(wallKey(wall));
  next.wallsLeft[next.turn] -= 1;
  return { ok: true, state: finishTurn(next, wallToNotation(wall)) };
}

/** Apply one notation string ("e2" pawn move, "e3h" wall) for the side to move. */
export function applyMove(state: GameState, notation: string): ApplyResult {
  const parsed = parseMoveNotation(notation);
  if (!parsed) return fail(state, `Bad notation: "${notation}"`);
  return parsed.type === 'pawn'
    ? applyPawnMove(state, parsed.to)
    : applyWall(state, parsed.wall);
}

/** End the game by resignation: `player` resigns, the other player wins. */
export function applyResign(state: GameState, player: PlayerIndex): GameState {
  const next = cloneGame(state);
  if (next.winner === null) {
    next.winner = other(player);
    next.winReason = 'resign';
  }
  return next;
}

export function applyTimeout(state: GameState, player: PlayerIndex): GameState {
  const next = cloneGame(state);
  if (next.winner === null) {
    next.winner = other(player);
    next.winReason = 'timeout';
  }
  return next;
}

export interface ReplayResult {
  state: GameState;
  /** Index of the first illegal/unparseable move, or -1 if the whole list replayed. */
  failedAt: number;
  reason?: string;
}

/** Rebuild a game from its notation array alone — the online / TV / puzzle path. */
export function replay(moves: string[]): ReplayResult {
  let state = createGame();
  for (let i = 0; i < moves.length; i++) {
    const res = applyMove(state, moves[i]);
    if (!res.ok) return { state, failedAt: i, reason: res.reason };
    state = res.state;
  }
  return { state, failedAt: -1 };
}
