import { resolve } from "node:path";
import { defineConfig } from "vite";

// Multi-page build rooted at src/: the settings app plus the two
// overlay pages. Inputs are absolute so Rollup finds them; outputs
// land flat in dist/ (index.html, chat.html, goal.html) so the Rust
// localhost server and Tauri can serve them directly.
export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        chat: resolve(__dirname, "src/chat.html"),
        goal: resolve(__dirname, "src/goal.html"),
      },
    },
  },
  server: { port: 5173 },
});
