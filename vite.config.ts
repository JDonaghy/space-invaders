import { defineConfig } from "vite";

// GitHub Pages project site: https://jdonaghy.github.io/space-invaders/
export default defineConfig({
  base: "/space-invaders/",
  build: {
    target: "es2022",
  },
});
