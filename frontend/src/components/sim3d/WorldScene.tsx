"use client";

/* Shared 3D world for all NexusLayer scenarios on the ONE persistent Port
   Meridian geography. Node positions, link states, suitability, and coverage
   all come from backend simulation state; the scene only visualizes. Overlay
   modes control visual density; labels use distance-based priority so the
   overview stays readable. A geographic engine can replace this module behind
   the same props. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import {
  AccessPointModel,
  AircraftModel,
  CarModel,
  GatewayModel,
  GenericNodeModel,
  InternetModel,
  LaptopModel,
  PersonModel,
  PhoneModel,
  RouterModel,
  SatelliteModel,
  ShipModel,
  TowerModel,
} from "@/components/sim3d/models";
import { LivingWorldEnvironment } from "@/components/sim3d/environments";
import { FALLBACK_CAMERAS, SAT_UNITS, shortLabel, type OverlayMode } from "@/components/sim3d/coordinates";
import type { SimulationState, Topology, WorldRegion } from "@/lib/api";

export const KM = 1; // 1 world unit = 1 km
const MAX_COVERAGE_RING_KM = 500;

export const MOBILE_TYPES = ["ship", "car", "vehicle", "aircraft", "train", "drone", "boat"];
const CLIENT_TYPES = ["phone", "smartphone", "tablet", "computer", "laptop", "person", "sensor", "iot", "camera"];

export interface WorldNode {
  id: string;
  label: string;
  type: string;
  pos: [number, number, number];
  onActive: boolean;
  reachable: boolean;
  /** Endpoint whose route resolution found no path (coverage-gap evidence). */
  noRoute: boolean;
  follower: boolean;
}

/** Render positions: live sim positions with co-located followers fanned out. */
export function nodePositions(
  topology: Topology,
  sim: SimulationState | null
): Map<string, [number, number, number]> {
  const states = new Map((sim?.nodes ?? []).map((n) => [n.id, n.world_position ?? null]));
  const base = new Map<string, [number, number, number]>();
  for (const n of topology.nodes) {
    const live = states.get(n.id) ?? n.world_position;
    const x = (live?.x_km ?? 0) * KM;
    const z = (live?.y_km ?? 0) * KM;
    const alt = live?.altitude_m ?? 0;
    const y = n.type === "satellite" ? SAT_UNITS : alt > 1000 ? Math.min(alt / 1000, 14) : 0;
    base.set(n.id, [x, y, z]);
  }
  // Fan out nodes sharing the same spot (onboard gear rides with its host).
  const groups = new Map<string, string[]>();
  for (const n of topology.nodes) {
    const p = base.get(n.id)!;
    const key = `${Math.round(p[0] * 2)}/${Math.round(p[2] * 2)}/${n.type === "satellite" ? "sat" : "gnd"}`;
    const list = groups.get(key) ?? [];
    list.push(n.id);
    groups.set(key, list);
  }
  const followOf = new Map(topology.nodes.map((n) => [n.id, n.mobility?.follow ?? null]));
  const out = new Map(base);
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort((a, b) => Number(!!followOf.get(a)) - Number(!!followOf.get(b)));
    sorted.forEach((id, k) => {
      if (k === 0) return; // leader keeps the true position
      const p = base.get(id)!;
      const angle = k * 2.4;
      const radius = 2.4 + Math.floor(k / 5) * 1.6;
      out.set(id, [p[0] + Math.cos(angle) * radius, p[1], p[2] + Math.sin(angle) * radius]);
    });
  }
  return out;
}

export function toWorld(
  topology: Topology,
  sim: SimulationState | null
): { nodes: WorldNode[]; mobileId: string | null } {
  const states = new Map((sim?.nodes ?? []).map((n) => [n.id, n]));
  const noRoute = new Set(
    (sim?.endpoint_routes ?? []).filter((e) => !e.route).map((e) => e.endpoint_id)
  );
  const pos = nodePositions(topology, sim);
  const nodes: WorldNode[] = topology.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    pos: pos.get(n.id) ?? [0, 0, 0],
    onActive: states.get(n.id)?.on_active_route ?? false,
    reachable: states.get(n.id)?.reachable ?? true,
    noRoute: noRoute.has(n.id),
    follower: !!n.mobility?.follow,
  }));
  const mobile = nodes.find((n) => MOBILE_TYPES.includes(n.type));
  return { nodes, mobileId: mobile?.id ?? null };
}

const LABEL_HEIGHT: Record<string, number> = {
  ship: 4.2,
  car: 2.6,
  aircraft: 3.2,
  base_station: 6.2,
  tower: 6.2,
  satellite: -3.2,
  gateway: 3.4,
  ground_station: 3.4,
  internet: 3.6,
  access_point: 3.2,
  router: 2.4,
  core: 2.4,
  phone: 2.0,
  smartphone: 2.0,
  person: 2.6,
  laptop: 2.0,
};

type LabelPriority = "high" | "medium" | "low" | "gear" | "alert";

function priorityFor(node: WorldNode, selected: boolean, onFocusRoute: boolean): LabelPriority {
  if (selected || !node.reachable || onFocusRoute) return "high";
  // No-route endpoints (coverage gap) tie with APs so geometry, not rank,
  // decides; the rural phones read next to their hotspot instead of hiding.
  if (node.noRoute) return "alert";
  // Onboard/follower gear shares its leader's spot: label only up close.
  if (node.follower) return "gear";
  if (["satellite", "base_station", "tower", "gateway", "ground_station", "internet",
       "ship", "boat", "car", "vehicle", "aircraft", "drone", "train"].includes(node.type)) return "high";
  if (["access_point", "router", "core", "switch", "edge_compute", "server"].includes(node.type)) return "medium";
  return "low";
}

/* Label arbitration: every label registers its anchor + rank; one arbiter
   per frame projects anchors to screen space and hides lower-rank labels
   whose boxes collide with accepted ones. Distance gates keep far views
   quiet (region names carry overview context); selected / unreachable /
   on-route labels always win. State flips only on change, so no per-frame
   React renders. */
interface LabelEntry {
  pos: [number, number, number];
  text: string;
  fontSize: number;
  lines: number;
  rank: number;
  always: boolean;
  gate: number;
  minGate: number;
  shown: boolean;
  setShow: (v: boolean) => void;
}

const labelRegistry = new Map<string, LabelEntry>();

/** Clear hysteresis after a discrete camera jump so gates evaluate fresh. */
function resetLabelArbitration() {
  for (const e of labelRegistry.values()) {
    if (e.shown) {
      e.shown = false;
      e.setShow(false);
    }
  }
}

function useLabelRegistration(key: string, entry: Omit<LabelEntry, "shown" | "setShow">, active: boolean) {
  // Start hidden; the arbiter reveals on the first frame (avoids far-label flash).
  const [show, setShow] = useState(false);
  const ref = useRef<LabelEntry | null>(null);
  useEffect(() => {
    if (!active) {
      labelRegistry.delete(key);
      ref.current = null;
      return;
    }
    const full: LabelEntry = { ...entry, shown: ref.current?.shown ?? false, setShow };
    ref.current = full;
    labelRegistry.set(key, full);
    return () => {
      labelRegistry.delete(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, entry.pos[0], entry.pos[1], entry.pos[2], entry.text, entry.rank, entry.always, entry.gate, entry.minGate]);
  return show;
}

function LabelArbiter() {
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const entries = [...labelRegistry.entries()];
    if (entries.length === 0) return;
    const persp = camera as THREE.PerspectiveCamera;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 50) / 2);
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const accepted: Box[] = [];
    const scored: { key: string; e: LabelEntry; sx: number; sy: number; w: number; h: number; gated: boolean; dist: number }[] = [];
    for (const [key, e] of entries) {
      tmp.set(e.pos[0], e.pos[1], e.pos[2]);
      const dist = camera.position.distanceTo(tmp);
      // Robust behind-camera test in view space (NDC z is unreliable there).
      tmp.applyMatrix4(camera.matrixWorldInverse);
      const behind = tmp.z > -0.5;
      tmp.set(e.pos[0], e.pos[1], e.pos[2]);
      tmp.project(camera);
      // Hysteresis on both gates so labels don't flicker at boundaries.
      const far = e.shown ? e.gate + 8 : e.gate;
      const near = e.shown ? e.minGate - 8 : e.minGate;
      let gated = !behind && (e.always || (dist < far && dist > near));
      const sx = (tmp.x * 0.5 + 0.5) * size.width;
      const sy = (-tmp.y * 0.5 + 0.5) * size.height;
      const pxPerUnit = dist > 0.01 ? size.height / (2 * tanHalf * dist) : 0;
      const w = e.text.length * 0.62 * e.fontSize * pxPerUnit + 22;
      const h = e.lines * e.fontSize * 1.35 * pxPerUnit + 16;
      // Cull labels hanging mostly off the viewport edge (with hysteresis).
      if (gated && !behind && !e.always) {
        const overflowX = Math.max(0, -(sx - w / 2)) + Math.max(0, sx + w / 2 - size.width);
        const overflowY = Math.max(0, -(sy - h / 2)) + Math.max(0, sy + h / 2 - size.height);
        const frac = Math.max(overflowX / w, overflowY / h);
        const limit = e.shown ? 0.5 : 0.35;
        if (frac > limit) gated = false;
      }
      scored.push({ key, e, sx, sy, w, h, gated, dist });
    }
    scored.sort((p, q) =>
      Number(q.e.always) - Number(p.e.always) || p.e.rank - q.e.rank || p.dist - q.dist
    );
    for (const s of scored) {
      let ok = s.gated;
      if (ok && !s.e.always) {
        const box: Box = { x0: s.sx - s.w / 2, y0: s.sy - s.h / 2, x1: s.sx + s.w / 2, y1: s.sy + s.h / 2 };
        ok = !accepted.some(
          (a) => box.x0 < a.x1 && box.x1 > a.x0 && box.y0 < a.y1 && box.y1 > a.y0
        );
        if (ok) accepted.push(box);
      } else if (ok) {
        accepted.push({ x0: s.sx - s.w / 2, y0: s.sy - s.h / 2, x1: s.sx + s.w / 2, y1: s.sy + s.h / 2 });
      }
      if (ok !== s.e.shown) {
        s.e.shown = ok;
        s.e.setShow(ok);
      }
    }
  });
  return null;
}

/** Rank + distance gate per priority tier (camera distance in scene units). */
function gateFor(priority: LabelPriority): { rank: number; gate: number } {
  switch (priority) {
    case "high": return { rank: 1, gate: 110 };
    case "medium": return { rank: 2, gate: 70 };
    case "alert": return { rank: 2, gate: 45 };
    case "low": return { rank: 3, gate: 45 };
    case "gear": return { rank: 4, gate: 30 };
  }
}

function SmartLabel({
  id,
  pos,
  text,
  priority,
  force,
  color = "#f8fafc",
  size = 1.25,
}: {
  id: string;
  pos: [number, number, number];
  text: string;
  priority: LabelPriority;
  force: boolean;
  color?: string;
  size?: number;
}) {
  const { rank, gate } = gateFor(priority);
  const show = useLabelRegistration(`n:${id}`, {
    pos, text, fontSize: size, lines: 1, rank, always: force, gate, minGate: 0,
  }, true);
  if (!show) return null;
  return (
    <Billboard position={pos}>
      <Text
        fontSize={size}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.08}
        outlineColor="#0f172a"
      >
        {text}
      </Text>
    </Billboard>
  );
}

function NodeMesh({
  node,
  selected,
  onFocusRoute,
  labelsOn,
  onPick,
}: {
  node: WorldNode;
  selected: boolean;
  onFocusRoute: boolean;
  labelsOn: boolean;
  onPick: (id: string) => void;
}) {
  const troubled = !node.reachable || node.noRoute;
  const color = troubled ? "#ef4444" : selected ? "#0284c7" : node.onActive ? "#2563eb" : "#e2e8f0";
  const handle = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick(node.id);
  };
  const isSat = node.type === "satellite";
  const labelColor = troubled ? "#e0a458" : "#f8fafc";
  // Deterministic height spread so co-located labels (rural phones, plaza)
  // stack vertically instead of hiding behind each other.
  let hash = 0;
  for (let i = 0; i < node.id.length; i++) hash = (hash * 31 + node.id.charCodeAt(i)) | 0;
  const jitter = (Math.abs(hash) % 8) * 1.2;
  const labelPos: [number, number, number] = [node.pos[0], node.pos[1] + (LABEL_HEIGHT[node.type] ?? 2.6) + jitter, node.pos[2]];
  return (
    <>
    <group position={node.pos} onClick={handle}>
      <group scale={isSat ? 1.3 : 1}>
        {(node.type === "ship" || node.type === "boat") && <ShipModel />}
        {(node.type === "car" || node.type === "vehicle") && <CarModel />}
        {(node.type === "aircraft" || node.type === "drone") && <AircraftModel />}
        {(node.type === "base_station" || node.type === "tower") && <TowerModel />}
        {isSat && <SatelliteModel />}
        {(node.type === "gateway" || node.type === "ground_station" || node.type === "iot_gateway") && <GatewayModel />}
        {node.type === "internet" && <InternetModel />}
        {node.type === "access_point" && <AccessPointModel />}
        {(node.type === "router" || node.type === "core" || node.type === "switch" || node.type === "edge_compute") && <RouterModel />}
        {(node.type === "phone" || node.type === "smartphone") && <PhoneModel />}
        {node.type === "person" && <PersonModel />}
        {node.type === "laptop" && <LaptopModel />}
        {![
          "ship", "boat", "car", "vehicle", "aircraft", "drone", "base_station", "tower",
          "satellite", "gateway", "ground_station", "iot_gateway", "internet", "access_point",
          "router", "core", "switch", "edge_compute", "phone", "smartphone", "person", "laptop",
        ].includes(node.type) && <GenericNodeModel />}
      </group>
      {isSat && (
        <group>
          {/* subtle schematic footprint: the satellite is NOT at true distance */}
          <mesh position={[0, -SAT_UNITS / 2, 0]}>
            <coneGeometry args={[2.2, SAT_UNITS, 24, 1, true]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.035} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[0, -SAT_UNITS + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.9, 2.2, 48]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.35} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {!isSat && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.7, 2.0, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}
      {isSat && (
        <mesh>
          <sphereGeometry args={[selected ? 0.7 : 0.5, 12, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
      {/* generous invisible hit target: thin masts are hard to click otherwise */}
      {!isSat && (
        <mesh position={[0, 2.5, 0]} onClick={handle}>
          <cylinderGeometry args={[1.4, 1.4, 5, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {isSat && (
        <mesh onClick={handle}>
          <sphereGeometry args={[2, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
    {labelsOn && (
      <SmartLabel
        id={node.id}
        pos={labelPos}
        text={isSat ? "GEO relay (schematic)" : shortLabel(node.label)}
        priority={priorityFor(node, selected, onFocusRoute)}
        force={selected}
        color={labelColor}
      />
    )}
    </>
  );
}

function Pulse({ curve, color, offset = 0 }: { curve: THREE.Curve<THREE.Vector3>; color: string; offset?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useFrame(({ clock }) => {
    if (ref.current && !reduced) {
      const t = (clock.getElapsedTime() * 0.25 + offset) % 1;
      ref.current.position.copy(curve.getPointAt(t));
    }
  });
  if (reduced) return null;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.28, 8, 8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/** Dashed wireless paths distinguish radio from solid wired links; geometry
    is disposed when topology or state changes. */
function TechnicalLine({ curve, color, opacity, wireless }: {
  curve: THREE.Curve<THREE.Vector3>; color: string; opacity: number; wireless: boolean;
}) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    const material = wireless
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 1.6, gapSize: 0.8 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const result = new THREE.Line(geometry, material);
    if (wireless) result.computeLineDistances();
    return result;
  }, [curve, color, opacity, wireless]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  return <primitive object={line} />;
}

function LinkViz({
  topology,
  world,
  sim,
  overlay,
  selectedLinkId,
  focusLinkIds,
  achievedByLink,
  onPickLink,
}: {
  topology: Topology;
  world: WorldNode[];
  sim: SimulationState | null;
  overlay: OverlayMode;
  selectedLinkId: string | null;
  focusLinkIds: Set<string> | null;
  achievedByLink: Map<string, number>;
  onPickLink: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(world.map((n) => [n.id, n.pos])), [world]);
  const states = useMemo(() => new Map((sim?.links ?? []).map((l) => [l.id, l])), [sim]);
  const nodeTypes = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n.type])), [topology]);

  if (overlay === "clean" || overlay === "coverage") return null;

  return (
    <group>
      {topology.links.map((l) => {
        const a = byId.get(l.source);
        const b = byId.get(l.target);
        if (!a || !b) return null;
        const st = states.get(l.id);
        const down = st?.status === "down";
        const unsuitable = !!st && !st.suitable;
        const active = !!st?.on_active_route;
        const backup = !!st?.on_backup_route;
        const selected = selectedLinkId === l.id;
        const focused = !!focusLinkIds?.has(l.id);

        // Overlay filtering: default views stay quiet; detail on demand.
        if (overlay === "active" && !(active || down || unsuitable || selected)) return null;
        if (overlay === "selected" && !(focused || selected)) {
          if (!focusLinkIds || focusLinkIds.size === 0) {
            if (!(active || down)) return null;
          }
          // else: faint context, styled below
        }

        let color = down ? "#dc2626" : unsuitable ? "#d97706" : active ? "#2563eb" : backup ? "#16a34a" : "#94a3b8";
        let opacity = down || unsuitable ? 0.7 : 0.95;
        const wireless = l.medium === "wireless";
        let tube = active && !wireless;
        // Pulse only the route being examined or explicit traffic; drawing two
        // moving meshes on every active link overwhelms dense world views.
        let pulses = active && (overlay === "traffic" ||
          (overlay === "selected" && (focused || !focusLinkIds || focusLinkIds.size === 0)));
        if (overlay === "topology") {
          color = "#64748b";
          opacity = selected ? 0.95 : 0.5;
          tube = false;
          pulses = false;
        } else if (overlay === "health") {
          pulses = false;
        } else if (overlay === "selected" && focusLinkIds && focusLinkIds.size > 0 && !(focused || selected)) {
          color = "#475569";
          opacity = 0.18;
          tube = false;
          pulses = false;
        }
        const bright = selected || (focused && active);
        if (bright) {
          color = "#7dd3fc";
          opacity = 1;
          if (overlay !== "topology" && overlay !== "health") pulses = true;
        }

        const lift: [number, number, number][] = [a, b].map((p) => [p[0], p[1] + 1.2, p[2]]);
        const touchesSat = nodeTypes.get(l.source) === "satellite" || nodeTypes.get(l.target) === "satellite";
        const mid: [number, number, number] = touchesSat
          ? [(lift[0][0] + lift[1][0]) / 2, Math.max(lift[0][1], lift[1][1]) + 4, (lift[0][2] + lift[1][2]) / 2]
          : [(lift[0][0] + lift[1][0]) / 2, (lift[0][1] + lift[1][1]) / 2 + 0.8, (lift[0][2] + lift[1][2]) / 2];
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(...lift[0]),
          new THREE.Vector3(...mid),
          new THREE.Vector3(...lift[1])
        );
        // Traffic mode: tube width reflects achieved fair-share rate.
        const achieved = achievedByLink.get(l.id);
        const radius = overlay === "traffic" && achieved != null
          ? 0.1 + Math.min(achieved, 100) / 100 * 0.22
          : bright ? 0.24 : 0.14;
        return (
          <group key={`${l.id}-${color}-${selected}-${focused}-${overlay}`}>
            {tube ? (
              <mesh geometry={new THREE.TubeGeometry(curve, 16, radius, 6, false)}>
                <meshBasicMaterial color={color} transparent opacity={opacity} />
              </mesh>
            ) : (
              <TechnicalLine curve={curve} color={selected ? "#7dd3fc" : color} opacity={opacity} wireless={wireless} />
            )}
            {pulses && (
              <group>
                <Pulse curve={curve} color="#7dd3fc" offset={0} />
                {(selected || focused) && <Pulse curve={curve} color="#7dd3fc" offset={0.5} />}
              </group>
            )}
            {/* invisible fat hit-proxy for link selection */}
            <mesh
              geometry={new THREE.TubeGeometry(curve, 12, 1.3, 6, false)}
              onClick={(e) => {
                e.stopPropagation();
                onPickLink(l.id);
              }}
            >
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function CoverageRings({
  topology,
  sim,
  show,
}: {
  topology: Topology;
  sim: SimulationState | null;
  show: boolean;
}) {
  const nodeTypes = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n.type])), [topology]);
  const fixed = useMemo(
    () => new Map(topology.nodes.map((n) => [n.id, !n.mobility || (!n.mobility.follow && !n.mobility.speed_kmh && !(n.mobility.velocity_x_kmh || n.mobility.velocity_y_kmh))])),
    [topology]
  );
  const world = useMemo(() => {
    const pos3 = nodePositions(topology, sim);
    const pos = new Map<string, [number, number]>();
    for (const [id, p] of pos3) pos.set(id, [p[0], p[2]]);
    return pos;
  }, [topology, sim]);
  const INFRA_ANCHOR = ["base_station", "tower", "access_point", "ground_station", "gateway"];
  if (!show) return null;
  return (
    <group>
      {(sim?.links ?? []).map((st) => {
        const radius = st.coverage_radius_km;
        if (radius == null || radius <= 0 || radius > MAX_COVERAGE_RING_KM) return null;
        const link = topology.links.find((l) => l.id === st.id);
        if (!link) return null;
        const ends = [link.source, link.target];
        // Anchor at the fixed infrastructure side (tower, not the moving modem).
        const anchor =
          ends.find((id) => fixed.get(id) && INFRA_ANCHOR.includes(nodeTypes.get(id) ?? "")) ??
          ends.find((id) => INFRA_ANCHOR.includes(nodeTypes.get(id) ?? "")) ??
          ends.find((id) => !MOBILE_TYPES.includes(nodeTypes.get(id) ?? "") && !CLIENT_TYPES.includes(nodeTypes.get(id) ?? ""));
        if (!anchor) return null;
        const p = world.get(anchor);
        if (!p) return null;
        const active = st.on_active_route;
        return (
          <group key={st.id}>
            <mesh position={[p[0], 0.04, p[1]]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[Math.max(radius - 0.35, 0.1), radius, 72]} />
              <meshBasicMaterial color={active ? "#3b82f6" : "#16a34a"} transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[p[0], 0.03, p[1]]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[radius, 72]} />
              <meshBasicMaterial color={active ? "#3b82f6" : "#16a34a"} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** One region name: overview context only, hidden at close range. Lowest
    rank, so node labels win any collision. */
function RegionLabel({ id, center, name, warn, sub }: { id: string; center: [number, number]; name: string; warn: boolean; sub: string | null }) {
  // Area tags float above terrain/buildings (never occluded) with staggered
  // heights so neighboring region names don't collide at overview.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const height = 22 + (Math.abs(hash) % 4) * 4;
  const pos: [number, number, number] = [center[0], height, center[1]];
  const show = useLabelRegistration(`r:${id}`, {
    // Underserved regions win ties: the coverage gap must read at overview.
    // (Gear labels live <30 units away; region labels >80: never compete.)
    pos, text: name, fontSize: 1.8, lines: sub ? 2 : 1, rank: warn ? 4 : 5, always: false, gate: 500, minGate: 80,
  }, true);
  if (!show) return null;
  return (
    <Billboard position={[center[0], height, center[1]]}>
      <Text
        fontSize={1.8}
        color={warn ? "#e0a458" : "#9fb3c8"}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#0b1e33"
      >
        {name}
      </Text>
      {sub && (
        <Text
          position={[0, -2, 0]}
          fontSize={1.1}
          color="#e0a458"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.04}
          outlineColor="#0b1e33"
        >
          {sub}
        </Text>
      )}
    </Billboard>
  );
}

/** Named region labels + the underserved-settlement tint (clickable). */
function RegionLayer({
  regions,
  overlay,
  onPickRegion,
}: {
  regions: WorldRegion[];
  overlay: OverlayMode;
  onPickRegion: (id: string) => void;
}) {
  const rural = regions.find((r) => r.id === "rural");
  const ruralBounds = rural?.bounds_km ?? [-48, -26, -32, -14];
  const rw = ruralBounds[2] - ruralBounds[0];
  const rd = ruralBounds[3] - ruralBounds[1];
  const rcx = (ruralBounds[0] + ruralBounds[2]) / 2;
  const rcz = (ruralBounds[1] + ruralBounds[3]) / 2;
  return (
    <group>
      {regions.map((r) => (
        <RegionLabel
          key={r.id}
          id={r.id}
          center={r.center_km}
          name={r.name}
          warn={r.coverage === "none"}
          sub={r.coverage === "none" ? "underserved — no usable coverage" : null}
        />
      ))}
      {/* underserved tint: always faintly visible, strong in coverage mode */}
      <mesh
        position={[rcx, 0.06, rcz]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onPickRegion("rural");
        }}
      >
        <planeGeometry args={[rw, rd]} />
        <meshBasicMaterial
          color="#e0a458"
          transparent
          opacity={overlay === "coverage" ? 0.25 : 0.13}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function MobileWake({ pos, kind }: { pos: [number, number, number] | null; kind: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.08 * Math.sin(t * 2);
    }
  });
  if (!pos || kind !== "ship") return null;
  return (
    <mesh ref={ref} position={[pos[0] - 3.4, 0.03, pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[3.2, 1.6]} />
      <meshBasicMaterial color="#bae6fd" transparent opacity={0.3} />
    </mesh>
  );
}

/** Placement mode: click the ground to propose a position; ghost follows. */
function PlacementPlane({ onPlace }: { onPlace: (x: number, y: number) => void }) {
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.12, -10]}
        onClick={(e) => {
          e.stopPropagation();
          onPlace(e.point.x, e.point.z);
        }}
        onPointerMove={(e) => setGhost([e.point.x, e.point.z])}
      >
        <planeGeometry args={[150, 120]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {ghost && (
        <mesh position={[ghost[0], 0.15, ghost[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.2, 1.6, 32]} />
          <meshBasicMaterial color="#2dd4bf" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function FollowRig({ target, follow }: { target: [number, number, number] | null; follow: boolean }) {
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  useFrame(() => {
    if (follow && target && controlsRef.current) {
      controlsRef.current.target.set(target[0], Math.min(target[1], 6) + 2, target[2]);
      controlsRef.current.update();
    }
  });
  return <OrbitControls ref={controlsRef as never} makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={5} maxDistance={320} />;
}

export interface ViewRequest {
  preset: string;
  nonce: number;
}

function ViewRig({ view, regions }: { view: ViewRequest | null; regions: WorldRegion[] }) {
  const { camera, controls } = useThree((s) => ({ camera: s.camera, controls: s.controls as { target: THREE.Vector3; update: () => void; addEventListener: (event: string, callback: () => void) => void; removeEventListener: (event: string, callback: () => void) => void } | null }));
  const destination = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  // A view request moves only the camera; the canonical world never moves.
  useEffect(() => {
    if (!view || !controls) return;
    const regional = regions.find((r) => r.id === view.preset || (view.preset === "coast" && r.id === "harbor"));
    const spot = regional?.camera ?? FALLBACK_CAMERAS[view.preset] ?? FALLBACK_CAMERAS.overview;
    const position = new THREE.Vector3(...spot.pos);
    const target = new THREE.Vector3(...spot.tgt);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      destination.current = null;
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    } else {
      destination.current = { position, target };
    }
    resetLabelArbitration();
    // Regional data arriving later must not unexpectedly move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.nonce, camera, controls]);

  useEffect(() => {
    if (!controls) return;
    const interrupt = () => { destination.current = null; };
    controls.addEventListener("start", interrupt);
    return () => controls.removeEventListener("start", interrupt);
  }, [controls]);

  useFrame((_, delta) => {
    const next = destination.current;
    if (!next || !controls) return;
    const amount = 1 - Math.exp(-4 * Math.min(delta, 0.1));
    camera.position.lerp(next.position, amount);
    controls.target.lerp(next.target, amount);
    controls.update();
    if (camera.position.distanceToSquared(next.position) < 0.01 &&
        controls.target.distanceToSquared(next.target) < 0.01) {
      camera.position.copy(next.position);
      controls.target.copy(next.target);
      controls.update();
      destination.current = null;
    }
  });
  return null;
}

export interface MessageFlow {
  key: string;
  nodeIds: string[];
  /** Per-hop durations in ms, proportional to modeled latency (scaled for visibility). */
  hopMs: number[];
}

/** One pulse traveling a traced message path; timing mirrors hop latencies. */
function MessageFlowViz({ flow, world }: { flow: MessageFlow; world: WorldNode[] }) {
  const ref = useRef<THREE.Mesh | null>(null);
  const start = useRef(-1);
  const [done, setDone] = useState(false);
  const pos = useMemo(() => new Map(world.map((n) => [n.id, n.pos])), [world]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || done) return;
    if (start.current < 0) start.current = clock.elapsedTime;
    const t = (clock.elapsedTime - start.current) * 1000;
    let acc = 0;
    for (let i = 0; i < flow.hopMs.length; i++) {
      const a = pos.get(flow.nodeIds[i]);
      const b = pos.get(flow.nodeIds[i + 1]);
      if (!a || !b) continue;
      if (t < acc + flow.hopMs[i]) {
        const f = Math.max(0, Math.min(1, (t - acc) / flow.hopMs[i]));
        // Lift the pulse along the same arc LinkViz uses (mid = max + 4).
        const lift = Math.max(a[1], b[1]) + 4;
        tmp.set(
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f + Math.sin(f * Math.PI) * (lift - Math.max(a[1], b[1])),
          a[2] + (b[2] - a[2]) * f
        );
        mesh.position.copy(tmp);
        mesh.visible = true;
        return;
      }
      acc += flow.hopMs[i];
    }
    mesh.visible = false;
    setDone(true);
  });
  if (done) return null;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.9, 12, 12]} />
      <meshBasicMaterial color="#2dd4bf" toneMapped={false} />
    </mesh>
  );
}

export default function WorldScene({
  topology,
  sim,
  selectedNodeId,
  selectedLinkId,
  focusLinkIds,
  messageFlow = null,
  follow,
  view,
  overlay,
  regions,
  selectedBuildingId,
  placing,
  labelsOn = true,
  onPickNode,
  onPickLink,
  onPickBuilding,
  onPickRegion,
  onPlacePoint,
}: {
  topology: Topology;
  sim: SimulationState | null;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  focusLinkIds: Set<string> | null;
  messageFlow?: MessageFlow | null;
  follow: boolean;
  view: ViewRequest | null;
  overlay: OverlayMode;
  regions: WorldRegion[];
  selectedBuildingId: string | null;
  placing: boolean;
  labelsOn?: boolean;
  onPickNode: (id: string | null) => void;
  onPickLink: (id: string | null) => void;
  onPickBuilding: (id: string | null) => void;
  onPickRegion: (id: string) => void;
  onPlacePoint: (xKm: number, yKm: number) => void;
}) {
  const { nodes, mobileId } = useMemo(() => toWorld(topology, sim), [topology, sim]);
  const mobile = nodes.find((n) => n.id === mobileId) ?? null;
  const selected = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const quality = typeof window !== "undefined" ? localStorage.getItem("nx-3d-quality") : null;
  // Keep dynamic shadows and expensive antialiasing opt-in on laptops.
  const low = quality === "low";
  const high = quality === "high";
  // Message path links join the focus set so the traced route highlights.
  const mergedFocus = useMemo(() => {
    if (!messageFlow) return focusLinkIds;
    const ids = new Set(focusLinkIds ?? []);
    const seq = messageFlow.nodeIds;
    for (const l of topology.links) {
      for (let i = 0; i + 1 < seq.length; i++) {
        if (
          (l.source === seq[i] && l.target === seq[i + 1]) ||
          (l.source === seq[i + 1] && l.target === seq[i])
        ) {
          ids.add(l.id);
        }
      }
    }
    return ids;
  }, [focusLinkIds, messageFlow, topology]);
  const focusNodeIds = useMemo(() => {
    if (!mergedFocus || !sim) return new Set<string>();
    const ids = new Set<string>();
    for (const l of topology.links) {
      if (mergedFocus.has(l.id)) {
        ids.add(l.source);
        ids.add(l.target);
      }
    }
    return ids;
  }, [mergedFocus, topology, sim]);
  const achievedByLink = useMemo(() => {
    const map = new Map<string, number>();
    for (const ep of sim?.endpoint_routes ?? []) {
      if (ep.achieved_mbps == null || !ep.route) continue;
      for (const lid of ep.route.link_ids) {
        map.set(lid, Math.max(map.get(lid) ?? 0, ep.achieved_mbps));
      }
    }
    return map;
  }, [sim]);

  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.5] : 1}
      gl={{ powerPreference: "low-power", antialias: high }}
      camera={{ position: [60, 54, 76], fov: 50 }}
      onPointerMissed={() => {
        if (placing) return;
        onPickNode(null);
        onPickLink(null);
        onPickBuilding(null);
      }}
      aria-label="3D network simulation"
    >
      <color attach="background" args={["#9bc7dd"]} />
      <fog attach="fog" args={["#9bc7dd", 190, 410]} />
      <hemisphereLight args={["#e9f8ff", "#819a77", 1.25]} />
      <directionalLight position={[40, 60, 20]} intensity={1.65} castShadow={high} shadow-mapSize={[1024, 1024]} />
      <LivingWorldEnvironment low={low} selectedBuildingId={selectedBuildingId} onPickBuilding={onPickBuilding} />
      <RegionLayer regions={regions} overlay={overlay} onPickRegion={onPickRegion} />
      <CoverageRings topology={topology} sim={sim} show={overlay === "coverage" || overlay === "health"} />
      <LinkViz
        topology={topology}
        world={nodes}
        sim={sim}
        overlay={overlay}
        selectedLinkId={selectedLinkId}
        focusLinkIds={mergedFocus}
        achievedByLink={achievedByLink}
        onPickLink={onPickLink}
      />
      {messageFlow && <MessageFlowViz key={messageFlow.key} flow={messageFlow} world={nodes} />}
      {nodes.map((n) => (
        <NodeMesh
          key={n.id}
          node={n}
          selected={selectedNodeId === n.id}
          onFocusRoute={focusNodeIds.has(n.id)}
          labelsOn={labelsOn}
          onPick={onPickNode}
        />
      ))}
      {placing && <PlacementPlane onPlace={onPlacePoint} />}
      <MobileWake pos={mobile ? mobile.pos : null} kind={mobile?.type ?? ""} />
      <FollowRig target={(selected ?? mobile)?.pos ?? null} follow={follow} />
      <ViewRig view={view} regions={regions} />
      <LabelArbiter />
    </Canvas>
  );
}
