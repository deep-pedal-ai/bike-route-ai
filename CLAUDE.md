# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# From repo root
npm run dev          # start both servers concurrently (client: 8080, server: 3000)
npm test             # run all tests across all packages
npm run lint         # ESLint across all packages
npm run typecheck    # tsc --noEmit across all packages
npm run ci           # lint + typecheck + test in sequence (mirrors CI pipeline)
npm run build        # build all packages (shared → server → client)

# Run tests for a single package
npm test -w packages/server
npm test -w packages/client

# Run a single test file
cd packages/server && npx vitest run src/routes/routes.test.ts
cd packages/client && npx vitest run src/App.test.tsx

# Watch mode
cd packages/server && npm run test:watch
cd packages/client && npm run test:watch
```

## Architecture

npm workspaces monorepo with three packages:

- **`packages/shared`** — TypeScript interfaces only (`Route`, `RouteRequest`, `RouteResponse`). No runtime code. Both server and client import from `@bike-route-ai/shared`.
- **`packages/server`** — Express app split into `app.ts` (Express setup, routes mounted) and `index.ts` (listen call). Tests import `app.ts` directly via supertest, never `index.ts`.
- **`packages/client`** — React + Vite. Calls `/api/*` which Vite proxies to `localhost:3000` in dev. Tailwind v4 CSS-first config (`@import "tailwindcss"` in `index.css`, no `tailwind.config.js`).

## Standards

All code must conform to **[STANDARDS.md](./STANDARDS.md)**. Read it before making any changes. The `/review` skill checks the diff against it automatically.

## Key Conventions

- All packages use `"type": "module"` (ESM). Import paths in source use `.js` extensions (resolved to `.ts` at runtime by tsx/Vite).
- `moduleResolution: "bundler"` in `tsconfig.base.json` — shared package exports resolve directly to TypeScript source; no build step needed for `shared` during development.
- Server uses `tsx watch` for hot reload; client uses Vite dev server.
- `useEffect` async fetch pattern: wrap in an inner `async` function and call it — `useEffect` callbacks cannot be `async` directly.
- Pre-commit hook (husky + lint-staged) runs `eslint` on staged `.ts`/`.tsx` files and fails the commit on errors.
