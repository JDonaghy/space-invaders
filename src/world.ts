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

import { SPRITES, type SpriteName } from "./sprites";
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

export interface World {
  readonly aliens: Alien[];
  /** Shield top-left corners. Inert scenery in this slice. */
  readonly shields: { x: number; y: number }[];
  /** Cannon center-x and top-y. */
  readonly cannon: { x: number; y: number };
  /** The in-flight player shot, or null when none is on screen. The arcade
   * allowed exactly one at a time, so firing is gated on this being null. */
  shot: { x: number; y: number } | null;
  /** Current march direction: 1 right, -1 left. */
  marchDir: 1 | -1;
  /** Ticks until the next march step. Counts down one per fixed update. */
  stepCooldown: number;
  /** Current wave, starting at 1. Drives "lower and faster" on restart. */
  wave: number;
  /** True once the formation reaches the cannon's line. The update then
   * freezes — the game-over screen itself is a later slice (#3); this one
   * only stops the simulation. */
  gameOver: boolean;
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
  const shields: { x: number; y: number }[] = [];
  const slot = WORLD_W / 4;
  for (let i = 0; i < 4; i++) {
    shields.push({ x: slot * i + (slot - shieldW) / 2, y: SHIELD_TOP });
  }

  const world: World = {
    aliens,
    shields,
    cannon: { x: WORLD_W / 2, y: CANNON_TOP },
    shot: null,
    marchDir: 1,
    stepCooldown: 0,
    wave: 0,
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
  // over the newly laid formation; clear it so each wave starts clean.
  world.shot = null;
}

/** Clamp `v` to the closed range [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Return the first alive alien whose sprite box overlaps the shot box, or null.
 * Shots pass through shields in this slice — only aliens are tested here.
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
 * True when the lowest alive alien has descended to the cannon's line. That is
 * the lose condition for this slice — alien bombs and lives are #2, so the
 * only way to end the game here is the formation reaching the cannon. With no
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
 * Once the formation reaches the cannon's line the update freezes — the
 * game-over screen itself is #3; this slice only stops the simulation.
 *
 * Out of scope for this slice: alien bombs (#2), player death and lives (#2),
 * and shield erosion — shields are inert scenery the shot passes through.
 * Score and screens are #3.
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

  // 3. Shot travel and alien collision. The shot moves up each step; when it
  //    leaves the top of the field or strikes an alien it is removed.
  if (world.shot) {
    world.shot.y -= SHOT_SPEED * dt;
    if (world.shot.y + SHOT_H <= 0) {
      world.shot = null;
    } else {
      const hit = findAlienHit(world, world.shot);
      if (hit) {
        hit.alive = false;
        world.shot = null;
      }
    }
  }

  // 4. March: count down one tick per update, step on zero. The next interval
  //    is recomputed from the aliens remaining after the step, so killing one
  //    between steps speeds up the step after next.
  world.stepCooldown -= 1;
  if (world.stepCooldown <= 0) {
    marchStep(world);
    world.stepCooldown = ticksPerStep(aliveCount(world), world.wave);
  }

  // 5. Reach: a drop may have brought the formation to the cannon's line.
  if (reachedCannon(world)) {
    world.gameOver = true;
    return;
  }

  // 6. Next wave: a cleared formation restarts lower and faster.
  if (aliveCount(world) === 0) {
    startWave(world, world.wave + 1);
  }
}
