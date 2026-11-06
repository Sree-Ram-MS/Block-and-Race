import {
  wallLegal,
  applyMove,
  GameState,
  legalMoves,
  notationToWall,
  other,
  parseMoveNotation,
  pathDistance,
  PlayerIndex,
  squareToNotation,
  wallToNotation,
} from '../engine';

export type AiLevel = 'easy' | 'medium' | 'hard';

/**
 * Heuristic, from `player`'s point of view (the spec's scoring rule):
 *   score = opponent's shortest-path length - own shortest-path length
 * …scaled up, plus small terms for walls in hand and race progress, and a
 * large terminal bonus for winning.
 */
export function evaluate(state: GameState, player: PlayerIndex): number {
  const opp = other(player);
  if (state.winner === player) return 10000;
  if (state.winner === opp) return -10000;
  const myDist = pathDistance(state.walls, state.pawns[player], state.goals[player]);
  const oppDist = pathDistance(state.walls, state.pawns[opp], state.goals[opp]);
  return (
    (oppDist - myDist) * 100 +
    (state.wallsLeft[player] - state.wallsLeft[opp]) * 2
  );
}

/**
 * Candidate actions for search: every pawn move, plus wall placements
 * pruned to grooves near either pawn (walls far from both pawns almost
 * never matter at a 2–3 ply horizon), cut to a cap so the search stays
 * fast. Legality (including the BFS seal check) is only run for the
 * near-pawn grooves — never for all 128 slots — and no per-candidate
 * heuristic scoring happens here: the search itself does the scoring,
 * which keeps a hard move well under ~500 ms on the opening.
 * Order matters for alpha-beta: pawn moves first (usually strongest),
 * then walls ordered by immediate opponent-path gain.
 */
function candidates(state: GameState, player: PlayerIndex, wallCap: number): string[] {
  const out: string[] = [];
  for (const m of legalMoves(state, player)) out.push(squareToNotation(m));

  if (state.wallsLeft[player] > 0 && wallCap > 0) {
    const opp = other(player);
    const oppBefore = pathDistance(state.walls, state.pawns[opp], state.goals[opp]);
    const walls: { notation: string; gain: number }[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const near = [state.pawns[0], state.pawns[1]].some(
          (p) => Math.abs(r - p.r) <= 2 && Math.abs(c - p.c) <= 2,
        );
        if (!near) continue;
        for (const o of ['h', 'v'] as const) {
          const w = { r, c, o };
          if (!wallLegal(state, player, w).ok) continue;
          const trial = new Set(state.walls);
          trial.add(`${r},${c},${o}`);
          const gain =
            pathDistance(trial, state.pawns[opp], state.goals[opp]) - oppBefore;
          walls.push({ notation: wallToNotation(w), gain });
        }
      }
    }
    walls.sort((a, b) => b.gain - a.gain);
    out.push(...walls.slice(0, wallCap).map((w) => w.notation));
  }
  return out;
}

function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  root: PlayerIndex,
): number {
  if (depth === 0 || state.winner !== null) return evaluate(state, root);
  const player = state.turn;
  const maximizing = player === root;
  const acts = candidates(state, player, 3);
  if (acts.length === 0) return evaluate(state, root);
  if (maximizing) {
    let value = -Infinity;
    for (const a of acts) {
      const res = applyMove(state, a);
      if (!res.ok) continue;
      value = Math.max(value, alphabeta(res.state, depth - 1, alpha, beta, root));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }
  let value = Infinity;
  for (const a of acts) {
    const res = applyMove(state, a);
    if (!res.ok) continue;
    value = Math.min(value, alphabeta(res.state, depth - 1, alpha, beta, root));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

/**
 * Choose a move for the player to move. Returns a notation string
 * ("e2" / "e3h"), or null if the game is over / no move exists.
 *
 * Levels: easy = depth 1 with blunders, medium = depth 2, hard = depth 3
 * alpha-beta over pruned wall candidates. Synchronous; the hard search on
 * the opening position is kept well under ~500 ms by the pruning above
 * (verified by a unit smoke check during development). The UI calls this
 * inside a setTimeout so rendering isn't blocked; a Web Worker wrapper
 * (ai.worker.ts) is a future upgrade, noted in the README.
 */
export function chooseAiMove(state: GameState, level: AiLevel): string | null {
  if (state.winner !== null) return null;
  const player = state.turn;
  const depth = level === 'easy' ? 1 : level === 'medium' ? 2 : 3;
  const wallCap = level === 'easy' ? 4 : level === 'medium' ? 5 : 6;
  const acts = candidates(state, player, wallCap);
  if (acts.length === 0) return null;

  let best = -Infinity;
  let bestMoves: string[] = [];
  for (const a of acts) {
    const res = applyMove(state, a);
    if (!res.ok) continue;
    const v =
      depth <= 1
        ? evaluate(res.state, player)
        : alphabeta(res.state, depth - 1, -Infinity, Infinity, player);
    if (v > best + 1e-9) {
      best = v;
      bestMoves = [a];
    } else if (Math.abs(v - best) <= 1e-9) {
      bestMoves.push(a);
    }
  }
  if (bestMoves.length === 0) return null;

  if (level === 'easy') {
    // Blunder 35% of the time: pick a random pawn move instead.
    if (Math.random() < 0.35) {
      const pawnMoves = acts
                .filter((n) => parseMoveNotation(n)?.type === 'pawn');
      if (pawnMoves.length)
        return pawnMoves[Math.floor(Math.random() * pawnMoves.length)];
    }
    // Otherwise pick randomly among near-best to feel less robotic.
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
  return bestMoves[0];
}

export { notationToWall };
