import type { NextConfig } from "next";

/**
 * GitHub Pages project site: https://alphaca-labs.github.io/feelgood-music-adventure/
 *
 * `NEXT_PUBLIC_BASE_PATH` is public on purpose. `basePath` only rewrites Next's own
 * routing/asset URLs — the game fetches its atlas directly, so the runtime needs the
 * same prefix (see `lib/game/paths.ts`). Leaving it unset keeps `pnpm --filter web dev`
 * working on http://localhost:3000/.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  // Pages cannot serve extension-less paths; /foo must resolve to /foo/index.html.
  trailingSlash: true,
  // No image optimization server exists in a static export.
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
