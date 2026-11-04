"""Live provider tests — opt-in only (NEXUS_LIVE_AI_TESTS=1).

These call the configured model provider over the network and are skipped
by default so the normal suite stays deterministic and credential-free.
"""

import os

import pytest

from app import agents, providers

pytestmark = pytest.mark.skipif(
    os.getenv("NEXUS_LIVE_AI_TESTS") != "1", reason="live AI tests are opt-in"
)


def test_live_verify():
    status = providers.provider_status()
    assert status["state"] == "configured", f"live tests need credentials: {status['state']}"
    result = providers.verify()
    assert result["verified"] is True, result


def test_live_architect_proposal():
    res = agents.run_agent(agents.AgentRequest(
        capability="architect",
        prompt="Design a network for a ship traveling between coastal cellular "
               "coverage and an offshore satellite-only region. Prioritize reliability.",
    ))
    assert res.provenance == "ai_verified", res.ai_status
    topo = res.result["ai"]["proposal_topology"]
    assert len(topo["nodes"]) >= 3 and len(topo["links"]) >= 2


def test_live_hardware_concept():
    res = agents.run_agent(agents.AgentRequest(
        capability="hardware",
        prompt="A gateway for a remote mobile platform switching between terrestrial LTE and satellite.",
    ))
    assert res.provenance == "ai_verified", res.ai_status
    assert res.result["ai"]["concept"]["device_id"].startswith("ai-concept-")


def test_live_connectivity_recommendation():
    res = agents.run_agent(agents.AgentRequest(
        capability="connectivity", prompt="Bulk overnight backup, minimize cost.",
        context={"routes": [
            {"node_ids": ["a", "b"], "link_ids": ["l1"], "latency_ms": 45,
             "bandwidth_mbps": 50, "reliability": 0.9, "cost_per_gb": 0.5},
            {"node_ids": ["a", "c"], "link_ids": ["l2"], "latency_ms": 855,
             "bandwidth_mbps": 20, "reliability": 0.97, "cost_per_gb": 9.0},
        ]},
    ))
    assert res.provenance == "ai_verified", res.ai_status
    assert res.result["local"]["selected_link_ids"] == ["l1"]
