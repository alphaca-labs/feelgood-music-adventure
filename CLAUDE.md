# CLAUDE.md

## Project Overview

**omniseed** is a Turborepo monorepo template using Next.js 16, React 19, and Prisma ORM with shadcn/ui design system.

## Commands

```bash
pnpm build              # Build all
pnpm dev                # Dev all apps
pnpm web                # Web app (port 3000)
pnpm admin              # Admin app (port 3001)
pnpm frontend           # Frontend app — React Router v7 (port 3003)
pnpm lint               # ESLint
pnpm format             # Prettier format
pnpm format:check       # Check formatting
pnpm migrate            # prisma format + generate + db push (in packages/database)
pnpm bump-deps          # Update all deps (except react-day-picker)
pnpm bump-ui            # Update all shadcn/ui components
pnpm gen:api-web        # Generate API client for web
pnpm gen:api-admin      # Generate API client for admin
pnpm bootstrap          # Prune to Next fullstack flavor (destructive; deletes .beskit + git-commits; --dry-run/--yes/--force/--no-commit)
pnpm bootstrap:front    # Prune to frontend-only (RR7) flavor
pnpm bootstrap:separate # Prune to frontend + api (Fastify) flavor
```

## Structure

### Apps (`apps/`)

- **web**: User-facing app (port 3000)
- **admin**: Admin panel with NextAuth (port 3001)
- **api**: Fastify v5 backend (tRPC + REST hybrid), CommonJS, tsup build (port 3002)
- **frontend**: React Router v7 framework-mode app, SSR (port 3003)
- **storybook**: Component docs (port 6006)
- **email**: Email templates (React Email)

### Packages (`packages/`)

- **@repo/database**: Prisma client and schema (single source of truth for DB access)
- **@repo/upload**: R2/S3 server upload util (presigned URLs)
- **@repo/design-system**: shadcn/ui components
- **@repo/next-config**: Shared Next.js config
- **@repo/typescript-config**: Shared TS configs
- **@repo/analytics**, **@repo/seo**, **@repo/editor**, **@repo/email**

## Key Conventions

### Database Access

All DB access MUST go through `@repo/database`. Never create direct Prisma clients.

```typescript
import { database } from '@repo/database'        // Next RSC only (server-only guard)
import { database } from '@repo/database/node'    // plain-Node consumers (Fastify api, CLI, workers)
```

- Non-RSC server code MUST use `@repo/database/node`; the default subpath has `server-only` and crashes at import elsewhere.
- Plain-Node consumers must bundle (tsup/esbuild) — Prisma 7's generated client is a CJS/ESM hybrid that fails under raw `node`. tsup `noExternal` is only for **hoist-only transitive** deps: in this pnpm isolated layout Prisma runtime deps (`@prisma/client`/`@prisma/adapter-pg`/`pg`) hoist under `packages/database` (not in the app's `node_modules`), so inline them via `noExternal` (left external → runtime `MODULE_NOT_FOUND`) and shim the client's `import.meta.url` via esbuild `define`+`banner` for CJS. An app's **direct** deps stay external (pnpm symlinks them into the app) — don't reflexively inline every new dep.

Schema: `packages/database/prisma/schema.prisma`

### File Uploads (`@repo/upload`)

R2 (primary) / S3 server util over AWS SDK v3 — presigned PUT/GET URLs + direct put/get/delete/list + Zod schemas. Like `@repo/database/node`, it is node-only raw TS with **no `server-only` guard**: call it from server code only so credentials never reach a client bundle.

- **R2 + AWS SDK checksums:** set `requestChecksumCalculation`/`responseChecksumValidation` to `"WHEN_REQUIRED"` on any R2-targeted `S3Client`. The SDK default (`WHEN_SUPPORTED`) adds `x-amz-checksum-*` headers that break R2 presigned PUTs (signature mismatch / 501).

### API Transports (apps/api, tRPC + REST hybrid)

- New domains live in `src/domain/{name}/{schema,service}.ts` — a transport-agnostic Zod schema + pure service. The tRPC procedure (`src/trpc/routers/{name}.ts`) and the REST handler (`src/routes/{name}.ts`) MUST call the **same** service + schema (zero duplicated logic). Map absence at the transport edge: service returns `undefined`; REST → 404, tRPC → `TRPCError NOT_FOUND`.
- **Internal callers use tRPC (`/trpc`), external/public use REST.** Register CORS first and the tRPC plugin last in `server.ts`.
- **JIT type sharing (no contract package):** api exposes `"exports": { "./trpc": "./src/trpc/router.ts" }` (source, no build step); frontend adds `"api": "workspace:*"` and does `import type { AppRouter } from "api/trpc"` — type-only, so no api/Node runtime leaks into the bundle (`verbatimModuleSyntax` erases it).
- `pnpm bootstrap:front` strips this tRPC wiring (it deletes `apps/api`; `bootstrap:separate` keeps it) — so wrap tRPC-only frontend code in the `// @bootstrap:*` sentinel blocks the cleanup matches.

### UI Components

```typescript
import { Button } from "@repo/design-system/components/ui/button"
import { cn } from "@repo/design-system/lib/utils"
```

- Compose DS components (Button/Card/Table/Badge/Avatar/Input/Tabs/Pagination/…) — do NOT reimplement them with custom markup. The shared theme is monochrome, so they match the design out of the box; tune the look via `className` (tailwind-merge overrides DS defaults like `rounded-md`/`shadow`). Custom markup is justified only where no DS primitive fits (e.g. a bespoke app shell).
- Icons: `lucide-react` (primary), `@tabler/icons-react` (secondary). admin uses Material Symbols Outlined via the shared `MaterialSymbol` component — it emits classes only; the consumer app loads the webfont (Google Fonts `<link>` in app `<head>`) + base CSS. web/frontend stay on lucide.
- Toast: `import { toast } from "sonner"`
- App-only design tokens (shadows, `--font-mono`, Material Symbols base CSS) go in that app's CSS (e.g. `apps/admin/app/styles.css`), NEVER shared `design-system/styles/globals.css` — shared globals affect web/admin/frontend/storybook/email at once.

### Server Actions

Located in `@actions/{domain}/{action}.ts`. Must declare `'use server'` at top.

### File Organization

- `/_components`, `/_hooks`, `/lib` — shared across scopes
- `{scope}/_components`, `{scope}/_hooks`, `{scope}/lib` — scope-specific
- All directories use `kebab-case`

## Tech Stack

- **Framework**: Next.js 16 (web/admin, App Router, Server Components default)
- **API**: Fastify v5 (apps/api, CommonJS, tsup build)
- **Frontend (alt)**: React Router v7 (apps/frontend, framework mode + SSR). `~/*` tsconfig alias needs `vite-tsconfig-paths` in `vite.config.ts` — tsc resolves it but the Vite/Rollup build won't (typecheck passes, build fails).
- **React**: 19
- **Database**: PostgreSQL + Prisma ORM
- **Styling**: Tailwind CSS 4, shadcn/ui (Radix UI). `@repo/design-system` is monochrome-themed (near-black primary + neutral grays); `--chart-*` stays colored.
- **Forms**: react-hook-form + @hookform/resolvers
- **Validation**: Zod
- **State**: TanStack Query (admin, frontend)
- **Auth**: NextAuth v5 beta (admin)
- **Monorepo**: Turborepo + pnpm
- **Lint/Format**: ESLint + Prettier
