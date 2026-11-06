# Barricade — Race to the Other Side

An original implementation of the Barricade.gg game concept (a Quoridor-style
duel), built with **Vite + TypeScript**, hosted on **GitHub Pages**, with
**Firebase Realtime Database** online play. **Not affiliated with barricade.gg.**

## The game

- 9×9 board, 2 players, 1 pawn each, 10 walls each. You start in the middle of
  your home row (`e1` for South, `e9` for North) and race to any square of the
  far row. The board flips so each player sees themselves at the bottom.
- A turn is **one** action: move one square (up/down/left/right) **or** place
  a wall. No passing.
- Walls are 2 cells long, sit in the grooves (horizontal/vertical), block both
  pawns, and are permanent. They can't overlap or cross — but two walls placed
  end-to-end leave a gap a crossing wall can pass through. A wall that leaves
  **either** player with no route to goal is illegal (BFS-checked).
- Face-to-face pawns **jump** straight over; if a wall or the edge is behind
  the opponent, you step **diagonally** to either side of them.
- Win by reaching the far row, resignation, or your opponent's clock flagging.
- Time controls: 1+0, 1+3, 3+0, 3+2, 5+3, 10+0, 15+10 (local clocks;
  `mm:ss.t` under 20 seconds).
- Modes: local hot-seat 2P, vs computer (Easy/Medium/Hard), online friend
  (link, lobby, spectate/TV), all from the one UI.
- Controls: click a highlighted square to move; **Place wall** mode → hover a
  groove (green ghost = legal, red = illegal) and click; **R** or the Rotate
  button flips wall orientation. Toggleable shortest-path highlight.

### Notation

A game is just an array of strings — that array is the single source of truth
for online sync, replays, and (future) puzzles/TV.

- Squares `a1`–`i9` from South's perspective: file = column (a = left),
  rank 1 = bottom row, rank 9 = top row. `a1` = row 8, col 0.
- Walls `<file><rank>h|v`, e.g. `e3h`: the coordinate names the wall's anchor
  square (the square top-left of its groove crossing, mapped with the same
  formula). An `h` wall sits in the groove below squares (r,c) and (r,c+1);
  a `v` wall in the groove right of (r,c) and (r+1,c).

## Project layout

```
src/engine/   pure TypeScript rules engine, zero dependencies
              (types, state, walls, path/BFS, moves, notation, apply/replay)
              used identically by the UI, the AI and (future) Functions
src/ai/       chooseAiMove(state, level) — path-length score
              (opponent's path − own path) + alpha-beta search,
              depth 1 (easy, blunders) / 2 (medium) / 3 (hard, pruned walls)
src/ui/       SVG board renderer (flip, ghost wall preview, path highlight)
src/net/      Firebase bootstrap (dynamic imports) + OnlineManager
              (anon auth, presence, lobby, rooms, transactions, spectate)
index.html    app shell          public/404.html   Pages SPA fallback
database.rules.json + firebase.json   Realtime Database rules (Option A)
.github/workflows/pages.yml           GitHub Pages deploy
```

A Web Worker wrapper for the AI (`src/ai/ai.worker.ts`) is a deliberate future
step: the AI is synchronous today (hard stays fast via wall pruning) and the
UI calls it in a `setTimeout`, so the board never freezes; worker-ising later
needs no engine changes because `chooseAiMove` is pure.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173/Block-and-Race/
npm test         # Vitest — engine rule tests
npm run build    # tsc + vite build → dist/
npm run preview
```

Local and vs-computer play work with no configuration at all.

## Deploy to GitHub Pages

1. Create a GitHub repo named **`Block-and-Race`** (the Vite `base` in
   `vite.config.ts` is `/Block-and-Race/` — if you name the repo differently,
   change `base` to match) and push this project to its `main` branch.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Set the Firebase web config as repo **Variables** (not Secrets — it's
   public by design): Settings → Secrets and variables → Actions →
   **Variables** tab → add `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`.
4. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually).
   The site goes live at `https://<you>.github.io/Block-and-Race/`.

Room links are hash-based (`#/room/<id>`, with `&spectate=1` / “Watch” for TV
mode) so they survive Pages hosting; `public/404.html` bounces stray paths
back into the app.

## Firebase setup (step by step)

1. Go to the [Firebase Console](https://console.firebase.google.com) →
   **Add project** (any name) → create.
2. **Build → Authentication → Sign-in method → enable Anonymous.**
3. **Build → Realtime Database → Create database** (start in *locked mode* —
   you'll deploy the rules from this repo next).
4. Project settings → **Your apps → Web (`</>`)** → register the app → copy
   the `firebaseConfig` values into:
   - the GitHub repo Variables above (for the Pages build), and
   - a local `.env` file (copy `.env.example`) for `npm run dev`.
5. Deploy the security rules, either:
   - CLI: `npm i -g firebase-tools && firebase login && firebase use <project-id> && firebase deploy --only database`, or
   - Console: Realtime Database → Rules → paste the contents of
     `database.rules.json` → Publish.
   (`.github/workflows/firebase.yml.example` shows an automated version —
   rename it to `firebase.yml` and add a service-account secret to use it.)
6. **Lock the API key down:** Google Cloud Console → APIs & Services →
   Credentials → your browser key → Application restrictions → HTTP referrers
   → allow only `https://<you>.github.io/*` (e.g. `sree-ram-ms.github.io`).
7. Recommended: enable **App Check** (reCAPTCHA v3) for the web app in the
   Firebase Console, and register the github.io domain there.

How online play works: Anonymous Auth gives each visitor a uid and an
`anon-#####` name (editable, stored locally). Presence lives at
`/presence/{uid}` (removed `onDisconnect`), waiting rooms are listed at
`/lobby/{roomId}` (host listing removed `onDisconnect`), and a room at
`/rooms/{roomId}` holds seats, the time control, clocks, result — and the
append-only `moves` list. **Only the notation strings are synced**; every
client rebuilds the game with the engine's `replay()`. Seat `p1` is claimed
with a transaction so two guests can't take it. A room link opened when both
seats are taken (or with `&spectate=1`) opens read-only spectate/TV mode.
Rematch creates a fresh room and a new link.

## Trust model — read this before adding stakes

This project ships **Option A (Spark plan, casual only)**: security rules
require a signed-in seated player, allow only append-only move writes, and
validate a move's *shape* (a 2–3 char string). Rules cannot run the game
engine, so they cannot prove a move is *legal* — both clients check every
move with the shared engine when replaying, so cheating can desync a casual
game but gains nothing. (Turn-parity enforcement in rules is approximate for
the same reason: move keys are strings.)

**Ranked play, Elo and a trustworthy leaderboard need Option B (Blaze plan):**
clients write move *intents*, and a Cloud Function validates each intent with
this same `src/engine/`, appends the move, updates clocks from server time
(`ServerValue.TIMESTAMP` + `.info/serverTimeOffset`), ends the game and
updates Elo (K=32) and the `/queue/{tc}` matchmaking — none of which exists
yet, by design. The engine is deliberately dependency-free so it can be
imported by Functions unchanged.

## Tests

`npm test` runs the Vitest suite for the engine: starting position/opening
moves, wall blocking both directions, H/V overlap + collinear + cross
rejection, the end-to-end **gap** case, BFS full-seal rejection for both
players, straight jumps, both diagonal sidesteps, jumps at the board edge,
win detection, walls-left accounting, notation round-trips, and replay
equivalence.
