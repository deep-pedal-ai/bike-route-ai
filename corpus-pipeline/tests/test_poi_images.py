"""S4 (TDD): Wikimedia image resolver — wikidata id -> Commons image + license.

Network-free: an injected ``transport(url) -> json`` dispatches on the URL so
both hops (Wikidata EntityData for the P18 filename, then the Commons imageinfo
API for license/attribution) are mocked from recorded fixtures. The common case
per feature §2a is *no image* (~0% for water/viewpoint) — that returns ``None``,
not an exception.
"""

from __future__ import annotations

import json
from pathlib import Path

from freewheel_corpus.poi.images import resolve_image

_FIXTURES = Path(__file__).parent / "fixtures"


def test_resolve_image_is_non_throwing_when_a_transport_hop_fails():
    """A Wikimedia/Wikidata network failure degrades to no-image (None), never
    raises — otherwise one flaky hop would abort the whole p6 batch."""

    def boom(_url: str) -> dict:
        raise RuntimeError("wikimedia unreachable")

    assert resolve_image("Q42", transport=boom) is None


def test_attribution_html_is_stripped_to_plain_text():
    """Commons returns the Artist as HTML; we store/display clean plain text."""

    def transport(url: str) -> dict:
        if "EntityData" in url:
            return {
                "entities": {
                    "Q1": {"claims": {"P18": [
                        {"mainsnak": {"datavalue": {"value": "Foo.jpg"}}}
                    ]}}
                }
            }
        return {
            "query": {"pages": {"1": {"imageinfo": [{"extmetadata": {
                "LicenseShortName": {"value": "CC BY-SA 2.0"},
                "Artist": {"value": (
                    '<a rel="nofollow" class="external text" '
                    'href="https://example.com/u/jane">Jane&nbsp;Doe</a>'
                )},
            }}]}}}
        }

    img = resolve_image("Q1", transport=transport)

    assert img is not None
    assert img.license == "CC BY-SA 2.0"
    assert img.attribution == "Jane Doe"  # tags dropped, &nbsp; unescaped
    assert "<" not in img.attribution and "href" not in img.attribution


def _load(name: str) -> dict:
    return json.loads((_FIXTURES / name).read_text())


def _transport_for(entity_fixture: str, imageinfo_fixture: str | None = None):
    """Build a url->json transport that dispatches on the API host/path."""

    def transport(url: str) -> dict:
        if "EntityData" in url or "wbgetentities" in url:
            return _load(entity_fixture)
        if "commons" in url or "imageinfo" in url or "iiprop" in url:
            assert imageinfo_fixture is not None, "unexpected Commons call"
            return _load(imageinfo_fixture)
        raise AssertionError(f"unexpected URL: {url}")

    return transport


def test_wikidata_with_p18_resolves_filename_license_and_attribution():
    transport = _transport_for(
        "wikidata_entity_with_p18.json",
        "commons_imageinfo_bethesda.json",
    )

    ref = resolve_image("Q2589194", transport=transport)

    assert ref is not None
    assert ref.commons_filename == "Bethesda Fountain Central Park.jpg"
    # A stable, derivable Special:FilePath URL (not a raw upload.wikimedia URL).
    assert "Special:FilePath" in ref.image_url
    assert "Bethesda" in ref.image_url
    assert ref.license == "CC BY-SA 4.0"
    assert ref.attribution == "Jane Photographer"


def test_missing_or_empty_wikidata_id_returns_none_without_calling():
    calls: list[str] = []

    def transport(url: str) -> dict:
        calls.append(url)
        return {}

    assert resolve_image(None, transport=transport) is None
    assert resolve_image("", transport=transport) is None
    assert resolve_image("   ", transport=transport) is None
    assert calls == []  # no HTTP for an absent id


def test_entity_without_p18_returns_none():
    """The common case (§2a): a wikidata id that simply has no image -> None."""
    transport = _transport_for("wikidata_entity_no_p18.json")

    assert resolve_image("Q11111111", transport=transport) is None
