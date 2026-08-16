/**
 * Entry point: canvas setup, resize handling, and the fixed-timestep loop.
 *
 * The loop is the point of this slice. `update` runs at a fixed 60 Hz via an
 * accumulator, decoupled from the display's refresh rate, so the movement and
 * march tempo the next slices add are frame-rate independent. `render` draws
 * whatever the current state is, once per animation frame.
 */

import { createWorld, update } from "./world";
import { fitViewport, render, type Viewport } from "./render";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) throw new Error("#stage canvas is missing from index.html");

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2d canvas context unavailable");

const world = createWorld();
let view: Viewport = fitViewport(canvas);

function onResize(): void {
  view = fitViewport(canvas!);
  render(ctx!, view, world);
}
window.addEventListener("resize", onResize);
// Some mobile browsers rotate without firing `resize` promptly; catch both.
window.addEventListener("orientationchange", onResize);

/** Fixed update step: 60 simulation ticks per second, in milliseconds. */
const STEP_MS = 1000 / 60;
/**
 * Cap on frame delta. A backgrounded tab can be suspended for minutes; on
 * return, simulate at most this much rather than fast-forwarding the backlog.
 */
const MAX_FRAME_MS = 250;

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  accumulator += Math.min(now - last, MAX_FRAME_MS);
  last = now;

  while (accumulator >= STEP_MS) {
    update(world, STEP_MS / 1000);
    accumulator -= STEP_MS;
  }

  render(ctx!, view, world);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
