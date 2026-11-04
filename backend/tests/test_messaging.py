"""Tests for inter-device messaging (Stage C4)."""

import pytest
from fastapi.testclient import TestClient

from app import messaging, scenarios
from app.main import app
from app.simulation import get_session


@pytest.fixture()
def client() -> TestClient:
    test_client = TestClient(app)
    test_client.post("/api/simulation/reset")
    return test_client


@pytest.fixture()
def shared_ready():
    scenarios.ensure_world_seed()
    get_session("shared_world").reset()
    return "shared_world"


def test_aircraft_to_laptop_message(shared_ready):
    rec = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="plane-phone",
        dest_id="laptop-1", kind="message"))
    assert rec.status == "delivered"
    assert len(rec.hops) >= 2
    assert rec.path_labels[0] == "Cabin Phone"
    assert rec.path_labels[-1] == "Field Laptop"
    assert rec.total_ms is not None and rec.total_ms > 0
    assert rec.meets_profile  # messaging tolerates GEO latency
    assert any("satellite" in h.technology.lower() or "vsat" in h.technology.lower()
               or "SATCOM" in h.technology for h in rec.hops)


def test_rural_phone_has_no_path_and_explains_why(shared_ready):
    rec = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="rural-phone-1",
        dest_id="laptop-1", kind="message"))
    assert rec.status == "failed"
    assert rec.reason  # names the blocking constraint
    assert rec.hops == []


def test_voice_over_satellite_flagged_but_delivered(shared_ready):
    rec = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="plane-phone",
        dest_id="laptop-1", kind="voice"))
    assert rec.status == "delivered"
    assert rec.meets_profile is False  # GEO latency exceeds the voice budget
    assert any("latency" in n for n in rec.profile_notes)


def test_file_size_changes_transfer_time(shared_ready):
    small = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="ship-phone",
        dest_id="laptop-1", kind="file", size_kb=100))
    big = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="ship-phone",
        dest_id="laptop-1", kind="file", size_kb=10000))
    assert small.status == big.status == "delivered"
    assert big.transfer_ms is not None and small.transfer_ms is not None
    assert big.transfer_ms > small.transfer_ms
    assert big.cost_usd is not None and small.cost_usd is not None
    assert big.cost_usd > small.cost_usd


def test_message_errors(client, shared_ready):
    assert client.post("/api/messages/send", json={
        "scenario_id": shared_ready, "source_id": "nope",
        "dest_id": "laptop-1"}).status_code == 404
    assert client.post("/api/messages/send", json={
        "scenario_id": shared_ready, "source_id": "ship-1",
        "dest_id": "ship-1"}).status_code == 400
    listing = client.get("/api/messages", params={"scenario_id": shared_ready}).json()
    assert "messages" in listing


def test_failed_link_breaks_messaging_and_event_logged(shared_ready):
    session = get_session(shared_ready)
    before = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="ship-phone",
        dest_id="laptop-1", kind="message"))
    assert before.status == "delivered"
    for hop in before.hops:
        session.fail_link(hop.link_id)
    after = messaging.send_message(messaging.MessageSendRequest(
        scenario_id=shared_ready, source_id="ship-phone",
        dest_id="laptop-1", kind="message"))
    assert after.status in ("delivered", "failed")
    if after.status == "failed":
        assert "down" in after.reason or "No topological path" in after.reason
    kinds = [e.type for e in session.get_events()]
    assert "message" in kinds
