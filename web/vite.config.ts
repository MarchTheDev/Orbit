import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The version, read from the repository's own VERSION file.
 *
 * The same file feeds the release workflow, so what the app says it is, what
 * the bundles are named, and what the GitHub release is called all come from
 * one line in one place.
 */
const VERSION = readFileSync(path.resolve(__dirname, "..", "VERSION"), "utf8").trim();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  define: {
    __ORBIT_VERSION__: JSON.stringify(VERSION),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Reachable from outside this machine, so a preview (or a phone on the
    // same network) can open the interface. The desktop app never uses this;
    // it loads the built file.
    host: true,
    allowedHosts: true,
  },
});
