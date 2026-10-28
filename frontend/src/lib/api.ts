export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface TopologyNode {
  id: string;
  type: string;
  label: string;
  position?: { x: number; y: number };
  properties?: Record<string, unknown>;
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  label?: string | null;
  latency_ms: number;
  bandwidth_mbps: number;
  reliability: number;
  status: string;
  technology: string;
}

export interface Topology {
  metadata: { name: string; description?: string | null; synthetic: boolean };
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export interface Health {
  status: string;
  service: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Backend request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchHealth(): Promise<Health> {
  return fetchJson<Health>("/health");
}

export function fetchTopology(): Promise<Topology> {
  return fetchJson<Topology>("/api/topology");
}
