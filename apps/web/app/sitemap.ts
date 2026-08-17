import fs from "node:fs";
import path from "node:path";
import { baseUrl } from "lib/utils";
import type { MetadataRoute } from "next";

type Route = {
  url: string;
  lastModified: string;
};

export const dynamic = "force-dynamic";

const appFolders = fs.readdirSync(path.join(process.cwd(), "app/(pages)"), {
  withFileTypes: true,
});
const pages = appFolders
  .filter((file) => file.isDirectory())
  .filter((folder) => !folder.name.startsWith("_"))
  .filter((folder) => !folder.name.startsWith("("))
  .map((folder) => folder.name);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routesMap = [""].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date().toISOString(),
  }));

  const pageRoutes: Route[] = pages.map((page) => ({
    url: `${baseUrl}/${page}`,
    lastModified: new Date().toISOString(),
  }));

  return [...routesMap, ...pageRoutes];
}
