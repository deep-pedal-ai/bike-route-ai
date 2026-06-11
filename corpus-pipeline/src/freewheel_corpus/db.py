"""Database helpers: connection from DATABASE_URL + a PostGIS presence check.

``connect()`` opens a psycopg3 connection. ``check_postgis()`` is a standalone
guard (separate from connect, so it is trivially unit-testable with a fake
connection) that fails fast with a clear, specific message rather than letting a
raw psycopg error surface later when geometry DDL/queries run.

Note: migration 001 itself runs ``CREATE EXTENSION IF NOT EXISTS postgis``, so
the presence check is for connection paths that ASSUME a provisioned DB (stats,
the phase ingests) — not a precondition of ``migrate`` on a genuinely fresh DB.
"""

from __future__ import annotations

import psycopg


class PostGISNotInstalledError(RuntimeError):
    """Raised when the target database lacks the PostGIS extension."""


def connect(database_url: str) -> psycopg.Connection:
    """Open a psycopg3 connection to the given DATABASE_URL."""
    return psycopg.connect(database_url)


def check_postgis(conn: psycopg.Connection) -> str:
    """Assert PostGIS is installed; return its version string.

    Raises :class:`PostGISNotInstalledError` with an actionable message if the
    extension is absent, instead of letting a later geometry operation fail with
    an opaque ``psycopg`` ``UndefinedFunction``/``UndefinedObject`` error.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'postgis'")
        row = cur.fetchone()

    if not row or row[0] is None:
        raise PostGISNotInstalledError(
            "PostGIS is not installed on the target database. The corpus "
            "pipeline requires the PostGIS extension for all geometry storage "
            "and scoring. Enable it on the database referenced by DATABASE_URL "
            "(`CREATE EXTENSION postgis;`, requires the extension to be "
            "available) and re-run."
        )
    return row[0]
