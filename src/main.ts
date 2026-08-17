/**
 * Entry point: canvas setup, resize handling, and the fixed-timestep loop.
 *
 * The loop is the point of this slice. `update` runs at a fixed 60 Hz via an
 * accumulator, decoupled from the display's refresh rate, so the movement and
 * march tempo the next slices add are frame-rate independent. `render` draws
 * whatever the current state is, once per animation frame.
 *
 * This slice also owns the screens around the loop. The world starts on the
 * title screen; a fire press (Space or tap) starts a run and, being a user
 * gesture, unlocks the AudioContext the soundtrack needs. `P` / the on-canvas
 * pause button toggles pause (the wave freezes where it stands); `M` / the
 * mute button toggles all sound and persists the choice. A run that ends
 * shows the game-over screen, and a fire press goes straight back in.
 */

import { createWorld, resetWorld, update, type World } from "./world";
import { fitViewport, render, WORLD_BUTTONS, type Viewport } from "./render";
import {
  createInput,
  consumeFire,
  consumePause,
  consumeMute,
  type ButtonRect,
} from "./input";
import { createSound, type Sound } from "./sound";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) throw new Error("#stage canvas is missing from index.html");

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2d canvas context unavailable");

const world: World = createWorld();
const input = createInput();
const sound = createSound();
// Begin on the title screen. `createWorld` leaves the world in `playing` so a
// harness that drives `update` directly (the smoke test) runs as before; the
// player, though, sees the title first and starts the run with a fire press.
world.phase = "title";

let view: Viewport = fitViewport(canvas);
syncButtonRects();

function onResize(): void {
  view = fitViewport(canvas!);
  syncButtonRects();
  render(ctx!, view, world, sound.isMuted());
}
window.addEventListener("resize", onResize);
// Some mobile browsers rotate without firing `resize` promptly; catch both.
window.addEventListener("orientationchange", onResize);

/** Map the world-space button regions into the CSS-pixel hit rects the touch
 *  path expects. Called on resize so the targets track the playfield. */
function syncButtonRects(): void {
  const rects: ButtonRect[] = WORLD_BUTTONS.map((b) => ({
    id: b.id,
    x0: (view.scale * b.x0 + view.offsetX) / view.dpr,
    y0: (view.scale * b.y0 + view.offsetY) / view.dpr,
    x1: (view.scale * b.x1 + view.offsetX) / view.dpr,
    y1: (view.scale * b.y1 + view.offsetY) / view.dpr,
  }));
  input.buttonRects = rects;
}

/**
 * Unlock the AudioContext on the first user gesture. Browsers refuse to start
 * audio before one, so we listen once and resume. Safe to call many times,
 * but the listener removes itself after the first successful gesture.
 */
function attachAudioUnlock(): void {
  const unlock = () => {
    sound.unlock();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock);
}
attachAudioUnlock();

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

  // Screens: handle the edges the update itself can't, because they must work
  // while the world is frozen. Pause and mute are consumed every frame; fire
  // on the title or game-over screen starts or restarts the run (and, being a
  // gesture, unlocks audio). Fire on the pause screen is discarded so a tap
  // while paused does not fire the instant the wave resumes.
  if (consumePause(input)) togglePause();
  if (consumeMute(input)) toggleMute();

  if (world.phase === "title" || world.phase === "gameover") {
    if (consumeFire(input)) startRun();
  } else if (world.phase === "paused") {
    consumeFire(input);
  }

  while (accumulator >= STEP_MS) {
    update(world, input, STEP_MS / 1000);
    drainEvents(world, sound);
    accumulator -= STEP_MS;
  }

  // The mystery-ship warble syncs to the world once per frame: play while it
  // is on screen and the run is live, stop otherwise (paused, gone, or shot).
  syncUfo(sound, world.phase === "playing" && world.mystery !== null);

  render(ctx!, view, world, sound.isMuted());
  requestAnimationFrame(frame);
}

/** Toggle between playing and paused. A no-op on the title and game-over
 *  screens, where "pause" has no meaning. */
function togglePause(): void {
  if (world.phase === "playing") world.phase = "paused";
  else if (world.phase === "paused") world.phase = "playing";
}

/** Toggle mute on every sound effect and persist the choice. */
function toggleMute(): void {
  sound.setMuted(!sound.isMuted());
}

/** Start or restart a run: fresh world in place, playing, audio unlocked. */
function startRun(): void {
  resetWorld(world);
  sound.unlock();
}

/** Play the sound events the update emitted this step, then clear the queue. */
function drainEvents(world: World, sound: Sound): void {
  for (const e of world.events) {
    switch (e) {
      case "fire":
        sound.fire();
        break;
      case "alienHit":
      case "cannonHit":
      case "mysteryHit":
        sound.explosion();
        break;
      case "march":
        sound.marchStep();
        break;
    }
  }
  world.events.length = 0;
}

/** Start or stop the mystery-ship warble to match its presence on screen. */
function syncUfo(sound: Sound, present: boolean): void {
  if (present) sound.ufoLoopStart();
  else sound.ufoLoopStop();
}

requestAnimationFrame(frame);
