import { DIRS, GameState, inBoard, PawnMove, PlayerIndex } from './types';
import { edgeBlocked } from './path';

/** Convenience alias matching the design doc's `blocked(cell, dir)` wording. */
export function blocked(
  state: GameState,
  r: number,
  c: number,
  dr: number,
  dc: number,
): boolean {
  return edgeBlocked(state.walls, r, c, dr, dc);
}

/**
 * All legal pawn moves for `player`, including the face-to-face rules:
 * jump straight over the opponent; if the jump square is off-board or the
 * edge behind the opponent is walled, diagonal side-steps beside the
 * opponent instead.
 */
export function legalMoves(state: GameState, player: PlayerIndex): PawnMove[] {
  const me = state.pawns[player];
  const opp = state.pawns[player === 0 ? 1 : 0];
  const out: PawnMove[] = [];
  for (const { dr, dc } of DIRS) {
    const nr = me.r + dr;
    const nc = me.c + dc;
    if (!inBoard(nr, nc) || edgeBlocked(state.walls, me.r, me.c, dr, dc)) continue;
    if (nr !== opp.r || nc !== opp.c) {
      out.push({ r: nr, c: nc, kind: 'move' });
      continue;
    }
    // Face to face -> try the jump straight over.
    const jr = nr + dr;
    const jc = nc + dc;
    if (inBoard(jr, jc) && !edgeBlocked(state.walls, nr, nc, dr, dc)) {
      out.push({ r: jr, c: jc, kind: 'jump' });
    } else {
      // Jump blocked -> diagonal side-steps beside the opponent.
      const perps =
        dr !== 0
          ? [
              { dr: 0, dc: -1 },
              { dr: 0, dc: 1 },
            ]
          : [
              { dr: -1, dc: 0 },
              { dr: 1, dc: 0 },
            ];
      for (const p of perps) {
        const sr = nr + p.dr;
        const sc = nc + p.dc;
        if (inBoard(sr, sc) && !edgeBlocked(state.walls, nr, nc, p.dr, p.dc))
          out.push({ r: sr, c: sc, kind: 'sidestep' });
      }
    }
  }
  return out;
}
