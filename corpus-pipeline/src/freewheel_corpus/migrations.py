"""Migration runner — apply ``db/migrations/*.sql`` in filename order, idempotently.

Applied migrations are recorded in a ``schema_migrations`` table (``filename`` is
the primary key, ``applied_at`` a server-default timestamp). A re-run skips any
file already recorded, so ``migrate`` is naturally idempotent (PLAN §WP0 behaviors
1 & 2). The bookkeeping table is created on first run before any migration is
applied.

The runner does NOT commit — the caller owns the transaction boundary
(``cli.migrate`` commits via its ``with db.connect(...)`` block; the DB-backed
tests call ``run_migrations`` then ``conn.commit()``). Each ``.sql`` file is a
multi-statement script executed in a single parameter-free ``execute()`` (psycopg3
runs a multi-command string when there are no parameters).
"""

from __future__ import annotations

from pathlib import Path

import psycopg

# db/migrations lives next to this module's package root:
# migrations.py -> freewheel_corpus -> db/migrations
_MIGRATIONS_DIR = Path(__file__).resolve().parent / "db" / "migrations"

_CREATE_LEDGER_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
)
"""


def _migration_files(migrations_dir: Path) -> list[Path]:
    """Return the ``*.sql`` migration files sorted by filename (lexicographic).

    Filenames are zero-padded (``001_init.sql``) so a plain lexicographic sort is
    the intended application order.
    """
    return sorted(migrations_dir.glob("*.sql"), key=lambda p: p.name)


def _applied(cur: psycopg.Cursor) -> set[str]:
    """The set of migration filenames already recorded in ``schema_migrations``."""
    cur.execute("SELECT filename FROM schema_migrations")
    return {row[0] for row in cur.fetchall()}


def run_migrations(
    conn: psycopg.Connection, *, migrations_dir: Path | str | None = None
) -> list[str]:
    """Apply pending migrations in filename order; return the newly-applied names.

    Idempotent: the ledger table is created if missing, already-applied files are
    skipped, and a second run returns ``[]``. Does not commit (the caller does).
    """
    directory = Path(migrations_dir) if migrations_dir is not None else _MIGRATIONS_DIR

    applied: list[str] = []
    with conn.cursor() as cur:
        cur.execute(_CREATE_LEDGER_SQL)
        already = _applied(cur)

        for path in _migration_files(directory):
            if path.name in already:
                continue  # idempotent skip
            sql = path.read_text()
            cur.execute(sql)  # multi-statement script, no params
            cur.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s)",
                (path.name,),
            )
            applied.append(path.name)

    return applied
