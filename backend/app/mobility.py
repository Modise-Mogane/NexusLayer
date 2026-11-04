"""Simplified mobility and link-suitability models.

Documented assumptions (Phase 1, repeatable and synthetic):
- World is a flat 2D plane in kilometers; altitude affects only reporting.
- Mobile nodes move with constant velocity or toward waypoints.
- Wireless link suitability uses a range threshold with hysteresis:
  suitable at distance <= max_range_km, unsuitable beyond
  max_range_km * (1 + hysteresis_margin). Inside the band the previous
  state is kept (anti-flapping).
- Signal quality is a linear 1 - distance/range estimate for display, not
  a calibrated RF prediction. Wired links are always suitable.
- Satellite links (no max_range_km) are assumed available everywhere
  (GEO wide-beam abstraction); failures must be injected explicitly.
- GNSS positioning is modeled separately: positions are known to the
  simulator and never imply an internet data channel.

More advanced propagation (path loss, fading, interference) can replace
quality_for_distance() behind the same interface later.
"""

import math

DEFAULT_HYSTERESIS_MARGIN = 0.10


def distance_km(a: dict, b: dict) -> float:
    dx = float(a.get("x_km", 0.0)) - float(b.get("x_km", 0.0))
    dy = float(a.get("y_km", 0.0)) - float(b.get("y_km", 0.0))
    return math.hypot(dx, dy)


def quality_for_distance(distance: float, max_range: float) -> float:
    """Linear synthetic signal quality 0..1 (display estimate only)."""
    if max_range <= 0:
        return 1.0
    return max(0.0, min(1.0, 1.0 - distance / max_range))


def path_loss_db(distance_km: float, frequency_mhz: float = 1800.0) -> float:
    """Free-space path loss in dB (simplified, documented reference model)."""
    d = max(distance_km, 0.001)
    f = max(frequency_mhz, 1.0)
    return 20 * math.log10(d) + 20 * math.log10(f) + 92.45 - 60.0


def link_suitable(
    medium: str,
    technology: str,
    distance: float | None,
    max_range_km: float | None,
    previously_suitable: bool,
    hysteresis_margin: float = DEFAULT_HYSTERESIS_MARGIN,
) -> tuple[bool, str, float | None]:
    """Decide whether a link can carry traffic at the current geometry."""
    if medium != "wireless":
        return True, "wired link; geometry independent", None
    if distance is None or max_range_km is None:
        return True, f"{technology}: no range constraint configured", None
    quality = quality_for_distance(distance, max_range_km)
    if distance <= max_range_km:
        return True, f"within range ({distance:.1f}/{max_range_km:.0f} km)", quality
    outer = max_range_km * (1.0 + hysteresis_margin)
    if distance > outer:
        return False, f"out of range ({distance:.1f}/{max_range_km:.0f} km)", quality
    if previously_suitable:
        return True, f"in hysteresis band, holding ({distance:.1f} km)", quality
    return False, f"in hysteresis band, still unsuitable ({distance:.1f} km)", quality


def advance_position(
    position: dict, mobility: dict | None, dt_seconds: float
) -> dict:
    """Advance a world position by dt under the simplified kinematic model."""
    pos = {
        "x_km": float(position.get("x_km", 0.0)),
        "y_km": float(position.get("y_km", 0.0)),
        "altitude_m": float(position.get("altitude_m", 0.0)),
    }
    if not mobility:
        return pos
    waypoints = mobility.get("waypoints_km") or []
    speed_kmh = float(mobility.get("speed_kmh", 0.0) or 0.0)
    if waypoints and speed_kmh > 0:
        target = waypoints[0]
        dx, dy = float(target[0]) - pos["x_km"], float(target[1]) - pos["y_km"]
        dist = math.hypot(dx, dy)
        step = speed_kmh * dt_seconds / 3600.0
        if dist <= step:
            pos["x_km"], pos["y_km"] = float(target[0]), float(target[1])
        elif dist > 0:
            pos["x_km"] += dx / dist * step
            pos["y_km"] += dy / dist * step
        return pos
    vx = float(mobility.get("velocity_x_kmh", 0.0) or 0.0)
    vy = float(mobility.get("velocity_y_kmh", 0.0) or 0.0)
    pos["x_km"] += vx * dt_seconds / 3600.0
    pos["y_km"] += vy * dt_seconds / 3600.0
    return pos
