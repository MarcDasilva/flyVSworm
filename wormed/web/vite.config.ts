import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// wormed/data lives OUTSIDE this root, so the dev server will not serve it by
// path and a fetch of /data/positions.json 404s. publicDir mounts the data
// directory at the URL root instead: /positions.json, /names.json,
// /edges.json — and, for Task 15, /chain.json, which is how the browser
// learns the program id and the behavior account.
export default defineConfig({
  publicDir: fileURLToPath(new URL("../data", import.meta.url)),
  // The fee payer's key lives in the relay, never in the browser, so the two
  // touch buttons POST to it. Proxying keeps them same-origin: a cross-origin
  // POST would need CORS on a process whose whole job is to be the trust
  // boundary.
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
