//#region smoke-mock-dom.ts
var noop = () => {};
function makeCanvas() {
	return {
		width: 0,
		height: 0,
		getContext: () => ({
			fillStyle: "",
			imageSmoothingEnabled: false,
			setTransform: noop,
			fillRect: noop,
			drawImage: noop,
			clearRect: noop
		})
	};
}
globalThis.document = {
	createElement: (_tag) => makeCanvas(),
	querySelector: () => null
};
globalThis.window = {
	innerWidth: 224,
	innerHeight: 256,
	devicePixelRatio: 1,
	addEventListener: noop,
	removeEventListener: noop
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = noop;
//#endregion
//#region src/sprites.ts
/** Pre-render a pixel grid to an offscreen canvas, one canvas pixel per cell. */
function prerender(rows, color) {
	const w = rows[0].length;
	const h = rows.length;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d context unavailable for sprite pre-render");
	ctx.fillStyle = color;
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === "#") ctx.fillRect(x, y, 1, 1);
	return {
		canvas,
		w,
		h
	};
}
var INVADER = "#ffffff";
var GREEN = "#33ff33";
var BOMB_COLOR = "#ffcc44";
/** Top row alien — the small "squid", 8×8. */
var SQUID = [
	"...##...",
	"..####..",
	".######.",
	"##.##.##",
	"########",
	".#.##.#.",
	"#......#",
	".#....#."
];
/** Middle rows alien — the "crab", 11×8. */
var CRAB = [
	"..#.....#..",
	"...#...#...",
	"..#######..",
	".##.###.##.",
	"###########",
	"#.#######.#",
	"#.#.....#.#",
	"...##.##..."
];
/** Bottom rows alien — the "octopus", 12×8. */
var OCTOPUS = [
	"....####....",
	".##########.",
	"############",
	"###..##..###",
	"############",
	"...##..##...",
	"..##.##.##..",
	"##........##"
];
/** The player's cannon, 13×8. */
var CANNON = [
	"......#......",
	".....###.....",
	".....###.....",
	".###########.",
	"#############",
	"#############",
	"#############",
	"#############"
];
/** A shield bunker, 22×16, with the arched notch cut from the underside.
*  Exported so the world can seed each bunker's per-cell damage mask from the
*  same grid the sprite was pre-rendered from — collision truth and render
*  cache stay in sync that way. */
var SHIELD = [
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
	"#####............#####"
];
/** All sprites, pre-rendered once at module load. */
var SPRITES = {
	squid: prerender(SQUID, INVADER),
	crab: prerender(CRAB, INVADER),
	octopus: prerender(OCTOPUS, INVADER),
	cannon: prerender(CANNON, GREEN),
	shield: prerender(SHIELD, GREEN),
	bomb: prerender([
		"##.",
		".##",
		"##.",
		".##",
		"##."
	], BOMB_COLOR)
};
//#endregion
//#region src/input.ts
/** Read and clear the fire request. Returns true if fire was requested. */
function consumeFire(s) {
	const q = s.fireQueued;
	s.fireQueued = false;
	return q;
}
/** Top-left of the formation's wave-1 starting position. */
var FORMATION_LEFT = 26;
var FORMATION_TOP = 64;
/** Which alien type occupies each formation row, top to bottom. */
var ROW_KINDS = [
	"squid",
	"crab",
	"crab",
	"octopus",
	"octopus"
];
/** Y of the top of the shield bunkers. */
var SHIELD_TOP = 192;
/** Y of the top of the cannon. The formation reaching this line ends the game. */
var CANNON_TOP = 216;
/** Cannon horizontal speed, in world pixels per second. */
var CANNON_SPEED = 150;
/** Player shot vertical speed, in world pixels per second (upward). */
var SHOT_SPEED = 360;
/** Alien bomb vertical speed, in world pixels per second (downward). Slower
*  than the player's shot, as on the arcade — a bomb is a falling hazard you
*  can read and dodge, not a snap interception. */
var BOMB_SPEED = 180;
/** Cap on simultaneous bombs in flight. The arcade allowed about three; the
*  cap keeps a thinned, fast wave from flooding the screen with bombs. */
var BOMB_MAX_IN_FLIGHT = 3;
/** Bomb-spawn interval in ticks at a full formation — ~1.5 s between drops. */
var BOMB_INTERVAL_FULL = 90;
/** ...and near emptiness — ~0.5 s. The fleet shoots more desperately as it
*  thins, mirroring the march-tempo curve. */
var BOMB_INTERVAL_MIN = 30;
/** Each new wave shaves this many ticks off the full-formation bomb interval,
*  so later waves shoot more often as well as marching faster. */
var BOMB_INTERVAL_PER_WAVE = 10;
/** The full-formation bomb interval never drops below this, however high the
*  wave — keeps a deep wave readable. */
var BOMB_INTERVAL_FLOOR = 40;
/** Starting (and maximum) number of lives. Losing the third ends the run. */
var START_LIVES = 3;
/**
* Horizontal advance per march step, in world pixels. The arcade stepped the
* formation 2 px at a time — small enough to read as a discrete step, not a
* glide, but large enough to see at any render scale.
*/
var STEP_X = 2;
/**
* Vertical drop when the leading column reaches an edge — one cell height, so
* the formation descends a full row each time it bounces. This is the
* "drops a row" of the issue brief.
*/
var DROP_PX = 16;
/**
* How close the leading alien's sprite edge may come to the side wall before
* the formation drops and reverses. Keeps the sprites just off the wall
* instead of clipping it.
*/
var FIELD_MARGIN = 4;
/**
* Tempo curve, in fixed-timestep ticks (1 tick = 1/60 s) between march steps.
* The arcade consulted a table keyed on aliens remaining; this is a linear
* approximation that hits the same end points — slow and deliberate with a
* full formation, fast with one alien left.
*/
var TICKS_MAX_BASE = 50;
var TICKS_MIN = 3;
/** Each new wave shaves this many ticks off the full-formation interval. */
var TICKS_MAX_PER_WAVE = 6;
/** The full-formation interval never drops below this, however high the wave. */
var TICKS_MAX_FLOOR = 20;
/** Each cleared wave restarts this many pixels lower than the last. */
var WAVE_DROP_PX = 12;
/** ...and the starting top is capped after this many waves of lowering, so a
* late wave does not begin already touching the cannon. */
var MAX_WAVE_DROP = 4;
/**
* March-step interval in ticks, for `alive` remaining aliens on `wave`.
*
* Pure function of the count and the wave so the curve can be exercised
* directly — the toy exemption in CLAUDE.md welcomes small unit tests here.
* The interval falls as aliens die and as waves advance; the last alien on a
* late wave is fast. It is clamped at `TICKS_MIN` so the march never crowds
* out the rest of the update.
*/
function ticksPerStep(alive, wave) {
	const tMax = Math.max(TICKS_MAX_FLOOR, TICKS_MAX_BASE - (wave - 1) * TICKS_MAX_PER_WAVE);
	const f = (55 - alive) / 54;
	return Math.max(TICKS_MIN, Math.round(tMax - (tMax - TICKS_MIN) * f));
}
/**
* Build one eroding bunker at `x, y`. The cell mask is seeded from the shield
* pixel grid (so the arched notch starts as already-eroded cells) and the
* render canvas is seeded by blitting the pre-rendered shield sprite — the
* two stay in sync because erosion clears a cell in both at once.
*/
function makeShield(x, y) {
	const w = SHIELD[0].length;
	const h = SHIELD.length;
	const cells = new Uint8Array(w * h);
	for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) cells[yy * w + xx] = SHIELD[yy][xx] === "#" ? 1 : 0;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d context unavailable for shield render cache");
	ctx.drawImage(SPRITES.shield.canvas, 0, 0);
	return {
		x,
		y,
		w,
		h,
		cells,
		canvas,
		ctx
	};
}
/** Build the world: empty formation, four shields, centered cannon, wave 1. */
function createWorld() {
	const aliens = [];
	for (let row = 0; row < 5; row++) for (let col = 0; col < 11; col++) aliens.push({
		kind: ROW_KINDS[row],
		x: 0,
		y: 0,
		alive: false
	});
	const shieldW = SPRITES.shield.w;
	const shields = [];
	const slot = 56;
	for (let i = 0; i < 4; i++) shields.push(makeShield(slot * i + (slot - shieldW) / 2, SHIELD_TOP));
	const world = {
		aliens,
		shields,
		cannon: {
			x: 112,
			y: CANNON_TOP
		},
		shot: null,
		bombs: [],
		marchDir: 1,
		stepCooldown: 0,
		wave: 0,
		lives: START_LIVES,
		bombCooldown: 0,
		gameOver: false
	};
	startWave(world, 1);
	return world;
}
/** Count aliens still alive in the formation. */
function aliveCount(world) {
	let n = 0;
	for (const a of world.aliens) if (a.alive) n++;
	return n;
}
/**
* Lay out a fresh wave: every alien alive, formation at the wave's (lower)
* starting top, marching right. Called for wave 1 from createWorld and again
* whenever the previous wave is cleared, so the wave-1 layout and every
* restart share one code path.
*/
function startWave(world, wave) {
	world.wave = wave;
	const top = FORMATION_TOP + Math.min(wave - 1, MAX_WAVE_DROP) * WAVE_DROP_PX;
	for (let row = 0; row < 5; row++) for (let col = 0; col < 11; col++) {
		const a = world.aliens[row * 11 + col];
		a.alive = true;
		a.x = FORMATION_LEFT + col * 16 + 8;
		a.y = top + row * 16 + 8;
	}
	world.marchDir = 1;
	world.stepCooldown = ticksPerStep(55, wave);
	world.shot = null;
	world.bombs.length = 0;
	world.bombCooldown = bombInterval(55, wave);
}
/** Clamp `v` to the closed range [lo, hi]. */
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}
/**
* Return the first alive alien whose sprite box overlaps the shot box, or null.
* Shield erosion is handled separately in `update` before this is consulted,
* so a shot that strikes a bunker never reaches the formation check here.
*/
function findAlienHit(world, shot) {
	const sx0 = shot.x - 1 / 2;
	const sx1 = shot.x + 1 / 2;
	const sy0 = shot.y;
	const sy1 = shot.y + 4;
	for (const a of world.aliens) {
		if (!a.alive) continue;
		const sp = SPRITES[a.kind];
		const ax0 = a.x - sp.w / 2;
		const ax1 = a.x + sp.w / 2;
		const ay0 = a.y - sp.h / 2;
		const ay1 = a.y + sp.h / 2;
		if (sx1 > ax0 && sx0 < ax1 && sy1 > ay0 && sy0 < ay1) return a;
	}
	return null;
}
/**
* Erode every intact cell of `shield` that lies under the world-space pixel
* rectangle `[px0,py0]`–`[px1,py1]` (inclusive, integer pixels). Returns true
* if any material was removed — i.e. the projectile actually struck the
* bunker rather than passing through an existing hole. The cell mask and the
* render cache are cleared together so collision and drawing never disagree.
*/
function erodeShield(shield, px0, py0, px1, py1) {
	const cx0 = Math.max(0, px0 - shield.x);
	const cx1 = Math.min(shield.w - 1, px1 - shield.x);
	const cy0 = Math.max(0, py0 - shield.y);
	const cy1 = Math.min(shield.h - 1, py1 - shield.y);
	if (cx0 > cx1 || cy0 > cy1) return false;
	let struck = false;
	for (let yy = cy0; yy <= cy1; yy++) for (let xx = cx0; xx <= cx1; xx++) {
		const i = yy * shield.w + xx;
		if (shield.cells[i]) {
			shield.cells[i] = 0;
			shield.ctx.clearRect(xx, yy, 1, 1);
			struck = true;
		}
	}
	return struck;
}
/**
* If the world-space pixel rectangle overlaps any bunker's intact material,
* erode those cells and return true. A projectile can overlap at most one
* bunker (they are spaced apart), so the first strike returns immediately;
* overlapping only already-eroded cells returns false so the projectile
* passes clean through the hole.
*/
function hitShields(world, px0, py0, px1, py1) {
	for (const s of world.shields) {
		if (px1 < s.x || px0 > s.x + s.w - 1 || py1 < s.y || py0 > s.y + s.h - 1) continue;
		if (erodeShield(s, px0, py0, px1, py1)) return true;
	}
	return false;
}
/**
* Bomb-spawn interval in ticks, for `alive` remaining aliens on `wave`. Falls
* as the formation thins and as waves advance, with a little jitter so the
* cadence is not metronomic — the arcade's drops were randomized too. Clamped
* at `BOMB_INTERVAL_MIN` so a thinned late wave still leaves a beat to react.
*/
function bombInterval(alive, wave) {
	const f = (55 - alive) / 54;
	const full = Math.max(BOMB_INTERVAL_FLOOR, BOMB_INTERVAL_FULL - (wave - 1) * BOMB_INTERVAL_PER_WAVE);
	const base = Math.round(full - (full - BOMB_INTERVAL_MIN) * f);
	const jitter = Math.round((Math.random() - .5) * base * .4);
	return Math.max(BOMB_INTERVAL_MIN, base + jitter);
}
/**
* Maybe drop one alien bomb. Only the bottom-most alive alien in a column may
* fire, so bombs always emerge from beneath the formation and never through
* it. The shooter is chosen uniformly from those column bottoms, matching the
* arcade's "any live column, at random" behaviour. The drop is skipped if the
* in-flight cap is reached; the caller still resets the cooldown either way.
*/
function spawnBomb(world) {
	if (world.bombs.length >= BOMB_MAX_IN_FLIGHT) return;
	const bottomByCol = new Array(11).fill(null);
	for (let row = 0; row < 5; row++) for (let col = 0; col < 11; col++) {
		const a = world.aliens[row * 11 + col];
		if (a.alive) bottomByCol[col] = a;
	}
	const candidates = [];
	for (const a of bottomByCol) if (a) candidates.push(a);
	if (candidates.length === 0) return;
	const shooter = candidates[Math.floor(Math.random() * candidates.length)];
	const sp = SPRITES[shooter.kind];
	world.bombs.push({
		x: shooter.x,
		y: shooter.y + sp.h / 2
	});
}
/**
* Lose a life: clear the screen of bombs and the player's shot, re-centre the
* cannon, and decrement lives. Reaching zero sets `gameOver` — the third life
* lost ends the run. Clearing the bombs on death is the arcade's beat: the
* explosion clears the air, so the respawn is not instantly punished by a
* bomb that was already on top of the cannon.
*/
function loseLife(world) {
	world.lives -= 1;
	world.bombs.length = 0;
	world.shot = null;
	world.cannon.x = 112;
	if (world.lives <= 0) world.gameOver = true;
}
/**
* Advance the formation one march step. Every alive alien moves on the same
* tick — there is no per-alien animation here, only the whole-formation step.
*
* If the next sideways step would carry the leading column past the side
* wall, the formation instead drops a row and reverses direction (no sideways
* advance on that tick — the drop is the movement for that step, as on the
* arcade). The "leading column" is the leftmost or rightmost column that
* still has a live alien, so cleared flanks do not stop the march early: the
* formation keeps using the full width as long as anything lives.
*/
function marchStep(world) {
	if (world.marchDir > 0) {
		let leadEdge = -Infinity;
		for (const a of world.aliens) {
			if (!a.alive) continue;
			leadEdge = Math.max(leadEdge, a.x + SPRITES[a.kind].w / 2);
		}
		if (leadEdge + STEP_X > 220) {
			dropFormation(world);
			world.marchDir = -1;
		} else for (const a of world.aliens) if (a.alive) a.x += STEP_X;
	} else {
		let leadEdge = Infinity;
		for (const a of world.aliens) {
			if (!a.alive) continue;
			leadEdge = Math.min(leadEdge, a.x - SPRITES[a.kind].w / 2);
		}
		if (leadEdge - STEP_X < FIELD_MARGIN) {
			dropFormation(world);
			world.marchDir = 1;
		} else for (const a of world.aliens) if (a.alive) a.x -= STEP_X;
	}
}
/** Drop every alive alien one row. */
function dropFormation(world) {
	for (const a of world.aliens) if (a.alive) a.y += DROP_PX;
}
/**
* True when the lowest alive alien has descended to the cannon's line. The
* formation landing on you is an instant loss regardless of lives left — the
* arcade ended the run the moment invaders touched the ground line. With no
* aliens alive the result is false (a cleared wave restarts, it does not end).
*/
function reachedCannon(world) {
	let lowest = -Infinity;
	for (const a of world.aliens) {
		if (!a.alive) continue;
		lowest = Math.max(lowest, a.y + SPRITES[a.kind].h / 2);
	}
	return lowest >= CANNON_TOP;
}
/** Integer pixel bbox of the in-flight player shot, or null. Aligned with the
*  renderer's `Math.round` so the cells eroded here are exactly the cells the
*  player sees the shot overlap. */
function shotBox(shot) {
	const x0 = Math.round(shot.x - 1 / 2);
	const y0 = Math.round(shot.y);
	return {
		x0,
		y0,
		x1: x0 + 1 - 1,
		y1: y0 + 4 - 1
	};
}
/** Integer pixel bbox of a bomb. */
function bombBox(b) {
	const w = SPRITES.bomb.w;
	const h = SPRITES.bomb.h;
	const x0 = Math.round(b.x - w / 2);
	const y0 = Math.round(b.y);
	return {
		x0,
		y0,
		x1: x0 + w - 1,
		y1: y0 + h - 1
	};
}
/** Vertical span a bomb sweeps in one update: from its prior `yBefore` down
*  to `yAfter` plus the bomb height. Used by the bomb-shot test so a fast-
*  closing shot and bomb cannot tunnel past each other between ticks. */
function bombSweptY(yBefore, yAfter) {
	return {
		top: yBefore,
		bottom: yAfter + SPRITES.bomb.h - 1
	};
}
/**
* Advance the world by one fixed step of `dt` seconds.
*
* Cannon movement and the shot are driven from `input` here — never from the
* render callback or from raw event handlers. `input` is the held state the
* listeners in `input.ts` maintain; fire is an edge the update consumes.
*
* The march runs on a tick counter (one update = one tick), decoupled from
* `dt` so a 120 Hz display does not double its speed. The tempo rises as the
* formation thins and again on each new wave.
*
* Aliens shoot back on their own cadence: only the bottom of each live column
* drops a bomb, and at most three are in the air at once. A bomb that reaches
* the cannon costs a life — losing a life clears the screen and re-centres
* the cannon; losing the third ends the run. Both the player's shot and alien
* bombs erode the bunkers per-cell where they strike, and a shot and bomb that
* meet in the air cancel, as on the arcade.
*
* The run also ends the moment the formation lands on the cannon's line. Once
* `gameOver` is set the update freezes — the game-over screen itself is #3;
* this slice only stops the simulation.
*
* Out of scope for this slice: score and the game-over screen (#3).
*/
function update(world, input, dt) {
	if (world.gameOver) return;
	const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
	if (dir !== 0) {
		const cw = SPRITES.cannon.w;
		world.cannon.x = clamp(world.cannon.x + dir * CANNON_SPEED * dt, cw / 2, 224 - cw / 2);
	}
	if (consumeFire(input) && world.shot === null) world.shot = {
		x: world.cannon.x,
		y: 212
	};
	let shotPreY = null;
	if (world.shot) {
		shotPreY = world.shot.y;
		world.shot.y -= SHOT_SPEED * dt;
		if (world.shot.y + 4 <= 0) world.shot = null;
		else {
			const b = shotBox(world.shot);
			if (hitShields(world, b.x0, b.y0, b.x1, b.y1)) world.shot = null;
			else {
				const hit = findAlienHit(world, world.shot);
				if (hit) {
					hit.alive = false;
					world.shot = null;
				}
			}
		}
	}
	world.bombCooldown -= 1;
	if (world.bombCooldown <= 0) {
		spawnBomb(world);
		world.bombCooldown = bombInterval(aliveCount(world), world.wave);
	}
	for (let i = world.bombs.length - 1; i >= 0; i--) {
		const bomb = world.bombs[i];
		const yBefore = bomb.y;
		bomb.y += BOMB_SPEED * dt;
		if (bomb.y >= 240) {
			world.bombs.splice(i, 1);
			continue;
		}
		if (world.shot && shotPreY !== null) {
			const sMin = world.shot.y;
			const sMax = shotPreY + 4 - 1;
			const { top: bMin, bottom: bMax } = bombSweptY(yBefore, bomb.y);
			const s = world.shot;
			const sx0 = s.x - 1 / 2;
			const sx1 = s.x + 1 / 2;
			const bw = SPRITES.bomb.w;
			const bx0 = bomb.x - bw / 2;
			if (bomb.x + bw / 2 > sx0 && bx0 < sx1 && sMax > bMin && bMax > sMin) {
				world.bombs.splice(i, 1);
				world.shot = null;
				continue;
			}
		}
		{
			const b = bombBox(bomb);
			if (hitShields(world, b.x0, b.y0, b.x1, b.y1)) {
				world.bombs.splice(i, 1);
				continue;
			}
		}
		{
			const cw = SPRITES.cannon.w;
			const ch = SPRITES.cannon.h;
			const cx0 = world.cannon.x - cw / 2;
			const cx1 = world.cannon.x + cw / 2;
			const cy0 = world.cannon.y;
			const cy1 = world.cannon.y + ch;
			const bw = SPRITES.bomb.w;
			const bh = SPRITES.bomb.h;
			const bx0 = bomb.x - bw / 2;
			const bx1 = bomb.x + bw / 2;
			const by0 = bomb.y;
			const by1 = bomb.y + bh;
			if (bx1 > cx0 && bx0 < cx1 && by1 > cy0 && by0 < cy1) {
				loseLife(world);
				break;
			}
		}
	}
	if (world.gameOver) return;
	world.stepCooldown -= 1;
	if (world.stepCooldown <= 0) {
		marchStep(world);
		world.stepCooldown = ticksPerStep(aliveCount(world), world.wave);
	}
	if (reachedCannon(world)) {
		world.gameOver = true;
		return;
	}
	if (aliveCount(world) === 0) startWave(world, world.wave + 1);
}
//#endregion
//#region smoke.ts
var dt = 1e3 / 60;
var input = {
	left: false,
	right: false,
	fireQueued: false
};
var fails = 0;
function check(cond, msg) {
	if (!cond) {
		fails++;
		console.error("FAIL:", msg);
	} else console.log("ok  :", msg);
}
var w = createWorld();
check(w.lives === 3, "createWorld: starts with 3 lives");
check(w.bombs.length === 0, "createWorld: no bombs in flight");
check(w.shields.length === 4, "createWorld: four shields");
for (const s of w.shields) {
	let intact = 0;
	for (let i = 0; i < s.cells.length; i++) if (s.cells[i]) intact++;
	check(intact > 250 && intact < 352, `shield intact cells ~280 (got ${intact})`);
}
for (let i = 0; i < 480; i++) update(w, input, dt / 1e3);
check(w.bombs.length <= 3, "idle sim: bomb cap respected");
check(w.lives >= 0 && w.lives <= 3, "idle sim: lives in range");
check(!w.gameOver || w.lives === 0, "idle sim: gameOver only at 0 lives OR formation-reach");
var w2 = createWorld();
var hits = 0;
for (let i = 0; i < 1800 && !w2.gameOver; i++) {
	w2.bombs.push({
		x: w2.cannon.x,
		y: w2.cannon.y - 1
	});
	const livesBefore = w2.lives;
	update(w2, input, dt / 1e3);
	if (w2.lives < livesBefore) hits++;
}
check(w2.gameOver, "forced hits: game over reached");
check(w2.lives === 0, "forced hits: ended at 0 lives");
check(hits === 3, `forced hits: exactly 3 lives lost (got ${hits})`);
var w3 = createWorld();
var shield = w3.shields[0];
w3.cannon.x = shield.x + shield.w / 2;
var erodedBefore = 0;
for (let i = 0; i < shield.cells.length; i++) if (!shield.cells[i]) erodedBefore++;
var fired = 0;
for (let i = 0; i < 180; i++) {
	if (w3.shot === null) {
		input.fireQueued = true;
		fired++;
	}
	update(w3, input, dt / 1e3);
	consumeFire(input);
}
var erodedAfter = 0;
for (let i = 0; i < shield.cells.length; i++) if (!shield.cells[i]) erodedAfter++;
check(erodedAfter > erodedBefore, `shield erosion: shot chewed away cells (before ${erodedBefore}, after ${erodedAfter})`);
var intactAfter = 0;
for (let i = 0; i < shield.cells.length; i++) if (shield.cells[i]) intactAfter++;
check(intactAfter > 0, "shield erosion: bunker not removed whole");
var w4 = createWorld();
w4.shot = {
	x: 112,
	y: 170
};
w4.bombs.push({
	x: 112,
	y: 160
});
update(w4, input, dt / 1e3);
check(w4.shot === null, "bomb-shot cancel: shot removed");
check(w4.bombs.length === 0, "bomb-shot cancel: bomb removed");
var w5 = createWorld();
var shield5 = w5.shields[0];
var eroded5Before = 0;
for (let i = 0; i < shield5.cells.length; i++) if (!shield5.cells[i]) eroded5Before++;
for (let i = 0; i < 60; i++) {
	w5.bombs.push({
		x: shield5.x + shield5.w / 2,
		y: shield5.y - 4
	});
	update(w5, input, dt / 1e3);
}
var eroded5After = 0;
for (let i = 0; i < shield5.cells.length; i++) if (!shield5.cells[i]) eroded5After++;
check(eroded5After > eroded5Before, `bomb erodes shield: bomb chewed away cells (before ${eroded5Before}, after ${eroded5After})`);
console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
if (fails > 0) process.exit(1);
//#endregion
