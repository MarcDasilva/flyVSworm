import { defineConfig } from "vite";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// wormed/data lives OUTSIDE this root, so the dev server will not serve it by
// path and a fetch of /data/positions.json 404s. publicDir mounts the data
// directory at the URL root instead: /positions.json, /names.json,
// /edges.json — and, for Task 15, /chain.json, which is how the browser
// learns the program id and the behavior account.
const brainDir = fileURLToPath(new URL("../../frontend/public/brain", import.meta.url));

/**
 * The baked fly brain (brain.json, brain.glb, synapses.bin) is 22 MB and it
 * already lives in the Next app's public directory. Serving it from there
 * rather than copying it keeps ONE copy of the bake in the repo: two would
 * drift the moment fly-brain/python/bake_3d.py is re-run.
 */
function flyBrainAssets() {
  return {
    name: "fly-brain-assets",
    configureServer(server: { middlewares: { use(fn: (req: { url?: string }, res: NodeJS.WritableStream & { statusCode: number; setHeader(k: string, v: string): void }, next: () => void) => void): void } }) {
      server.middlewares.use((req, res, next) => {
        const name = /^\/brain\/([\w.-]+)$/.exec(req.url?.split("?")[0] ?? "")?.[1];
        if (!name) return next();
        const file = `${brainDir}/${name}`;
        stat(file).then(
          () => {
            res.setHeader("content-type",
              name.endsWith(".json") ? "application/json" : "application/octet-stream");
            createReadStream(file).pipe(res);
          },
          () => next(),
        );
      });
    },
  };
}

export default defineConfig({
  publicDir: fileURLToPath(new URL("../data", import.meta.url)),
  plugins: [flyBrainAssets()],
  // The fee payer's key lives in the relay, never in the browser, so the two
  // touch buttons POST to it. Proxying keeps them same-origin: a cross-origin
  // POST would need CORS on a process whose whole job is to be the trust
  // boundary.
  // /fly is the fly's own model (fly-brain/python/server.py): its spike
  // stream and the network description the brain is matched against. It sends
  // no CORS headers, so it is proxied rather than called across the origin.
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      // Trailing slash is load-bearing: vite matches a proxy key as a PREFIX, so a bare "/fly"
      // also swallows /fly.glb — the fly's own model in publicDir — and forwards it to the
      // python server, which 404s it and takes the whole desk down with it.
      "/fly/": {
        target: "http://127.0.0.1:8000",
        ws: true,
        rewrite: (path: string) => path.replace(/^\/fly/, ""),
      },
    },
  },
});
