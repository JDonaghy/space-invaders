/**
 * Rendering: scale the 224×256 logical playfield to the real canvas and draw
 * the current world state. Pure draw calls — no state changes here.
 */

import { SPRITES } from "./sprites";
import { WORLD_W, WORLD_H, type World } from "./world";

export interface Viewport {
  /** Device-pixel size of the canvas backing store. */
  width: number;
  height: number;
  /** Device pixels per logical (world) pixel. */
  scale: number;
  /** Letterbox offset of the playfield, in device pixels. */
  offsetX: number;
  offsetY: number;
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
  };
}

/** Draw the whole frame: letterbox, playfield, sprites, ground line. */
export function render(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  world: World,
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

  for (const shield of world.shields) {
    ctx.drawImage(SPRITES.shield.canvas, Math.round(shield.x), shield.y);
  }

  const cannon = SPRITES.cannon;
  ctx.drawImage(
    cannon.canvas,
    Math.round(world.cannon.x - cannon.w / 2),
    world.cannon.y,
  );

  // The ground line under the cannon.
  ctx.fillStyle = "#33ff33";
  ctx.fillRect(0, WORLD_H - 16, WORLD_W, 1);
}
