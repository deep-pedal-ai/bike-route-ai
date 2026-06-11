# Build Log — Freewheel Corpus Pipeline

Append-only execution record for agentic coding. Newest entries at the bottom of
each section. Every step run and what happened — so the build is auditable and
resumable. The orchestrator and each subagent append here as work happens.

**Conventions**
- Branch: `feat/corpus-pipeline` (never `main`).
- One commit per green work-package gate (see [`PLAN.md`](./PLAN.md) §8).
- Decisions are recorded in [`DECISIONS.md`](./DECISIONS.md) + [`adr/`](./adr/);
  don't relitigate them here, reference them.

---

## 2026-06-10 — Planning session (human + Claude)

### Repo reconnaissance
- `git ls-files` → only `LICENSE`, `README.md`. README is one line ("an AI agent
  that generates recommended bike routes given user input"). Owner
  `deep-pedal-ai`, single "Initial commit". **No serving app, no `package.json`,
  no workspaces.** → The spec's monorepo/serving-app premise is fictional;
  isolation rules are dormant (ADR-0001).

### Grill — 7 questions resolved (see DECISIONS.md for full table)
- Q1 placement → `corpus-pipeline/` at root, self-contained (ADR-0001).
- Q2 verification → ephemeral **Neon PostGIS branch** as `DATABASE_URL` target.
- Q3 dedup → cross-source pass, precedence `canon>osm_relation>nysdot>usbrs>
  generated`, hard-delete loser (ADR-0003).
- Q4 ORS quota → per-endpoint counters; no elevation backfill for OSM relations.
- Q5 coords → YAML `[lat,lon]`, code `[lon,lat]`, metro-bounds guard.
- Q6a → drop NYS `7bg2-3faq` from v1 pending live inspection; Q6b → `out_and_back`
  into `tags`, no new column.
- Q7a CRS → **EPSG:32618** metres everywhere (ADR-0002); Q7b → filter NYC DOT to
  current facilities (exclude retired).

### Working conventions captured
- Branch never main; running build log (this file); TDD vertical slices via the
  `tdd` skill; plan must be executable by an orchestrator dispatching Opus
  subagents.

### Artifacts created this session
- `git checkout -b feat/corpus-pipeline` ✓
- `corpus-pipeline/docs/adr/0001…0004` ✓ (isolation, CRS, dedup precedence,
  no-pgvector)
- `corpus-pipeline/docs/DECISIONS.md` ✓
- `corpus-pipeline/docs/PLAN.md` ✓ (orchestrator + 6 work packages WP0–WP5,
  TDD behavior lists, gates, Neon lifecycle, parallelism map)
- `corpus-pipeline/docs/BUILD-LOG.md` ✓ (this file)

**State:** planning complete; no feature code written yet. Next action is WP0
(foundation + migration 001), pending human go-ahead and Neon provisioning.

---

## 2026-06-10 — CORRECTION: serving app is real (supersedes the recon above)

Mid-session, the `bike-route-ai` working tree gained a full npm-workspaces
monorepo (files timestamped 22:13, after the initial recon):
`packages/{shared,server,client}`, root `package.json`
(`workspaces: ["packages/*"]`), `CLAUDE.md`, `STANDARDS.md`, husky/eslint,
`tsconfig.base.json`, and a tracked `.claude/skills/`.

**The "premise is fictional / isolation rules dormant" conclusion above is
withdrawn.** Verified ground truth:
- `git ls-files` now lists the three packages; `git status` shows
  `corpus-pipeline/` as the only untracked addition.
- Serving app is a **stub**: `packages/server/src/routes/routes.ts` returns
  hardcoded sample routes, **no Postgres connection** → no column-level DB
  contract to match; migration 001 stays greenfield.
- `packages/shared/src/index.ts` `Route` = `{id, name, distance,
  waypoints[lat,lng][]}` — a thin API DTO, a downstream projection of our
  `routes` table, owned by the server (incl. PostGIS `[lon,lat]`→`[lat,lng]`).
- `corpus-pipeline/` is outside `packages/`, so the workspace glob excludes it;
  lint-staged (`*.{ts,tsx}`) ignores `.py`. Q1 placement is correct and now
  *binding* rather than forward-looking.

**Docs corrected accordingly:** ADR-0001 (repo-state note), DECISIONS.md (Repo
context section). No grill decision (Q1–Q7) changes — only their justification:
the isolation rules are live, not hypothetical. Lesson logged: re-verify repo
state before finalizing, the tree can change mid-session.

---

## 2026-06-10 — Plan hardening (advisor review pass)

Stronger-reviewer pass on PLAN.md surfaced four issues, all fixed:
1. **WP5 acceptance conflated two things** → split into Gate 5a (pipeline
   correctness, autonomously verifiable) and Gate 5b (corpus completeness,
   human-gated). Prevents the orchestrator from spinning its retry loop on
   canon DRAFT-coord skips and absent manual GPX. Added §11 (expected pauses /
   human gates / external prereqs).
2. **Coordinate order bites in two more spots** → flagged in WP0
   (`metro_boundary.geojson` is `[lon,lat]` RFC 7946, opposite of `canon.yaml`)
   and WP1 (Overpass `poly:` is `"lat lon …"`, lat-first), both with a
   metro-bounds fail-loud assert.
3. **Dedup ownership** → pure overlap predicate + its mandated test moved to
   WP1 `geometry.py`; WP4 keeps only the DB-side precedence/hard-delete; noted
   `phase3` is edited in WP3 and WP5.
4. **ORS key prereq** → §11 records that WP4 live verification is *deferred*
   (not a code failure) if `ORS_API_KEY` is absent.

---

## Work-package execution (append as WPs run)

> Template per entry:
> ```
> ### YYYY-MM-DD — WP<n> <title> [subagent | orchestrator]
> - command/step → outcome
> - tests added (RED→GREEN): <behavior>
> - Neon verification: <what ran> → <result>
> - gate: pass | fail (+ why)
> - commit: <sha> <message>
> - surprises / followups
> ```

_(none yet)_
