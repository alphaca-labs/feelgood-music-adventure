import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// `env("DATABASE_URL")` throws while the config module is *loaded*, so it broke every
// command in this package — including `prisma generate`, which needs no datasource URL.
// That made the shared `turbo build` gate fail on any checkout without a database
// (CI, the GitHub Pages build, a fresh clone). Attach the datasource only when the URL
// exists; `db push` / `studio` keep the exact same behaviour when it is set.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "./prisma/schema.prisma",
  ...(databaseUrl ? { datasource: { url: env("DATABASE_URL") } } : {}),
});
