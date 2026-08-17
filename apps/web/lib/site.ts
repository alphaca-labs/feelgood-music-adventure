/** Public base path of the deployed site ("" locally, "/feelgood-music-adventure" on Pages). */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Absolute origin used for metadata/robots/sitemap. */
export const siteOrigin =
  process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://alphaca-labs.github.io";

export const siteUrl = `${siteOrigin}${basePath}`;

/** Prefix a public asset path with the deployment base path. */
export const assetUrl = (path: string) =>
  `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
