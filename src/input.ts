/**
 * Input: held movement state plus an edge-triggered fire request.
 *
 * Both the keyboard and the touch paths feed the same `InputState`, so the
 * fixed-timestep `update` samples one source of truth — it never reads raw
 * events, and the event listeners here never mutate the world directly. The
 * update consumes fire each step; movement is sampled as held booleans.
 */

export interface InputState {
  left: boolean;
  right: boolean;
  /** Edge-triggered fire request. The update reads and clears it each step. */
  fireQueued: boolean;
}

/** Read and clear the fire request. Returns true if fire was requested. */
export function consumeFire(s: InputState): boolean {
  const q = s.fireQueued;
  s.fireQueued = false;
  return q;
}

/** Build the input state and attach keyboard + touch listeners to the window. */
export function createInput(): InputState {
  const state: InputState = { left: false, right: false, fireQueued: false };
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
}

/**
 * A touch becomes a "hold" (moves the cannon) only after this delay; a touch
 * released before it is a tap and fires instead. The delay keeps a quick fire
 * tap from nudging the cannon a few pixels before the player meant to move.
 */
const HOLD_DELAY_MS = 120;
/** Distance a touch may wander and still count as a tap, in CSS pixels. */
const TAP_SLACK_PX = 12;

function attachTouch(s: InputState): void {
  const active = new Map<number, TouchRec>();

  // Recompute held sides from every active, armed touch. A tap that never
  // armed contributes no movement; a still-pressed finger on the other side
  // keeps its direction.
  const applyHeldSides = () => {
    let left = false;
    let right = false;
    for (const r of active.values()) {
      if (!r.armed) continue;
      if (r.side === "left") left = true;
      else right = true;
    }
    s.left = left;
    s.right = right;
  };

  const onTouchStart = (e: TouchEvent) => {
    const half = window.innerWidth / 2;
    for (const t of e.changedTouches) {
      const side: "left" | "right" = t.clientX < half ? "left" : "right";
      const rec: TouchRec = {
        side,
        startX: t.clientX,
        startY: t.clientY,
        moved: false,
        armed: false,
        timeout: 0,
      };
      rec.timeout = window.setTimeout(() => {
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
      // A tap is a touch that never armed (short) and never dragged.
      if (!rec.armed && !rec.moved) {
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
