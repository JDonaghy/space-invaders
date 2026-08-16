# space-invaders

A browser clone of the 1978 arcade game. Rows of aliens march side to side and
drop toward you, you move a cannon along the bottom and shoot, and the wave
speeds up as you clear it. Four shields wear away where they are hit. Three
lives, then game over.

**Live:** https://jdonaghy.github.io/space-invaders/

Arrow keys and space on a computer; hold either side of the screen to move and
tap to fire on a phone. `P` pauses, `M` mutes. Your best score is remembered on
the device.

## How it's built

A hand-written game loop on a plain 2D canvas — `requestAnimationFrame`, a
fixed-timestep update, and `CanvasRenderingContext2D` draw calls. No game
engine, no framework, no physics library. Sprites are pixel grids drawn as
filled rects, the way the original was a bitmap.

TypeScript, bundled by Vite, published to GitHub Pages on merge to `main`.

```bash
npm ci
npm run dev
```

## Scope

Faithful to the arcade rather than feature-rich: one alien formation that
repeats faster each wave, one kind of shot, no power-ups, no accounts and no
online leaderboard. That scope was agreed with the person who asked for it
before any code was written — see `CLAUDE.md` for the approved definition and
what is deliberately excluded.

## Licence

MIT.
