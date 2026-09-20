import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // The worm scene's modules are the standalone worm app's own (../wormed/web/src, aliased
    // @worm/* in tsconfig). Turbopack resolves NOTHING outside its root, so the root has to be the
    // repo, not this directory — without it every @worm/* import is "module not found".
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
