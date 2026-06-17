"""Overpass transport retry: transient 5xx (esp. 504) are retried, 4xx are not.

The public Overpass endpoint returns 504 Gateway Timeout under load; p6 saw a
~30% rate. The transport now backs off and retries transient failures so those
routes resolve instead of logging an error. Backoff sleeps are stubbed so the
wiring test runs instantly.
"""

from __future__ import annotations

import httpx
import pytest

from freewheel_corpus.clients import overpass


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "https://overpass-api.de/api/interpreter")
    resp = httpx.Response(code, request=req)
    return httpx.HTTPStatusError("boom", request=req, response=resp)


def test_is_transient_error_classifies_correctly():
    assert overpass._is_transient_error(_status_error(504))
    assert overpass._is_transient_error(_status_error(429))
    assert overpass._is_transient_error(httpx.ConnectTimeout("slow"))
    assert not overpass._is_transient_error(_status_error(400))  # bad query
    assert not overpass._is_transient_error(_status_error(404))
    assert not overpass._is_transient_error(ValueError("unrelated"))


def test_transport_retries_504_then_succeeds(monkeypatch):
    """Two 504s then a 200 -> the transport returns the body after 3 attempts."""
    # Stub tenacity's backoff sleep so the test doesn't actually wait seconds.
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)

    req = httpx.Request("POST", "https://overpass-api.de/api/interpreter")
    calls = {"n": 0}

    def fake_post(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(504, request=req)
        return httpx.Response(200, request=req, json={"elements": [1, 2]})

    monkeypatch.setattr(overpass.httpx, "post", fake_post)

    transport = overpass._http_transport("https://overpass-api.de/api/interpreter", 5.0)
    result = transport("[out:json];node(1);out;")

    assert calls["n"] == 3
    assert result == {"elements": [1, 2]}


def test_transport_gives_up_after_attempts_and_reraises(monkeypatch):
    """Persistent 504 -> after the attempt cap the error propagates (p6 logs it)."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)

    req = httpx.Request("POST", "https://overpass-api.de/api/interpreter")
    calls = {"n": 0}

    def always_504(*_args, **_kwargs):
        calls["n"] += 1
        return httpx.Response(504, request=req)

    monkeypatch.setattr(overpass.httpx, "post", always_504)

    transport = overpass._http_transport("https://overpass-api.de/api/interpreter", 5.0)
    with pytest.raises(httpx.HTTPStatusError):
        transport("[out:json];node(1);out;")

    assert calls["n"] == overpass._RETRY_ATTEMPTS
