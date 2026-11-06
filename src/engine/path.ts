import { DIRS, inBoard, Pos, SIZE } from './types';

type WallSet = ReadonlySet<string>;

function toSet(walls: WallSet | string[]): WallSet {
  return Array.isArray(walls) ? new Set(walls) : walls;
}

/** Is the edge from (r,c) in direction (dr,dc) blocked by a wall? */
export function edgeBlocked(wallsIn: WallSet | string[], r: number, c: number, dr: number, dc: number): boolean {
  const walls = toSet(wallsIn);
  const has = (wr: number, wc: number, o: string) => walls.has(`${wr},${wc},${o}`);
  if (dc === 1) return has(r, c, 'v') || has(r - 1, c, 'v');
  if (dc === -1) return has(r, c - 1, 'v') || has(r - 1, c - 1, 'v');
  if (dr === 1) return has(r, c, 'h') || has(r, c - 1, 'h');
  if (dr === -1) return has(r - 1, c, 'h') || has(r - 1, c - 1, 'h');
  return false;
}

// Helper so wall objects can be turned into a set elsewhere.
export function wallsToSet(walls: { r: number; c: number; o: string }[]): Set<string> {
  return new Set(walls.map((w) => `${w.r},${w.c},${w.o}`));
}

/**
 * BFS distances from every square to `goalRow`, ignoring pawns.
 * Infinity = unreachable. Pass `target` to stop as soon as that square's
 * distance is known (a big saving for the AI's many pathDistance calls).
 */
export function distancesToGoal(
  wallsIn: WallSet | string[],
  goalRow: number,
  target?: Pos,
): number[][] {
  const walls = toSet(wallsIn);
  const dist: number[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(Infinity));
  const q: [number, number][] = [];
  for (let c = 0; c < SIZE; c++) {
    dist[goalRow][c] = 0;
    q.push([goalRow, c]);
  }
  if (target && target.r === goalRow) return dist;
  let head = 0;
  while (head < q.length) {
    const [r, c] = q[head++];
    for (const { dr, dc } of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBoard(nr, nc) || dist[nr][nc] !== Infinity) continue;
      if (edgeBlocked(walls, r, c, dr, dc)) continue;
      dist[nr][nc] = dist[r][c] + 1;
      if (target && nr === target.r && nc === target.c) return dist;
      q.push([nr, nc]);
    }
  }
  return dist;
}

export function pathDistance(walls: WallSet | string[], pos: Pos, goalRow: number): number {
  return distancesToGoal(walls, goalRow, pos)[pos.r][pos.c];
}

export function hasPath(walls: WallSet | string[], pos: Pos, goalRow: number): boolean {
  return pathDistance(walls, pos, goalRow) !== Infinity;
}

/** One shortest path (list of squares, pawn first, goal square last), or []. */
export function shortestPath(wallsIn: WallSet | string[], pos: Pos, goalRow: number): Pos[] {
  const walls = toSet(wallsIn);
  const dist = distancesToGoal(walls, goalRow);
  if (dist[pos.r][pos.c] === Infinity) return [];
  const path: Pos[] = [{ ...pos }];
  let cur = { ...pos };
  while (dist[cur.r][cur.c] > 0) {
    let stepped = false;
    for (const { dr, dc } of DIRS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!inBoard(nr, nc)) continue;
      if (edgeBlocked(walls, cur.r, cur.c, dr, dc)) continue;
      if (dist[nr][nc] === dist[cur.r][cur.c] - 1) {
        cur = { r: nr, c: nc };
        path.push(cur);
        stepped = true;
        break;
      }
    }
    if (!stepped) return [];
  }
  return path;
}
