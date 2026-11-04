"""Pydantic models for network topology and simulation state."""

from pydantic import BaseModel, Field, field_validator


class Position(BaseModel):
    x: float
    y: float


class WorldPosition(BaseModel):
    """Optional geographic-style position for 3D/mobility simulation (km)."""

    x_km: float = 0.0
    y_km: float = 0.0
    altitude_m: float = 0.0


class MobilitySpec(BaseModel):
    """Optional movement spec for a mobile node (simplified kinematic model)."""

    velocity_x_kmh: float = 0.0
    velocity_y_kmh: float = 0.0
    # Optional waypoint route; simulated node heads toward each in order.
    waypoints_km: list[list[float]] = Field(default_factory=list)
    speed_kmh: float = 0.0
    # Optional node id to follow: copies the leader's position each tick
    # (e.g. onboard clients ride with their ship/aircraft).
    follow: str | None = None


PORT_KINDS = ("ethernet", "fiber", "wifi", "cellular", "satellite", "serial", "power", "microwave", "bluetooth", "lpwan")


class NodePortConfig(BaseModel):
    """One configurable interface/port on a topology node.

    All engineering parameters are optional: the physical-layer inspector
    reports "Not calculated" (with the missing inputs named) instead of
    fabricating values. Illustrative defaults are labeled as such in the UI.
    """

    name: str = Field(description="Interface name, e.g. eth0, SFP-1, wlan0")
    kind: str = Field(description="Port kind: ethernet, fiber, wifi, cellular, satellite, serial, power")
    technology: str = Field(default="", description="Display technology, e.g. 'Wi-Fi 6', 'Cellular (LTE)'")
    enabled: bool = True
    # L2 / wired
    speed_mbps: float | None = None
    duplex: str | None = Field(default=None, description="'full' or 'half' where supported")
    mtu: int | None = 1500
    mac: str | None = None
    vlan: int | None = None
    # Fiber / optical
    transceiver: str | None = None
    connector_type: str | None = None
    fiber_type: str | None = None
    wavelength_nm: float | None = None
    tx_optical_dbm: float | None = None
    rx_optical_dbm: float | None = None
    optical_budget_db: float | None = None
    # Wireless / radio
    standard: str | None = Field(default=None, description="e.g. 802.11ax, LTE-A, 5G NR")
    frequency_mhz: float | None = None
    channel: str | None = None
    channel_width_mhz: float | None = None
    tx_power_dbm: float | None = None
    antenna: str | None = None
    antenna_gain_dbi: float | None = None
    # Cellular extras
    bands: list[str] = Field(default_factory=list)
    modem: str | None = None
    cell_id: str | None = None
    # Satellite extras
    terminal_type: str | None = None
    sat_system: str | None = None
    uplink_band: str | None = None
    downlink_band: str | None = None
    # Link-layer security on this interface
    security_protocol: str | None = Field(
        default=None, description="e.g. none, WPA2, WPA3, 5G-AKA, IPsec"
    )
    auth_method: str | None = None
    cipher: str | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, value: str) -> str:
        if value not in PORT_KINDS:
            raise ValueError(f"Unknown port kind {value!r}; expected one of {PORT_KINDS}")
        return value

    @field_validator("vlan")
    @classmethod
    def _check_vlan(cls, value: int | None) -> int | None:
        if value is not None and not 1 <= value <= 4094:
            raise ValueError("VLAN must be in 1..4094")
        return value

    @field_validator("mtu")
    @classmethod
    def _check_mtu(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("MTU must be positive")
        return value

    @field_validator("duplex")
    @classmethod
    def _check_duplex(cls, value: str | None) -> str | None:
        if value is not None and value not in ("full", "half"):
            raise ValueError("duplex must be 'full' or 'half'")
        return value


class LinkSecurityConfig(BaseModel):
    """Security metadata for one link (modeled, not real cryptography)."""

    protocol: str = Field(description="e.g. none, WPA2, WPA3, 5G-AKA, TLS 1.3, IPsec")
    scope: str = Field(
        default="link",
        description="What the protocol protects on this hop: link, network, transport, application",
    )
    enabled: bool = True
    auth_method: str | None = None
    cipher_family: str | None = None
    confidentiality: bool = Field(default=False, description="Modeled: payload confidentiality on this hop")
    integrity: bool = Field(default=False, description="Modeled: integrity protection on this hop")
    notes: str = ""

    @field_validator("scope")
    @classmethod
    def _check_scope(cls, value: str) -> str:
        if value not in ("link", "network", "transport", "application"):
            raise ValueError("scope must be link, network, transport, or application")
        return value


class TopologyNode(BaseModel):
    id: str
    type: str = Field(description="Node kind: ship, base_station, satellite, gateway, internet, ...")
    label: str
    position: Position | None = None
    world_position: WorldPosition | None = None
    mobility: MobilitySpec | None = None
    device_id: str | None = Field(
        default=None, description="Optional hardware-library device reference"
    )
    supported_technologies: list[str] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict)
    ports: list[NodePortConfig] = Field(
        default_factory=list, description="Configured interfaces/ports on this node"
    )


class RfConfig(BaseModel):
    """Simplified link-budget config (illustrative planning values)."""

    model: str = Field(default="link_budget", description='"link_budget" or "range_threshold"')
    preset: str | None = Field(default=None, description="Optional rf.py preset name")
    frequency_mhz: float | None = None
    tx_power_dbm: float | None = None
    tx_gain_dbi: float | None = None
    rx_gain_dbi: float | None = None
    rx_sensitivity_dbm: float | None = None
    extra_loss_db: float | None = None
    required_margin_db: float | None = None
    hysteresis_db: float | None = None


class TopologyLink(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None
    latency_ms: float = Field(description="Synthetic example latency in milliseconds")
    bandwidth_mbps: float = Field(description="Synthetic example bandwidth in Mbps")
    reliability: float = Field(ge=0.0, le=1.0, description="Synthetic example reliability 0..1")
    cost_per_gb: float = Field(
        default=0.0, ge=0.0, description="Synthetic relative cost in USD/GB"
    )
    status: str = Field(description="Connection status: active, standby, down")
    technology: str = Field(description="Communication technology used on this link")
    max_range_km: float | None = Field(
        default=None, description="Optional suitability range for wireless links (km)"
    )
    medium: str = Field(default="wired", description='"wired" or "wireless"')
    rf: RfConfig | None = Field(
        default=None, description="Optional link-budget config; takes precedence over max_range_km"
    )
    source_port: str | None = Field(
        default=None, description="Named port on the source node, if modeled"
    )
    target_port: str | None = Field(
        default=None, description="Named port on the target node, if modeled"
    )
    protocols: list[str] = Field(
        default_factory=list, description="Configured protocols above L2, e.g. IPv4, TCP, TLS 1.3"
    )
    security: LinkSecurityConfig | None = Field(
        default=None, description="Modeled link security metadata (not real cryptography)"
    )
    experimental: bool = Field(
        default=False,
        description="Explicitly experimental model: bypasses interface-compatibility rejection",
    )


class TopologyMetadata(BaseModel):
    name: str
    description: str | None = None
    synthetic: bool = True
    version: int = 1
    environment: str = "generic"


class Topology(BaseModel):
    metadata: TopologyMetadata
    nodes: list[TopologyNode]
    links: list[TopologyLink]


class NodeInterface(BaseModel):
    link_id: str
    technology: str
    neighbor_id: str


class LinkSuitability(BaseModel):
    suitable: bool = True
    reason: str = ""
    signal_quality: float | None = Field(default=None, ge=0.0, le=1.0)
    distance_km: float | None = None


class LinkState(BaseModel):
    id: str
    status: str = Field(description='Operational status: "up" or "down"')
    on_active_route: bool = False
    on_backup_route: bool = False
    suitable: bool = True
    suitability_reason: str = ""
    signal_quality: float | None = None
    distance_km: float | None = None
    rx_dbm: float | None = None
    margin_db: float | None = None
    suitability_model: str = "range_threshold"
    coverage_radius_km: float | None = None


class NodeState(BaseModel):
    id: str
    status: str = Field(description='Operational status: "up" or "down"')
    on_active_route: bool = False
    reachable: bool = True
    interfaces: list[NodeInterface] = Field(default_factory=list)
    world_position: WorldPosition | None = None
    traffic: str = Field(default="browsing", description="Application traffic profile id")


class RouteInfo(BaseModel):
    node_ids: list[str]
    node_labels: list[str]
    link_ids: list[str]
    latency_ms: float
    bandwidth_mbps: float
    reliability: float = Field(
        description="Synthetic score: product of link reliabilities under the "
        "documented independence assumption (see routing.py)"
    )
    cost_per_gb: float = 0.0
    score: float | None = Field(
        default=None, description="Balanced-policy normalized score (lower is better)"
    )
    eligible: bool = True
    ineligibility_reason: str = ""


class RouteDecision(BaseModel):
    policy: str
    selected_link_ids: list[str] = Field(default_factory=list)
    explanation: str = ""
    candidates_considered: int = 0
    candidates_eligible: int = 0
    weights: dict[str, float] = Field(default_factory=dict)


class EndpointRoute(BaseModel):
    endpoint_id: str
    endpoint_label: str = ""
    route: RouteInfo | None = None
    connectivity: str = Field(
        description='"connected" (on the initial preferred route), '
        '"degraded" (on a backup route) or "disconnected" (no viable route)'
    )
    achieved_mbps: float | None = Field(
        default=None, description="Fair-share throughput estimate (see traffic.py)"
    )
    traffic: str = Field(default="browsing", description="Application traffic profile id")
    traffic_suitable: bool = True
    traffic_notes: list[str] = Field(default_factory=list)


class SimulationState(BaseModel):
    status: str = Field(description='Session status: "idle", "running" or "paused"')
    tick: int = Field(description="Monotonic action counter; reset restores 0")
    sim_time_s: float = 0.0
    routing_policy: str
    connectivity: str = Field(
        description='"connected" (on the initial preferred route), '
        '"degraded" (on a backup route) or "disconnected" (no viable route)'
    )
    active_route: RouteInfo | None = None
    backup_routes: list[RouteInfo] = Field(default_factory=list)
    endpoint_routes: list[EndpointRoute] = Field(
        default_factory=list,
        description="Per-endpoint routes; active_route mirrors the primary endpoint",
    )
    links: list[LinkState] = Field(default_factory=list)
    nodes: list[NodeState] = Field(default_factory=list)
    decision: RouteDecision | None = None
    scenario_id: str = "maritime_failover"


class SimulationEvent(BaseModel):
    seq: int
    timestamp: str = Field(description="UTC ISO-8601 wall-clock time of recording")
    sim_time_s: float = 0.0
    tick: int = 0
    type: str
    message: str


class EventsResponse(BaseModel):
    events: list[SimulationEvent]


class LinkActionRequest(BaseModel):
    link_id: str = Field(min_length=1)


class StepRequest(BaseModel):
    ticks: int = Field(default=1, ge=1, le=1000)
    dt_seconds: float = Field(default=60.0, ge=0.1, le=86400.0)


class PolicyRequest(BaseModel):
    policy: str = Field(min_length=1)
    weights: dict[str, float] | None = None
