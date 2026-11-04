"""Tests for the Physics Lab calculation engine (Stage C3)."""

import math

import pytest
from fastapi.testclient import TestClient

from app import physics_lab as lab
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_copper_scales_with_length():
    short = lab.copper_link(lab.CopperParams(length_m=100, attenuation_db_per_100m=20))
    long = lab.copper_link(lab.CopperParams(length_m=200, attenuation_db_per_100m=20))
    att = lambda r: next(o.value for o in r.outputs if o.key == "attenuation_db")
    assert att(short) == pytest.approx(20.0)
    assert att(long) == pytest.approx(40.0)
    assert short.fidelity == "L2-engineering-calc"
    assert any("velocity" in a.lower() or "VF" in a for a in short.assumptions)


def test_optical_photon_energy_known_value():
    # 1240 eV·nm / 1240 nm ≈ 1 eV.
    out = lab.optical_source(lab.OpticalParams(wavelength_nm=1240.0))
    ev = next(o.value for o in out.outputs if o.key == "photon_energy_ev")
    assert ev == pytest.approx(1.0, rel=1e-3)


def test_fiber_beats_copper_on_loss():
    out = lab.fiber_link(lab.FiberParams(length_km=20))
    loss = next(o.value for o in out.outputs if o.key == "total_loss_db")
    copper = next(o.value for o in out.outputs if o.key == "copper_loss_db")
    assert loss < copper


def test_radio_matches_friis():
    p = lab.RadioParams(frequency_mhz=2400, distance_km=1.0, tx_power_dbm=20,
                        tx_gain_dbi=0, rx_gain_dbi=0, rx_sensitivity_dbm=-90,
                        extra_loss_db=0)
    out = lab.radio_link(p)
    fspl = next(o.value for o in out.outputs if o.key == "fspl_db")
    assert fspl == pytest.approx(20 * math.log10(1.0) + 20 * math.log10(2400) + 32.44)
    rx = next(o.value for o in out.outputs if o.key == "rx_dbm")
    assert rx == pytest.approx(20 - fspl)


def test_satellite_delay_is_geometry_dominated():
    out = lab.satellite_link(lab.SatelliteParams(distance_km=36000))
    delay = next(o.value for o in out.outputs if o.key == "delay_ms")
    assert delay == pytest.approx(36000e3 / lab.C_M_S * 1000, rel=1e-6)
    assert delay > 100  # GEO one-way delay dominates the budget


def test_teleport_probabilities_sum_to_one_and_needs_classical_bits():
    out = lab.quantum_teleport(lab.TeleportParams(theta_deg=60, phi_deg=30))
    vals = {o.key: o.value for o in out.outputs}
    assert vals["p0"] + vals["p1"] == pytest.approx(1.0)
    assert "2" in str(vals["classical_bits"])
    assert any("faster-than-light" in n.lower() or "light speed" in n.lower() for n in out.notes)


def test_bb84_deterministic_and_detects_eve():
    clean = lab.bb84_demo(lab.Bb84Params(num_bits=128, seed=7, eve=False))
    again = lab.bb84_demo(lab.Bb84Params(num_bits=128, seed=7, eve=False))
    assert [o.value for o in clean.outputs] == [o.value for o in again.outputs]
    noisy = lab.bb84_demo(lab.Bb84Params(num_bits=512, seed=7, eve=True))
    qber = lambda r: next(o.value for o in r.outputs if o.key == "qber")
    assert qber(clean) == pytest.approx(0.0)
    assert qber(noisy) == pytest.approx(25.0, abs=8.0)
    assert "INSECURE" in str(next(o.value for o in noisy.outputs if o.key == "verdict"))


def test_physics_endpoints_reject_bad_input(client):
    assert client.post("/api/physics/radio", json={"frequency_mhz": -5}).status_code == 422
    assert client.post("/api/physics/copper", json={"length_m": 0}).status_code == 422
    good = client.post("/api/physics/radio", json={"frequency_mhz": 1800, "distance_km": 5})
    assert good.status_code == 200
    assert good.json()["experiment"] == "radio"
