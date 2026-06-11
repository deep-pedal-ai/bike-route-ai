# STANDARDS.md

Code standards for bike-route-ai. Enforced by `/review` at PR time and by Claude during development.

## TypeScript

- `strict: true` is set in `tsconfig.base.json` — do not weaken it per-package.
- `any` is banned. Use `unknown` and narrow with type guards, or define a proper type.
- Prefer `type` over `interface` for object shapes unless you need declaration merging.

## React

**Components**
- Function components only. No class components.
- One component per file. Filename matches the component name in PascalCase (`RouteList.tsx`).

**Hooks**
- Custom hooks must start with `use` (`useRoutes`, not `fetchRoutes`).
- `eslint-plugin-react-hooks` is enforced — follow the rules of hooks (no conditional hook calls).

**State**
- Use `useState` for local component state.
- Use `useContext` only when the same state is needed by 3+ unrelated components (auth, user session, theme).
- Do not introduce external state libraries (Redux, Zustand, Jotai, etc.) without team agreement.

**Async in components**
- `useEffect` callbacks cannot be `async`. Wrap in an inner async function and call it:
  ```ts
  useEffect(() => {
    const load = async () => { ... };
    load();
  }, []);
  ```

**Import order** (within each file, maintain this grouping — one blank line between groups):
1. External packages (`react`, `express`, …)
2. Internal modules (`../services/route-service.js`, …)
3. Types (`import type { Route } from '@bike-route-ai/shared'`)

## Express / Node

**Layered architecture** — requests must flow through layers in order:

```
routes/      → maps URLs to controller functions only, no logic
controllers/ → handles req/res, calls services, sends responses
services/    → business logic; no Express types (Request, Response, NextFunction)
clients/     → external API calls and DB queries
middleware/  → cross-cutting concerns (auth, error handling, logging)
```

Services must never import from `express`. If a service needs something from the request, the controller extracts it and passes it as a plain argument.

**Async route handlers**
All async handlers must use try/catch and forward errors to Express via `next(err)`:
```ts
router.get('/', async (req, res, next) => {
  try {
    const result = await routeService.getRoutes();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

**Error responses**
All error responses must use this shape:
```ts
{ error: string, statusCode: number }
```
Errors are handled centrally in `middleware/error-handler.ts`. Controllers call `next(err)` — they do not send error responses directly.

## File and folder naming

| Type | Convention | Example |
|---|---|---|
| React component | PascalCase | `RouteList.tsx` |
| Everything else | kebab-case | `route-service.ts`, `api-client.ts` |
| Test files | co-located, same name + `.test` | `route-service.test.ts` |
