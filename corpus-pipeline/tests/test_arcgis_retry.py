"""ArcGIS transport retry: transient connection drops / 5xx are retried, 4xx aren't.

A real Seattle SDOT facility run hit "Server disconnected without sending a
response" (``httpx.RemoteProtocolError``) mid-pagination and failed the whole
fetch; a manual re-run then succeeded unchanged — i.e. transient. The transport
now backs off and retries these, mirroring the Overpass client. Backoff sleeps
are stubbed so the wiring tests run instantly. The retry lives inside
``_http_transport`` (decorating the real ``httpx.get`` path), so these tests
monkeypatch ``httpx.get`` rather than injecting a client transport — an injected
transport would bypass the retry wrapper entirely.
"""

from __future__ import annotations

import httpx
import pytest

from freewheel_corpus.clients import arcgis

_URL = "https://example.test/FeatureServer/0/query"
_PARAMS = {"where": "1=1", "f": "geojson"}


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("GET", _URL)
    resp = httpx.Response(code, request=req)
    return httpx.HTTPStatusError("boom", request=req, response=resp)


def test_is_transient_error_classifies_correctly():
    assert arcgis._is_transient_error(_status_error(504))
    assert arcgis._is_transient_error(_status_error(429))
    # The exact failure the live run hit, plus the rest of the drop/timeout family.
    assert arcgis._is_transient_error(httpx.RemoteProtocolError("server disconnected"))
    assert arcgis._is_transient_error(httpx.ConnectError("refused"))
    assert arcgis._is_transient_error(httpx.ReadError("reset"))
    assert arcgis._is_transient_error(httpx.ConnectTimeout("slow"))
    assert not arcgis._is_transient_error(_status_error(400))  # bad query
    assert not arcgis._is_transient_error(_status_error(404))
    assert not arcgis._is_transient_error(ValueError("unrelated"))


def test_transport_retries_connection_drop_then_succeeds(monkeypatch):
    """Two RemoteProtocolErrors then a 200 -> body returned after 3 attempts."""
    # Stub tenacity's backoff sleep so the test doesn't actually wait seconds.
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)

    req = httpx.Request("GET", _URL)
    calls = {"n": 0}

    def fake_get(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        return httpx.Response(200, request=req, json={"features": [1, 2]})

    monkeypatch.setattr(arcgis.httpx, "get", fake_get)

    transport = arcgis._http_transport(5.0)
    result = transport(_URL, _PARAMS)

    assert calls["n"] == 3
    assert result == {"features": [1, 2]}


def test_transport_retries_transient_5xx_then_succeeds(monkeypatch):
    """Two 503s then a 200 -> the transport returns the body after 3 attempts."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)

    req = httpx.Request("GET", _URL)
    calls = {"n": 0}

    def fake_get(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, request=req)
        return httpx.Response(200, request=req, json={"features": []})

    monkeypatch.setattr(arcgis.httpx, "get", fake_get)

    transport = arcgis._http_transport(5.0)
    result = transport(_URL, _PARAMS)

    assert calls["n"] == 3
    assert result == {"features": []}


def test_transport_gives_up_after_attempts_and_reraises(monkeypatch):
    """Persistent connection drop -> after the attempt cap the error propagates."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)

    calls = {"n": 0}

    def always_drop(*_args, **_kwargs):
        calls["n"] += 1
        raise httpx.RemoteProtocolError("Server disconnected without sending a response.")

    monkeypatch.setattr(arcgis.httpx, "get", always_drop)

    transport = arcgis._http_transport(5.0)
    with pytest.raises(httpx.RemoteProtocolError):
        transport(_URL, _PARAMS)

    assert calls["n"] == arcgis._RETRY_ATTEMPTS


def test_transport_does_not_retry_4xx(monkeypatch):
    """A 400 (bad query) is not transient -> raises on the first attempt."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)

    req = httpx.Request("GET", _URL)
    calls = {"n": 0}

    def bad_request(*_args, **_kwargs):
        calls["n"] += 1
        return httpx.Response(400, request=req)

    monkeypatch.setattr(arcgis.httpx, "get", bad_request)

    transport = arcgis._http_transport(5.0)
    with pytest.raises(httpx.HTTPStatusError):
        transport(_URL, _PARAMS)

    assert calls["n"] == 1
