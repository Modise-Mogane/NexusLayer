"""Communications Physics Lab calculation engine (Stage C3, Level 2).

Deterministic engineering calculations with editable inputs, shown formulas,
substituted values, units, and assumptions. Every result names its model and
scope; conceptual animations live in the frontend and are labeled L1.
Nothing here claims to be a full field solver or a measurement.
"""

import math
import random

from pydantic import BaseModel, Field

# SI defining constants (exact).
C_M_S = 299_792_458.0
H_J_S = 6.626_070_15e-34
EV_J = 1.602_176_634e-19


class Equation(BaseModel):
    name: str
    formula: str
    substitution: str


class Output(BaseModel):
    key: str
    label: str
    value: float | str
    unit: str = ""


class Reference(BaseModel):
    label: str
    detail: str = ""


class LabResult(BaseModel):
    experiment: str
    fidelity: str = "L2-engineering-calc"
    inputs: dict
    outputs: list[Output]
    equations: list[Equation]
    assumptions: list[str]
    refs: list[Reference]
    notes: list[str] = []


def _fmt(value: float, digits: int = 3) -> str:
    if value != 0 and (abs(value) >= 1e6 or abs(value) < 1e-3):
        return f"{value:.3e}"
    return f"{value:.{digits}f}"


# -- copper ------------------------------------------------------------------

COPPER_ASSUMPTIONS = [
    "Uniform cable: attenuation scales linearly with length (illustrative).",
    "Propagation at velocity_factor × c; dispersion and skin effect not modeled.",
    "No coding gain, equalization, or crosstalk modeled.",
]


class CopperParams(BaseModel):
    length_m: float = Field(default=100.0, ge=0.1, le=10000)
    attenuation_db_per_100m: float = Field(default=22.0, ge=0.1, le=200)
    data_rate_mbps: float = Field(default=1000.0, ge=0.001, le=1000000)
    velocity_factor: float = Field(default=0.66, ge=0.1, le=1.0)


def copper_link(p: CopperParams) -> LabResult:
    attenuation = p.length_m / 100.0 * p.attenuation_db_per_100m
    delay_s = p.length_m / (p.velocity_factor * C_M_S)
    bit_period_ns = 1e9 / (p.data_rate_mbps * 1e6)
    in_flight = delay_s * p.data_rate_mbps * 1e6
    return LabResult(
        experiment="copper",
        inputs=p.model_dump(),
        outputs=[
            Output(key="attenuation_db", label="Total attenuation", value=attenuation, unit="dB"),
            Output(key="delay_us", label="Propagation delay", value=delay_s * 1e6, unit="µs"),
            Output(key="bit_period_ns", label="Bit period at line rate", value=bit_period_ns, unit="ns"),
            Output(key="bits_in_flight", label="Bits simultaneously on the cable", value=in_flight, unit="bits"),
        ],
        equations=[
            Equation(name="Cable loss", formula="A = L/100m × a₁₀₀",
                     substitution=f"A = {_fmt(p.length_m)}/100 × {_fmt(p.attenuation_db_per_100m)} = {_fmt(attenuation)} dB"),
            Equation(name="Propagation delay", formula="τ = L / (VF × c)",
                     substitution=f"τ = {_fmt(p.length_m)} / ({_fmt(p.velocity_factor)} × c) = {_fmt(delay_s * 1e6)} µs"),
        ],
        assumptions=COPPER_ASSUMPTIONS,
        refs=[Reference(label="Illustrative link model", detail="Linear loss + fixed velocity factor; see experiment notes.")],
        notes=["Energy propagates as guided EM waves; individual electrons drift slowly — they do not race the signal."],
    )


# -- optical sources ----------------------------------------------------------

OPTICAL_ASSUMPTIONS = [
    "Single nominal wavelength; real sources have spectral width (LEDs wide, lasers narrow).",
    "Photon energy only — wall-plug efficiency and coupling loss are separate concerns.",
]


class OpticalParams(BaseModel):
    wavelength_nm: float = Field(default=1310.0, ge=300, le=2000)
    source: str = Field(default="laser", pattern="^(led|laser)$")


def optical_source(p: OpticalParams) -> LabResult:
    lam_m = p.wavelength_nm * 1e-9
    energy_j = H_J_S * C_M_S / lam_m
    energy_ev = energy_j / EV_J
    freq_thz = C_M_S / lam_m / 1e12
    return LabResult(
        experiment="optical_source",
        inputs=p.model_dump(),
        outputs=[
            Output(key="photon_energy_ev", label="Photon energy", value=energy_ev, unit="eV"),
            Output(key="photon_energy_j", label="Photon energy", value=energy_j, unit="J"),
            Output(key="frequency_thz", label="Optical frequency", value=freq_thz, unit="THz"),
        ],
        equations=[
            Equation(name="Photon energy", formula="E = hc/λ",
                     substitution=f"E = hc/{_fmt(p.wavelength_nm)}nm = {_fmt(energy_ev)} eV"),
        ],
        assumptions=OPTICAL_ASSUMPTIONS,
        refs=[Reference(label="SI defining constants", detail="h and c are exact by definition.")],
        notes=[
            "LED: spontaneous emission over a broad spectrum; laser: stimulated emission, narrow line.",
            "High-rate fiber links normally use lasers, not LEDs, because of spectral width and modulation speed.",
            "Light comes from electron–hole recombination across the semiconductor bandgap.",
        ],
    )


# -- fiber ---------------------------------------------------------------------

FIBER_ASSUMPTIONS = [
    "Uniform fiber: loss scales linearly; splices/connectors folded into extra_loss_db.",
    "Single group velocity; modal/chromatic dispersion penalties not computed.",
    "Copper comparison uses the stated illustrative attenuation, not a cable datasheet.",
]


class FiberParams(BaseModel):
    length_km: float = Field(default=20.0, ge=0.01, le=500)
    attenuation_db_per_km: float = Field(default=0.35, ge=0.01, le=10)
    tx_power_dbm: float = Field(default=0.0, ge=-30, le=30)
    extra_loss_db: float = Field(default=2.0, ge=0, le=60)
    wavelength_nm: float = Field(default=1550.0, ge=800, le=1700)
    copper_db_per_100m: float = Field(default=22.0, ge=0.1, le=200)


def fiber_link(p: FiberParams) -> LabResult:
    loss = p.length_km * p.attenuation_db_per_km + p.extra_loss_db
    rx = p.tx_power_dbm - loss
    delay_ms = p.length_km * 1000 / (0.68 * C_M_S) * 1000
    copper_loss = p.length_km * 1000 / 100 * p.copper_db_per_100m
    return LabResult(
        experiment="fiber",
        inputs=p.model_dump(),
        outputs=[
            Output(key="total_loss_db", label="Total optical loss", value=loss, unit="dB"),
            Output(key="rx_dbm", label="Received power", value=rx, unit="dBm"),
            Output(key="delay_ms", label="Propagation delay", value=delay_ms, unit="ms"),
            Output(key="copper_loss_db", label="Same length in copper (illustrative)", value=copper_loss, unit="dB"),
        ],
        equations=[
            Equation(name="Optical budget", formula="RX = TX − αL − extras",
                     substitution=f"RX = {_fmt(p.tx_power_dbm)} − {_fmt(p.attenuation_db_per_km)}×{_fmt(p.length_km)} − {_fmt(p.extra_loss_db)} = {_fmt(rx)} dBm"),
            Equation(name="Fiber delay", formula="τ = L / (0.68c)",
                     substitution=f"τ = {_fmt(p.length_km)} km / (0.68c) = {_fmt(delay_ms)} ms"),
        ],
        assumptions=FIBER_ASSUMPTIONS,
        refs=[Reference(label="Illustrative optical budget", detail="Linear loss + fixed group velocity.")],
        notes=["Guidance is a waveguide effect; the bouncing-ray animation is a conceptual aid, not a mode solution."],
    )


# -- radio / microwave -----------------------------------------------------------

RADIO_ASSUMPTIONS = [
    "Free-space path loss only; no fading, shadowing, or interference.",
    "Far-field, matched polarization, clear first Fresnel zone assumed.",
    "Suitable when margin ≥ required_margin_db (same rule as the RF engine).",
]


class RadioParams(BaseModel):
    frequency_mhz: float = Field(default=1800.0, ge=1, le=300000)
    distance_km: float = Field(default=5.0, ge=0.001, le=100000)
    tx_power_dbm: float = Field(default=23.0, ge=-50, le=100)
    tx_gain_dbi: float = Field(default=2.0, ge=-10, le=80)
    rx_gain_dbi: float = Field(default=18.0, ge=-10, le=80)
    rx_sensitivity_dbm: float = Field(default=-104.0, ge=-200, le=0)
    extra_loss_db: float = Field(default=15.0, ge=0, le=200)
    required_margin_db: float = Field(default=6.0, ge=0, le=60)


def radio_link(p: RadioParams) -> LabResult:
    from . import rf as rf_module

    fspl = rf_module.fspl_db(p.distance_km, p.frequency_mhz)
    rx = p.tx_power_dbm + p.tx_gain_dbi + p.rx_gain_dbi - fspl - p.extra_loss_db
    margin = rx - p.rx_sensitivity_dbm
    wavelength_m = C_M_S / (p.frequency_mhz * 1e6)
    delay_ms = p.distance_km * 1000 / C_M_S * 1000
    suitable = margin >= p.required_margin_db
    return LabResult(
        experiment="radio",
        inputs=p.model_dump(),
        outputs=[
            Output(key="fspl_db", label="Free-space path loss", value=fspl, unit="dB"),
            Output(key="rx_dbm", label="Received power", value=rx, unit="dBm"),
            Output(key="margin_db", label="Link margin", value=margin, unit="dB"),
            Output(key="suitable", label="Meets margin requirement", value="yes" if suitable else "no"),
            Output(key="wavelength_m", label="Wavelength", value=wavelength_m, unit="m"),
            Output(key="delay_ms", label="Propagation delay", value=delay_ms, unit="ms"),
        ],
        equations=[
            Equation(name="Free-space path loss", formula="FSPL = 20log₁₀d + 20log₁₀f + 32.44",
                     substitution=f"FSPL = 20log₁₀({_fmt(p.distance_km)}) + 20log₁₀({_fmt(p.frequency_mhz)}) + 32.44 = {_fmt(fspl)} dB"),
            Equation(name="Link budget", formula="RX = TX + Gtx + Grx − FSPL − extras",
                     substitution=f"RX = {_fmt(p.tx_power_dbm)} + {_fmt(p.tx_gain_dbi)} + {_fmt(p.rx_gain_dbi)} − {_fmt(fspl)} − {_fmt(p.extra_loss_db)} = {_fmt(rx)} dBm"),
            Equation(name="Margin", formula="M = RX − sensitivity",
                     substitution=f"M = {_fmt(rx)} − ({_fmt(p.rx_sensitivity_dbm)}) = {_fmt(margin)} dB"),
        ],
        assumptions=RADIO_ASSUMPTIONS,
        refs=[Reference(label="ITU-R P.525", detail="Free-space attenuation reference.")],
        notes=["Same equations as the simulation RF engine (rf.py); presets match the engine's illustrative values."],
    )


# -- satellite -------------------------------------------------------------------

SAT_ASSUMPTIONS = RADIO_ASSUMPTIONS + [
    "Single slant-range distance; orbital motion and handover not modeled.",
    "GEO default ≈ 36,000 km one-way; atmosphere folded into extra_loss_db.",
]


class SatelliteParams(BaseModel):
    frequency_mhz: float = Field(default=20000.0, ge=100, le=100000)
    distance_km: float = Field(default=36000.0, ge=500, le=100000)
    tx_power_dbm: float = Field(default=43.0, ge=-50, le=100)
    tx_gain_dbi: float = Field(default=45.0, ge=0, le=80)
    rx_gain_dbi: float = Field(default=50.0, ge=0, le=80)
    rx_sensitivity_dbm: float = Field(default=-120.0, ge=-200, le=0)
    extra_loss_db: float = Field(default=6.0, ge=0, le=200)
    required_margin_db: float = Field(default=3.0, ge=0, le=60)


def satellite_link(p: SatelliteParams) -> LabResult:
    inner = radio_link(RadioParams(
        frequency_mhz=p.frequency_mhz, distance_km=p.distance_km,
        tx_power_dbm=p.tx_power_dbm, tx_gain_dbi=p.tx_gain_dbi,
        rx_gain_dbi=p.rx_gain_dbi, rx_sensitivity_dbm=p.rx_sensitivity_dbm,
        extra_loss_db=p.extra_loss_db, required_margin_db=p.required_margin_db))
    inner.experiment = "satellite"
    inner.inputs = p.model_dump()
    inner.assumptions = SAT_ASSUMPTIONS
    inner.notes = [
        "Round-trip user traffic crosses this path twice plus processing — the dominant GEO latency term.",
        "The 3D satellite marker is a labeled schematic; budgets always use this slant-range geometry.",
    ]
    return inner


# -- quantum ---------------------------------------------------------------------

Q_ASSUMPTIONS = [
    "Ideal qubits: no decoherence, no gate error, perfect Bell pair.",
    "Educational scope: exact small-system math, not a hardware prediction.",
]


class TeleportParams(BaseModel):
    theta_deg: float = Field(default=60.0, ge=0, le=180)
    phi_deg: float = Field(default=30.0, ge=0, le=360)


def quantum_teleport(p: TeleportParams) -> LabResult:
    theta = math.radians(p.theta_deg)
    phi = math.radians(p.phi_deg)
    alpha = complex(math.cos(theta / 2), 0.0)
    beta = complex(math.cos(phi) * math.sin(theta / 2), math.sin(phi) * math.sin(theta / 2))
    corrections = {"00": "I (nothing)", "01": "X (bit flip)", "10": "Z (phase flip)", "11": "XZ (both)"}
    return LabResult(
        experiment="quantum_teleport",
        inputs=p.model_dump(),
        outputs=[
            Output(key="alpha", label="α amplitude", value=f"{alpha.real:+.4f}{alpha.imag:+.4f}j"),
            Output(key="beta", label="β amplitude", value=f"{beta.real:+.4f}{beta.imag:+.4f}j"),
            Output(key="p0", label="P(measure 0)", value=abs(alpha) ** 2),
            Output(key="p1", label="P(measure 1)", value=abs(beta) ** 2),
            Output(key="classical_bits", label="Classical bits required", value="2 bits (00/01/10/11)"),
            Output(key="bell_outcomes", label="Bell-measurement outcomes", value="4, each probability exactly 1/4"),
        ],
        equations=[
            Equation(name="State", formula="|ψ⟩ = cos(θ/2)|0⟩ + e^{iφ}sin(θ/2)|1⟩",
                     substitution=f"|ψ⟩ = {alpha.real:+.4f}|0⟩ + ({beta.real:+.4f}{beta.imag:+.4f}j)|1⟩"),
            Equation(name="Corrections", formula="outcome → Bob applies",
                     substitution="; ".join(f"{k}→{v}" for k, v in corrections.items())),
        ],
        assumptions=Q_ASSUMPTIONS,
        refs=[Reference(label="Bennett et al. 1993 (teleportation protocol)", detail="Shared entanglement + 2 classical bits + local correction.")],
        notes=[
            "Entanglement alone carries no controllable message: without the 2 classical bits, Bob's qubit is maximally mixed.",
            "No faster-than-light signaling: the classical bits travel at most at light speed.",
            "The original state is destroyed by Alice's measurement (no-cloning).",
        ],
    )


class Bb84Params(BaseModel):
    num_bits: int = Field(default=64, ge=16, le=1024)
    seed: int = Field(default=7, ge=0, le=10**9)
    eve: bool = Field(default=False)


def bb84_demo(p: Bb84Params) -> LabResult:
    rng = random.Random(p.seed)
    alice_bits = [rng.randrange(2) for _ in range(p.num_bits)]
    alice_bases = [rng.randrange(2) for _ in range(p.num_bits)]
    bob_bases = [rng.randrange(2) for _ in range(p.num_bits)]
    eve_bases = [rng.randrange(2) for _ in range(p.num_bits)] if p.eve else None
    # Ideal channel: Bob matches Alice whenever bases agree (no Eve),
    # or whenever Eve happened to use the same basis as both.
    bob_bits: list[int] = []
    for i in range(p.num_bits):
        if not p.eve or eve_bases is None:
            bob_bits.append(alice_bits[i] if alice_bases[i] == bob_bases[i] else rng.randrange(2))
        else:
            if eve_bases[i] == alice_bases[i]:
                resent = alice_bits[i]
            else:
                resent = rng.randrange(2)
            if bob_bases[i] == eve_bases[i]:
                bob_bits.append(resent)
            else:
                bob_bits.append(rng.randrange(2))
    # Sift: keep positions where Alice and Bob used the same basis.
    kept = [i for i in range(p.num_bits) if alice_bases[i] == bob_bases[i]]
    key = "".join(str(alice_bits[i]) for i in kept)
    errors = sum(1 for i in kept if alice_bits[i] != bob_bits[i])
    qber = errors / len(kept) if kept else 0.0
    return LabResult(
        experiment="bb84",
        inputs=p.model_dump(),
        outputs=[
            Output(key="sifted_bits", label="Sifted key length", value=len(kept), unit="bits"),
            Output(key="qber", label="Observed QBER on sifted key", value=qber * 100, unit="%"),
            Output(key="expected_qber", label="Theory (ideal)", value="0% without Eve; 25% with intercept-resend Eve", unit=""),
            Output(key="key_head", label="Sifted key (first 32 bits)", value=key[:32] or "—"),
            Output(key="verdict", label="Channel verdict", value="INSECURE — eavesdropping likely" if qber > 0.11 else "consistent with no eavesdropper"),
        ],
        equations=[
            Equation(name="Sifting", formula="keep i where basis_A(i) = basis_B(i)",
                     substitution=f"kept {len(kept)} of {p.num_bits} positions"),
            Equation(name="QBER", formula="errors / sifted",
                     substitution=f"{errors} / {len(kept)} = {_fmt(qber * 100, 1)}%"),
        ],
        assumptions=Q_ASSUMPTIONS + [
            "Ideal single photons and detectors; no dark counts or loss.",
            f"Deterministic demo: seed {p.seed} — same seed, same transcript.",
        ],
        refs=[Reference(label="Bennett & Brassard 1984 (BB84)", detail="Prepare-and-measure QKD; ~11% QBER abort threshold (ideal).")],
        notes=[
            "QKD distributes keys; the message itself still travels classically (often one-time-pad or AES).",
            "This demo omits error correction and privacy amplification.",
        ],
    )
