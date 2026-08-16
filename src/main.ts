/**
 * Scaffold placeholder — replaced by the first implementation PR.
 *
 * This exists so `npm run build` exits 0 on an empty repo, which is what the
 * Test stage gates on. It sets up the canvas, the device-pixel-ratio scaling
 * and the resize handling that the real game will keep; everything else here
 * is a holding screen.
 */

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) throw new Error("#stage canvas is missing from index.html");

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2d canvas context unavailable");

/** Size the backing store to the device pixel ratio so pixels stay crisp. */
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas!.width = Math.floor(window.innerWidth * dpr);
  canvas!.height = Math.floor(window.innerHeight * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;

  ctx!.fillStyle = "#05070a";
  ctx!.fillRect(0, 0, w, h);

  ctx!.fillStyle = "#7ef29d";
  ctx!.font = "16px ui-monospace, Menlo, monospace";
  ctx!.textAlign = "center";
  ctx!.textBaseline = "middle";
  ctx!.fillText("SPACE INVADERS", w / 2, h / 2 - 12);

  ctx!.fillStyle = "#5b6472";
  ctx!.font = "12px ui-monospace, Menlo, monospace";
  ctx!.fillText("not built yet", w / 2, h / 2 + 12);
}

window.addEventListener("resize", resize);
resize();
