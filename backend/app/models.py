"""Pydantic models for network topology."""

from pydantic import BaseModel, Field


class Position(BaseModel):
    x: float
    y: float


class TopologyNode(BaseModel):
    id: str
    type: str = Field(description="Node kind: ship, base_station, satellite, gateway, internet")
    label: str
    position: Position | None = None
    properties: dict = Field(default_factory=dict)


class TopologyLink(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None
    latency_ms: float = Field(description="Synthetic example latency in milliseconds")
    bandwidth_mbps: float = Field(description="Synthetic example bandwidth in Mbps")
    reliability: float = Field(ge=0.0, le=1.0, description="Synthetic example reliability 0..1")
    status: str = Field(description="Connection status: active, standby, down")
    technology: str = Field(description="Communication technology used on this link")


class TopologyMetadata(BaseModel):
    name: str
    description: str | None = None
    synthetic: bool = True


class Topology(BaseModel):
    metadata: TopologyMetadata
    nodes: list[TopologyNode]
    links: list[TopologyLink]
