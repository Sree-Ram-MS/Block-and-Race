/** Core types for the Barricade (Quoridor-style) rules engine. Pure, no deps. */

export const SIZE = 9;
export const WALLS_PER_PLAYER = 10;

export type PlayerIndex = 0 | 1;
export type Orientation = 'h' | 'v';

export interface Pos {
  r: number; // 0 = top row (North home), 8 = bottom row (South home)
  c: number; // 0 = left, 8 = right
}

/** A wall on the 8x8 slot grid. Anchor (r,c) is its top-left groove crossing, 0..7. */
export interface Wall {
  r: number;
  c: number;
  o: Orientation;
}

export interface GameState {
  pawns: [Pos, Pos];
  /** Goal row per player: player 0 (South) races to row 0, player 1 to row 8. */
  goals: [number, number];
  wallsLeft: [number, number];
  /** Wall keys, see wallKey(): "r,c,h" | "r,c,v". */
  walls: Set<string>;
  turn: PlayerIndex;
  ply: number;
  /** Notation strings, the single source of truth (replays, online, puzzles). */
  moves: string[];
  winner: PlayerIndex | null;
  winReason: 'goal' | 'resign' | 'timeout' | null;
}

export type MoveKind = 'move' | 'jump' | 'sidestep';

export interface PawnMove extends Pos {
  kind: MoveKind;
}

export interface Dir {
  dr: number;
  dc: number;
}

export const DIRS: Dir[] = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

export const inBoard = (r: number, c: number): boolean =>
  r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0) as PlayerIndex;
