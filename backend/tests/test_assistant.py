"""Tests for the global assistant selection context (Stage C1)."""

import pytest
from fastapi.testclient import TestClient

from app import chat, scenarios
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


def test_sanitize_context_allowlists_keys():
    cleaned = chat.sanitize_context({
        "route": "/simulation",
        "node_id": "ship-1",
        "node_label": "Vessel",
        "link_id": "",
        "__proto__": "x",
        "arbitrary": {"nested": True},
    })
    assert cleaned == {"route": "/simulation", "node_id": "ship-1", "node_label": "Vessel"}
    assert chat.sanitize_context(None) == {}
    assert chat.sanitize_context("nope") == {}


def test_selection_detail_node(maritime_ready):
    out = chat.tool_selection_detail("node", "ship-1", maritime_ready)
    assert out["kind"] == "node"
    assert out["label"] == "Vessel MV Nexus"
    assert "live" in out


def test_selection_detail_link(maritime_ready):
    detail = scenarios.get_scenario(maritime_ready)
    assert detail is not None
    lid = detail.topology.links[0].id
    out = chat.tool_selection_detail("link", lid, maritime_ready)
    assert out["kind"] == "link"
    assert "explanation" in out


def test_selection_detail_unknowns(maritime_ready):
    assert "error" in chat.tool_selection_detail("node", "nope", maritime_ready)
    assert "error" in chat.tool_selection_detail("weird", "ship-1", maritime_ready)
    assert "error" in chat.tool_selection_detail("node", "ship-1", "nope")


def test_respond_with_node_context_is_deterministic(client, maritime_ready):
    body = {
        "message": "Explain this connection.",
        "scenario_id": maritime_ready,
        "use_ai": False,
        "context": {"route": "/simulation", "node_id": "ship-1", "node_label": "Vessel"},
    }
    first = client.post("/api/chat", json=body).json()
    assert first["provenance"] == "local_deterministic"
    assert "Vessel MV Nexus" in first["reply"]
    assert any(c["tool"] == "selection_detail" for c in first["tool_calls"])
    second = client.post("/api/chat", json=body).json()
    assert second["reply"] == first["reply"]


DUMP_TOKENS = ("endpoint_status", "scenario_snapshot", "run_summary",
               "latency_ms", "bandwidth_mbps", "node_ids", "achieved_mbps")


def _assert_prose(reply: str):
    for token in DUMP_TOKENS:
        assert token not in reply, f"raw tool token {token!r} leaked into reply"


def test_system_prompt_requires_synthesis_not_dumps():
    assert "SYNTHESIZE" in chat.SYSTEM
    assert "NEVER paste" in chat.SYSTEM
    assert "no JSON" in chat.SYSTEM
    assert "Technical evidence" in chat.SYSTEM


def test_ai_messages_marks_evidence_internal(maritime_ready):
    ctx = chat.prepare_reply(None, "Explain this link.", maritime_ready,
                             use_ai=False,
                             context={"link_id": "link-1", "link_label": "LTE uplink"})
    msgs = chat.ai_messages(ctx, "Explain this link.")
    user_msg = msgs[-1]["content"]
    assert "INTERNAL EVIDENCE" in user_msg
    assert "never paste" in user_msg
    assert "link-1" in user_msg  # selection still reaches the model


def test_is_raw_dump_detector():
    assert chat.is_raw_dump('{"endpoint_status": {"overall": "ok"}}')
    assert chat.is_raw_dump("[{'latency_ms': 45}]".replace("'", '"'))
    assert chat.is_raw_dump(
        "endpoint_status says overall ok and scenario_snapshot lists node_ids")
    assert not chat.is_raw_dump(
        "The vessel uses LTE with 45 ms of latency and 50 Mbps of bandwidth.")
    assert not chat.is_raw_dump("")
    assert not chat.is_raw_dump("## Technical evidence\n- Ship: connected, 45 ms.")


def test_local_link_reply_is_prose_with_values(client, maritime_ready):
    detail = scenarios.get_scenario(maritime_ready)
    assert detail is not None
    lid = detail.topology.links[0].id
    body = {
        "message": "Can you explain the radio link?",
        "scenario_id": maritime_ready,
        "use_ai": False,
        "context": {"route": "/simulation", "link_id": lid},
    }
    reply = client.post("/api/chat", json=body).json()["reply"]
    _assert_prose(reply)
    assert "communicates with" in reply  # narrated endpoints
    assert "ms" in reply or "Mbps" in reply  # real configured values


def test_local_what_if_followup_keeps_link_context(client, maritime_ready):
    detail = scenarios.get_scenario(maritime_ready)
    assert detail is not None
    lid = [l for l in detail.topology.links
           if "cellular" in l.technology.lower() or "lte" in l.technology.lower()]
    lid = (lid[0].id if lid else detail.topology.links[0].id)
    first = client.post("/api/chat", json={
        "message": "Explain this radio link.",
        "scenario_id": maritime_ready,
        "use_ai": False,
        "context": {"route": "/simulation", "link_id": lid},
    }).json()
    second = client.post("/api/chat", json={
        "conversation_id": first["conversation_id"],
        "message": "What if we increase its frequency?",
        "scenario_id": maritime_ready,
        "use_ai": False,
        "context": {"route": "/simulation", "link_id": lid},
    }).json()
    assert second["conversation_id"] == first["conversation_id"]
    _assert_prose(second["reply"])
    assert "frequenc" in second["reply"].lower()
    assert "path loss" in second["reply"].lower()


def test_streamed_dump_is_corrected(monkeypatch, maritime_ready):
    from app import providers

    dump = str({"endpoint_status": {"overall": "ok", "latency_ms": 45},
                "scenario_snapshot": {"node_ids": ["a"]}})

    def fake_stream(messages, provider=None):
        yield {"delta": dump}

    monkeypatch.setattr(providers, "chat_stream", fake_stream)
    monkeypatch.setattr(providers, "provider_status", lambda: {
        "provider": "meta", "model": "test-model",
        "providers": {"meta": {"state": "configured"},
                      "baseten": {"state": "unavailable"}},
    })
    ctx = chat.prepare_reply(None, "How is the network?", maritime_ready,
                             use_ai=True)
    assert ctx["provider_state"] == "configured"
    events = list(chat.respond_stream(ctx, "How is the network?", maritime_ready))
    done = next(e for e in events if e["event"] == "done")
    assert "corrected_text" in done["data"]
    assert done["data"]["provenance"] == "local_deterministic"
    _assert_prose(done["data"]["corrected_text"])
    convo = chat.get_conversation(ctx["conversation_id"])
    assert convo is not None
    persisted = convo["messages"][-1]["content"]
    assert persisted == done["data"]["corrected_text"]


def test_stream_truncation_is_signaled(monkeypatch, maritime_ready):
    from app import providers

    def fake_stream(messages, provider=None):
        yield {"delta": "Partial answer"}
        yield {"done": True, "finish_reason": "length", "model": "test-model"}

    monkeypatch.setattr(providers, "chat_stream", fake_stream)
    monkeypatch.setattr(providers, "provider_status", lambda: {
        "provider": "meta", "model": "test-model",
        "providers": {"meta": {"state": "configured"},
                      "baseten": {"state": "unavailable"}},
    })
    ctx = chat.prepare_reply(None, "Explain this.", maritime_ready, use_ai=True)
    events = list(chat.respond_stream(ctx, "Explain this.", maritime_ready))
    done = next(e for e in events if e["event"] == "done")
    assert done["data"]["finish_reason"] == "length"
    convo = chat.get_conversation(ctx["conversation_id"])
    assert convo is not None
    assert "length limit" in convo["messages"][-1]["content"]

    def err_stream(messages, provider=None):
        yield {"delta": "Partial answer"}
        yield {"error": "Timeout"}

    monkeypatch.setattr(providers, "chat_stream", err_stream)
    ctx2 = chat.prepare_reply(None, "Explain this.", maritime_ready, use_ai=True)
    list(chat.respond_stream(ctx2, "Explain this.", maritime_ready))
    convo2 = chat.get_conversation(ctx2["conversation_id"])
    assert convo2 is not None
    assert "may be incomplete" in convo2["messages"][-1]["content"]


def test_streamed_raw_dump_never_reaches_delta(monkeypatch, maritime_ready):
    from app import providers

    dump = "{'endpoint_status': {'latency_ms': 45}, 'scenario_snapshot': {'nodes': []}}"
    monkeypatch.setattr(providers, 'chat_stream', lambda *args, **kwargs: iter([{'delta': dump}]))
    monkeypatch.setattr(providers, 'provider_status', lambda: {
        'provider': 'meta', 'model': 'test',
        'providers': {'meta': {'state': 'configured'}, 'baseten': {'state': 'unavailable'}},
    })
    ctx = chat.prepare_reply(None, 'How is the network?', maritime_ready, use_ai=True)
    events = list(chat.respond_stream(ctx, 'How is the network?', maritime_ready))
    displayed = ''.join(e['data']['text'] for e in events if e['event'] == 'delta')
    assert dump not in displayed
    assert displayed
