"""Tests for Stage D: coverage research + scheduled jobs."""

import pytest
from fastapi.testclient import TestClient

from app import coverage, jobs
from app.main import app
from app.simulation import SimulationSession


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_regions_seed_and_classify():
    assert coverage.ensure_regions() >= 3
    regions = {r["id"]: r["data"] for r in coverage.list_regions()}
    assert coverage.classify_gap(regions["offshore-platforms"])["class"] == "no_data"
    assert coverage.classify_gap(regions["highland-valley"])["class"] == "coverage_gap"
    assert coverage.classify_gap(regions["coastal-fishing"])["class"] == "coverage_gap"
    assert coverage.classify_gap({"coverage_pct": 92, "usage_pct": 40})["class"] == "low_adoption"
    assert coverage.classify_gap({"coverage_pct": 92, "usage_pct": 80})["class"] == "adequate"


def test_analyze_ranks_proposals_with_costs():
    report = coverage.analyze_region("highland-valley")
    assert report["gap"]["class"] == "coverage_gap"
    assert len(report["proposals"]) == 4
    scores = [p["score"] for p in report["proposals"]]
    assert scores == sorted(scores, reverse=True)
    top = report["proposals"][0]
    assert top["capex_usd_approx"] > 0
    assert "illustrative" in top["assumption"]
    assert report["confidence"].startswith("low:")
    assert coverage.list_reports("highland-valley")


def test_proposal_scenario_simulates():
    report = coverage.analyze_region("highland-valley")
    proposal_id = report["proposals"][0]["id"]
    out = coverage.proposal_to_scenario(report["id"], proposal_id)
    assert out["scenario_id"]
    from app import scenarios as scenario_store

    detail = scenario_store.get_scenario(out["scenario_id"])
    assert detail is not None
    session = SimulationSession(topology=detail.topology, scenario_id="cov-test")
    state = session.get_state()
    assert state.connectivity in ("connected", "degraded")
    assert state.active_route is not None
    scenario_store.delete_scenario(out["scenario_id"])
    with pytest.raises(KeyError):
        coverage.proposal_to_scenario("cov-nope", proposal_id)


def test_jobs_default_disabled_and_validated(client: TestClient):
    res = client.get("/api/jobs")
    assert res.status_code == 200
    all_jobs = {j["id"]: j for j in res.json()["jobs"]}
    assert {"job-source-refresh", "job-coverage-reassess"} <= set(all_jobs)
    assert all(j["enabled"] == 0 for j in all_jobs.values())
    res = client.post("/api/jobs/job-coverage-reassess", json={"interval_seconds": 60})
    assert res.status_code == 400
    res = client.post("/api/jobs/job-nope", json={"enabled": True})
    assert res.status_code == 404


def test_manual_coverage_reassess_run(client: TestClient):
    res = client.post("/api/jobs/job-coverage-reassess/run")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert len(body["result"]["reports"]) >= 3
    assert body["result"]["ai_summary"] is None  # deterministic unless opted in
    runs = client.get("/api/jobs/job-coverage-reassess/runs").json()["runs"]
    assert runs and runs[0]["status"] == "ok"
    assert "highland-valley" in runs[0]["log"]
    job = client.get("/api/jobs/job-coverage-reassess").json()
    assert job["last_status"] == "ok"
    assert job["next_run"]


def test_coverage_api_round_trip(client: TestClient):
    res = client.get("/api/coverage/regions")
    assert res.status_code == 200
    assert len(res.json()["regions"]) >= 3
    res = client.post("/api/coverage/regions/highland-valley/analyze")
    assert res.status_code == 200
    report = res.json()
    proposal_id = report["proposals"][0]["id"]
    res = client.post(
        f"/api/coverage/reports/{report['id']}/proposals/{proposal_id}/scenario")
    assert res.status_code == 200
    scenario_id = res.json()["scenario_id"]
    from app import scenarios as scenario_store

    scenario_store.delete_scenario(scenario_id)
    res = client.post("/api/coverage/regions/nope/analyze")
    assert res.status_code == 404
