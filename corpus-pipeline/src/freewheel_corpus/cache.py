"""Disk cache for external HTTP responses.

Every external response is cached at ``data/raw/{client}/{sha256(request)}.json``
and replayed on re-run; this is the quota-survival + resumability mechanism
(PLAN §2, §10). ``no_cache=True`` busts a cached entry (the CLI's ``--no-cache``).

The base dir is injectable so tests and callers can redirect it; it defaults to
``data/raw/`` relative to the current working directory (gitignored).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

DEFAULT_BASE_DIR = Path("data") / "raw"


def request_hash(request: Any) -> str:
    """Stable sha256 of a request payload (order-independent for dicts)."""
    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class DiskCache:
    """Keyed disk cache: ``{base_dir}/{client}/{sha256(request)}.json``."""

    def __init__(self, base_dir: Path | str | None = None) -> None:
        self.base_dir = Path(base_dir) if base_dir is not None else DEFAULT_BASE_DIR

    def _path(self, client: str, request: Any) -> Path:
        return self.base_dir / client / f"{request_hash(request)}.json"

    def get(self, client: str, request: Any) -> Any | None:
        """Return the cached payload for this request, or None if absent."""
        path = self._path(client, request)
        if path.exists():
            return json.loads(path.read_text())
        return None

    def set(self, client: str, request: Any, payload: Any) -> None:
        """Store a payload for this request."""
        path = self._path(client, request)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload))

    def get_or_fetch(
        self,
        client: str,
        request: Any,
        fetch: Callable[[], Any],
        *,
        no_cache: bool = False,
    ) -> Any:
        """Return the cached payload, or call ``fetch`` and cache the result.

        With ``no_cache=True`` the cached entry is bypassed: ``fetch`` always
        runs and its result overwrites any stored entry.
        """
        if not no_cache:
            cached = self.get(client, request)
            if cached is not None:
                return cached

        payload = fetch()
        self.set(client, request, payload)
        return payload
