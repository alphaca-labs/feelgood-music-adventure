import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Required by output: "export" — these routes are emitted as files, never served dynamically.
export const dynamic = "force-static";

const robots = (): MetadataRoute.Robots => ({
  rules: [{ userAgent: "*", allow: "/" }],
  sitemap: `${siteUrl}/sitemap.xml`,
});

export default robots;
