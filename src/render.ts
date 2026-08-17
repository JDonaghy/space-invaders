/**
 * Rendering: scale the 224×256 logical playfield to the real canvas and draw
 * the current world state. Pure draw calls — no state changes here.
 *
 * The HUD (score, best), the mystery ship, the on-canvas pause/mute buttons,
 * and the title / pause / game-over overlays are drawn in world coordinates
 * alongside the sprites, so the whole frame scales together.
 */

import { SPRITES } from "./sprites";
import { WORLD_W, WORLD_H, SHOT_W, SHOT_H, type World } from "./world";

export interface Viewport {
  /** Device-pixel size of the canvas backing store. */
  width: number;
  height: number;
  /** Device pixels per logical (world) pixel. */
  scale: number;
  /** Letterbox offset of the playfield, in device pixels. */
  offsetX: number;
  offsetY: number;
  /** Device pixel ratio used to size the backing store (clamped to ≤3). The
   *  entry point uses this to map world-space button rects into the CSS-pixel
   *  hit regions the touch path expects. */
  dpr: number;
}

/**
 * Size the backing store to the element's CSS size × device pixel ratio and
 * compute the largest playfield scale that fits, centered. Called on resize
 * and rotation.
 */
export function fitViewport(canvas: HTMLCanvasElement): Viewport {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const width = Math.max(1, Math.floor(cssW * dpr));
  const height = Math.max(1, Math.floor(cssH * dpr));
  canvas.width = width;
  canvas.height = height;

  let scale = Math.min(width / WORLD_W, height / WORLD_H);
  // Snap to whole device pixels per world pixel when there's room — uniform
  // pixel sizes keep the sprites crisp. Below 1:1 (tiny windows) stay fractional.
  if (scale >= 1) scale = Math.floor(scale);

  return {
    width,
    height,
    scale,
    offsetX: Math.floor((width - WORLD_W * scale) / 2),
    offsetY: Math.floor((height - WORLD_H * scale) / 2),
    dpr,
  };
}

/** On-canvas button hit regions in world pixels. The entry point maps these
 *  into CSS-pixel `ButtonRect`s for the touch path. The pause button is only
 *  meaningful while playing or paused, but the region is constant so the hit
 *  test stays simple; the entry point suppresses the pause toggle elsewhere. */
export interface WorldButton {
  id: "pause" | "mute";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const BTN = 12;
const BTN_PAD = 2;
export const WORLD_BUTTONS: readonly WorldButton[] = [
  { id: "pause", x0: BTN_PAD, y0: BTN_PAD, x1: BTN_PAD + BTN, y1: BTN_PAD + BTN },
  {
    id: "mute",
    x0: WORLD_W - BTN - BTN_PAD,
    y0: BTN_PAD,
    x1: WORLD_W - BTN_PAD,
    y1: BTN_PAD + BTN,
  },
];

const HUD_Y = 5;
const HUD_FONT = "8px monospace";
const BODY_FONT = "8px monospace";
const TITLE_FONT = "16px monospace";
const GREEN = "#33ff33";
const WHITE = "#ffffff";
const DIM = "#88cc88";

/** Draw the whole frame: letterbox, playfield, sprites, HUD, buttons, overlay. */
export function render(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  world: World,
  muted: boolean,
): void {
  // Letterbox / background, in raw device pixels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, view.width, view.height);

  // Everything else in world coordinates.
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  for (const alien of world.aliens) {
    if (!alien.alive) continue;
    const sprite = SPRITES[alien.kind];
    ctx.drawImage(
      sprite.canvas,
      Math.round(alien.x - sprite.w / 2),
      Math.round(alien.y - sprite.h / 2),
    );
  }

  // Each bunker is drawn from its own damage cache, so holes and gnawed edges
  // show where earlier shots and bombs struck. The cache is updated in place
  // by `erodeShield`; here it is a single blit per bunker.
  for (const shield of world.shields) {
    ctx.drawImage(shield.canvas, Math.round(shield.x), shield.y);
  }

  // The cannon is hidden once the run ends on a lost last life — it was just
  // blown up. A formation-reach game over still shows it, frozen in place.
  const cannon = SPRITES.cannon;
  if (!world.gameOver || world.lives > 0) {
    ctx.drawImage(
      cannon.canvas,
      Math.round(world.cannon.x - cannon.w / 2),
      world.cannon.y,
    );
  }

  // The in-flight player shot — a thin white bolt, drawn as a filled rect.
  if (world.shot) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      Math.round(world.shot.x - SHOT_W / 2),
      Math.round(world.shot.y),
      SHOT_W,
      SHOT_H,
    );
  }

  // Alien bombs in flight — amber zigzag bolts, one blit each.
  const bombSprite = SPRITES.bomb;
  for (const bomb of world.bombs) {
    ctx.drawImage(
      bombSprite.canvas,
      Math.round(bomb.x - bombSprite.w / 2),
      Math.round(bomb.y),
    );
  }

  // The mystery ship, if one is crossing the top — a red UFO, one blit.
  if (world.mystery) {
    const u = SPRITES.ufo;
    ctx.drawImage(
      u.canvas,
      Math.round(world.mystery.x - u.w / 2),
      Math.round(world.mystery.y),
    );
  }

  // Spare lives, drawn as little cannon icons in the bottom border below the
  // ground line, the way the arcade's cabinet did. The current life is the
  // cannon above, so only `lives - 1` spares are shown (clamped at zero once
  // the run is over). Bombs vanish at the ground line, so they never overlap
  // these icons on the way down.
  const spares = Math.max(0, world.lives - 1);
  for (let i = 0; i < spares; i++) {
    ctx.drawImage(cannon.canvas, 8 + i * (cannon.w + 4), WORLD_H - cannon.h - 2);
  }

  // The ground line under the cannon.
  ctx.fillStyle = "#33ff33";
  ctx.fillRect(0, WORLD_H - 16, WORLD_W, 1);

  drawHud(ctx, world);
  drawButtons(ctx, world, muted);
  drawOverlay(ctx, world);
}

/** Top-of-field score and best readout, in the arcade's green. */
function drawHud(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.font = HUD_FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = GREEN;
  // Left of the pause icon (x = BTN + 2*PAD = 16), so start at 20.
  ctx.fillText(`SCORE ${pad(world.score)}`, 20, HUD_Y);
  // Right of the field, ending left of the mute icon (x = WORLD_W - 16).
  const bestStr = `BEST ${pad(world.best)}`;
  const w = ctx.measureText(bestStr).width;
  ctx.fillText(bestStr, WORLD_W - 16 - 2 - w, HUD_Y);
}

/** The pause and mute buttons. Pause is shown only while playing or paused. */
function drawButtons(
  ctx: CanvasRenderingContext2D,
  world: World,
  muted: boolean,
): void {
  const showPause = world.phase === "playing" || world.phase === "paused";
  for (const b of WORLD_BUTTONS) {
    if (b.id === "pause" && !showPause) continue;
    // A faint outlined tile so the tappable area is visible without dominating.
    ctx.fillStyle = "rgba(51,255,51,0.08)";
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.strokeStyle = "rgba(51,255,51,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1);
    if (b.id === "pause") drawPauseIcon(ctx, b);
    else drawMuteIcon(ctx, b, muted);
  }
}

/** Two vertical bars — the universal "pause" glyph. */
function drawPauseIcon(ctx: CanvasRenderingContext2D, b: WorldButton): void {
  ctx.fillStyle = GREEN;
  ctx.fillRect(b.x0 + 3, b.y0 + 3, 2, 6);
  ctx.fillRect(b.x0 + 7, b.y0 + 3, 2, 6);
}

/** A small speaker. Muted adds a diagonal strike so the state reads at a
 *  glance. */
function drawMuteIcon(
  ctx: CanvasRenderingContext2D,
  b: WorldButton,
  muted: boolean,
): void {
  ctx.fillStyle = GREEN;
  // Speaker body: a small block on the left, a trapezoid cone to the right.
  ctx.fillRect(b.x0 + 3, b.y0 + 5, 2, 3);
  // Cone as three stacked horizontal segments widening to the right.
  ctx.fillRect(b.x0 + 5, b.y0 + 4, 1, 5);
  ctx.fillRect(b.x0 + 6, b.y0 + 3, 1, 7);
  if (muted) {
    // Diagonal strike through the speaker.
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x0 + 2.5, b.y0 + 2.5);
    ctx.lineTo(b.x0 + 9.5, b.y0 + 9.5);
    ctx.stroke();
  }
}

/** The title, pause, or game-over overlay — only one is ever showing. */
function drawOverlay(ctx: CanvasRenderingContext2D, world: World): void {
  if (world.phase === "playing") return;
  // Dim the frozen field so the overlay text reads.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  if (world.phase === "title") drawTitle(ctx);
  else if (world.phase === "paused") drawPaused(ctx);
  else drawGameOver(ctx, world);
}

/** The title screen: name the game and what each alien is worth. */
function drawTitle(ctx: CanvasRenderingContext2D): void {
  centerText(ctx, "SPACE INVADERS", WORLD_W / 2, 40, GREEN, TITLE_FONT);
  // Worth table: each alien sprite with its score, then the mystery ship.
  drawWorthRow(ctx, SPRITES.squid.canvas, 30, 72);
  drawWorthRow(ctx, SPRITES.crab.canvas, 20, 88);
  drawWorthRow(ctx, SPRITES.octopus.canvas, 10, 104);
  drawWorthRow(ctx, SPRITES.ufo.canvas, "??", 120);
  centerText(ctx, "PRESS SPACE / TAP TO START", WORLD_W / 2, 160, WHITE, BODY_FONT);
  centerText(ctx, "P PAUSE   M MUTE", WORLD_W / 2, 176, DIM, BODY_FONT);
}

/** One worth-table row: a sprite on the left, its value to the right. */
function drawWorthRow(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  value: number | string,
  y: number,
): void {
  const x = 72;
  ctx.drawImage(sprite, x, y);
  ctx.font = BODY_FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = GREEN;
  ctx.fillText(`= ${value}`, x + 20, y + 1);
}

/** The pause overlay: the wave is frozen exactly where it stands. */
function drawPaused(ctx: CanvasRenderingContext2D): void {
  centerText(ctx, "PAUSED", WORLD_W / 2, 120, GREEN, TITLE_FONT);
  centerText(ctx, "P TO RESUME", WORLD_W / 2, 142, WHITE, BODY_FONT);
}

/** The game-over screen: your score against your best, and a way back in. */
function drawGameOver(ctx: CanvasRenderingContext2D, world: World): void {
  centerText(ctx, "GAME OVER", WORLD_W / 2, 96, GREEN, TITLE_FONT);
  centerText(ctx, `SCORE  ${pad(world.score)}`, WORLD_W / 2, 122, WHITE, BODY_FONT);
  centerText(ctx, `BEST   ${pad(world.best)}`, WORLD_W / 2, 134, WHITE, BODY_FONT);
  // A new best is flagged only when the run actually beat the prior best —
  // a zero-score run on a fresh device is not a "new best".
  if (world.score > 0 && world.score === world.best) {
    centerText(ctx, "NEW BEST!", WORLD_W / 2, 148, GREEN, BODY_FONT);
  }
  centerText(
    ctx,
    "PRESS SPACE / TAP TO PLAY AGAIN",
    WORLD_W / 2,
    176,
    WHITE,
    BODY_FONT,
  );
}

/** Centered text helper. */
function centerText(
  ctx: CanvasRenderingContext2D,
  s: string,
  cx: number,
  y: number,
  color: string,
  font: string,
): void {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillText(s, cx, y);
}

/** Pad a score to at least four digits, the way the arcade's readout did. */
function pad(n: number): string {
  return String(n).padStart(4, "0");
}
