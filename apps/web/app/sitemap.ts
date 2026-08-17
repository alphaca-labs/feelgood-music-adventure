import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Required by output: "export" — these routes are emitted as files, never served dynamically.
export const dynamic = "force-static";

// Static export: the game is a single route with client-side scenes (spec §3).
// `force-dynamic` would abort `output: "export"`, so this stays a pure constant.
const sitemap = (): MetadataRoute.Sitemap => [
  { url: `${siteUrl}/`, changeFrequency: "monthly", priority: 1 },
];

export default sitemap;
