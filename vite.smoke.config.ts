import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "./smoke.ts",
      formats: ["es"],
      fileName: "smoke",
    },
    outDir: "smoke-out",
    emptyOutDir: true,
    // Skip the default browser targets; we run this under Node.
    target: "node18",
    minify: false,
  },
  // The DOM mock sets up globals; no real browser APIs needed at build time.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
