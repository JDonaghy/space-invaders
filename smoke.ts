// Headless smoke test: run the fixed-timestep update many times against a
// mocked DOM and assert invariants. Catches runtime crashes in createWorld /
// update and obvious logic regressions (lives, bomb cap, game-over paths).
// Bundled with vite and run under node; not part of the shipped app.
import "./smoke-mock-dom";
import {
  createWorld,
  update,
  WORLD_W,
  type InputState,
} from "./src/world";
import { consumeFire } from "./src/input";

const dt = 1000 / 60;
const input: InputState = { left: false, right: false, fireQueued: false };

let fails = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    fails++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
}

// --- Run 1: idle sim for several seconds; bombs should come and go, no crash.
const w = createWorld();
check(w.lives === 3, "createWorld: starts with 3 lives");
check(w.bombs.length === 0, "createWorld: no bombs in flight");
check(w.shields.length === 4, "createWorld: four shields");
for (const s of w.shields) {
  // A fresh bunker has ~280 intact cells (352 minus the notch).
  let intact = 0;
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i]) intact++;
  check(intact > 250 && intact < 352, `shield intact cells ~280 (got ${intact})`);
}

for (let i = 0; i < 60 * 8; i++) update(w, input, dt / 1000); // 8 s idle
check(w.bombs.length <= 3, "idle sim: bomb cap respected");
check(w.lives >= 0 && w.lives <= 3, "idle sim: lives in range");
check(!w.gameOver || w.lives === 0, "idle sim: gameOver only at 0 lives OR formation-reach");

// --- Run 2: force the player to be hit repeatedly until game over.
const w2 = createWorld();
// Spawn a bomb directly on the cannon each tick by manipulating state, then
// step until lives run out. We do it by flooding bombs array with an on-cannon
// bomb and stepping.
let hits = 0;
for (let i = 0; i < 60 * 30 && !w2.gameOver; i++) {
  // Drop a bomb right above the cannon so it collides this tick.
  w2.bombs.push({ x: w2.cannon.x, y: w2.cannon.y - 1 });
  const livesBefore = w2.lives;
  update(w2, input, dt / 1000);
  if (w2.lives < livesBefore) hits++;
}
check(w2.gameOver, "forced hits: game over reached");
check(w2.lives === 0, "forced hits: ended at 0 lives");
check(hits === 3, `forced hits: exactly 3 lives lost (got ${hits})`);

// --- Run 3: shoot a shield and confirm it erodes (per-cell, not removed whole).
const w3 = createWorld();
// Park the cannon under the leftmost shield and fire straight up into it.
const shield = w3.shields[0];
w3.cannon.x = shield.x + shield.w / 2;
// Fire and step until the shot has struck the shield a few times.
let erodedBefore = 0;
for (let i = 0; i < shield.cells.length; i++) if (!shield.cells[i]) erodedBefore++;
let fired = 0;
for (let i = 0; i < 60 * 3; i++) {
  if (w3.shot === null) {
    input.fireQueued = true;
    fired++;
  }
  update(w3, input, dt / 1000);
  consumeFire(input); // clear any leftover edge
}
let erodedAfter = 0;
for (let i = 0; i < shield.cells.length; i++) if (!shield.cells[i]) erodedAfter++;
check(
  erodedAfter > erodedBefore,
  `shield erosion: shot chewed away cells (before ${erodedBefore}, after ${erodedAfter})`,
);
// The shield must still exist as an object with mostly-intact cells (not removed).
let intactAfter = 0;
for (let i = 0; i < shield.cells.length; i++) if (shield.cells[i]) intactAfter++;
check(intactAfter > 0, "shield erosion: bunker not removed whole");

// --- Run 4: bomb-shot cancellation. Place a shot and a bomb on a collision
// course and confirm both vanish. Positioned below the formation and above the
// shields so neither hits anything else first.
const w4 = createWorld();
w4.shot = { x: WORLD_W / 2, y: 170 };
w4.bombs.push({ x: WORLD_W / 2, y: 160 });
update(w4, input, dt / 1000);
check(w4.shot === null, "bomb-shot cancel: shot removed");
check(w4.bombs.length === 0, "bomb-shot cancel: bomb removed");

// --- Run 5: a bomb erodes a shield it lands on (the issue requires both the
// player's shot AND alien bombs to chew bunkers away, not just one).
const w5 = createWorld();
const shield5 = w5.shields[0];
let eroded5Before = 0;
for (let i = 0; i < shield5.cells.length; i++) if (!shield5.cells[i]) eroded5Before++;
// Drop a bomb just above the shield, aligned to its centre, and step until it
// has had time to strike.
for (let i = 0; i < 60; i++) {
  w5.bombs.push({ x: shield5.x + shield5.w / 2, y: shield5.y - 4 });
  update(w5, input, dt / 1000);
}
let eroded5After = 0;
for (let i = 0; i < shield5.cells.length; i++) if (!shield5.cells[i]) eroded5After++;
check(
  eroded5After > eroded5Before,
  `bomb erodes shield: bomb chewed away cells (before ${eroded5Before}, after ${eroded5After})`,
);

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
if (fails > 0) process.exit(1);
