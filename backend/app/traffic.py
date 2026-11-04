"""Application traffic profiles and shared-capacity modeling (illustrative).

Profiles describe what an application needs (bandwidth, latency tolerance).
Suitability compares the endpoint's active route against those needs. These
are simulated application models, not real calls or transmissions.

Fair-share abstraction: when N endpoint routes share a link, each is
credited bandwidth/N on that link; the endpoint's achieved rate is the
minimum across its path. No queuing, burst, or QoS detail is modeled.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TrafficProfile:
    id: str
    label: str
    required_mbps: float
    max_latency_ms: float
    description: str


TRAFFIC_PROFILES: dict[str, TrafficProfile] = {
    "voice": TrafficProfile("voice", "Phone call / voice", 0.1, 200.0,
        "Real-time voice; needs low latency more than bandwidth."),
    "video_call": TrafficProfile("video_call", "Video call", 2.0, 250.0,
        "Interactive video; needs steady megabits and bounded latency."),
    "messaging": TrafficProfile("messaging", "Messaging", 0.05, 2000.0,
        "Tolerant text/media messaging."),
    "browsing": TrafficProfile("browsing", "Web browsing", 1.0, 1200.0,
        "Default interactive profile; tolerates high-latency links."),
    "file_transfer": TrafficProfile("file_transfer", "Large file transfer", 10.0, 5000.0,
        "Bulk throughput; latency-tolerant."),
    "telemetry": TrafficProfile("telemetry", "Telemetry", 0.02, 5000.0,
        "Small periodic sensor reports."),
    "emergency": TrafficProfile("emergency", "Emergency signaling", 0.05, 500.0,
        "Priority class (advisory label in reports); evaluated like messaging."),
}

DEFAULT_PROFILE = "browsing"


def profile_for(node_properties: dict) -> TrafficProfile:
    pid = str((node_properties or {}).get("traffic", DEFAULT_PROFILE))
    return TRAFFIC_PROFILES.get(pid, TRAFFIC_PROFILES[DEFAULT_PROFILE])


def fair_share_achieved(
    route_link_ids: list[str], link_bandwidth: dict[str, float], sharers: dict[str, int]
) -> float:
    """Minimum per-link fair share along a path (Mbps)."""
    shares = []
    for lid in route_link_ids:
        bw = link_bandwidth.get(lid, 0.0)
        n = max(sharers.get(lid, 1), 1)
        shares.append(bw / n)
    return min(shares) if shares else 0.0


def check_suitability(
    profile: TrafficProfile, latency_ms: float | None, achieved_mbps: float | None
) -> tuple[bool, list[str]]:
    """Compare route performance against application needs."""
    if latency_ms is None or achieved_mbps is None:
        return False, ["no connectivity"]
    reasons = []
    if latency_ms > profile.max_latency_ms:
        reasons.append(f"latency {latency_ms:.0f} ms exceeds {profile.max_latency_ms:.0f} ms budget")
    if achieved_mbps < profile.required_mbps:
        reasons.append(f"achieved {achieved_mbps:.2f} Mbps below {profile.required_mbps} Mbps need")
    return (len(reasons) == 0), reasons
