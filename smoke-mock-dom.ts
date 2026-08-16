// Minimal DOM mock so the game-logic modules (which call document.createElement
// at load to pre-render sprites and shield caches) can run under Node. Only
// the calls actually made by src/sprites.ts and src/world.ts are stubbed.
const noop = (): void => {};

interface StubCanvas {
  width: number;
  height: number;
  getContext: (kind: string) => unknown;
}

function makeCanvas(): StubCanvas {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      imageSmoothingEnabled: false,
      setTransform: noop,
      fillRect: noop,
      drawImage: noop,
      clearRect: noop,
    }),
  };
}

(globalThis as unknown as { document: unknown }).document = {
  createElement: (_tag: string) => makeCanvas(),
  querySelector: () => null,
};

(globalThis as unknown as { window: unknown }).window = {
  innerWidth: 224,
  innerHeight: 256,
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop,
};

(globalThis as unknown as { performance: unknown }).performance = {
  now: () => Date.now(),
};

(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
  noop;

export {};
