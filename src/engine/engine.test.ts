import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyPawnMove,
  applyResign,
  applyWall,
  createGame,
  distancesToGoal,
  edgeBlocked,
  GameState,
  hasPath,
  legalMoves,
  notationToSquare,
  notationToWall,
  parseMoveNotation,
  pathDistance,
  replay,
  shortestPath,
  squareToNotation,
  wallKey,
  wallLegal,
  wallToNotation,
} from './index';

function withWalls(s: GameState, keys: string[]): GameState {
  for (const k of keys) s.walls.add(k);
  return s;
}
const hasMove = (s: GameState, p: 0 | 1, r: number, c: number) =>
  legalMoves(s, p).some((m) => m.r === r && m.c === c);

describe('starting position', () => {
  it('starts pawns at (8,4) and (0,4) with 10 walls each, South to move', () => {
    const s = createGame();
    expect(s.pawns).toEqual([
      { r: 8, c: 4 },
      { r: 0, c: 4 },
    ]);
    expect(s.wallsLeft).toEqual([10, 10]);
    expect(s.turn).toBe(0);
    expect(s.ply).toBe(0);
    expect(s.winner).toBeNull();
    expect(s.walls.size).toBe(0);
  });

  it('South has exactly 3 opening moves (up, left, right)', () => {
    const s = createGame();
    const moves = legalMoves(s, 0);
    expect(moves).toHaveLength(3);
    expect(hasMove(s, 0, 7, 4)).toBe(true);
    expect(hasMove(s, 0, 8, 3)).toBe(true);
    expect(hasMove(s, 0, 8, 5)).toBe(true);
  });

  it('North has exactly 3 opening moves (down, left, right)', () => {
    const s = createGame();
    expect(legalMoves(s, 1)).toHaveLength(3);
    expect(hasMove(s, 1, 1, 4)).toBe(true);
  });

  it('open-board path distance is 8 for both pawns', () => {
    const s = createGame();
    expect(pathDistance(s.walls, s.pawns[0], 0)).toBe(8);
    expect(pathDistance(s.walls, s.pawns[1], 8)).toBe(8);
    expect(distancesToGoal(s.walls, 0)[8][4]).toBe(8);
  });

  it('shortest path on an open board has 9 squares / 8 steps', () => {
    const s = createGame();
    const p = shortestPath(s.walls, s.pawns[0], 0);
    expect(p).toHaveLength(9);
    expect(p[0]).toEqual({ r: 8, c: 4 });
    expect(p[8].r).toBe(0);
  });
});

describe('walls block movement', () => {
  it('a horizontal wall blocks the pawn below it moving up', () => {
    const s = withWalls(createGame(), ['7,4,h']);
    expect(hasMove(s, 0, 7, 4)).toBe(false);
    expect(legalMoves(s, 0)).toHaveLength(2);
  });

  it('the same horizontal wall blocks the pawn above it moving down', () => {
    const s = createGame();
    s.pawns[0] = { r: 7, c: 4 };
    s.walls.add('7,4,h');
    expect(edgeBlocked(s.walls, 7, 4, 1, 0)).toBe(true);
    expect(hasMove(s, 0, 8, 4)).toBe(false);
  });

  it('a vertical wall blocks left/right movement across both its rows', () => {
    const s = createGame();
    s.walls.add(wallKey({ r: 4, c: 4, o: 'v' }));
    expect(edgeBlocked(s.walls, 4, 4, 0, 1)).toBe(true);
    expect(edgeBlocked(s.walls, 4, 5, 0, -1)).toBe(true);
    expect(edgeBlocked(s.walls, 5, 4, 0, 1)).toBe(true);
    expect(edgeBlocked(s.walls, 5, 5, 0, -1)).toBe(true);
    expect(edgeBlocked(s.walls, 6, 4, 0, 1)).toBe(false);
  });
});

describe('wall conflicts', () => {
  it('rejects an exact H overlap', () => {
    const s = withWalls(createGame(), ['4,4,h']);
    expect(wallLegal(s, 0, { r: 4, c: 4, o: 'h' }).ok).toBe(false);
  });
  it('rejects an exact V overlap', () => {
    const s = withWalls(createGame(), ['4,4,v']);
    expect(wallLegal(s, 0, { r: 4, c: 4, o: 'v' }).ok).toBe(false);
  });
  it('rejects a collinear H wall one slot along (overlap)', () => {
    const s = withWalls(createGame(), ['4,4,h']);
    expect(wallLegal(s, 0, { r: 4, c: 5, o: 'h' }).ok).toBe(false);
    expect(wallLegal(s, 0, { r: 4, c: 3, o: 'h' }).ok).toBe(false);
  });
  it('rejects a collinear V wall one slot along (overlap)', () => {
    const s = withWalls(createGame(), ['4,4,v']);
    expect(wallLegal(s, 0, { r: 5, c: 4, o: 'v' }).ok).toBe(false);
    expect(wallLegal(s, 0, { r: 3, c: 4, o: 'v' }).ok).toBe(false);
  });
  it('rejects crossing walls on the same anchor', () => {
    const s = withWalls(createGame(), ['4,4,h']);
    const chk = wallLegal(s, 0, { r: 4, c: 4, o: 'v' });
    expect(chk.ok).toBe(false);
    expect(chk.reason).toMatch(/cross/i);
  });
  it('rejects out-of-bounds wall anchors', () => {
    const s = createGame();
    expect(wallLegal(s, 0, { r: 8, c: 0, o: 'h' }).ok).toBe(false);
    expect(wallLegal(s, 0, { r: 0, c: 8, o: 'v' }).ok).toBe(false);
    expect(wallLegal(s, 0, { r: -1, c: 0, o: 'h' }).ok).toBe(false);
  });
});

describe('the GAP case', () => {
  it('H at (r,c) and H at (r,c+2) do not conflict — a gap remains', () => {
    const s = withWalls(createGame(), ['5,2,h']);
    expect(wallLegal(s, 0, { r: 5, c: 4, o: 'h' }).ok).toBe(true);
  });
  it('a V wall anchored in the gap slot can pass between end-to-end H walls', () => {
    const s = withWalls(createGame(), ['5,2,h', '5,4,h']);
    // Gap crossing is anchor (5,3): it crosses neither H wall.
    expect(wallLegal(s, 0, { r: 5, c: 3, o: 'v' }).ok).toBe(true);
  });
});

describe('seal check (BFS)', () => {
  // Barrier: a full row of H walls at r=4 (gap only at col 8), an H wall
  // closing the top of that gap pocket, and the trial V wall closing its side.
  const barrier = ['4,0,h', '4,2,h', '4,4,h', '4,6,h', '3,7,h'];
  it('rejects a wall that would seal South off from its goal', () => {
    const s = withWalls(createGame(), barrier);
    const chk = wallLegal(s, 0, { r: 4, c: 7, o: 'v' });
    expect(chk.ok).toBe(false);
    expect(chk.reason).toMatch(/no route/i);
  });
  it('the sealed position really has no path for South', () => {
    const s = withWalls(createGame(), [...barrier, '4,7,v']);
    expect(hasPath(s.walls, s.pawns[0], 0)).toBe(false);
  });
  it('the sealed position really has no path for North either', () => {
    const s = withWalls(createGame(), [...barrier, '4,7,v']);
    expect(hasPath(s.walls, s.pawns[1], 8)).toBe(false);
  });
  it('without the sealing wall both pawns still have a path', () => {
    const s = withWalls(createGame(), barrier);
    expect(hasPath(s.walls, s.pawns[0], 0)).toBe(true);
    expect(hasPath(s.walls, s.pawns[1], 8)).toBe(true);
  });
});

describe('face-to-face jumps', () => {
  function faceToFace(): GameState {
    const s = createGame();
    s.pawns[0] = { r: 5, c: 4 };
    s.pawns[1] = { r: 4, c: 4 };
    return s;
  }
  it('jumps straight over the opponent', () => {
    const s = faceToFace();
    expect(hasMove(s, 0, 3, 4)).toBe(true);
    expect(hasMove(s, 0, 4, 4)).toBe(false); // cannot stay/move onto opponent
    expect(legalMoves(s, 0).find((m) => m.r === 3 && m.c === 4)?.kind).toBe('jump');
  });
  it('offers both diagonal sidesteps when the jump is walled', () => {
    const s = faceToFace();
    s.walls.add('3,4,h'); // walls the edge behind the opponent
    expect(hasMove(s, 0, 3, 4)).toBe(false);
    expect(hasMove(s, 0, 4, 3)).toBe(true);
    expect(hasMove(s, 0, 4, 5)).toBe(true);
    expect(legalMoves(s, 0).find((m) => m.r === 4 && m.c === 3)?.kind).toBe('sidestep');
  });
  it('drops a sidestep that is itself walled', () => {
    const s = faceToFace();
    s.walls.add('3,4,h');
    s.walls.add('3,3,v'); // blocks (4,4) -> (4,3)
    expect(hasMove(s, 0, 4, 3)).toBe(false);
    expect(hasMove(s, 0, 4, 5)).toBe(true);
  });
  it('at the board edge, a face-to-face pawn sidesteps instead of jumping off', () => {
    const s = createGame();
    s.pawns[0] = { r: 1, c: 4 };
    s.pawns[1] = { r: 0, c: 4 }; // opponent on the edge row
    expect(hasMove(s, 0, 0, 3)).toBe(true);
    expect(hasMove(s, 0, 0, 5)).toBe(true);
    expect(legalMoves(s, 0).every((m) => m.r >= 0)).toBe(true);
  });
});

describe('applying moves', () => {
  it('a pawn move switches turn, increments ply and records notation', () => {
    const s = createGame();
    const res = applyPawnMove(s, { r: 7, c: 4 });
    expect(res.ok).toBe(true);
    expect(res.state.turn).toBe(1);
    expect(res.state.ply).toBe(1);
    expect(res.state.moves).toEqual(['e2']);
    expect(res.state.wallsLeft).toEqual([10, 10]);
    expect(s.ply).toBe(0); // input state untouched
  });
  it('an illegal pawn move is rejected and changes nothing', () => {
    const s = createGame();
    const res = applyPawnMove(s, { r: 6, c: 4 });
    expect(res.ok).toBe(false);
    expect(res.state.ply).toBe(0);
  });
  it('reaching the far row wins the game', () => {
    const s = createGame();
    s.pawns[0] = { r: 1, c: 4 };
    s.pawns[1] = { r: 5, c: 5 };
    const res = applyMove(s, 'e9');
    expect(res.ok).toBe(true);
    expect(res.state.winner).toBe(0);
    expect(res.state.winReason).toBe('goal');
  });
  it('no moves are accepted after the game is won', () => {
    const s = createGame();
    s.pawns[0] = { r: 1, c: 4 };
    s.pawns[1] = { r: 5, c: 5 };
    const won = applyMove(s, 'e9').state;
    expect(applyPawnMove(won, { r: 5, c: 4 }).ok).toBe(false);
  });
  it('resign gives the win to the other player', () => {
    const s = applyResign(createGame(), 0);
    expect(s.winner).toBe(1);
    expect(s.winReason).toBe('resign');
  });
  it('placing a wall decrements only the mover\'s wallsLeft', () => {
    const s = createGame();
    const res = applyWall(s, { r: 4, c: 4, o: 'h' });
    expect(res.ok).toBe(true);
    expect(res.state.wallsLeft).toEqual([9, 10]);
    expect(res.state.moves).toEqual(['e5h']);
    expect(res.state.turn).toBe(1);
  });
  it('a player with 0 walls left cannot place another', () => {
    const s = createGame();
    s.wallsLeft[0] = 0;
    expect(wallLegal(s, 0, { r: 4, c: 4, o: 'h' }).ok).toBe(false);
    expect(applyWall(s, { r: 4, c: 4, o: 'h' }).ok).toBe(false);
    expect(applyMove(s, 'e5h').ok).toBe(false);
  });
  it('an illegal (crossing) wall via notation is rejected', () => {
    const s = withWalls(createGame(), ['4,4,h']);
    expect(applyMove(s, 'e5v').ok).toBe(false);
  });
});

describe('notation', () => {
  it('maps key squares: a1 bottom-left, e1 South start, e9 North start, i9 top-right', () => {
    expect(squareToNotation({ r: 8, c: 0 })).toBe('a1');
    expect(squareToNotation({ r: 8, c: 4 })).toBe('e1');
    expect(squareToNotation({ r: 0, c: 4 })).toBe('e9');
    expect(squareToNotation({ r: 0, c: 8 })).toBe('i9');
  });
  it('round-trips every square', () => {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        expect(notationToSquare(squareToNotation({ r, c }))).toEqual({ r, c });
  });
  it('round-trips every wall anchor and orientation', () => {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        for (const o of ['h', 'v'] as const)
          expect(notationToWall(wallToNotation({ r, c, o }))).toEqual({ r, c, o });
  });
  it('e3h means anchor r=6, c=4, horizontal — and back', () => {
    expect(notationToWall('e3h')).toEqual({ r: 6, c: 4, o: 'h' });
    expect(wallToNotation({ r: 6, c: 4, o: 'h' })).toBe('e3h');
    expect(notationToWall('e3v')).toEqual({ r: 6, c: 4, o: 'v' });
  });
  it('parseMoveNotation distinguishes pawn moves from walls', () => {
    expect(parseMoveNotation('e2')).toEqual({ type: 'pawn', to: { r: 7, c: 4 } });
    expect(parseMoveNotation('e3h')).toEqual({
      type: 'wall',
      wall: { r: 6, c: 4, o: 'h' },
    });
  });
  it('rejects garbage notation', () => {
    expect(parseMoveNotation('z9')).toBeNull();
    expect(parseMoveNotation('e0')).toBeNull();
    expect(parseMoveNotation('e3x')).toBeNull();
    expect(parseMoveNotation('')).toBeNull();
    expect(notationToSquare('a10')).toBeNull();
  });
});

describe('replay', () => {
  const list = ['e2', 'e8', 'a2h', 'e7', 'e3'];
  it('replay of a move list equals the stepwise state', () => {
    let step = createGame();
    for (const m of list) {
      const res = applyMove(step, m);
      expect(res.ok).toBe(true);
      step = res.state;
    }
    const rep = replay(list);
    expect(rep.failedAt).toBe(-1);
    expect(rep.state.pawns).toEqual(step.pawns);
    expect([...rep.state.walls].sort()).toEqual([...step.walls].sort());
    expect(rep.state.wallsLeft).toEqual(step.wallsLeft);
    expect(rep.state.turn).toBe(step.turn);
    expect(rep.state.ply).toBe(step.ply);
    expect(rep.state.moves).toEqual(list);
  });
  it('replay stops at the first illegal move and reports its index', () => {
    const rep = replay(['e2', 'e2', 'e3']);
    expect(rep.failedAt).toBe(1); // North cannot move to e2
    expect(rep.state.ply).toBe(1);
  });
  it('replay of an empty list is a fresh game', () => {
    const rep = replay([]);
    expect(rep.failedAt).toBe(-1);
    expect(rep.state.ply).toBe(0);
  });
});
