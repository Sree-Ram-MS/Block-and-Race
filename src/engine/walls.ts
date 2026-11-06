import { GameState, PlayerIndex, Wall } from './types';
import { hasPath } from './path';

export const wallKey = (w: Wall): string => `${w.r},${w.c},${w.o}`;

export function parseWallKey(key: string): Wall {
  const [r, c, o] = key.split(',');
  return { r: Number(r), c: Number(c), o: o as Wall['o'] };
}

export const wallFromKey = parseWallKey;

export interface WallCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Is wall `w` legal for `player`?
 *
 * Conflict rules (exactly the verified prototype + the spec):
 *  - H(r,c) clashes with H(r,c-1), H(r,c+1)   (collinear overlap) and V(r,c) (cross)
 *  - V(r,c) clashes with V(r-1,c), V(r+1,c)   (collinear overlap) and H(r,c) (cross)
 *  - Same slot + same orientation           (exact overlap)
 * Note the GAP case: H(r,c) and H(r,c+2) do *not* conflict — two walls placed
 * end-to-end leave a one-crossing gap, and a V wall anchored in that gap slot
 * (r,c+1) crosses neither of them, so it is legal (subject to the seal check).
 * Finally, a BFS must still leave BOTH pawns a route to their goal row.
 */
/** Bounds + overlap/cross/collinear conflicts only (no BFS seal check). Cheap. */
export function wallConflict(state: GameState, w: Wall): WallCheck {
  if (w.r < 0 || w.r > 7 || w.c < 0 || w.c > 7)
    return { ok: false, reason: 'Off the board.' };
  for (const key of state.walls) {
    const x = parseWallKey(key);
    if (x.r === w.r && x.c === w.c) {
      return {
        ok: false,
        reason: x.o === w.o ? 'Walls cannot overlap.' : 'Walls cannot cross.',
      };
    }
    if (w.o === 'h' && x.o === 'h' && x.r === w.r && Math.abs(x.c - w.c) === 1)
      return { ok: false, reason: 'Walls cannot overlap.' };
    if (w.o === 'v' && x.o === 'v' && x.c === w.c && Math.abs(x.r - w.r) === 1)
      return { ok: false, reason: 'Walls cannot overlap.' };
  }
  return { ok: true };
}

export function wallLegal(state: GameState, player: PlayerIndex, w: Wall): WallCheck {
  if (state.winner !== null) return { ok: false, reason: 'Game is over.' };
  if (state.wallsLeft[player] <= 0) return { ok: false, reason: 'No walls left.' };
  const conflict = wallConflict(state, w);
  if (!conflict.ok) return conflict;

  const trial = new Set(state.walls);
  trial.add(wallKey(w));
  for (const p of [0, 1] as PlayerIndex[]) {
    if (!hasPath(trial, state.pawns[p], state.goals[p]))
      return {
        ok: false,
        reason: 'Illegal: that would leave a pawn with no route to its goal.',
      };
  }
  return { ok: true };
}

/** All currently legal wall placements for `player` (used by the AI). */
export function allLegalWalls(state: GameState, player: PlayerIndex): Wall[] {
  const out: Wall[] = [];
  if (state.wallsLeft[player] <= 0) return out;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      for (const o of ['h', 'v'] as const) {
        const w = { r, c, o };
        if (wallLegal(state, player, w).ok) out.push(w);
      }
  return out;
}
