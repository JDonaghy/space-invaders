/**
 * The game world: state, layout constants, and the fixed-timestep update.
 *
 * All positions are in a logical coordinate space of 224×256 — the arcade
 * machine's native resolution. The renderer scales this to the screen; game
 * logic never sees device pixels.
 */

import { SPRITES, type SpriteName } from "./sprites";

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
  };
}

/**
 * Advance the world by one fixed step of `dt` seconds.
 *
 * Deliberately empty in this slice: cannon movement/firing and the alien
 * march are the next two issues. What matters now is that this is called on
 * a fixed timestep, so the tempo those slices add is frame-rate independent.
 */
export function update(_world: World, _dt: number): void {
  // Intentionally nothing yet.
}
