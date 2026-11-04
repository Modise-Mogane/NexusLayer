"""Modular simplified RF link-budget models (illustrative, documented).

Formulas (established engineering equations, simplified application):
- Free-space path loss: FSPL(dB) = 20*log10(d_km) + 20*log10(f_MHz) + 32.44
- Received power: RX = TX + Gtx + Grx - FSPL - extra_losses
- Link margin: RX - sensitivity; suitable when margin >= required_margin_db.
- Hysteresis: a link that became unsuitable re-qualifies only when
  margin >= required_margin_db + hysteresis_db (anti-flapping in dB).
- Display quality: margin mapped linearly to 0..1 over a 20 dB window.

Scope and honesty notes:
- Bidirectional access links are evaluated on the weaker (uplink) budget,
  which is the usual coverage limiter; downlink-only analysis would
  overstate range.
- Satellite geometry uses slant range from endpoint altitudes; the GEO
  abstraction keeps the satellite effectively stationary.
- NOT modeled: fading distributions, shadowing maps, interference, antenna
  patterns, atmospheric absorption detail, Doppler, capacity/SINR mapping.
  Numbers are synthetic planning estimates, not measurements.
"""

import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class BudgetParams:
    frequency_mhz: float = 1800.0
    tx_power_dbm: float = 23.0
    tx_gain_dbi: float = 2.0
    rx_gain_dbi: float = 18.0
    rx_sensitivity_dbm: float = -104.0
    extra_loss_db: float = 15.0
    required_margin_db: float = 6.0
    hysteresis_db: float = 3.0
    label: str = "custom"


# Illustrative presets (synthetic planning values, not datasheets).
TECH_PRESETS: dict[str, BudgetParams] = {
    "lte_uplink": BudgetParams(
        frequency_mhz=1800.0, tx_power_dbm=23.0, tx_gain_dbi=2.0,
        rx_gain_dbi=18.0, rx_sensitivity_dbm=-104.0, extra_loss_db=15.0,
        required_margin_db=6.0, hysteresis_db=3.0, label="LTE uplink (illustrative)",
    ),
    "lte_downlink": BudgetParams(
        frequency_mhz=1800.0, tx_power_dbm=46.0, tx_gain_dbi=18.0,
        rx_gain_dbi=2.0, rx_sensitivity_dbm=-104.0, extra_loss_db=15.0,
        required_margin_db=6.0, hysteresis_db=3.0, label="LTE downlink (illustrative)",
    ),
    "5g_uplink": BudgetParams(
        frequency_mhz=3500.0, tx_power_dbm=23.0, tx_gain_dbi=2.0,
        rx_gain_dbi=20.0, rx_sensitivity_dbm=-100.0, extra_loss_db=18.0,
        required_margin_db=6.0, hysteresis_db=3.0, label="5G uplink (illustrative)",
    ),
    "vsat_uplink": BudgetParams(
        frequency_mhz=20000.0, tx_power_dbm=43.0, tx_gain_dbi=45.0,
        rx_gain_dbi=50.0, rx_sensitivity_dbm=-120.0, extra_loss_db=6.0,
        required_margin_db=3.0, hysteresis_db=2.0, label="VSAT GEO uplink (illustrative)",
    ),
    "wifi": BudgetParams(
        frequency_mhz=5000.0, tx_power_dbm=20.0, tx_gain_dbi=3.0,
        rx_gain_dbi=3.0, rx_sensitivity_dbm=-90.0, extra_loss_db=10.0,
        required_margin_db=6.0, hysteresis_db=3.0, label="Wi-Fi (illustrative)",
    ),
    "lora": BudgetParams(
        frequency_mhz=868.0, tx_power_dbm=14.0, tx_gain_dbi=2.0,
        rx_gain_dbi=5.0, rx_sensitivity_dbm=-137.0, extra_loss_db=8.0,
        required_margin_db=6.0, hysteresis_db=3.0, label="LoRa (illustrative)",
    ),
    "microwave": BudgetParams(
        frequency_mhz=18000.0, tx_power_dbm=27.0, tx_gain_dbi=35.0,
        rx_gain_dbi=35.0, rx_sensitivity_dbm=-75.0, extra_loss_db=4.0,
        required_margin_db=10.0, hysteresis_db=2.0, label="Microwave PtP (illustrative)",
    ),
}


def fspl_db(distance_km: float, frequency_mhz: float) -> float:
    """Free-space path loss in dB (d in km, f in MHz)."""
    d = max(distance_km, 0.001)
    f = max(frequency_mhz, 1.0)
    return 20 * math.log10(d) + 20 * math.log10(f) + 32.44


def slant_range_km(a: dict, b: dict) -> float:
    """3D range including altitude (for satellite geometry)."""
    dx = float(a.get("x_km", 0.0)) - float(b.get("x_km", 0.0))
    dy = float(a.get("y_km", 0.0)) - float(b.get("y_km", 0.0))
    dz_km = (float(a.get("altitude_m", 0.0)) - float(b.get("altitude_m", 0.0))) / 1000.0
    return math.sqrt(dx * dx + dy * dy + dz_km * dz_km)


def received_power_dbm(params: BudgetParams, distance_km: float) -> tuple[float, float]:
    """Return (RX dBm, FSPL dB) for the simplified budget."""
    loss = fspl_db(distance_km, params.frequency_mhz)
    rx = (
        params.tx_power_dbm
        + params.tx_gain_dbi
        + params.rx_gain_dbi
        - loss
        - params.extra_loss_db
    )
    return rx, loss


def quality_from_margin(margin_db: float, window_db: float = 20.0) -> float:
    """Map link margin to a 0..1 display score (estimate, not a measurement)."""
    return max(0.0, min(1.0, margin_db / window_db))


def effective_range_km(params: BudgetParams) -> float:
    """Invert the budget: distance where margin equals the required margin."""
    budget = (
        params.tx_power_dbm
        + params.tx_gain_dbi
        + params.rx_gain_dbi
        - params.extra_loss_db
        - params.rx_sensitivity_dbm
        - params.required_margin_db
        - 32.44
        - 20 * math.log10(max(params.frequency_mhz, 1.0))
    )
    return max(0.001, 10 ** (budget / 20.0))


@dataclass(frozen=True)
class BudgetResult:
    suitable: bool
    reason: str
    quality: float
    rx_dbm: float
    margin_db: float
    fspl_db: float
    distance_km: float
    threshold_db: float


def evaluate(
    params: BudgetParams, distance_km: float, previously_suitable: bool
) -> BudgetResult:
    """Evaluate link suitability from the link budget with dB hysteresis."""
    rx, loss = received_power_dbm(params, distance_km)
    margin = rx - params.rx_sensitivity_dbm
    if previously_suitable:
        suitable = margin >= params.required_margin_db
        threshold = params.required_margin_db
    else:
        suitable = margin >= params.required_margin_db + params.hysteresis_db
        threshold = params.required_margin_db + params.hysteresis_db
    state = "suitable" if suitable else "unsuitable"
    reason = (
        f"RX {rx:.1f} dBm, margin {margin:.1f} dB vs {threshold:.1f} dB required "
        f"({params.label}; {state})"
    )
    return BudgetResult(
        suitable=suitable,
        reason=reason,
        quality=quality_from_margin(margin),
        rx_dbm=rx,
        margin_db=margin,
        fspl_db=loss,
        distance_km=distance_km,
        threshold_db=threshold,
    )


def params_from_dict(data: dict | None, technology: str = "") -> BudgetParams | None:
    """Build params from a link rf-config dict, defaulting to tech presets."""
    if data is None:
        return None
    preset_name = str(data.get("preset", "") or "").lower()
    if not preset_name:
        tech = technology.lower()
        if "vsat" in tech or "satellite" in tech or "feeder" in tech or "ka-band" in tech:
            preset_name = "vsat_uplink"
        elif "5g" in tech or "nr" in tech:
            preset_name = "5g_uplink"
        elif "lte" in tech or "cellular" in tech or "4g" in tech:
            preset_name = "lte_uplink"
        elif "wi-fi" in tech or "wifi" in tech:
            preset_name = "wifi"
        elif "lora" in tech or "lpwan" in tech:
            preset_name = "lora"
        elif "microwave" in tech or "ptp" in tech:
            preset_name = "microwave"
    base = TECH_PRESETS.get(preset_name, TECH_PRESETS["lte_uplink"])

    def pick(key: str, default: float) -> float:
        value = data.get(key, None)
        return float(value) if value is not None else float(default)

    return BudgetParams(
        frequency_mhz=pick("frequency_mhz", base.frequency_mhz),
        tx_power_dbm=pick("tx_power_dbm", base.tx_power_dbm),
        tx_gain_dbi=pick("tx_gain_dbi", base.tx_gain_dbi),
        rx_gain_dbi=pick("rx_gain_dbi", base.rx_gain_dbi),
        rx_sensitivity_dbm=pick("rx_sensitivity_dbm", base.rx_sensitivity_dbm),
        extra_loss_db=pick("extra_loss_db", base.extra_loss_db),
        required_margin_db=pick("required_margin_db", base.required_margin_db),
        hysteresis_db=pick("hysteresis_db", base.hysteresis_db),
        label=str(data.get("label") or base.label),
    )
