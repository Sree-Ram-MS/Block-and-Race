import { Pos, Wall } from './types';

/**
 * Notation — a game is just an array of these strings.
 *
 * Squares: `a1`–`i9`, always from player 0 / South's perspective.
 *   file = column: a = col 0 (left) … i = col 8
 *   rank = 9 - row: rank 1 = row 8 (bottom, South home), rank 9 = row 0 (top)
 *   So a1 = (row 8, col 0) bottom-left, e1 = South's start, e9 = North's start.
 *
 * Walls: `<file><rank><h|v>`, e.g. `e3h`.
 *   The coordinate names the wall's anchor square: the square that is
 *   top-left of the wall's groove crossing — i.e. anchor (r,c) maps with the
 *   same formula as a square: file = a+c, rank = 9-r.
 *   An `h` wall at anchor (r,c) sits in the groove *below* squares (r,c) and
 *   (r,c+1), spanning columns c..c+1. A `v` wall sits in the groove *right of*
 *   squares (r,c) and (r+1,c), spanning rows r..r+1.
 *   Anchors live on the 8x8 slot grid, so wall files are a–h, ranks 2–9.
 *   Example: `e3h` = anchor r=6, c=4, horizontal.
 */

const FILES = 'abcdefghi';

export function squareToNotation(pos: Pos): string {
  return `${FILES[pos.c]}${9 - pos.r}`;
}

export function notationToSquare(s: string): Pos | null {
  const m = /^([a-i])([1-9])$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  return { r: 9 - Number(m[2]), c: FILES.indexOf(m[1]) };
}

export function wallToNotation(w: Wall): string {
  return `${FILES[w.c]}${9 - w.r}${w.o}`;
}

export function notationToWall(s: string): Wall | null {
  const m = /^([a-h])([2-9])([hv])$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  return { r: 9 - Number(m[2]), c: FILES.indexOf(m[1]), o: m[3] as Wall['o'] };
}

export type ParsedMove =
  | { type: 'pawn'; to: Pos }
  | { type: 'wall'; wall: Wall };

/** A wall string is 3 chars ending in h/v; a pawn move is a 2-char square. */
export function parseMoveNotation(s: string): ParsedMove | null {
  const t = s.trim().toLowerCase();
  if (/^[a-h][2-9][hv]$/.test(t)) {
    const wall = notationToWall(t);
    return wall ? { type: 'wall', wall } : null;
  }
  const to = notationToSquare(t);
  return to ? { type: 'pawn', to } : null;
}

export function isWallNotation(s: string): boolean {
  return /^[a-h][2-9][hv]$/.test(s.trim().toLowerCase());
}
