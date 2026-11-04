"""Tests for AI provider handling and structured agent validation.

Provider network calls are mocked; no credentials or live API needed.
Live verification lives in test_ai_live.py (opt-in via NEXUS_LIVE_AI_TESTS=1).
"""

import pytest

from app import agents, providers


def _creds(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MODEL_API_KEY", "test-key-not-a-secret")
    monkeypatch.setenv("META_MODEL", "test-model")


def test_status_states(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL", raising=False)
    assert providers.provider_status()["state"] == "unavailable"
    monkeypatch.setenv("MODEL_API_KEY", "x")
    assert providers.provider_status()["state"] == "partially_configured"
    _creds(monkeypatch)
    status = providers.provider_status()
    assert status["state"] == "configured"
    assert status["base_url"] == "https://api.meta.ai/v1"


def test_chat_requires_credentials(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL", raising=False)
    out = providers.chat([{"role": "user", "content": "hi"}])
    assert out == {"ok": False, "error": "provider_not_configured", "model": ""}


def test_chat_network_failure_is_structured(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)

    def boom(*args, **kwargs):
        raise TimeoutError("slow network (must not leak)")

    monkeypatch.setattr(providers, "_post_chat", boom)
    out = providers.chat([{"role": "user", "content": "hi"}])
    assert out["ok"] is False
    assert out["error"] == "TimeoutError"
    assert "slow network" not in str(out)


def test_extract_text_edge_cases():
    assert providers._extract_text({})[2] == "empty_choices"
    text, finish, err = providers._extract_text(
        {"choices": [{"message": {"content": None}, "finish_reason": "length"}]}
    )
    assert text is None and err == "budget_exhausted"
    text, _, _ = providers._extract_text(
        {"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}]}
    )
    assert text == "hi"


def test_strip_fences():
    assert providers._strip_fences('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert providers._strip_fences('{"a": 1}') == '{"a": 1}'


def test_json_mode_rejects_invalid_json(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)
    monkeypatch.setattr(
        providers, "_post_chat",
        lambda *a, **k: {"choices": [{"message": {"content": "not json"}, "finish_reason": "stop"}]},
    )
    out = providers.chat_json([{"role": "user", "content": "x"}])
    assert out["ok"] is False and out["error"] == "invalid_json"


VALID_TOPO = {
    "nodes": [
        {"id": "ship-1", "type": "ship", "label": "Vessel", "device_id": "gen-ship-comms-01",
         "supported_technologies": ["Cellular (LTE)", "VSAT (GEO)"]},
        {"id": "base-1", "type": "base_station", "label": "Shore BS", "device_id": "gen-basestation-lte-01",
         "supported_technologies": ["Cellular (LTE)", "Fiber"]},
        {"id": "sat-1", "type": "satellite", "label": "SAT", "device_id": "gen-vsat-maritime-01",
         "supported_technologies": ["VSAT (GEO)"]},
        {"id": "gw-1", "type": "gateway", "label": "GW", "device_id": "gen-sat-gateway-01",
         "supported_technologies": ["VSAT (GEO)", "Fiber"]},
        {"id": "net-1", "type": "internet", "label": "Internet"},
    ],
    "links": [
        {"id": "l-cell", "source": "ship-1", "target": "base-1", "technology": "Cellular (LTE)",
         "medium": "wireless", "latency_ms": 35, "bandwidth_mbps": 50, "reliability": 0.92,
         "cost_per_gb": 0.5, "max_range_km": 25, "status": "active"},
        {"id": "l-sat", "source": "ship-1", "target": "sat-1", "technology": "VSAT (GEO)",
         "medium": "wireless", "latency_ms": 600, "bandwidth_mbps": 20, "reliability": 0.98,
         "cost_per_gb": 8.0, "status": "standby"},
        {"id": "l-feed", "source": "sat-1", "target": "gw-1", "technology": "Ka-band feeder",
         "medium": "wireless", "latency_ms": 250, "bandwidth_mbps": 100, "reliability": 0.99,
         "cost_per_gb": 1.0, "status": "active"},
        {"id": "l-bh1", "source": "base-1", "target": "net-1", "technology": "Fiber",
         "medium": "wired", "latency_ms": 10, "bandwidth_mbps": 1000, "reliability": 0.995,
         "cost_per_gb": 0.05, "status": "active"},
        {"id": "l-bh2", "source": "gw-1", "target": "net-1", "technology": "Fiber",
         "medium": "wired", "latency_ms": 5, "bandwidth_mbps": 1000, "reliability": 0.999,
         "cost_per_gb": 0.05, "status": "active"},
    ],
    "explanation": "Dual-uplink maritime design.",
    "limitations": ["Illustrative values."],
    "devices_used": ["gen-ship-comms-01"],
}


def test_architect_ai_proposal_validated(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)
    monkeypatch.setattr(
        providers, "chat_json",
        lambda *a, **k: {"ok": True, "data": VALID_TOPO, "model": "test-model", "finish_reason": "stop"},
    )
    res = agents.run_agent(agents.AgentRequest(capability="architect", prompt="ship network"))
    assert res.provenance == "ai_verified"
    assert res.ai_status == "ok"
    assert res.result["ai"]["proposal_topology"]["nodes"][0]["id"] == "ship-1"
    assert res.result["ai"]["validation"]["valid"] is True


def test_architect_invalid_proposal_falls_back(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)
    bad = dict(VALID_TOPO)
    bad["links"] = [dict(VALID_TOPO["links"][0], target="node-missing")]
    monkeypatch.setattr(
        providers, "chat_json",
        lambda *a, **k: {"ok": True, "data": bad, "model": "test-model", "finish_reason": "stop"},
    )
    res = agents.run_agent(agents.AgentRequest(capability="architect", prompt="ship network"))
    assert res.provenance == "local_deterministic"
    assert res.result["ai"] is None
    assert "invalid" in res.ai_status
    assert "recommendations" in res.result["local"]


def test_hardware_ai_proposal_validated(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)
    device = {
        "device": {
            "device_id": "ai-concept-test-01", "name": "Test GW", "category": "gateway",
            "family": "networking", "model_identifier": "AI-T-1",
            "interfaces": [
                {"name": "cell", "technology": "Cellular (LTE)", "max_throughput_mbps": 150},
                {"name": "sat", "technology": "VSAT (GEO)", "max_throughput_mbps": 50},
            ],
            "throughput_mbps": 40, "tx_power_dbm": 30, "rx_sensitivity_dbm": -100,
        },
        "assumptions": ["spec-level only"],
        "feasibility_notes": "needs gateway stack",
    }
    monkeypatch.setattr(
        providers, "chat_json",
        lambda *a, **k: {"ok": True, "data": device, "model": "test-model", "finish_reason": "stop"},
    )
    res = agents.run_agent(agents.AgentRequest(capability="hardware", prompt="gateway"))
    assert res.provenance == "ai_verified"
    assert res.result["ai"]["concept"]["device_id"] == "ai-concept-test-01"
    assert res.result["ai"]["feasibility"]["verdict"] in ("feasible_spec", "needs_review")


def test_research_ai_rejects_bad_verdict(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)
    monkeypatch.setattr(
        providers, "chat_json",
        lambda *a, **k: {"ok": True, "data": {"verdict": "definitely_true"}, "model": "t", "finish_reason": "stop"},
    )
    res = agents.run_agent(agents.AgentRequest(
        capability="research", prompt="review", context={"finding": {"title": "t"}}))
    assert res.result["ai"] is None
    assert "unknown verdict" in res.ai_status


def test_connectivity_ai_recommends_policy(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)
    monkeypatch.setattr(
        providers, "chat_json",
        lambda *a, **k: {"ok": True, "data": {
            "recommended_policy": "balanced",
            "weights": {"latency": 0.5, "bandwidth": 0.2, "reliability": 0.2, "cost": 0.1},
            "rationale": "balanced needs", "tradeoffs": ["t1"],
        }, "model": "t", "finish_reason": "stop"},
    )
    res = agents.run_agent(agents.AgentRequest(capability="connectivity", prompt="cheap bulk"))
    assert res.result["ai"]["recommended_policy"] == "balanced"
    # Deterministic engine still computes the actual selection.
    assert "selected_link_ids" in res.result["local"]


def test_use_ai_false_skips_provider(monkeypatch: pytest.MonkeyPatch):
    _creds(monkeypatch)

    def boom(*a, **k):
        raise AssertionError("provider must not be called")

    monkeypatch.setattr(providers, "chat_json", boom)
    res = agents.run_agent(agents.AgentRequest(capability="architect", prompt="x", use_ai=False))
    assert res.ai_status == "not_attempted"
    assert res.result["ai"] is None
