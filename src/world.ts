/**
 * The game world: state, layout constants, and the fixed-timestep update.
 *
 * All positions are in a logical coordinate space of 224×256 — the arcade
 * machine's native resolution. The renderer scales this to the screen; game
 * logic never sees device pixels.
 *
 * The march (this slice) is driven by a tick counter, not a wall-clock timer.
 * `stepCooldown` counts down one per fixed update (60 Hz) and the formation
 * advances one step when it hits zero. The accumulator in main.ts feeds this
 * update a fixed dt regardless of the display, so the march is the same speed
 * on a 60 Hz panel and a 120 Hz panel — it cannot run faster on a fast screen.
 */

import { SPRITES, SHIELD, type SpriteName } from "./sprites";
import { consumeFire, type InputState } from "./input";

/** Logical playfield size — the arcade's native 224×256. */
export const WORLD_W = 224;
export const WORLD_H = 256;

/** Formation shape: 5 rows of 11 aliens. */
export const FORMATION_COLS = 11;
export const FORMATION_ROWS = 5;
/** Total aliens in a full wave — used by the tempo curve. */
export const FORMATION_TOTAL = FORMATION_ROWS * FORMATION_COLS;

/** Horizontal and vertical spacing between formation cells. */
export const CELL_W = 16;
export const CELL_H = 16;

/** Top-left of the formation's wave-1 starting position. */
const FORMATION_LEFT = 26;
const FORMATION_TOP = 64;

/** Which alien type occupies each formation row, top to bottom. */
const ROW_KINDS: readonly SpriteName[] = [
  "squid",
  "crab",
  "crab",
  "octopus",
  "octopus",
];

/** Y of the top of the shield bunkers. */
const SHIELD_TOP = 192;
/** Y of the top of the cannon. The formation reaching this line ends the game. */
const CANNON_TOP = 216;

/** Cannon horizontal speed, in world pixels per second. */
const CANNON_SPEED = 150;
/** Player shot vertical speed, in world pixels per second (upward). */
const SHOT_SPEED = 360;
/** Player shot size, in world pixels — a thin vertical bolt, as on the arcade. */
export const SHOT_W = 1;
export const SHOT_H = 4;

// --- Bomb tuning ---------------------------------------------------------

/** Alien bomb vertical speed, in world pixels per second (downward). Slower
 *  than the player's shot, as on the arcade — a bomb is a falling hazard you
 *  can read and dodge, not a snap interception. */
const BOMB_SPEED = 180;
/** Cap on simultaneous bombs in flight. The arcade allowed about three; the
 *  cap keeps a thinned, fast wave from flooding the screen with bombs. */
const BOMB_MAX_IN_FLIGHT = 3;
/** Bomb-spawn interval in ticks at a full formation — ~1.5 s between drops. */
const BOMB_INTERVAL_FULL = 90;
/** ...and near emptiness — ~0.5 s. The fleet shoots more desperately as it
 *  thins, mirroring the march-tempo curve. */
const BOMB_INTERVAL_MIN = 30;
/** Each new wave shaves this many ticks off the full-formation bomb interval,
 *  so later waves shoot more often as well as marching faster. */
const BOMB_INTERVAL_PER_WAVE = 10;
/** The full-formation bomb interval never drops below this, however high the
 *  wave — keeps a deep wave readable. */
const BOMB_INTERVAL_FLOOR = 40;

// --- Lives ---------------------------------------------------------------

/** Starting (and maximum) number of lives. Losing the third ends the run. */
const START_LIVES = 3;

// --- March tuning --------------------------------------------------------

/**
 * Horizontal advance per march step, in world pixels. The arcade stepped the
 * formation 2 px at a time — small enough to read as a discrete step, not a
 * glide, but large enough to see at any render scale.
 */
const STEP_X = 2;
/**
 * Vertical drop when the leading column reaches an edge — one cell height, so
 * the formation descends a full row each time it bounces. This is the
 * "drops a row" of the issue brief.
 */
const DROP_PX = CELL_H;
/**
 * How close the leading alien's sprite edge may come to the side wall before
 * the formation drops and reverses. Keeps the sprites just off the wall
 * instead of clipping it.
 */
const FIELD_MARGIN = 4;

/**
 * Tempo curve, in fixed-timestep ticks (1 tick = 1/60 s) between march steps.
 * The arcade consulted a table keyed on aliens remaining; this is a linear
 * approximation that hits the same end points — slow and deliberate with a
 * full formation, fast with one alien left.
 */
const TICKS_MAX_BASE = 50; // full formation, wave 1: ~0.83 s/step
const TICKS_MIN = 3; // one alien left: ~0.05 s/step
/** Each new wave shaves this many ticks off the full-formation interval. */
const TICKS_MAX_PER_WAVE = 6;
/** The full-formation interval never drops below this, however high the wave. */
const TICKS_MAX_FLOOR = 20;

/** Each cleared wave restarts this many pixels lower than the last. */
const WAVE_DROP_PX = 12;
/** ...and the starting top is capped after this many waves of lowering, so a
 * late wave does not begin already touching the cannon. */
const MAX_WAVE_DROP = 4;

/**
 * March-step interval in ticks, for `alive` remaining aliens on `wave`.
 *
 * Pure function of the count and the wave so the curve can be exercised
 * directly — the toy exemption in CLAUDE.md welcomes small unit tests here.
 * The interval falls as aliens die and as waves advance; the last alien on a
 * late wave is fast. It is clamped at `TICKS_MIN` so the march never crowds
 * out the rest of the update.
 */
export function ticksPerStep(alive: number, wave: number): number {
  const tMax = Math.max(
    TICKS_MAX_FLOOR,
    TICKS_MAX_BASE - (wave - 1) * TICKS_MAX_PER_WAVE,
  );
  // 0 at a full formation, 1 with one alien left.
  const f = (FORMATION_TOTAL - alive) / (FORMATION_TOTAL - 1);
  return Math.max(TICKS_MIN, Math.round(tMax - (tMax - TICKS_MIN) * f));
}

export interface Alien {
  readonly kind: SpriteName;
  /** Center of the alien's formation cell. */
  x: number;
  y: number;
  alive: boolean;
}

/**
 * A destructible shield bunker. Damage is per-cell, not a hit counter: each
 * cell of `cells` is 1 while that pixel of bunker material is intact and 0
 * once it has been eroded. `canvas` is a render cache of the same mask, kept
 * in sync on erosion so the renderer can blit one image per bunker instead of
 * redrawing 350-odd cells a frame.
 *
 * Both alien bombs and the player's shot erode the cells they overlap, so a
 * bunker is chewed away progressively where it is struck — holes open, then
 * widen, and shots eventually pass clean through the gaps.
 */
export interface Shield {
  /** Top-left corner, in world pixels. */
  x: number;
  y: number;
  /** Width and height in cells (matches the shield sprite, 22×16). */
  w: number;
  h: number;
  /** Per-cell intact mask: 1 = material present, 0 = eroded. Collision truth. */
  cells: Uint8Array;
  /** Render cache of `cells`; lit pixels are green material, cleared pixels
   *  are transparent so the background shows through the holes. */
  canvas: HTMLCanvasElement;
  /** 2D context of `canvas`, retained so erosion can clear cells in place. */
  ctx: CanvasRenderingContext2D;
}

/** An alien bomb in flight. `x` is the center, `y` is the top edge. */
export interface Bomb {
  x: number;
  y: number;
}

export interface World {
  readonly aliens: Alien[];
  /** The four bunkers, each independently eroding where struck. */
  readonly shields: Shield[];
  /** Cannon center-x and top-y. */
  readonly cannon: { x: number; y: number };
  /** The in-flight player shot, or null when none is on screen. The arcade
    * allowed exactly one at a time, so firing is gated on this being null. */
  shot: { x: number; y: number } | null;
  /** Alien bombs currently in flight. */
  readonly bombs: Bomb[];
  /** Current march direction: 1 right, -1 left. */
  marchDir: 1 | -1;
  /** Ticks until the next march step. Counts down one per fixed update. */
  stepCooldown: number;
  /** Current wave, starting at 1. Drives "lower and faster" on restart. */
  wave: number;
  /** Lives remaining. Reaching zero ends the run; losing any life resets the
    * cannon to centre and clears the screen of bombs and the player's shot. */
  lives: number;
  /** Ticks until the next alien bomb may drop. Counts down one per update. */
  bombCooldown: number;
  /** True once the formation reaches the cannon's line OR the last life is
    * lost. The update then freezes — the game-over screen itself is a later
    * slice (#3); this one only stops the simulation. */
  gameOver: boolean;
}

/**
 * Build one eroding bunker at `x, y`. The cell mask is seeded from the shield
 * pixel grid (so the arched notch starts as already-eroded cells) and the
 * render canvas is seeded by blitting the pre-rendered shield sprite — the
 * two stay in sync because erosion clears a cell in both at once.
 */
function makeShield(x: number, y: number): Shield {
  const w = SHIELD[0].length;
  const h = SHIELD.length;
  const cells = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      cells[yy * w + xx] = SHIELD[yy][xx] === "#" ? 1 : 0;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable for shield render cache");
  ctx.drawImage(SPRITES.shield.canvas, 0, 0);
  return { x, y, w, h, cells, canvas, ctx };
}

/** Build the world: empty formation, four shields, centered cannon, wave 1. */
export function createWorld(): World {
  const aliens: Alien[] = [];
  for (let row = 0; row < FORMATION_ROWS; row++) {
    for (let col = 0; col < FORMATION_COLS; col++) {
      // Position is filled in by startWave; kind is permanent per slot.
      aliens.push({ kind: ROW_KINDS[row], x: 0, y: 0, alive: false });
    }
  }

  // Four bunkers spread evenly across the gap between formation and cannon.
  const shieldW = SPRITES.shield.w;
  const shields: Shield[] = [];
  const slot = WORLD_W / 4;
  for (let i = 0; i < 4; i++) {
    shields.push(makeShield(slot * i + (slot - shieldW) / 2, SHIELD_TOP));
  }

  const world: World = {
    aliens,
    shields,
    cannon: { x: WORLD_W / 2, y: CANNON_TOP },
    shot: null,
    bombs: [],
    marchDir: 1,
    stepCooldown: 0,
    wave: 0,
    lives: START_LIVES,
    bombCooldown: 0,
    gameOver: false,
  };
  startWave(world, 1);
  return world;
}

/** Count aliens still alive in the formation. */
function aliveCount(world: World): number {
  let n = 0;
  for (const a of world.aliens) if (a.alive) n++;
  return n;
}

/**
 * Lay out a fresh wave: every alien alive, formation at the wave's (lower)
 * starting top, marching right. Called for wave 1 from createWorld and again
 * whenever the previous wave is cleared, so the wave-1 layout and every
 * restart share one code path.
 */
function startWave(world: World, wave: number): void {
  world.wave = wave;
  const top = FORMATION_TOP + Math.min(wave - 1, MAX_WAVE_DROP) * WAVE_DROP_PX;
  for (let row = 0; row < FORMATION_ROWS; row++) {
    for (let col = 0; col < FORMATION_COLS; col++) {
      const a = world.aliens[row * FORMATION_COLS + col];
      a.alive = true;
      a.x = FORMATION_LEFT + col * CELL_W + CELL_W / 2;
      a.y = top + row * CELL_H + CELL_H / 2;
    }
  }
  world.marchDir = 1;
  world.stepCooldown = ticksPerStep(FORMATION_TOTAL, wave);
  // A shot still in flight when the last alien dies would otherwise appear
  // over the newly laid formation; clear it so each wave starts clean. Bombs
  // and the bomb timer reset for the same reason — a fresh wave is a breath,
  // not a continuation of the previous wave's bombardment.
  world.shot = null;
  world.bombs.length = 0;
  world.bombCooldown = bombInterval(FORMATION_TOTAL, wave);
}

/** Clamp `v` to the closed range [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Return the first alive alien whose sprite box overlaps the shot box, or null.
 * Shield erosion is handled separately in `update` before this is consulted,
 * so a shot that strikes a bunker never reaches the formation check here.
 */
function findAlienHit(
  world: World,
  shot: { x: number; y: number },
): Alien | null {
  const sx0 = shot.x - SHOT_W / 2;
  const sx1 = shot.x + SHOT_W / 2;
  const sy0 = shot.y;
  const sy1 = shot.y + SHOT_H;
  for (const a of world.aliens) {
    if (!a.alive) continue;
    const sp = SPRITES[a.kind];
    const ax0 = a.x - sp.w / 2;
    const ax1 = a.x + sp.w / 2;
    const ay0 = a.y - sp.h / 2;
    const ay1 = a.y + sp.h / 2;
    if (sx1 > ax0 && sx0 < ax1 && sy1 > ay0 && sy0 < ay1) return a;
  }
  return null;
}

/**
 * Erode every intact cell of `shield` that lies under the world-space pixel
 * rectangle `[px0,py0]`–`[px1,py1]` (inclusive, integer pixels). Returns true
 * if any material was removed — i.e. the projectile actually struck the
 * bunker rather than passing through an existing hole. The cell mask and the
 * render cache are cleared together so collision and drawing never disagree.
 */
function erodeShield(
  shield: Shield,
  px0: number,
  py0: number,
  px1: number,
  py1: number,
): boolean {
  const cx0 = Math.max(0, px0 - shield.x);
  const cx1 = Math.min(shield.w - 1, px1 - shield.x);
  const cy0 = Math.max(0, py0 - shield.y);
  const cy1 = Math.min(shield.h - 1, py1 - shield.y);
  if (cx0 > cx1 || cy0 > cy1) return false;
  let struck = false;
  for (let yy = cy0; yy <= cy1; yy++) {
    for (let xx = cx0; xx <= cx1; xx++) {
      const i = yy * shield.w + xx;
      if (shield.cells[i]) {
        shield.cells[i] = 0;
        shield.ctx.clearRect(xx, yy, 1, 1);
        struck = true;
      }
    }
  }
  return struck;
}

/**
 * If the world-space pixel rectangle overlaps any bunker's intact material,
 * erode those cells and return true. A projectile can overlap at most one
 * bunker (they are spaced apart), so the first strike returns immediately;
 * overlapping only already-eroded cells returns false so the projectile
 * passes clean through the hole.
 */
function hitShields(
  world: World,
  px0: number,
  py0: number,
  px1: number,
  py1: number,
): boolean {
  for (const s of world.shields) {
    if (px1 < s.x || px0 > s.x + s.w - 1 || py1 < s.y || py0 > s.y + s.h - 1) {
      continue;
    }
    if (erodeShield(s, px0, py0, px1, py1)) return true;
  }
  return false;
}

/**
 * Bomb-spawn interval in ticks, for `alive` remaining aliens on `wave`. Falls
 * as the formation thins and as waves advance, with a little jitter so the
 * cadence is not metronomic — the arcade's drops were randomized too. Clamped
 * at `BOMB_INTERVAL_MIN` so a thinned late wave still leaves a beat to react.
 */
function bombInterval(alive: number, wave: number): number {
  const f = (FORMATION_TOTAL - alive) / (FORMATION_TOTAL - 1);
  const full = Math.max(
    BOMB_INTERVAL_FLOOR,
    BOMB_INTERVAL_FULL - (wave - 1) * BOMB_INTERVAL_PER_WAVE,
  );
  const base = Math.round(full - (full - BOMB_INTERVAL_MIN) * f);
  const jitter = Math.round((Math.random() - 0.5) * base * 0.4);
  return Math.max(BOMB_INTERVAL_MIN, base + jitter);
}

/**
 * Maybe drop one alien bomb. Only the bottom-most alive alien in a column may
 * fire, so bombs always emerge from beneath the formation and never through
 * it. The shooter is chosen uniformly from those column bottoms, matching the
 * arcade's "any live column, at random" behaviour. The drop is skipped if the
 * in-flight cap is reached; the caller still resets the cooldown either way.
 */
function spawnBomb(world: World): void {
  if (world.bombs.length >= BOMB_MAX_IN_FLIGHT) return;

  const bottomByCol: (Alien | null)[] = new Array(FORMATION_COLS).fill(null);
  for (let row = 0; row < FORMATION_ROWS; row++) {
    for (let col = 0; col < FORMATION_COLS; col++) {
      const a = world.aliens[row * FORMATION_COLS + col];
      if (a.alive) bottomByCol[col] = a; // lower rows overwrite → column bottom
    }
  }
  const candidates: Alien[] = [];
  for (const a of bottomByCol) if (a) candidates.push(a);
  if (candidates.length === 0) return;

  const shooter = candidates[Math.floor(Math.random() * candidates.length)];
  const sp = SPRITES[shooter.kind];
  // Spawn at the shooter's bottom edge, x-centred on it.
  world.bombs.push({ x: shooter.x, y: shooter.y + sp.h / 2 });
}

/**
 * Lose a life: clear the screen of bombs and the player's shot, re-centre the
 * cannon, and decrement lives. Reaching zero sets `gameOver` — the third life
 * lost ends the run. Clearing the bombs on death is the arcade's beat: the
 * explosion clears the air, so the respawn is not instantly punished by a
 * bomb that was already on top of the cannon.
 */
function loseLife(world: World): void {
  world.lives -= 1;
  world.bombs.length = 0;
  world.shot = null;
  world.cannon.x = WORLD_W / 2;
  if (world.lives <= 0) world.gameOver = true;
}

/**
 * Advance the formation one march step. Every alive alien moves on the same
 * tick — there is no per-alien animation here, only the whole-formation step.
 *
 * If the next sideways step would carry the leading column past the side
 * wall, the formation instead drops a row and reverses direction (no sideways
 * advance on that tick — the drop is the movement for that step, as on the
 * arcade). The "leading column" is the leftmost or rightmost column that
 * still has a live alien, so cleared flanks do not stop the march early: the
 * formation keeps using the full width as long as anything lives.
 */
function marchStep(world: World): void {
  if (world.marchDir > 0) {
    let leadEdge = -Infinity;
    for (const a of world.aliens) {
      if (!a.alive) continue;
      leadEdge = Math.max(leadEdge, a.x + SPRITES[a.kind].w / 2);
    }
    if (leadEdge + STEP_X > WORLD_W - FIELD_MARGIN) {
      dropFormation(world);
      world.marchDir = -1;
    } else {
      for (const a of world.aliens) if (a.alive) a.x += STEP_X;
    }
  } else {
    let leadEdge = Infinity;
    for (const a of world.aliens) {
      if (!a.alive) continue;
      leadEdge = Math.min(leadEdge, a.x - SPRITES[a.kind].w / 2);
    }
    if (leadEdge - STEP_X < FIELD_MARGIN) {
      dropFormation(world);
      world.marchDir = 1;
    } else {
      for (const a of world.aliens) if (a.alive) a.x -= STEP_X;
    }
  }
}

/** Drop every alive alien one row. */
function dropFormation(world: World): void {
  for (const a of world.aliens) if (a.alive) a.y += DROP_PX;
}

/**
 * True when the lowest alive alien has descended to the cannon's line. The
 * formation landing on you is an instant loss regardless of lives left — the
 * arcade ended the run the moment invaders touched the ground line. With no
 * aliens alive the result is false (a cleared wave restarts, it does not end).
 */
function reachedCannon(world: World): boolean {
  let lowest = -Infinity;
  for (const a of world.aliens) {
    if (!a.alive) continue;
    lowest = Math.max(lowest, a.y + SPRITES[a.kind].h / 2);
  }
  return lowest >= CANNON_TOP;
}

/** Integer pixel bbox of the in-flight player shot, or null. Aligned with the
 *  renderer's `Math.round` so the cells eroded here are exactly the cells the
 *  player sees the shot overlap. */
function shotBox(shot: { x: number; y: number }): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const x0 = Math.round(shot.x - SHOT_W / 2);
  const y0 = Math.round(shot.y);
  return { x0, y0, x1: x0 + SHOT_W - 1, y1: y0 + SHOT_H - 1 };
}

/** Integer pixel bbox of a bomb. */
function bombBox(b: Bomb): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const w = SPRITES.bomb.w;
  const h = SPRITES.bomb.h;
  const x0 = Math.round(b.x - w / 2);
  const y0 = Math.round(b.y);
  return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
}

/** Vertical span a bomb sweeps in one update: from its prior `yBefore` down
 *  to `yAfter` plus the bomb height. Used by the bomb-shot test so a fast-
 *  closing shot and bomb cannot tunnel past each other between ticks. */
function bombSweptY(yBefore: number, yAfter: number): {
  top: number;
  bottom: number;
} {
  const h = SPRITES.bomb.h;
  return { top: yBefore, bottom: yAfter + h - 1 };
}

/**
 * Advance the world by one fixed step of `dt` seconds.
 *
 * Cannon movement and the shot are driven from `input` here — never from the
 * render callback or from raw event handlers. `input` is the held state the
 * listeners in `input.ts` maintain; fire is an edge the update consumes.
 *
 * The march runs on a tick counter (one update = one tick), decoupled from
 * `dt` so a 120 Hz display does not double its speed. The tempo rises as the
 * formation thins and again on each new wave.
 *
 * Aliens shoot back on their own cadence: only the bottom of each live column
 * drops a bomb, and at most three are in the air at once. A bomb that reaches
 * the cannon costs a life — losing a life clears the screen and re-centres
 * the cannon; losing the third ends the run. Both the player's shot and alien
 * bombs erode the bunkers per-cell where they strike, and a shot and bomb that
 * meet in the air cancel, as on the arcade.
 *
 * The run also ends the moment the formation lands on the cannon's line. Once
 * `gameOver` is set the update freezes — the game-over screen itself is #3;
 * this slice only stops the simulation.
 *
 * Out of scope for this slice: score and the game-over screen (#3).
 */
export function update(world: World, input: InputState, dt: number): void {
  if (world.gameOver) return; // frozen until the game-over screen (#3)

  // 1. Cannon movement. Both directions held cancels out; the cannon is
  //    bounded by the field edges so it cannot slide off the playfield.
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    const cw = SPRITES.cannon.w;
    world.cannon.x = clamp(
      world.cannon.x + dir * CANNON_SPEED * dt,
      cw / 2,
      WORLD_W - cw / 2,
    );
  }

  // 2. Fire: edge-triggered, exactly one shot in the air at a time. The
  //    request is consumed whether or not a shot spawns — a press made while
  //    a shot is in flight does nothing and is not remembered; the player
  //    must press again once that shot leaves the field or hits something.
  if (consumeFire(input) && world.shot === null) {
    world.shot = { x: world.cannon.x, y: CANNON_TOP - SHOT_H };
  }

  // 3. Shot travel, shield erosion, alien collision. The shot moves up each
  //    step. It is removed when it leaves the top of the field, when it
  //    strikes a bunker (eroding the cells it overlaps), or when it hits an
  //    alien. The bunker check comes first — a shield sits between the cannon
  //    and the formation, so a shot that hits material never reaches the
  //    aliens; one that finds an existing hole passes through and continues.
  //    The shot's pre-move y is kept for the bomb-shot swept test in step 4.
  let shotPreY: number | null = null;
  if (world.shot) {
    shotPreY = world.shot.y;
    world.shot.y -= SHOT_SPEED * dt;
    if (world.shot.y + SHOT_H <= 0) {
      world.shot = null;
    } else {
      const b = shotBox(world.shot);
      if (hitShields(world, b.x0, b.y0, b.x1, b.y1)) {
        world.shot = null;
      } else {
        const hit = findAlienHit(world, world.shot);
        if (hit) {
          hit.alive = false;
          world.shot = null;
        }
      }
    }
  }

  // 4. Alien bombs: spawn on the cooldown, then move and resolve each. A bomb
  //    is removed when it reaches the ground line, when a shot and bomb meet
  //    in the air (both cancel — tested swept so they cannot jump past each
  //    other between ticks), when it erodes a bunker, or when it hits the
  //    cannon (which costs a life). Iterating backwards so splices are safe.
  world.bombCooldown -= 1;
  if (world.bombCooldown <= 0) {
    spawnBomb(world);
    world.bombCooldown = bombInterval(aliveCount(world), world.wave);
  }

  for (let i = world.bombs.length - 1; i >= 0; i--) {
    const bomb = world.bombs[i];
    const yBefore = bomb.y;
    bomb.y += BOMB_SPEED * dt;

    // 4a. Reached the ground line — disappears, no life lost.
    if (bomb.y >= WORLD_H - 16) {
      world.bombs.splice(i, 1);
      continue;
    }

    // 4b. Bomb-shot cancellation (swept). The shot moved in step 3; test its
    //     whole swept span against the bomb's swept span so a fast-closing
    //     pair cannot pass through each other in a single tick. Both vanish.
    if (world.shot && shotPreY !== null) {
      const sMin = world.shot.y;
      const sMax = shotPreY + SHOT_H - 1; // shot moved up: pre-move bottom
      const { top: bMin, bottom: bMax } = bombSweptY(yBefore, bomb.y);
      const s = world.shot;
      const sx0 = s.x - SHOT_W / 2;
      const sx1 = s.x + SHOT_W / 2;
      const bw = SPRITES.bomb.w;
      const bx0 = bomb.x - bw / 2;
      const bx1 = bomb.x + bw / 2;
      if (bx1 > sx0 && bx0 < sx1 && sMax > bMin && bMax > sMin) {
        world.bombs.splice(i, 1);
        world.shot = null;
        continue;
      }
    }

    // 4c. Bomb-shield erosion. Erodes the cells it overlaps; consumed if it
    //     struck material, passes through an existing hole otherwise.
    {
      const b = bombBox(bomb);
      if (hitShields(world, b.x0, b.y0, b.x1, b.y1)) {
        world.bombs.splice(i, 1);
        continue;
      }
    }

    // 4d. Bomb-cannon collision. Costs a life; loseLife clears every bomb and
    //     the shot, so the loop is done — break out before touching the now-
    //     empty list. If that was the last life, gameOver is set and we bail
    //     before the march runs. Continuous boxes, as in `findAlienHit` — the
    //     cannon is not a per-cell grid, so no rounding is wanted here.
    {
      const cw = SPRITES.cannon.w;
      const ch = SPRITES.cannon.h;
      const cx0 = world.cannon.x - cw / 2;
      const cx1 = world.cannon.x + cw / 2;
      const cy0 = world.cannon.y;
      const cy1 = world.cannon.y + ch;
      const bw = SPRITES.bomb.w;
      const bh = SPRITES.bomb.h;
      const bx0 = bomb.x - bw / 2;
      const bx1 = bomb.x + bw / 2;
      const by0 = bomb.y;
      const by1 = bomb.y + bh;
      if (bx1 > cx0 && bx0 < cx1 && by1 > cy0 && by0 < cy1) {
        loseLife(world);
        break;
      }
    }
  }
  if (world.gameOver) return;

  // 5. March: count down one tick per update, step on zero. The next interval
  //    is recomputed from the aliens remaining after the step, so killing one
  //    between steps speeds up the step after next.
  world.stepCooldown -= 1;
  if (world.stepCooldown <= 0) {
    marchStep(world);
    world.stepCooldown = ticksPerStep(aliveCount(world), world.wave);
  }

  // 6. Reach: a drop may have brought the formation to the cannon's line —
  //    instant loss, regardless of lives left.
  if (reachedCannon(world)) {
    world.gameOver = true;
    return;
  }

  // 7. Next wave: a cleared formation restarts lower and faster.
  if (aliveCount(world) === 0) {
    startWave(world, world.wave + 1);
  }
}
