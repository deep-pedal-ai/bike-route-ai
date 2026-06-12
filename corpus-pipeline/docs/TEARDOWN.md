# Teardown — Freewheel Corpus Pipeline (Neon)

This build provisioned a **persistent** Neon Postgres+PostGIS database so you can
explore the corpus after the run. Nothing is auto-deleted. When you're done, tear
it down yourself with the steps below.

> **No secrets in this file.** The actual connection strings (with password) live
> only in `corpus-pipeline/.env`, which is gitignored. This doc references the
> project by ID and name.

---

## What was provisioned

| Resource | Identifier |
|----------|-----------|
| Neon org | **Permaflux** (`org-dawn-hall-45241230`) |
| Neon project | **`freewheel-corpus`** — `sweet-wildflower-00839123` |
| Default branch (the corpus) | `main` — `br-calm-surf-afj225jp` |
| Test branch (integration test only) | `test` — `br-withered-mountain-af1fd7ss` |
| Database / role | `neondb` / `neondb_owner` |
| Engine | PostgreSQL 17.10, PostGIS 3.5.0 |

The real corpus (127 routes, 23,807 facility segments, all scored) lives on the
**`main`** branch.

---

## Explore the data before you delete it

Connection strings are in `corpus-pipeline/.env` (`DATABASE_URL` = the corpus).
The Neon SQL Editor in the console also works: <https://console.neon.tech>.

```bash
# from corpus-pipeline/, load .env and open a psql shell on the corpus
set -a; source .env; set +a
psql "$DATABASE_URL"
```

Useful starter queries:

```sql
SELECT source, count(*) FROM routes GROUP BY source ORDER BY count(*) DESC;
SELECT round(quality_score::numeric,1) AS score, count(*) FROM routes GROUP BY 1 ORDER BY 1;
SELECT name, ST_AsGeoJSON(geom) FROM routes ORDER BY distance_km DESC LIMIT 1;
```

> A local, Neon-independent copy of the corpus is also in
> `corpus-pipeline/exports/` (`routes.geojson`, `routes.csv`,
> `facility_segments.csv`, `ingest_log.csv`). See `docs/RECOVERY.md`.

---

## Tear it down (deletes ALL data, irreversible)

Deleting the **project** removes both branches (`main` + `test`) and every row.

### Option A — Neon Console (no tooling)
1. <https://console.neon.tech> → org **Permaflux**.
2. Open project **`freewheel-corpus`**.
3. **Settings → Delete project**, confirm by typing the project name.

### Option B — Neon CLI
```bash
# one-time: npm i -g neonctl && neonctl auth
neonctl projects delete sweet-wildflower-00839123
```

### Option C — drop just the test branch, keep the corpus
```bash
neonctl branches delete br-withered-mountain-af1fd7ss --project-id sweet-wildflower-00839123
```

---

## Also clean up (not Neon)

- **OpenRouteService key** — you said you'd rotate it. It's in `corpus-pipeline/.env`
  (`ORS_API_KEY`); revoke/rotate at <https://account.heigit.org>. Not in git.
- **Local cache** — `corpus-pipeline/data/raw/` (gitignored). Delete to reclaim disk.

## Cost note

Free plan — no charges. Deleting frees the project slot and storage.
