/**
 * Input: held movement state plus edge-triggered fire, pause, and mute
 * requests.
 *
 * Both the keyboard and the touch paths feed the same `InputState`, so the
 * fixed-timestep `update` samples one source of truth — it never reads raw
 * events, and the event listeners here never mutate the world directly. The
 * update consumes fire each step; movement is sampled as held booleans. Pause
 * and mute are edges too, but they are consumed by the entry point (not the
 * update) so they still work while the world is frozen on the title, pause or
 * game-over screen.
 */

/** A tappable on-canvas button region, in CSS pixels. The entry point
 *  computes these from the rendered button positions and pushes them here so
 *  a touch landing on a button toggles pause/mute instead of moving/firing. */
export interface ButtonRect {
  id: "pause" | "mute";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  /** Edge-triggered fire request. The update reads and clears it each step. */
  fireQueued: boolean;
  /** Edge-triggered pause request. Consumed by the entry point each frame. */
  pauseQueued: boolean;
  /** Edge-triggered mute request. Consumed by the entry point each frame. */
  muteQueued: boolean;
  /** Current on-canvas button hit regions in CSS pixels, kept in sync on
   *  resize by the entry point. Touched by the touch path only. */
  buttonRects: ButtonRect[];
}

/** Read and clear the fire request. Returns true if fire was requested. */
export function consumeFire(s: InputState): boolean {
  const q = s.fireQueued;
  s.fireQueued = false;
  return q;
}

/** Read and clear the pause request. Returns true if pause was toggled. */
export function consumePause(s: InputState): boolean {
  const q = s.pauseQueued;
  s.pauseQueued = false;
  return q;
}

/** Read and clear the mute request. Returns true if mute was toggled. */
export function consumeMute(s: InputState): boolean {
  const q = s.muteQueued;
  s.muteQueued = false;
  return q;
}

/** Build the input state and attach keyboard + touch listeners to the window. */
export function createInput(): InputState {
  const state: InputState = {
    left: false,
    right: false,
    fireQueued: false,
    pauseQueued: false,
    muteQueued: false,
    buttonRects: [],
  };
  attachKeyboard(state);
  attachTouch(state);
  return state;
}

function attachKeyboard(s: InputState): void {
  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case "ArrowLeft":
        s.left = true;
        e.preventDefault();
        break;
      case "ArrowRight":
        s.right = true;
        e.preventDefault();
        break;
      case "Space":
        // Edge-triggered: ignore OS key-repeat so holding fire does not
        // auto-fire once the in-flight shot clears — the arcade did the same.
        if (!e.repeat) s.fireQueued = true;
        e.preventDefault();
        break;
      case "KeyP":
        if (!e.repeat) s.pauseQueued = true;
        e.preventDefault();
        break;
      case "KeyM":
        if (!e.repeat) s.muteQueued = true;
        e.preventDefault();
        break;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "ArrowLeft":
        s.left = false;
        e.preventDefault();
        break;
      case "ArrowRight":
        s.right = false;
        e.preventDefault();
        break;
      case "Space":
      case "KeyP":
      case "KeyM":
        e.preventDefault();
        break;
    }
  };
  // If the window loses focus mid-hold the keyup may never fire; drop held
  // movement so the cannon does not slide off on its own.
  const onBlur = () => {
    s.left = false;
    s.right = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
}

interface TouchRec {
  side: "left" | "right";
  startX: number;
  startY: number;
  /** True once the touch wandered past the slack threshold — a drag, not a tap. */
  moved: boolean;
  /** True once the hold delay elapsed — this touch counts as a move, not a tap. */
  armed: boolean;
  timeout: number;
  /** Set when the touch began inside a pause/mute button region: it toggles
   *  that control on release (a button tap) and never moves or fires. */
  button: "pause" | "mute" | null;
}

/**
 * A touch becomes a "hold" (moves the cannon) only after this delay; a touch
 * released before it is a tap and fires instead. The delay keeps a quick fire
 * tap from nudging the cannon a few pixels before the player meant to move.
 */
const HOLD_DELAY_MS = 120;
/** Distance a touch may wander and still count as a tap, in CSS pixels. */
const TAP_SLACK_PX = 12;

/** Return the button whose region contains `(x, y)`, or null. */
function buttonAt(s: InputState, x: number, y: number): ButtonRect | null {
  for (const r of s.buttonRects) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r;
  }
  return null;
}

function attachTouch(s: InputState): void {
  const active = new Map<number, TouchRec>();

  // Recompute held sides from every active, armed touch. A tap that never
  // armed contributes no movement; a still-pressed finger on the other side
  // keeps its direction. Button touches never contribute movement.
  const applyHeldSides = () => {
    let left = false;
    let right = false;
    for (const r of active.values()) {
      if (!r.armed || r.button) continue;
      if (r.side === "left") left = true;
      else right = true;
    }
    s.left = left;
    s.right = right;
  };

  const onTouchStart = (e: TouchEvent) => {
    const half = window.innerWidth / 2;
    for (const t of e.changedTouches) {
      // A touch that begins on a pause/mute button toggles it (on release) and
      // is otherwise inert — it neither moves the cannon nor fires.
      const btn = buttonAt(s, t.clientX, t.clientY);
      const rec: TouchRec = {
        side: btn ? "left" : t.clientX < half ? "left" : "right",
        startX: t.clientX,
        startY: t.clientY,
        moved: false,
        armed: false,
        timeout: 0,
        button: btn ? btn.id : null,
      };
      rec.timeout = window.setTimeout(() => {
        if (rec.button) return; // buttons never arm as holds
        rec.armed = true;
        applyHeldSides();
      }, HOLD_DELAY_MS);
      active.set(t.identifier, rec);
    }
    e.preventDefault();
  };

  const onTouchMove = (e: TouchEvent) => {
    for (const t of e.changedTouches) {
      const rec = active.get(t.identifier);
      if (!rec) continue;
      if (
        Math.abs(t.clientX - rec.startX) > TAP_SLACK_PX ||
        Math.abs(t.clientY - rec.startY) > TAP_SLACK_PX
      ) {
        rec.moved = true;
      }
    }
    e.preventDefault();
  };

  const releaseTouch = (e: TouchEvent) => {
    for (const t of e.changedTouches) {
      const rec = active.get(t.identifier);
      if (!rec) continue;
      clearTimeout(rec.timeout);
      if (rec.button) {
        // A button tap is a touch that never dragged off the button.
        if (!rec.moved) {
          if (rec.button === "pause") s.pauseQueued = true;
          else s.muteQueued = true;
        }
      } else if (!rec.armed && !rec.moved) {
        // A play-area tap is a touch that never armed (short) and never dragged.
        s.fireQueued = true;
      }
      active.delete(t.identifier);
    }
    applyHeldSides();
    e.preventDefault();
  };

  const cancelTouch = (e: TouchEvent) => {
    for (const t of e.changedTouches) {
      const rec = active.get(t.identifier);
      if (!rec) continue;
      clearTimeout(rec.timeout);
      active.delete(t.identifier);
    }
    applyHeldSides();
    e.preventDefault();
  };

  // Listeners live on window; the canvas covers the viewport and carries
  // `touch-action: none`, so touches start on it and never pan the page.
  // `passive: false` lets us preventDefault to suppress double-tap zoom.
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", releaseTouch, { passive: false });
  window.addEventListener("touchcancel", cancelTouch, { passive: false });
}
