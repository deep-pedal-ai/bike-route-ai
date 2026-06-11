# /check

Run lint, typecheck, and tests across all packages in sequence. Stop and report on the first failure.

## Process

Run these three commands from the repo root in order:

1. `npm run lint` — ESLint across all packages
2. `npx tsc --noEmit -p packages/server/tsconfig.json && npx tsc --noEmit -p packages/client/tsconfig.json && npx tsc --noEmit -p packages/shared/tsconfig.json` — typecheck all packages without emitting
3. `npm test` — Vitest across all packages

If any step fails, stop immediately and report which step failed, the full error output, and what to fix. Do not proceed to the next step after a failure.

If all three pass, report a one-line summary: "lint ✓  types ✓  tests ✓" with the test count.
