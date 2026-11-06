import { GameState, legalMoves, PawnMove, PlayerIndex, Pos, shortestPath, Wall } from '../engine';
import { wallKey, wallLegal } from '../engine';

export const CELL = 52;
export const GROOVE = 14;
export const STEP = CELL + GROOVE;
export const BOARD_PX = 9 * CELL + 8 * GROOVE; // 580

const SVGNS = 'http://www.w3.org/2000/svg';

export interface BoardOptions {
  /** Which player sits at the bottom of the screen. */
  viewer: PlayerIndex;
  /** 'move' = pawn dots clickable, 'wall' = grooves clickable. */
  inputMode: 'move' | 'wall';
  wallOrientation: 'h' | 'v';
  showPath: boolean;
  /** Can the viewer act right now? (turn, mode, game not over) */
  interactive: boolean;
  hoverWall: Wall | null;
  onPawnMove: (to: Pos) => void;
  onWallHover: (w: Wall | null) => void;
  onWallPlace: (w: Wall) => void;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: SVGElement,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.appendChild(node);
  return node;
}

/** Display coords: viewer always sees their own pawn at the bottom (180° flip for North). */
export function toDisplay(pos: Pos, viewer: PlayerIndex): Pos {
  return viewer === 0 ? { ...pos } : { r: 8 - pos.r, c: 8 - pos.c };
}

function centre(pos: Pos, viewer: PlayerIndex): [number, number] {
  const d = toDisplay(pos, viewer);
  return [d.c * STEP + CELL / 2, d.r * STEP + CELL / 2];
}

/** Pixel rect of a wall in unflipped space, then rotated 180° when flipped. */
function wallRect(w: Wall, viewer: PlayerIndex): { x: number; y: number; w: number; h: number } {
  let rect =
    w.o === 'h'
      ? { x: w.c * STEP, y: w.r * STEP + CELL, w: 2 * CELL + GROOVE, h: GROOVE }
      : { x: w.c * STEP + CELL, y: w.r * STEP, w: GROOVE, h: 2 * CELL + GROOVE };
  if (viewer === 1) {
    rect = {
      x: BOARD_PX - rect.x - rect.w,
      y: BOARD_PX - rect.y - rect.h,
      w: rect.w,
      h: rect.h,
    };
  }
  return rect;
}

export function renderBoard(container: HTMLElement, state: GameState, opts: BoardOptions): void {
  container.innerHTML = '';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${BOARD_PX} ${BOARD_PX}`);
  svg.setAttribute('class', 'board-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Barricade board, 9 by 9');
  container.appendChild(svg);

  const viewer = opts.viewer;
  const moves: PawnMove[] =
    opts.interactive && state.winner === null ? legalMoves(state, state.turn) : [];
  const moveSet = new Map(moves.map((m) => [`${m.r},${m.c}`, m]));

  // Goal row tint for the viewer (bottom = viewer's home, top = viewer's goal).
  el('rect', { x: 0, y: 0, width: BOARD_PX, height: CELL, class: 'goal-row' }, svg);

  // Squares
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const d = toDisplay({ r, c }, viewer);
      const rect = el(
        'rect',
        {
          x: d.c * STEP,
          y: d.r * STEP,
          width: CELL,
          height: CELL,
          rx: 8,
          class: `square${(r + c) % 2 ? ' alt' : ''}${moveSet.has(`${r},${c}`) ? ' target' : ''}`,
        },
        svg,
      );
      if (opts.inputMode === 'move' && moveSet.has(`${r},${c}`)) {
        rect.classList.add('clickable');
        rect.addEventListener('click', () => opts.onPawnMove({ r, c }));
      }
    }
  }

  // Shortest-path highlight for the player to move.
  if (opts.showPath && state.winner === null) {
    const turn = state.turn;
    const path = shortestPath(state.walls, state.pawns[turn], state.goals[turn]);
    if (path.length > 1) {
      const pts = path.map((p) => centre(p, viewer).join(',')).join(' ');
      el('polyline', { points: pts, class: 'path-line' }, svg);
      for (const p of path.slice(1))
        el('circle', { cx: centre(p, viewer)[0], cy: centre(p, viewer)[1], r: 5, class: 'path-dot' }, svg);
    }
  }

  // Legal-move dots
  if (opts.inputMode === 'move') {
    for (const m of moves) {
      const [cx, cy] = centre(m, viewer);
      const dot = el(
        'circle',
        { cx, cy, r: m.kind === 'move' ? 11 : 14, class: `move-dot ${m.kind}` },
        svg,
      );
      if (opts.interactive) {
        dot.classList.add('clickable');
        dot.addEventListener('click', () => opts.onPawnMove({ r: m.r, c: m.c }));
      }
    }
  }

  // Placed walls
  const wallColors = ['#ffb703', '#4cc9f0'];
  // We don't track wall ownership in state; colour by nothing — use a neutral
  // wood tone for all placed walls (ownership isn't part of the rules state).
  void wallColors;
  for (const key of state.walls) {
    const [r, c, o] = key.split(',');
    const rect = wallRect({ r: Number(r), c: Number(c), o: o as 'h' | 'v' }, viewer);
    el('rect', { ...rect, rx: 5, class: 'wall-placed' }, svg);
  }

  // Wall groove hit-areas + ghost preview (wall input mode)
  if (opts.inputMode === 'wall' && state.winner === null) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const w: Wall = { r, c, o: opts.wallOrientation };
        const rect = wallRect(w, viewer);
        // Expand hit area a few px around the thin groove.
        const hit = el(
          'rect',
          {
            x: rect.x - 3,
            y: rect.y - 3,
            width: rect.w + 6,
            height: rect.h + 6,
            class: 'groove-hit',
          },
          svg,
        );
        hit.addEventListener('mouseenter', () => opts.onWallHover(w));
        hit.addEventListener('mouseleave', () => opts.onWallHover(null));
        hit.addEventListener('click', () => {
          if (opts.interactive) opts.onWallPlace(w);
        });
      }
    }
    if (opts.hoverWall) {
      const legal = wallLegal(state, state.turn, opts.hoverWall).ok;
      const rect = wallRect(opts.hoverWall, viewer);
      el('rect', {
        ...rect,
        rx: 5,
        class: `wall-ghost ${legal ? 'legal' : 'illegal'}`,
        key: wallKey(opts.hoverWall),
      }, svg);
    }
  }

  // Pawns (drawn last, on top)
  const pawnColors = ['#ffb703', '#4cc9f0'];
  (state.pawns as Pos[]).forEach((p, pi) => {
    const [cx, cy] = centre(p, viewer);
    el('circle', {
      cx,
      cy,
      r: 20,
      class: 'pawn',
      fill: pawnColors[pi],
      stroke: pi === state.turn && state.winner === null ? '#fff' : 'rgba(0,0,0,.35)',
    }, svg);
    el('text', {
      x: cx,
      y: cy + 5,
      class: 'pawn-label',
      'text-anchor': 'middle',
    }, svg).textContent = pi === 0 ? 'S' : 'N';
  });
}
