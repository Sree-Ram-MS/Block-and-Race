import { GameState, PlayerIndex, WALLS_PER_PLAYER } from './types';

export function createGame(): GameState {
  return {
    pawns: [
      { r: 8, c: 4 }, // player 0, South, races to row 0
      { r: 0, c: 4 }, // player 1, North, races to row 8
    ],
    goals: [0, 8],
    wallsLeft: [WALLS_PER_PLAYER, WALLS_PER_PLAYER],
    walls: new Set<string>(),
    turn: 0 as PlayerIndex,
    ply: 0,
    moves: [],
    winner: null,
    winReason: null,
  };
}

/** Deep-enough clone: pawns, wallsLeft, walls Set and moves are all copied. */
export function cloneGame(s: GameState): GameState {
  return {
    pawns: [{ ...s.pawns[0] }, { ...s.pawns[1] }],
    goals: [s.goals[0], s.goals[1]],
    wallsLeft: [s.wallsLeft[0], s.wallsLeft[1]],
    walls: new Set(s.walls),
    turn: s.turn,
    ply: s.ply,
    moves: [...s.moves],
    winner: s.winner,
    winReason: s.winReason,
  };
}
