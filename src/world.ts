/**
 * The game world: state, layout constants, and the fixed-timestep update.
 *
 * All positions are in a logical coordinate space of 224×256 — the arcade
 * machine's native resolution. The renderer scales this to the screen; game
 * logic never sees device pixels.
 */

import { SPRITES, type SpriteName } from "./sprites";
import { consumeFire, type InputState } from "./input";

/** Logical playfield size — the arcade's native 224×256. */
export const WORLD_W = 224;
export const WORLD_H = 256;

/** Formation shape: 5 rows of 11 aliens. */
export const FORMATION_COLS = 11;
export const FORMATION_ROWS = 5;

/** Horizontal and vertical spacing between formation cells. */
export const CELL_W = 16;
export const CELL_H = 16;

/** Top-left of the formation's starting position. */
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
/** Y of the top of the cannon. */
const CANNON_TOP = 216;

/** Cannon horizontal speed, in world pixels per second. */
const CANNON_SPEED = 150;
/** Player shot vertical speed, in world pixels per second (upward). */
const SHOT_SPEED = 360;
/** Player shot size, in world pixels — a thin vertical bolt, as on the arcade. */
export const SHOT_W = 1;
export const SHOT_H = 4;

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
}

/** Build the wave-start world: full formation, four shields, centered cannon. */
export function createWorld(): World {
  const aliens: Alien[] = [];
  for (let row = 0; row < FORMATION_ROWS; row++) {
    for (let col = 0; col < FORMATION_COLS; col++) {
      aliens.push({
        kind: ROW_KINDS[row],
        x: FORMATION_LEFT + col * CELL_W + CELL_W / 2,
        y: FORMATION_TOP + row * CELL_H + CELL_H / 2,
        alive: true,
      });
    }
  }

  // Four bunkers spread evenly across the gap between formation and cannon.
  const shieldW = SPRITES.shield.w;
  const shields: { x: number; y: number }[] = [];
  const slot = WORLD_W / 4;
  for (let i = 0; i < 4; i++) {
    shields.push({ x: slot * i + (slot - shieldW) / 2, y: SHIELD_TOP });
  }

  return {
    aliens,
    shields,
    cannon: { x: WORLD_W / 2, y: CANNON_TOP },
    shot: null,
  };
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
 * Advance the world by one fixed step of `dt` seconds.
 *
 * Cannon movement and the shot are driven from `input` here — never from the
 * render callback or from raw event handlers. `input` is the held state the
 * listeners in `input.ts` maintain; fire is an edge the update consumes.
 *
 * Out of scope for this slice: alien march (#6), alien bombs, player death,
 * and shield erosion — shields are inert scenery the shot passes through.
 */
export function update(world: World, input: InputState, dt: number): void {
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
}
