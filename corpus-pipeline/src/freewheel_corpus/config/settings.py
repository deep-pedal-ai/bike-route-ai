"""Application settings — pydantic-settings, env-driven, loaded from ``.env``.

All configuration is environment-driven (PLAN §WP0):
- ``DATABASE_URL`` (required), ``ORS_API_KEY`` (required).
- One base-URL var per external service, each defaulting to the public
  endpoint, because every service self-hosts later (override via env).
- Scoring weights + gate thresholds, so WP3/WP4 read config rather than
  hardcoding the v1 heuristic.

A missing required var raises a pydantic ``ValidationError`` that names the
field. Tests pass ``_env_file=None`` to avoid the on-disk ``.env`` satisfying a
deliberately-omitted var.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# corpus-pipeline/.env — three parents up from this file:
# config/settings.py -> config -> freewheel_corpus -> src -> corpus-pipeline
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """Env-driven configuration for the corpus pipeline."""

    model_config = SettingsConfigDict(
        env_file=str(_DEFAULT_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Required ---------------------------------------------------------
    database_url: str
    ors_api_key: str

    # --- Per-service base URLs (default = public endpoint; override to self-host)
    overpass_base_url: str = "https://overpass-api.de/api/interpreter"
    valhalla_base_url: str = "https://valhalla1.openstreetmap.de"
    ors_base_url: str = "https://api.openrouteservice.org"
    socrata_base_url: str = "https://data.cityofnewyork.us"
    # NYSDOT GIS portal (verified live 2026-06-11): the REST path is /hostingny,
    # not /arcgis. The bike-routes layer is Framework/State_Bike_Routes/
    # FeatureServer/0 (the arcgis client appends that path).
    arcgis_base_url: str = "https://gisportalny.dot.ny.gov/hostingny/rest/services"

    # --- Test DB (optional; integration tests skip cleanly if unset) ------
    test_database_url: str | None = None

    # --- Scoring weights (quality_score v1 heuristic; PLAN §WP3) -----------
    # quality_score = 0.4*protected + 0.2*greenway + 0.2*surface + 0.2*source_prior
    weight_protected: float = 0.4
    weight_greenway: float = 0.2
    weight_surface: float = 0.2
    weight_source_prior: float = 0.2

    # --- Source priors (WP3 quality_score; PLAN §WP3) ----------------------
    # Trust prior per source: human-curated/native OSM 1.0, government-imported
    # 0.9, machine-generated loops 0.5. Read by Phase 3 (and Phase 4 inline).
    source_prior_canon: float = 1.0
    source_prior_osm_relation: float = 1.0
    source_prior_nysdot: float = 0.9
    source_prior_usbrs: float = 0.9
    source_prior_generated: float = 0.5
    source_prior_default: float = 0.5  # any unrecognized source

    # --- Surface quality (WP3 quality_score) -------------------------------
    # Neutral default when a route has no surface_breakdown (native osm_relation
    # rows have NULL breakdown). Documented v1 heuristic (see p3_quality_scoring).
    surface_quality_default: float = 0.5

    # --- Gate thresholds (PLAN §WP4 generation gate) -----------------------
    min_quality_score: float = 0.55
    generation_length_tolerance: float = 0.20  # ±20% of target length
    canon_distance_tolerance: float = 0.25  # ±25% of expected_km (canon sanity)


def load_settings(**overrides) -> Settings:
    """Construct Settings, surfacing missing-required-var errors clearly."""
    return Settings(**overrides)
