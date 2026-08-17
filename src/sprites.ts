/**
 * Sprites as pixel-grid data, the way the 1978 original was a bitmap.
 *
 * Each sprite is a list of strings — '#' is a lit pixel, '.' is transparent.
 * They are pre-rendered once to a small offscreen canvas and blitted with
 * `drawImage` (image smoothing off), so per-frame cost is one blit per sprite,
 * not one fillRect per pixel.
 */

export interface Sprite {
  readonly canvas: HTMLCanvasElement;
  /** Width in logical (world) pixels. */
  readonly w: number;
  /** Height in logical (world) pixels. */
  readonly h: number;
}

/** Pre-render a pixel grid to an offscreen canvas, one canvas pixel per cell. */
function prerender(rows: readonly string[], color: string): Sprite {
  const w = rows[0].length;
  const h = rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable for sprite pre-render");
  ctx.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === "#") ctx.fillRect(x, y, 1, 1);
    }
  }
  return { canvas, w, h };
}

// Alien colors follow the arcade cabinet's colored cellophane strips: white
// invaders, green shields and cannon near the bottom of the screen.
const INVADER = "#ffffff";
const GREEN = "#33ff33";
// Alien bombs are amber so incoming fire reads as distinct from the white
// player shot and the green shields/cannon, not because the arcade was amber
// (it was green) — clarity on a dark background wins here.
const BOMB_COLOR = "#ffcc44";
// The mystery ship (UFO) wore a red cellophane strip on the cabinet.
const UFO_COLOR = "#ff3333";

/** Top row alien — the small "squid", 8×8. */
const SQUID = [
  "...##...",
  "..####..",
  ".######.",
  "##.##.##",
  "########",
  ".#.##.#.",
  "#......#",
  ".#....#.",
];

/** Middle rows alien — the "crab", 11×8. */
const CRAB = [
  "..#.....#..",
  "...#...#...",
  "..#######..",
  ".##.###.##.",
  "###########",
  "#.#######.#",
  "#.#.....#.#",
  "...##.##...",
];

/** Bottom rows alien — the "octopus", 12×8. */
const OCTOPUS = [
  "....####....",
  ".##########.",
  "############",
  "###..##..###",
  "############",
  "...##..##...",
  "..##.##.##..",
  "##........##",
];

/** The player's cannon, 13×8. */
const CANNON = [
  "......#......",
  ".....###.....",
  ".....###.....",
  ".###########.",
  "#############",
  "#############",
  "#############",
  "#############",
];

/** A shield bunker, 22×16, with the arched notch cut from the underside.
 *  Exported so the world can seed each bunker's per-cell damage mask from the
 *  same grid the sprite was pre-rendered from — collision truth and render
 *  cache stay in sync that way. */
export const SHIELD = [
  "....##############....",
  "...################...",
  "..##################..",
  ".####################.",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "#######........#######",
  "######..........######",
  "#####............#####",
  "#####............#####",
];

/** An alien bomb, 3×5 — a small zigzag bolt, the way the arcade's "rolling"
 *  bomb wiggled as it fell. Kept tiny so a single hit erodes a small chunk of
 *  a bunker rather than punching a doorway. */
const BOMB = [
  "##.",
  ".##",
  "##.",
  ".##",
  "##.",
];

/** The mystery ship (UFO) that occasionally crosses the top of the field for a
 *  bonus. 16×6 — wider than any invader so it reads as a different thing, with
 *  a row of "lights" along the underside. */
const UFO = [
  "....########....",
  "..############..",
  ".####..##..####.",
  "################",
  ".##.##.##.##.##.",
  "..##........##..",
];

/** All sprites, pre-rendered once at module load. */
export const SPRITES = {
  squid: prerender(SQUID, INVADER),
  crab: prerender(CRAB, INVADER),
  octopus: prerender(OCTOPUS, INVADER),
  cannon: prerender(CANNON, GREEN),
  shield: prerender(SHIELD, GREEN),
  bomb: prerender(BOMB, BOMB_COLOR),
  ufo: prerender(UFO, UFO_COLOR),
} as const;

export type SpriteName = keyof typeof SPRITES;
