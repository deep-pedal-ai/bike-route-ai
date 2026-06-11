"""Freewheel corpus pipeline CLI (Typer).

Commands: ``migrate | phase1 | phase2 | phase3 | phase4 | stats``. There is
deliberately NO ``phase5`` (ADR-0004 — descriptions/embeddings are a documented
future migration).

``migrate`` applies pending migrations and records them in ``schema_migrations``.
``stats`` reports the corpus shape.
"""

from __future__ import annotations

import typer

from freewheel_corpus import db, migrations
from freewheel_corpus.config.settings import Settings

app = typer.Typer(
    help="Freewheel bike-route corpus pipeline.",
    no_args_is_help=True,
    add_completion=False,
)


def _settings() -> Settings:
    return Settings()


@app.command()
def migrate() -> None:
    """Apply pending DB migrations (idempotent); record them in schema_migrations."""
    settings = _settings()
    with db.connect(settings.database_url) as conn:
        applied = migrations.run_migrations(conn)
    if applied:
        typer.echo(f"Applied migrations: {', '.join(applied)}")
    else:
        typer.echo("No pending migrations; database is up to date.")


@app.command()
def stats() -> None:
    """Report corpus shape: counts by source, score distribution, rejects/unmatched."""
    settings = _settings()
    with db.connect(settings.database_url) as conn:
        db.check_postgis(conn)  # fail fast with a clear message if PostGIS absent
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM routes")
            total = cur.fetchone()[0]

            cur.execute(
                "SELECT source, count(*) FROM routes GROUP BY source ORDER BY source"
            )
            by_source = cur.fetchall()

            cur.execute(
                "SELECT count(*) FROM routes WHERE quality_score IS NOT NULL"
            )
            scored = cur.fetchone()[0]

            cur.execute(
                "SELECT min(quality_score), avg(quality_score), max(quality_score) "
                "FROM routes WHERE quality_score IS NOT NULL"
            )
            qmin, qavg, qmax = cur.fetchone()

            cur.execute("SELECT count(*) FROM facility_segments")
            facilities = cur.fetchone()[0]

            cur.execute(
                "SELECT event_type, count(*) FROM ingest_log "
                "GROUP BY event_type ORDER BY event_type"
            )
            events = cur.fetchall()

    typer.echo("Freewheel corpus — stats")
    typer.echo(f"  routes total:        {total}")
    typer.echo("  routes by source:")
    if by_source:
        for src, n in by_source:
            typer.echo(f"    {src}: {n}")
    else:
        typer.echo("    (none)")
    typer.echo(f"  scored routes:       {scored}")
    if scored:
        typer.echo(
            f"  quality_score:       min={qmin:.3f} avg={qavg:.3f} max={qmax:.3f}"
        )
    else:
        typer.echo("  quality_score:       (no scored routes)")
    typer.echo(f"  facility_segments:   {facilities}")
    typer.echo("  ingest_log events:")
    if events:
        for et, n in events:
            typer.echo(f"    {et}: {n}")
    else:
        typer.echo("    (none)")


@app.command()
def phase1(
    no_cache: bool = typer.Option(
        False, "--no-cache", help="Bypass the Overpass disk cache (re-fetch live)."
    ),
) -> None:
    """Phase 1 — OSM bicycle route relations (WP1)."""
    from freewheel_corpus.clients.overpass import OverpassClient
    from freewheel_corpus.phases import p1_osm_relations as p1

    settings = _settings()
    overpass = OverpassClient(base_url=settings.overpass_base_url)
    with db.connect(settings.database_url) as conn:
        db.check_postgis(conn)
        stats = p1.run(conn, client=overpass, no_cache=no_cache)

    typer.echo("Phase 1 — OSM bicycle route relations")
    typer.echo(f"  stored (upserted):   {stats.stored}")
    typer.echo(f"  rejected (< 3 km):   {stats.rejected_short}")
    typer.echo(f"  with gaps (dropped): {stats.gaps_dropped}")
    typer.echo(f"  empty geometry:      {stats.empty}")


@app.command()
def phase2(
    no_cache: bool = typer.Option(
        False, "--no-cache", help="Bypass the ArcGIS/Valhalla disk caches (re-fetch live)."
    ),
) -> None:
    """Phase 2 — loose GPX / polyline sources, map-matched (WP2)."""
    from freewheel_corpus.clients.arcgis import ArcGISClient
    from freewheel_corpus.clients.valhalla import ValhallaClient
    from freewheel_corpus.phases import p2_loose_gpx as p2

    settings = _settings()
    arcgis = ArcGISClient(base_url=settings.arcgis_base_url)
    valhalla = ValhallaClient(base_url=settings.valhalla_base_url)
    with db.connect(settings.database_url) as conn:
        db.check_postgis(conn)
        results = p2.run(
            conn, arcgis_client=arcgis, trace_client=valhalla, no_cache=no_cache
        )

    typer.echo("Phase 2 — loose GPX / polyline sources (map-matched)")
    for label, st in results.items():
        typer.echo(
            f"  {label:8s} stored={st.stored} "
            f"failed_match={st.failed_match} oversize={st.oversize} "
            f"match_error={st.match_error} skipped_no_geom={st.skipped_no_geom}"
        )


@app.command()
def phase3(
    no_cache: bool = typer.Option(
        False, "--no-cache", help="Bypass the Socrata disk cache (re-fetch live)."
    ),
) -> None:
    """Phase 3 — facility data + quality scoring (WP3)."""
    from freewheel_corpus.clients.socrata import SocrataClient
    from freewheel_corpus.phases import facility_ingest, p3_quality_scoring

    settings = _settings()
    socrata = SocrataClient(base_url=settings.socrata_base_url)
    with db.connect(settings.database_url) as conn:
        db.check_postgis(conn)

        try:
            fc = socrata.fetch_geojson(
                facility_ingest.NYC_DOT_DATASET,
                where=f"status='{facility_ingest.CURRENT_STATUS}'",
                no_cache=no_cache,
            )
            fac_stats = facility_ingest.ingest_facilities(conn, fc)
            facilities_ok = True
        except Exception as exc:
            conn.rollback()
            typer.echo(f"  WARNING: NYC DOT facility ingest failed ({exc}); "
                       f"scoring against existing facility_segments only.")
            fac_stats = None
            facilities_ok = False

        score_stats = p3_quality_scoring.run(conn)

    typer.echo("Phase 3 — facility data + quality scoring")
    if facilities_ok and fac_stats is not None:
        typer.echo(f"  facilities stored:   {fac_stats.stored}")
        typer.echo(f"  retired excluded:    {fac_stats.skipped_retired}")
        typer.echo(f"  by class:            {dict(sorted(fac_stats.by_class.items()))}")
    typer.echo(f"  routes scored:       {score_stats.scored}")
    typer.echo(f"  routes in coverage:  {score_stats.in_coverage}")


@app.command()
def phase4(
    canon_only: bool = typer.Option(
        False, "--canon-only", help="Run only canon seeding."
    ),
    generate_only: bool = typer.Option(
        False, "--generate-only", help="Run only scored generation."
    ),
) -> None:
    """Phase 4 — canon seeding + scored generation (WP4).

    Routes canon DRAFT rides + variants and generated round-trip loops into
    ``routes`` (``DATABASE_URL``) via openrouteservice, gated by the ±25% canon
    distance check / the ±20% length + 0.55 quality generation gate, then runs the
    generated-candidate dedup pass (ADR-0003 ladder, hard-delete loser). An ORS
    daily-quota exhaustion exits 0 with a "resume tomorrow" message (PLAN §10);
    the disk cache makes the resumed run cheap.
    """
    from freewheel_corpus.clients.ors import OrsClient
    from freewheel_corpus.phases import p4_canon_and_generation as p4

    settings = _settings()
    ors = OrsClient(api_key=settings.ors_api_key, base_url=settings.ors_base_url)
    run_canon = not generate_only
    run_generate = not canon_only
    paused = False

    with db.connect(settings.database_url) as conn:
        db.check_postgis(conn)  # fail fast with a clear message if PostGIS absent

        typer.echo("Phase 4 — canon seeding + scored generation")

        if run_canon:
            entries = p4.load_canon()
            cstats = p4.ingest_canon(conn, entries, ors_client=ors, settings=settings)
            typer.echo("  canon:")
            typer.echo(f"    stored:            {cstats.stored}")
            typer.echo(f"    skipped (±25%):    {cstats.skipped_distance}")
            typer.echo(f"    ORS errors:        {cstats.ors_failed}")
            paused = paused or cstats.quota_paused

        if run_generate and not paused:
            gstats = p4.generate_loops(conn, ors_client=ors, settings=settings)
            typer.echo("  generation:")
            typer.echo(f"    kept:              {gstats.kept}")
            typer.echo(f"    rejected (length): {gstats.rejected_length}")
            typer.echo(f"    rejected (quality):{gstats.rejected_quality}")
            typer.echo(f"    rejected (dup):    {gstats.rejected_duplicate}")
            typer.echo(f"    ORS errors:        {gstats.ors_failed}")
            paused = paused or gstats.quota_paused

            # Dedup the freshly-generated loops against the rest of the corpus
            # (only generated rows may lose here; the WP5 full pass does the rest).
            removed = p4.apply_dedup_pass(conn, only_sources=[p4.GENERATED_SOURCE])
            typer.echo(f"    deduped (removed): {removed}")

    if paused:
        typer.echo(
            "  PAUSED: ORS daily quota reached — resume tomorrow. Cached responses "
            "replay for free, so the next run continues where this one stopped."
        )
        raise typer.Exit(code=0)


if __name__ == "__main__":
    app()
