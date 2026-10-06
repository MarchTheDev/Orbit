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
/**
 * The version as a module.
 *
 * `define` would only have substituted it in a production build, which left the
 * development server reporting 0.0.0 and off it went offering an update to
 * itself. A module resolving to the number works the same in both, and is the
 * one place the value is turned into code.
 */
const versionModule = {
  name: 'orbit-version',
  resolveId(id: string) {
    return id === 'virtual:orbit-version' ? '\0virtual:orbit-version' : null;
  },
  load(id: string) {
    return id === '\0virtual:orbit-version'
      ? `export const APP_VERSION = ${JSON.stringify(VERSION)};`
      : null;
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), versionModule],
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
