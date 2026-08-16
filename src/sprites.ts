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

/** A shield bunker, 22×16, with the arched notch cut from the underside. */
const SHIELD = [
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

/** All sprites, pre-rendered once at module load. */
export const SPRITES = {
  squid: prerender(SQUID, INVADER),
  crab: prerender(CRAB, INVADER),
  octopus: prerender(OCTOPUS, INVADER),
  cannon: prerender(CANNON, GREEN),
  shield: prerender(SHIELD, GREEN),
} as const;

export type SpriteName = keyof typeof SPRITES;
