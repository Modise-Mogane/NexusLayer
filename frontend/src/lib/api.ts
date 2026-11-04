export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface TopologyNode {
  id: string;
  type: string;
  label: string;
  position?: { x: number; y: number };
  world_position?: { x_km: number; y_km: number; altitude_m: number };
  mobility?: {
    velocity_x_kmh?: number;
    velocity_y_kmh?: number;
    waypoints_km?: number[][];
    speed_kmh?: number;
    follow?: string | null;
  };
  device_id?: string | null;
  supported_technologies?: string[];
  properties?: Record<string, unknown>;
  ports?: NodePortConfig[];
}

export interface NodePortConfig {
  name: string;
  kind: string;
  enabled?: boolean;
  speed_mbps?: number | null;
  duplex?: string | null;
  mtu?: number | null;
  vlan?: number | null;
  mac?: string | null;
  frequency_mhz?: number | null;
  channel?: string | null;
  channel_width_mhz?: number | null;
  tx_power_dbm?: number | null;
  antenna_gain_dbi?: number | null;
  bands?: string[];
  wavelength_nm?: number | null;
}

export interface RfConfig {
  model?: string;
  preset?: string | null;
  frequency_mhz?: number | null;
  tx_power_dbm?: number | null;
  tx_gain_dbi?: number | null;
  rx_gain_dbi?: number | null;
  rx_sensitivity_dbm?: number | null;
  extra_loss_db?: number | null;
  required_margin_db?: number | null;
  hysteresis_db?: number | null;
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  label?: string | null;
  latency_ms: number;
  bandwidth_mbps: number;
  reliability: number;
  cost_per_gb?: number;
  status: string;
  technology: string;
  max_range_km?: number | null;
  medium?: string;
  rf?: RfConfig | null;
  source_port?: string | null;
  target_port?: string | null;
  protocols?: string[];
  security?: LinkSecurityConfig | null;
  experimental?: boolean;
}

export interface LinkSecurityConfig {
  protocol: string;
  scope?: string;
  enabled?: boolean;
  auth_method?: string | null;
  cipher_family?: string | null;
  confidentiality?: boolean;
  integrity?: boolean;
  notes?: string;
}

export interface LinkPhysicsCalc {
  id: string;
  title: string;
  status: "calculated" | "not_calculated";
  formula?: string;
  assumptions?: string[];
  missing?: string[];
  inputs?: { label: string; value: number | string | boolean; unit: string; how?: string }[];
  outputs?: { label: string; value: number | string | boolean; unit: string; formula?: string }[];
}

export interface LinkPhysics {
  link_id: string;
  label: string;
  technology: string;
  medium: string;
  family: string;
  source: { id: string; label: string; type: string; port: string | null };
  target: { id: string; label: string; type: string; port: string | null };
  configured: { latency_ms: number; bandwidth_mbps: number; reliability: number; status: string; note: string };
  distance_km: number | null;
  distance_how: string;
  frequency_mhz: number | null;
  wavelength_m: number | null;
  medium_explainer: { title: string; mechanism: string[]; key_points: string[] };
  calculations: LinkPhysicsCalc[];
  protocols: string[];
  security: (LinkSecurityConfig & { scope_warning?: string }) | null;
  live: {
    status: string; suitable: boolean | null; suitability_reason: string | null;
    signal_quality: string | null; rx_dbm: number | null; margin_db: number | null;
    on_active_route: boolean; on_backup_route: boolean;
  } | null;
  costs: { cost_per_gb_usd: number; devices: { node_id: string; name: string; capex_usd_approx: number | null; opex_usd_per_month: number | null }[] };
  references: { source_id?: string; label: string }[];
  security_references: { label: string; note: string }[];
  provenance: string;
}

export interface Topology {
  metadata: { name: string; description?: string | null; synthetic: boolean; environment?: string; version?: number };
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export interface Health {
  status: string;
  service: string;
}

export interface RouteInfo {
  node_ids: string[];
  node_labels: string[];
  link_ids: string[];
  latency_ms: number;
  bandwidth_mbps: number;
  reliability: number;
  cost_per_gb?: number;
  score?: number | null;
  eligible?: boolean;
  ineligibility_reason?: string;
}

export interface LinkState {
  id: string;
  status: "up" | "down";
  on_active_route: boolean;
  on_backup_route: boolean;
  suitable?: boolean;
  suitability_reason?: string;
  signal_quality?: number | null;
  distance_km?: number | null;
  rx_dbm?: number | null;
  margin_db?: number | null;
  suitability_model?: string;
  coverage_radius_km?: number | null;
}

export interface NodeState {
  id: string;
  status: "up" | "down";
  on_active_route: boolean;
  reachable: boolean;
  interfaces: { link_id: string; technology: string; neighbor_id: string }[];
  world_position?: { x_km: number; y_km: number; altitude_m: number } | null;
  traffic?: string;
}

export interface EndpointRoute {
  endpoint_id: string;
  endpoint_label: string;
  route: RouteInfo | null;
  connectivity: "connected" | "degraded" | "disconnected";
  achieved_mbps?: number | null;
  traffic: string;
  traffic_suitable: boolean;
  traffic_notes: string[];
}

export interface TrafficProfile {
  id: string;
  label: string;
  required_mbps: number;
  max_latency_ms: number;
  description: string;
}

export interface RouteDecision {
  policy: string;
  selected_link_ids: string[];
  explanation: string;
  candidates_considered: number;
  candidates_eligible: number;
  weights: Record<string, number>;
}

export interface SimulationState {
  status: "idle" | "running" | "paused";
  tick: number;
  sim_time_s?: number;
  routing_policy: string;
  connectivity: "connected" | "degraded" | "disconnected";
  active_route: RouteInfo | null;
  backup_routes: RouteInfo[];
  endpoint_routes?: EndpointRoute[];
  links: LinkState[];
  nodes: NodeState[];
  decision?: RouteDecision | null;
  scenario_id?: string;
}

export interface SimulationEvent {
  seq: number;
  timestamp: string;
  sim_time_s?: number;
  tick?: number;
  type: string;
  message: string;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  environment: string;
  version: number;
  node_count: number;
  link_count: number;
  updated_at: string;
}

export interface ScenarioDetail extends ScenarioSummary {
  topology: Topology;
}

export interface DeviceInterface {
  name: string;
  technology: string;
  connector?: string | null;
  max_throughput_mbps?: number | null;
}

export interface DeviceSpec {
  device_id: string;
  name: string;
  category: string;
  family: string;
  model_identifier: string;
  description?: string;
  interfaces: DeviceInterface[];
  protocols: string[];
  frequency_bands: string[];
  throughput_mbps?: number | null;
  latency_ms_typical?: number | null;
  tx_power_dbm?: number | null;
  rx_sensitivity_dbm?: number | null;
  range_km?: number | null;
  antenna?: string | null;
  power_watts?: number | null;
  cost_usd_approx?: number | null;
  opex_usd_per_month?: number | null;
  mobility?: string;
  environment?: string;
  limitations: string[];
  evidence?: { source: string; confidence: string; note: string };
  origin?: string;
}

export interface ResearchSubmission {
  title: string;
  category: string;
  problem: string;
  assumptions: string;
  measurements: string;
  references: string;
  use_cases: string;
  impact: string;
  confidence: string;
  limitations: string;
}

export interface ResearchFinding extends ResearchSubmission {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Assessment {
  id: string;
  finding_id: string;
  created_by: string;
  verdict: string;
  claims: string[];
  contradictions: string[];
  missing: string[];
  experiments: string[];
  compatible_devices: string[];
  summary: string;
  created_at: string;
}

export interface AgentResponse {
  capability: string;
  provenance: string;
  model: string;
  ai_status: string;
  result: { local: Record<string, unknown>; ai: Record<string, unknown> | null };
  advisory_note: string;
}

export interface AnalysisResult {
  scenario_id: string;
  policy: string;
  tick: number;
  sim_time_s: number;
  route_history: Record<string, unknown>[];
  handover_history: Record<string, unknown>[];
  latency_series: { tick: number; sim_time_s: number; latency_ms: number | null; bandwidth_mbps: number | null }[];
  availability: number;
  endpoints?: string[];
  per_endpoint?: Record<string, { label: string; availability: number; handovers: number; route_changes: number }>;
  disconnection_periods: Record<string, unknown>[];
  event_counts: Record<string, number>;
  assumptions: string[];
}

export interface ValidationResult {
  valid: boolean;
  issues: { severity: string; code: string; message: string }[];
  recommendations: string[];
  summary: string;
}

/** Link id of the primary terrestrial connection in maritime_failover.json. */
export const TERRESTRIAL_LINK_ID = "link-ship-cellular";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Backend request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function putJson<T>(path: string, body?: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteJson<T>(path: string): Promise<T> {
  return fetchJson<T>(path, { method: "DELETE" });
}

function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const simQuery = (scenarioId?: string) => (scenarioId ? `?scenario_id=${encodeURIComponent(scenarioId)}` : "");

export function fetchHealth(): Promise<Health> {
  return fetchJson<Health>("/health");
}

export interface WorldRegion {
  id: string;
  name: string;
  kind: string;
  bounds_km: [number, number, number, number];
  center_km: [number, number];
  camera: { pos: [number, number, number]; tgt: [number, number, number] };
  blurb: string;
  coverage: string;
  coverage_note: string;
  coverage_region_id?: string;
}

export interface WorldMeta {
  name: string;
  fictional: boolean;
  units: { horizontal: string; altitude: string; km_to_m: number };
  axes: { x: string; y: string; altitude: string };
  origin: { x_km: number; y_km: number; label: string };
  three_mapping: string;
  satellite_note: string;
  note: string;
}

export interface ScenarioFocus {
  region_id: string;
  camera_preset: string;
  activity: string;
  scenario_id: string;
  region: WorldRegion | null;
}

export function fetchWorldMeta(): Promise<{ meta: WorldMeta }> {
  return fetchJson<{ meta: WorldMeta }>("/api/world");
}

export function fetchWorldRegions(): Promise<{ regions: WorldRegion[] }> {
  return fetchJson<{ regions: WorldRegion[] }>("/api/world/regions");
}

export function fetchWorldFocus(scenarioId?: string): Promise<ScenarioFocus> {
  return fetchJson<ScenarioFocus>(`/api/world/focus${scenarioId ? `?scenario_id=${encodeURIComponent(scenarioId)}` : ""}`);
}

export function fetchTopology(): Promise<Topology> {
  return fetchJson<Topology>("/api/topology");
}

export function fetchSimulationState(scenarioId?: string): Promise<SimulationState> {
  return fetchJson<SimulationState>(`/api/simulation/state${simQuery(scenarioId)}`);
}

export function fetchSimulationEvents(scenarioId?: string): Promise<{ events: SimulationEvent[] }> {
  return fetchJson<{ events: SimulationEvent[] }>(`/api/simulation/events${simQuery(scenarioId)}`);
}

export function startSimulation(scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/start${simQuery(scenarioId)}`);
}

export function pauseSimulation(scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/pause${simQuery(scenarioId)}`);
}

export function resetSimulation(scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/reset${simQuery(scenarioId)}`);
}

export function failLink(linkId: string, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/fail-link${simQuery(scenarioId)}`, { link_id: linkId });
}

export function restoreLink(linkId: string, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/restore-link${simQuery(scenarioId)}`, { link_id: linkId });
}

export function stepSimulation(ticks: number, dtSeconds: number, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/step${simQuery(scenarioId)}`, { ticks, dt_seconds: dtSeconds });
}

export function setPolicy(policy: string, weights: Record<string, number> | undefined, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/policy${simQuery(scenarioId)}`, { policy, weights });
}

export function updateLinkParams(
  linkId: string,
  updates: {
    cost_per_gb?: number;
    latency_ms?: number;
    bandwidth_mbps?: number;
    reliability?: number;
    max_range_km?: number | null;
    rf?: RfConfig | null;
  },
  scenarioId?: string
): Promise<SimulationState> {
  const body: Record<string, unknown> = { link_id: linkId };
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) {
      if (k === "rf") body.clear_rf = true;
      if (k === "max_range_km") body.clear_max_range = true;
    } else if (v !== undefined) {
      body[k] = v;
    }
  }
  return postJson<SimulationState>(`/api/simulation/link-params${simQuery(scenarioId)}`, body);
}

export function setNodePosition(nodeId: string, xKm: number, yKm: number, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/node-position${simQuery(scenarioId)}`, {
    node_id: nodeId,
    x_km: xKm,
    y_km: yKm,
  });
}

export function fetchRfPresets(): Promise<{ presets: Record<string, Record<string, number | string>>; formulas: string[]; note: string }> {
  return fetchJson("/api/rf/presets");
}

export function setCourse(nodeId: string, vx: number, vy: number, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/course${simQuery(scenarioId)}`, {
    node_id: nodeId,
    velocity_x_kmh: vx,
    velocity_y_kmh: vy,
  });
}

export function fetchAnalysis(scenarioId?: string): Promise<AnalysisResult> {
  return fetchJson<AnalysisResult>(`/api/simulation/analysis${simQuery(scenarioId)}`);
}

export interface SimulationReport {
  scenario_id: string;
  policy: string;
  sim_time_s: number;
  tick: number;
  availability: number;
  per_endpoint: Record<string, { label: string; availability: number; handovers: number; route_changes: number }>;
  endpoints: {
    endpoint_id: string;
    label: string;
    route_changes: number;
    handovers: number;
    disconnected_periods: number;
    min_latency_ms: number | null;
    max_latency_ms: number | null;
    min_bandwidth_mbps: number | null;
    technologies_used: string[];
  }[];
  handovers: { tick: number; sim_time_s: number; endpoint_id?: string; from_link_ids: string[]; to_link_ids: string[]; reason: string }[];
  disconnection_periods: Record<string, unknown>[];
  event_counts: Record<string, number>;
  costs: {
    currency: string;
    assumption: string;
    priced_links: { link_id: string; label: string; technology: string; cost_per_gb_usd: number }[];
    devices: { node_id: string; label: string; device_id: string; name: string; capex_usd_approx: number | null; opex_usd_per_month: number | null }[];
    capex_usd_approx: number;
    opex_usd_per_month: number;
  };
  recommendations: { endpoint_id: string; finding: string; suggestion: string }[];
  assumptions: string[];
  confidence: string;
}

export function fetchReport(scenarioId?: string): Promise<SimulationReport> {
  return fetchJson<SimulationReport>(`/api/simulation/report${simQuery(scenarioId)}`);
}

export function setTraffic(nodeId: string, profile: string, scenarioId?: string): Promise<SimulationState> {
  return postJson<SimulationState>(`/api/simulation/traffic${simQuery(scenarioId)}`, {
    node_id: nodeId,
    profile,
  });
}

export function fetchTrafficProfiles(): Promise<{ default: string; profiles: TrafficProfile[] }> {
  return fetchJson("/api/simulation/traffic-profiles");
}

export function fetchPolicies(): Promise<{ policies: string[]; default_weights: Record<string, number> }> {
  return fetchJson("/api/policies");
}

export function fetchScenarios(): Promise<ScenarioSummary[]> {
  return fetchJson<ScenarioSummary[]>("/api/scenarios");
}

export function fetchScenario(id: string): Promise<ScenarioDetail> {
  return fetchJson<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(id)}`);
}

export function createScenario(name: string, environment: string, topology: Topology): Promise<ScenarioDetail> {
  return postJson<ScenarioDetail>("/api/scenarios", { name, environment, topology });
}

export function updateScenario(id: string, name: string, environment: string, topology: Topology, expected_version: number): Promise<ScenarioDetail> {
  return putJson<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(id)}`, { name, environment, topology, expected_version });
}

export function duplicateScenario(id: string, name?: string): Promise<ScenarioDetail> {
  return postJson<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(id)}/duplicate`, { name });
}

export function patchScenarioNode(
  sid: string,
  nid: string,
  patch: {
    label?: string; device_id?: string | null; ports?: NodePortConfig[];
    world_position?: { x_km: number; y_km: number; altitude_m: number } | null;
  },
): Promise<ScenarioDetail> {
  return patchJson<ScenarioDetail>(
    `/api/scenarios/${encodeURIComponent(sid)}/nodes/${encodeURIComponent(nid)}`,
    patch,
  );
}

export function patchScenarioLink(
  sid: string,
  lid: string,
  patch: {
    label?: string | null; status?: string; source_port?: string | null; target_port?: string | null;
    protocols?: string[]; security?: LinkSecurityConfig | null; experimental?: boolean;
  },
): Promise<ScenarioDetail> {
  return patchJson<ScenarioDetail>(
    `/api/scenarios/${encodeURIComponent(sid)}/links/${encodeURIComponent(lid)}`,
    patch,
  );
}

export function fetchLinkPhysics(sid: string, lid: string): Promise<LinkPhysics> {
  return fetchJson<LinkPhysics>(
    `/api/scenarios/${encodeURIComponent(sid)}/links/${encodeURIComponent(lid)}/physics`,
  );
}

export interface LabEquation {
  name: string;
  formula: string;
  substitution: string;
}

export interface LabOutput {
  key: string;
  label: string;
  value: number | string;
  unit: string;
}

export interface LabResult {
  experiment: string;
  fidelity: string;
  inputs: Record<string, unknown>;
  outputs: LabOutput[];
  equations: LabEquation[];
  assumptions: string[];
  refs: { label: string; detail: string }[];
  notes: string[];
}

export function runPhysicsLab(
  endpoint: "copper" | "optical" | "fiber" | "radio" | "satellite" | "quantum/teleport" | "quantum/bb84",
  params: Record<string, unknown>,
): Promise<LabResult> {
  return postJson<LabResult>(`/api/physics/${endpoint}`, params);
}

export interface MessageHop {
  link_id: string;
  from_id: string;
  from_label: string;
  to_id: string;
  to_label: string;
  technology: string;
  medium: string;
  latency_ms: number;
  bandwidth_mbps: number;
  distance_km: number | null;
  security: string;
}

export interface MessageRecord {
  id: string;
  scenario_id: string;
  source_id: string;
  source_label: string;
  dest_id: string;
  dest_label: string;
  kind: string;
  size_kb: number;
  status: "delivered" | "failed";
  reason: string;
  hops: MessageHop[];
  path_labels: string[];
  latency_ms: number | null;
  achieved_mbps: number | null;
  transfer_ms: number | null;
  total_ms: number | null;
  cost_usd: number | null;
  reliability: number | null;
  meets_profile: boolean;
  profile_notes: string[];
  tick: number;
  sim_time_s: number;
  assumptions: string[];
}

export function sendMessage(body: {
  scenario_id: string;
  source_id: string;
  dest_id: string;
  kind: string;
  size_kb?: number;
}): Promise<MessageRecord> {
  return postJson<MessageRecord>("/api/messages/send", body);
}

export function fetchMessages(scenarioId: string): Promise<{ messages: MessageRecord[] }> {
  return fetchJson<{ messages: MessageRecord[] }>(
    `/api/messages?scenario_id=${encodeURIComponent(scenarioId)}`
  );
}

export function checkPorts(
  sourcePort: NodePortConfig | null,
  targetPort: NodePortConfig | null,
  experimental = false,
): Promise<{ compatible: boolean; reason: string }> {
  return postJson("/api/compatibility/check-ports", {
    source_port: sourcePort,
    target_port: targetPort,
    experimental,
  });
}

export function deleteScenario(id: string): Promise<{ deleted: string }> {
  return deleteJson(`/api/scenarios/${encodeURIComponent(id)}`);
}

export function fetchTemplates(): Promise<{ templates: string[] }> {
  return fetchJson("/api/scenarios/templates");
}

export function scenarioFromTemplate(kind: string): Promise<ScenarioDetail> {
  return postJson<ScenarioDetail>(`/api/scenarios/from-template/${encodeURIComponent(kind)}`);
}

export function fetchHardware(params?: { category?: string; search?: string }): Promise<DeviceSpec[]> {
  const q = new URLSearchParams();
  if (params?.category) q.set("category", params.category);
  if (params?.search) q.set("search", params.search);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return fetchJson<DeviceSpec[]>(`/api/hardware${suffix}`);
}

export function fetchHardwareCategories(): Promise<{ categories: string[] }> {
  return fetchJson("/api/hardware/categories");
}

export function fetchDevice(id: string): Promise<DeviceSpec> {
  return fetchJson<DeviceSpec>(`/api/hardware/${encodeURIComponent(id)}`);
}

export function saveDevice(spec: DeviceSpec): Promise<DeviceSpec> {
  return postJson<DeviceSpec>("/api/hardware", spec);
}

export function checkDevice(spec: DeviceSpec): Promise<{ verdict: string; issues: { code?: string; message: string }[]; warnings: { code?: string; message: string }[]; note: string }> {
  return postJson("/api/hardware/check", spec);
}

export function submitFinding(submission: ResearchSubmission): Promise<ResearchFinding> {
  return postJson<ResearchFinding>("/api/research", submission);
}

export function fetchFindings(): Promise<ResearchFinding[]> {
  return fetchJson<ResearchFinding[]>("/api/research");
}

export function assessFinding(id: string): Promise<Assessment> {
  return postJson<Assessment>(`/api/research/${encodeURIComponent(id)}/assess`);
}

export function fetchAssessments(id: string): Promise<Assessment[]> {
  return fetchJson<Assessment[]>(`/api/research/${encodeURIComponent(id)}/assessments`);
}

export function reviewFinding(id: string, status: string): Promise<ResearchFinding> {
  return postJson<ResearchFinding>(`/api/research/${encodeURIComponent(id)}/review`, { status });
}

export interface AgentStatus {
  capabilities: string[];
  state: string;
  model: string;
  mode: string;
  note: string;
  provider?: string;
  base_url?: string;
  providers?: Record<string, { state: string; model: string }>;
}

export function fetchAgentStatus(): Promise<AgentStatus> {
  return fetchJson("/api/agents/status");
}

export function runAgent(capability: string, prompt: string, context?: Record<string, unknown>, useAi = true): Promise<AgentResponse> {
  return postJson<AgentResponse>("/api/agents/run", { capability, prompt, context: context ?? {}, use_ai: useAi });
}

export function verifyAgents(): Promise<{ verified: boolean; model?: string; error?: string; provider?: string }> {
  return postJson("/api/agents/verify");
}

export function assessFindingAI(id: string): Promise<Assessment> {
  return postJson<Assessment>(`/api/research/${encodeURIComponent(id)}/assess-ai`);
}

export function validateArchitecture(topology: Topology): Promise<ValidationResult> {
  return postJson<ValidationResult>("/api/architecture/validate", topology);
}

export function createHardware(spec: Record<string, unknown>): Promise<DeviceSpec> {
  return postJson<DeviceSpec>("/api/hardware", spec);
}

export function verifyProvider(provider: string): Promise<{ verified: boolean; model?: string; error?: string; provider?: string }> {
  return postJson(`/api/agents/verify/${encodeURIComponent(provider)}`);
}

// -- conversational chat -----------------------------------------------------

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  tool_calls_json: string;
  citations_json: string;
  proposal_json: string;
  provenance: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  scenario_id: string;
  capability: string;
  provider: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  messages?: ChatMessage[];
}

export interface ChatReply {
  conversation_id: string;
  capability: string;
  reply: string;
  message_id: string;
  tool_calls: { tool: string; result: unknown }[];
  citations: { doc_id: string; chunk_id: string; title: string; heading: string; page: number; snippet: string }[];
  proposal: { kind: string; data: Record<string, unknown>; explanation?: string } | null;
  provenance: string;
  provider: string;
}

export function fetchConversations(): Promise<{ conversations: Conversation[] }> {
  return fetchJson("/api/chat");
}

export function fetchConversation(id: string): Promise<Conversation> {
  return fetchJson(`/api/chat/${encodeURIComponent(id)}`);
}

export function deleteConversation(id: string): Promise<{ deleted: string }> {
  return fetchJson(`/api/chat/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface AssistantContext {
  route?: string;
  node_id?: string;
  node_label?: string;
  link_id?: string;
  link_label?: string;
  region_id?: string;
  entity_id?: string;
  entity_label?: string;
  experiment_id?: string;
}

export function sendChatMessage(body: {
  conversation_id?: string | null;
  message: string;
  scenario_id?: string;
  capability?: string | null;
  provider?: string | null;
  use_ai?: boolean;
  context?: AssistantContext | null;
}): Promise<ChatReply> {
  return postJson<ChatReply>("/api/chat", body);
}

export async function streamChatMessage(
  body: { conversation_id?: string | null; message: string; scenario_id?: string; capability?: string | null; provider?: string | null; use_ai?: boolean; context?: AssistantContext | null },
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat stream failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  const dispatch = (raw: string) => {
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        try {
          onEvent(event || "message", JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
        } catch {
          /* ignore partial frames */
        }
        event = "";
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) dispatch(part);
  }
  if (buffer.trim()) dispatch(buffer);
}

export function addChatNote(id: string, text: string): Promise<ChatMessage> {
  return postJson<ChatMessage>(`/api/chat/${encodeURIComponent(id)}/notes`, { text });
}

// -- knowledge base ----------------------------------------------------------

export interface KnowledgeDocument {
  id: string;
  title: string;
  source_type: string;
  source_ref: string;
  filename: string;
  mime: string;
  status: string;
  error: string;
  meta_json: string;
  created_at: string;
  passages?: { idx: number; heading: string; page: number; excerpt: string }[];
}

export interface KnowledgePassage {
  chunk_id: string;
  doc_id: string;
  idx: number;
  heading: string;
  page: number;
  title: string;
  source_type: string;
  source_ref: string;
  snippet: string;
  rank: number;
}

export async function uploadKnowledge(file: File, title?: string): Promise<{ id: string; title: string; chunks: number; chars: number; status: string }> {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  const res = await fetch(`${API_BASE}/api/knowledge/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as { id: string; title: string; chunks: number; chars: number; status: string };
}

export function fetchKnowledge(sourceType?: string): Promise<{ documents: KnowledgeDocument[] }> {
  return fetchJson(`/api/knowledge${sourceType ? `?source_type=${encodeURIComponent(sourceType)}` : ""}`);
}

export function searchKnowledge(q: string, limit = 6): Promise<{ query: string; passages: KnowledgePassage[] }> {
  return fetchJson(`/api/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export function fetchKnowledgeDoc(id: string): Promise<KnowledgeDocument> {
  return fetchJson(`/api/knowledge/${encodeURIComponent(id)}`);
}

export function deleteKnowledgeDoc(id: string): Promise<{ deleted: string }> {
  return fetchJson(`/api/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// -- knowledge sources -------------------------------------------------------

export interface KnowledgeSource {
  id: string;
  name: string;
  organization: string;
  url: string;
  category: string;
  data_type: string;
  access: string;
  license: string;
  trust: string;
  refresh_policy: string;
  last_checked: string;
  status: string;
  last_error: string;
  doc_count: number;
  enabled: number;
}

export function fetchSources(): Promise<{ sources: KnowledgeSource[] }> {
  return fetchJson("/api/sources");
}

export function ingestSource(id: string): Promise<{ id: string; status: string; reason?: string; doc_id?: string; chunks?: number }> {
  return postJson(`/api/sources/${encodeURIComponent(id)}/ingest`);
}

export function setSourceEnabled(id: string, enabled: boolean): Promise<KnowledgeSource> {
  return postJson(`/api/sources/${encodeURIComponent(id)}/enable`, { enabled });
}

// -- coverage research + jobs --------------------------------------------------

export interface CoverageRegion {
  id: string;
  name: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CoverageReport {
  id: string;
  region_id: string;
  region_name: string;
  gap: { class: string; summary: string; recommended_action: string };
  proposals: {
    id: string;
    title: string;
    devices: { device_id: string; found: boolean; name?: string; capex_usd?: number | null; opex_usd_per_month?: number | null }[];
    capex_usd_approx: number;
    opex_usd_per_month: number;
    coverage_gain_pp_estimate: number;
    cost_per_coverage_point_usd: number | null;
    latency_ms_estimate: number;
    capacity_mbps_estimate: number;
    feasibility_note: string;
    issues: string[];
    score: number;
    assumption: string;
  }[];
  evidence: { metric: string; value: number; source: string; note: string }[];
  confidence: string;
}

export interface ScheduledJob {
  id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  interval_seconds: number;
  enabled: number;
  last_run: string;
  next_run: string;
  last_status: string;
  last_result: Record<string, unknown>;
  created_at: string;
}

export function fetchRegions(): Promise<{ regions: CoverageRegion[] }> {
  return fetchJson("/api/coverage/regions");
}

export function analyzeRegion(id: string): Promise<CoverageReport> {
  return postJson(`/api/coverage/regions/${encodeURIComponent(id)}/analyze`);
}

export function fetchCoverageReports(regionId?: string): Promise<{ reports: { id: string; region_id: string; created_by: string; created_at: string; data: CoverageReport }[] }> {
  return fetchJson(`/api/coverage/reports${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`);
}

export function coverageProposalScenario(reportId: string, proposalId: string): Promise<{ scenario_id: string; report_id: string; proposal_id: string }> {
  return postJson(`/api/coverage/reports/${encodeURIComponent(reportId)}/proposals/${encodeURIComponent(proposalId)}/scenario`);
}

export function fetchJobs(): Promise<{ jobs: ScheduledJob[] }> {
  return fetchJson("/api/jobs");
}

export function updateJob(id: string, body: { enabled?: boolean; interval_seconds?: number; config?: Record<string, unknown> }): Promise<ScheduledJob> {
  return postJson(`/api/jobs/${encodeURIComponent(id)}`, body);
}

export function runJob(id: string): Promise<{ run_id: string; job_id: string; status: string; result: Record<string, unknown>; log: string }> {
  return postJson(`/api/jobs/${encodeURIComponent(id)}/run`);
}

export function fetchJobRuns(id: string): Promise<{ runs: { id: string; job_id: string; started_at: string; finished_at: string; status: string; log: string }[] }> {
  return fetchJson(`/api/jobs/${encodeURIComponent(id)}/runs`);
}
