"""Tests for Stage C: chat, knowledge/RAG, sources, multi-provider."""

import io
import os

import pytest
from fastapi.testclient import TestClient

from app import chat, knowledge, providers, scenarios, sources
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    test_client = TestClient(app)
    test_client.post("/api/simulation/reset")
    return test_client


@pytest.fixture()
def maritime_ready():
    scenarios.ensure_maritime_seed()
    return "maritime_failover"


# -- knowledge ---------------------------------------------------------------

SAMPLE_MD = """# VSAT Link Budget Notes

A stabilized maritime VSAT terminal needs open sky view and motion
stabilization. Typical Ka-band uplink uses a 1.2 m dish.

## Failover behavior

When LTE coverage drops, the gateway switches to satellite backhaul.
"""


def test_store_and_search_text_document():
    doc = knowledge.store_text_document(
        title="VSAT notes (test)", text=SAMPLE_MD, source_type="upload")
    try:
        assert doc["status"] == "indexed"
        assert doc["chunks"] >= 1
        hits = knowledge.search("VSAT stabilized maritime")
        assert hits, "expected FTS to find the stored passage"
        assert hits[0]["doc_id"] == doc["id"]
        assert "VSAT" in hits[0]["snippet"] or "vsat" in hits[0]["snippet"].lower()
    finally:
        assert knowledge.delete_document(doc["id"]) is True


def test_search_falls_back_to_or():
    doc = knowledge.store_text_document(
        title="OR fallback (test)", text="Zebra backhaul carries mango traffic far away.",
        source_type="upload")
    try:
        hits = knowledge.search("zebra mango nonexistenttermxyz")
        assert hits, "expected OR fallback to find the passage"
        assert hits[0]["doc_id"] == doc["id"]
    finally:
        knowledge.delete_document(doc["id"])


def test_store_document_validates_type_and_content():
    with pytest.raises(ValueError):
        knowledge.store_document("x", "evil.exe", b"MZ...", source_type="upload")
    with pytest.raises(ValueError):
        knowledge.store_document("x", "empty.md", b"   ", source_type="upload")
    doc = knowledge.store_document("t", "n.md", SAMPLE_MD.encode(), source_type="upload")
    try:
        fetched = knowledge.get_document(doc["id"])
        assert fetched is not None
        assert fetched["passages"], "expected indexed passages"
        assert knowledge.get_document("doc-nope") is None
    finally:
        knowledge.delete_document(doc["id"])


def test_upload_api_round_trip(client: TestClient):
    res = client.post(
        "/api/knowledge/upload",
        files={"file": ("notes.md", io.BytesIO(SAMPLE_MD.encode()), "text/markdown")},
    )
    assert res.status_code == 200
    doc_id = res.json()["id"]
    try:
        res = client.get("/api/knowledge/search", params={"q": "stabilized VSAT terminal"})
        assert res.status_code == 200
        assert any(p["doc_id"] == doc_id for p in res.json()["passages"])
        res = client.get(f"/api/knowledge/{doc_id}")
        assert res.status_code == 200
        assert res.json()["title"]
    finally:
        res = client.delete(f"/api/knowledge/{doc_id}")
        assert res.status_code == 200
    res = client.get("/api/knowledge/nonexistent")
    assert res.status_code == 404


def test_upload_rejects_unsupported_type(client: TestClient):
    res = client.post(
        "/api/knowledge/upload",
        files={"file": ("run.exe", io.BytesIO(b"MZbinary"), "application/octet-stream")},
    )
    assert res.status_code == 400


# -- sources ------------------------------------------------------------------

def test_registry_seeds_34_sources():
    count = sources.ensure_registry()
    assert count >= 34
    all_sources = sources.list_sources()
    assert len(all_sources) >= 34
    by_id = {s["id"]: s for s in all_sources}
    assert by_id["rfc-4271"]["organization"] == "IETF"
    assert by_id["itu-p525"]["category"] == "rf_propagation"
    assert all(s["url"].startswith("https://") for s in all_sources)
    assert all(s["status"] in ("pending", "ok", "failed", "skipped_license")
               for s in all_sources)


def test_registered_hosts_cover_all_seeds():
    hosts = sources._registered_hosts()
    assert len(hosts) >= 20
    for sid, _name, _org, url, *_rest in sources.SEED_SOURCES:
        import urllib.parse

        assert urllib.parse.urlparse(url).hostname in hosts, sid


def test_private_urls_blocked():
    for url in ("http://localhost:8000/x", "http://127.0.0.1/", "http://10.0.0.5/",
                "http://169.254.169.254/", "file:///etc/passwd", "gopher://x/"):
        ok, reason = sources._is_public_url(url)
        assert ok is False, url
        assert reason


def test_html_to_text_strips_scripts():
    html = ("<html><head><script>alert(1)</script></head>"
            "<body><h1>Title</h1><p>Hello <b>world</b></p></body></html>")
    text = sources.html_to_text(html)
    assert "alert" not in text
    assert "Title" in text and "Hello world" in text


def test_ingest_respects_disabled_and_unknown():
    assert sources.set_source_enabled("rfc-4271", False) is True
    try:
        out = sources.ingest_source("rfc-4271")
        assert out["status"] == "skipped"
    finally:
        assert sources.set_source_enabled("rfc-4271", True) is True
    with pytest.raises(KeyError):
        sources.ingest_source("source-nope")


def test_sources_api(client: TestClient):
    res = client.get("/api/sources")
    assert res.status_code == 200
    assert len(res.json()["sources"]) >= 34
    res = client.get("/api/sources/rfc-9293")
    assert res.status_code == 200
    assert res.json()["license"] == "ietf_trust_legal"
    res = client.get("/api/sources/nope")
    assert res.status_code == 404
    res = client.post("/api/sources/rfc-9293/enable", json={"enabled": False})
    assert res.status_code == 200
    assert res.json()["enabled"] == 0
    client.post("/api/sources/rfc-9293/enable", json={"enabled": True})


# -- providers -----------------------------------------------------------------

def test_provider_status_reports_both(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL", raising=False)
    monkeypatch.delenv("BASETEN_API_KEY", raising=False)
    monkeypatch.delenv("BASETEN_MODEL", raising=False)
    status = providers.provider_status()
    assert status["state"] == "unavailable"
    assert set(status["providers"]) == {"meta", "baseten"}
    assert status["providers"]["baseten"]["state"] == "unavailable"


def test_baseten_unconfigured_verify_reports_cleanly(monkeypatch):
    monkeypatch.delenv("BASETEN_API_KEY", raising=False)
    monkeypatch.delenv("BASETEN_MODEL", raising=False)
    out = providers.verify(provider="baseten")
    assert out["verified"] is False
    assert out["error"] == "provider_not_configured"
    assert out["provider"] == "baseten"


def test_verify_unknown_provider_rejected(client: TestClient):
    res = client.post("/api/agents/verify/nonsense")
    assert res.status_code == 400


# -- chat ----------------------------------------------------------------------

def test_classify_capability():
    assert chat.classify_capability("design a ship network") == "architect"
    assert chat.classify_capability("propose a gateway device") == "hardware"
    assert chat.classify_capability("what does RFC 4271 say?") == "research"
    assert chat.classify_capability("cheapest policy for bulk") == "connectivity"
    assert chat.classify_capability("why did the ship lose LTE?") == "simulation"
    assert chat.classify_capability("hello", hint="hardware") == "hardware"


def test_chat_round_trip_persists(client: TestClient, maritime_ready):
    res = client.post("/api/chat", json={
        "message": "How is the network performing?",
        "scenario_id": maritime_ready,
    })
    assert res.status_code == 200
    body = res.json()
    cid = body["conversation_id"]
    try:
        assert body["capability"] == "simulation"
        assert body["provenance"] == "local_deterministic"
        assert "Vessel" in body["reply"] or "ship" in body["reply"].lower()
        assert any(c["tool"] == "endpoint_status" for c in body["tool_calls"])
        # Follow-up continues the same conversation with history.
        res2 = client.post("/api/chat", json={
            "conversation_id": cid,
            "message": "Which links are eligible backups?",
            "scenario_id": maritime_ready,
        })
        assert res2.status_code == 200
        convo = client.get(f"/api/chat/{cid}").json()
        assert len(convo["messages"]) == 4
        assert convo["messages"][0]["role"] == "user"
        assert client.get("/api/chat").json()["conversations"]
    finally:
        assert client.delete(f"/api/chat/{cid}").status_code == 200
    assert client.get(f"/api/chat/{cid}").status_code == 404


def test_chat_hardware_concept_proposal(client: TestClient):
    res = client.post("/api/chat", json={
        "message": "Propose a gateway device bridging LTE and satellite for a ship",
    })
    assert res.status_code == 200
    body = res.json()
    try:
        assert body["capability"] == "hardware"
        proposal = body["proposal"]
        assert proposal is not None
        assert proposal["kind"] == "device"
        assert proposal["data"]["device_id"].startswith("ai-concept-")
        assert "UNVALIDATED" in proposal["note"]
    finally:
        client.delete(f"/api/chat/{body['conversation_id']}")


def test_chat_stream_events(client: TestClient, maritime_ready):
    res = client.post("/api/chat/stream", json={
        "message": "Summarize endpoint status",
        "scenario_id": maritime_ready,
    })
    assert res.status_code == 200
    text = res.text
    assert "event: meta" in text
    assert "event: delta" in text
    assert "event: done" in text


def test_chat_rejects_bad_input(client: TestClient):
    res = client.post("/api/chat", json={"message": "hi", "capability": "nonsense"})
    assert res.status_code == 400
    res = client.post("/api/chat", json={"message": "hi", "provider": "nonsense"})
    assert res.status_code == 400
    res = client.post("/api/chat", json={"conversation_id": "chat-nope", "message": "hi"})
    assert res.status_code == 404


def test_chat_note_records_review_decision(client: TestClient):
    res = client.post("/api/chat", json={"message": "hello"})
    cid = res.json()["conversation_id"]
    try:
        note = client.post(f"/api/chat/{cid}/notes", json={"text": "Engineer approved device concept."})
        assert note.status_code == 200
        convo = client.get(f"/api/chat/{cid}").json()
        assert convo["messages"][-1]["role"] == "system"
    finally:
        client.delete(f"/api/chat/{cid}")
