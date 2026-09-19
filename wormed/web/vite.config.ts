import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// wormed/data lives OUTSIDE this root, so the dev server will not serve it by
// path and a fetch of /data/positions.json 404s. publicDir mounts the data
// directory at the URL root instead: /positions.json, /names.json,
// /edges.json — and, for Task 15, /addresses.json.
export default defineConfig({
  publicDir: fileURLToPath(new URL("../data", import.meta.url)),
  server: { port: 5173 },
});
