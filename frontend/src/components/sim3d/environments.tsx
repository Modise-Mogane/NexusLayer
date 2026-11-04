"use client";

/* LivingWorldEnvironment: the ONE persistent Port Meridian geography shared by
   every simulation scenario (Stage B). City, suburb, rural settlement, harbor,
   airport, transport corridors, coastline and offshore all coexist in the
   unified km frame (see sim3d/coordinates.ts + backend/app/region.py); picking
   a scenario moves the camera and activity focus, never the landscape.

   All geometry is original procedural work (no third-party assets). Decorative
   props (trees, hills, parked vehicles) are static scenery; every networked
   entity renders from backend simulation state in WorldScene. */

import { useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AircraftModel, CarModel, PersonModel, ShipModel } from "@/components/sim3d/models";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface InstanceItem {
  pos: [number, number, number];
  scale?: [number, number, number];
  rotY?: number;
  color?: string;
}

function Instanced({
  geometry,
  material,
  items,
  castShadow,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: InstanceItem[];
  castShadow?: boolean;
}) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, items.length);
    const dummy = new THREE.Object3D();
    items.forEach((it, i) => {
      dummy.position.set(...it.pos);
      dummy.rotation.set(0, it.rotY ?? 0, 0);
      dummy.scale.set(...(it.scale ?? [1, 1, 1]));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (it.color) m.setColorAt(i, new THREE.Color(it.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = !!castShadow;
    m.frustumCulled = false;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, material, items.length]);
  useLayoutEffect(() => () => mesh.dispose(), [mesh]);
  if (items.length === 0) return null;
  return <primitive object={mesh} />;
}

/** Deterministic window-grid facade painted on canvas (no image assets). */
function facadeTexture(base: string, glass: string, lit: string, cols: number, rows: number, seed: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(seed);
  const cw = 128 / cols;
  const rh = 128 / rows;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      g.fillStyle = rnd() < 0.22 ? lit : glass;
      g.fillRect(x * cw + cw * 0.2, y * rh + rh * 0.22, cw * 0.6, rh * 0.56);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* selectable key buildings                                            */
/* ------------------------------------------------------------------ */

export interface BuildingInfo {
  id: string;
  name: string;
  kind: string;
  pos: [number, number, number];
  blurb: string;
  nodeIds: string[];
}

export const BUILDINGS: BuildingInfo[] = [
  {
    id: "bld-datacenter",
    name: "Meridian Data Center",
    kind: "data center",
    pos: [-11.5, 0, -14],
    blurb: "Aggregation core and internet exchange for the region. Hosts core-1 and the internet uplink.",
    nodeIds: ["core-1", "internet-1"],
  },
  {
    id: "bld-port-office",
    name: "Harbor Master's Office",
    kind: "port building",
    pos: [6.8, 0, -2.8],
    blurb: "Port operations with maritime antennas and the harbor VSAT terminal.",
    nodeIds: ["sat-ground"],
  },
  {
    id: "bld-terminal",
    name: "Airport Terminal",
    kind: "terminal",
    pos: [44, 0, -7],
    blurb: "Passenger terminal with fiber-fed Wi-Fi and the control tower.",
    nodeIds: ["airport-ap"],
  },
  {
    id: "bld-school",
    name: "Saltmeadow School",
    kind: "school",
    pos: [-41.5, 0, -18.6],
    blurb: "Rural school hosting the settlement's only hotspot. No backhaul uplink exists.",
    nodeIds: ["rural-ap", "rural-phone-1", "rural-phone-2"],
  },
  {
    id: "bld-clinic",
    name: "Saltmeadow Clinic",
    kind: "clinic",
    pos: [-38, 0, -22.8],
    blurb: "Rural clinic. Telemedicine is impossible without a usable connection.",
    nodeIds: [],
  },
];

/* ------------------------------------------------------------------ */
/* ground, water, coastline                                            */
/* ------------------------------------------------------------------ */

function Ground() {
  const coast = useMemo<[number, number][]>(() => [[-75, 0], [-62, 1], [-51, -0.5], [-40, 1.3], [-30, -0.5], [-19, 0.7], [-10, 0], [0, 0], [10, 0], [20, 1.5], [30, 0], [40, 1], [52, 0], [63, 1.4], [75, 0]], []);
  const shore = useMemo(() => {
    // Scenery never changes positions or distances used by the simulation.
    const shape = new THREE.Shape();
    shape.moveTo(-75, 100);
    shape.lineTo(75, 100);
    for (const [x, z] of [...coast].reverse()) shape.lineTo(x, -z);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [coast]);
  const beach = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(coast[0][0], -coast[0][1]);
    for (const [x, z] of coast.slice(1)) shape.lineTo(x, -z);
    for (const [x, z] of [...coast].reverse()) shape.lineTo(x, -z - 1.4);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [coast]);
  useEffect(() => () => { shore.dispose(); beach.dispose(); }, [shore, beach]);
  return (
    <group>
      {/* An inexpensive material keeps integrated GPUs responsive. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 59]}>
        <planeGeometry args={[150, 128]} />
        <meshStandardMaterial color="#237d9a" roughness={0.42} metalness={0.22} />
      </mesh>
      <mesh geometry={shore} position={[0, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#72965d" roughness={1} />
      </mesh>
      {/* harbor inlet water */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1, -0.02, 3]} receiveShadow>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color="#2d8eaa" roughness={0.5} metalness={0.18} />
      </mesh>
      <mesh geometry={beach} position={[0, 0.02, 0]}>
        <meshStandardMaterial color="#e3d3a7" roughness={1} />
      </mesh>
      {/* city concrete pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-5, 0.015, -8]} receiveShadow>
        <planeGeometry args={[22, 16]} />
        <meshStandardMaterial color="#a9b9ba" roughness={0.95} />
      </mesh>
      {/* town-square plaza pad (hosts town wifi + pedestrians) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.04, -2]}>
        <planeGeometry args={[5, 3]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.9} />
      </mesh>
      {/* airport tarmac pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[43, 0.015, -4]} receiveShadow>
        <planeGeometry args={[22, 12]} />
        <meshStandardMaterial color="#78716c" roughness={0.95} />
      </mesh>
      {/* rural fields */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-44.5, 0.015, -24.8]}>
        <planeGeometry args={[7, 2.5]} />
        <meshStandardMaterial color="#a3a35c" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-34.5, 0.015, -24.8]}>
        <planeGeometry args={[7, 2.5]} />
        <meshStandardMaterial color="#7a8c4f" roughness={1} />
      </mesh>
      {/* farm plots along the corridor south verge */}
      {[[-8, -18], [8, -18], [24, -24]].map(([x, z], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, z]}>
          <planeGeometry args={[10, 3]} />
          <meshStandardMaterial color={i % 2 ? "#8a9455" : "#a3a35c"} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/* Scenic water and a harbor crossing. These are landscape only: network
   routes and device positions continue to come exclusively from topology. */
function CoastalDetail({ low }: { low: boolean }) {
  const waves = useMemo(() => {
    const random = mulberry32(621);
    return Array.from({ length: low ? 90 : 210 }, () => ({
      pos: [-70 + random() * 140, 0.015, 8 + random() * 105] as [number, number, number],
      scale: [0.4 + random() * 2.8, 1, 1] as [number, number, number],
    }));
  }, [low]);
  const waveGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 0.055);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }, []);
  const waveMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#b0e6e8", transparent: true, opacity: 0.48, depthWrite: false,
  }), []);
  const reducedMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useFrame(({ clock }) => {
    if (!reducedMotion) waveMaterial.opacity = 0.38 + Math.sin(clock.elapsedTime * 0.45) * 0.08;
  });
  return (
    <group>
      <Instanced geometry={waveGeometry} material={waveMaterial} items={waves} />
      {/* A low bridge adds a clear harbor-scale landmark without representing a link. */}
      <group position={[-1, 0, 5.8]}>
        <mesh position={[0, 1.55, 0]}>
          <boxGeometry args={[26, 0.45, 2.2]} />
          <meshStandardMaterial color="#aabcc3" roughness={0.8} />
        </mesh>
        {[-10, -5, 0, 5, 10].map((x) => (
          <mesh key={x} position={[x, 0.68, 0]}>
            <boxGeometry args={[0.65, 1.4, 1.6]} />
            <meshStandardMaterial color="#d0d5c9" roughness={0.85} />
          </mesh>
        ))}
        {[-12, 12].map((x) => (
          <mesh key={x} position={[x, 0.8, -2.7]} rotation={[-0.22, 0, 0]}>
            <boxGeometry args={[2.2, 0.3, 5.5]} />
            <meshStandardMaterial color="#aabcc3" roughness={0.8} />
          </mesh>
        ))}
        {[-0.9, 0.9].map((z) => (
          <mesh key={z} position={[0, 1.95, z]}>
            <boxGeometry args={[26, 0.08, 0.08]} />
            <meshStandardMaterial color="#e4e5d9" />
          </mesh>
        ))}
      </group>
      {/* Offshore islets are scenic and do not imply service coverage. */}
      {[[-36, 30, 6], [31, 42, 4.5]].map(([x, z, r]) => (
        <group key={x} position={[x, -0.1, z]}>
          <mesh scale={[1.5, 0.18, 0.7]}>
            <sphereGeometry args={[r, 12, 6]} />
            <meshStandardMaterial color="#a7b68b" roughness={1} />
          </mesh>
          <mesh position={[0, 0.7, 0]} scale={[1.1, 0.35, 0.6]}>
            <sphereGeometry args={[r * 0.7, 12, 6]} />
            <meshStandardMaterial color="#638c63" roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* roads + railway                                                     */
/* ------------------------------------------------------------------ */

function Roads({ low }: { low: boolean }) {
  const dashes = useMemo(() => {
    const items: InstanceItem[] = [];
    for (let x = -30; x <= 34; x += 4) items.push({ pos: [x, 0.05, -6] });
    for (let x = -30; x <= 34; x += 8) items.push({ pos: [x, 0.05, -12], scale: [0.8, 1, 0.8] });
    // city streets: dashes along 2 avenues
    for (let z = -15; z <= -9; z += 3) {
      items.push({ pos: [-7, 0.05, z], rotY: Math.PI / 2 });
      items.push({ pos: [1, 0.05, z], rotY: Math.PI / 2 });
    }
    return items;
  }, []);
  const sleepers = useMemo(() => {
    const items: InstanceItem[] = [];
    for (let x = -30; x <= 34; x += 0.9) items.push({ pos: [x, 0.03, -9.5] });
    return items;
  }, []);
  const dashGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1.8, 0.18);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const dashMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#e7e5e4" }), []);
  const sleeperGeo = useMemo(() => new THREE.BoxGeometry(0.5, 0.06, 1.8), []);
  const sleeperMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#57534e", roughness: 1 }), []);
  return (
    <group>
      {/* corridor road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.03, -6]} receiveShadow>
        <planeGeometry args={[64, 4]} />
        <meshStandardMaterial color="#292524" roughness={0.95} />
      </mesh>
      {/* westfield road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.03, -12]} receiveShadow>
        <planeGeometry args={[64, 3]} />
        <meshStandardMaterial color="#33302c" roughness={0.95} />
      </mesh>
      {/* city avenues */}
      {[-7, 1].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.04, -12]} receiveShadow>
          <planeGeometry args={[2.2, 7]} />
          <meshStandardMaterial color="#292524" roughness={0.95} />
        </mesh>
      ))}
      {/* rural dirt road + connector to westfield */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-38, 0.03, -20]}>
        <planeGeometry args={[20, 3]} />
        <meshStandardMaterial color="#a08c6a" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-29, 0.03, -16]}>
        <planeGeometry args={[2.5, 8]} />
        <meshStandardMaterial color="#a08c6a" roughness={1} />
      </mesh>
      {/* quay road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1, 0.04, -1]}>
        <planeGeometry args={[16, 2.4]} />
        <meshStandardMaterial color="#44403c" roughness={0.95} />
      </mesh>
      {/* railway: twin rails + sleepers */}
      {[-9.9, -9.1].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.035, z]}>
          <planeGeometry args={[64, 0.14]} />
          <meshStandardMaterial color="#9aa4b2" roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
      <Instanced geometry={dashGeo} material={dashMat} items={dashes} />
      {!low && <Instanced geometry={sleeperGeo} material={sleeperMat} items={sleepers} />}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* city + suburb districts (instanced, facade textures)                */
/* ------------------------------------------------------------------ */

const OFFICES: [number, number, number][] = [
  // x, z, height
  [-12, -10.5, 10], [-8, -9.5, 13], [-4, -10, 9], [0, -9.5, 12],
  [-6, -14.5, 8], [-2, -14, 9], [-17, -15.5, 12], [4.5, -16, 10],
  [-16.5, -20, 8], [-10, -19.5, 11], [-4, -20, 8], [1.5, -20, 12],
];
const RESIDENTIAL: [number, number, number][] = [
  [-14, -9.5, 4], [-11, -9.5, 3.5], [-5, -12.5, 4], [-1, -11, 3.5], [2, -15, 4],
];
const SHOPS: [number, number][] = [
  [-14, -1.5], [-10, -1.5], [-6, -1.5], [-2, -1.5], [2, -1.5], [24, -1.8],
];
const HOUSES: [number, number, number][] = [
  // x, z, rotY
  [13.5, -14.8, 0.1], [16.5, -14.8, -0.08], [20, -14.8, 0.05], [23.5, -14.8, 0],
  [27, -14.8, -0.05], [12, -2, 0], [16, -2, 0.06], [21.5, -2, -0.04],
  [25, -2, 0.03], [28, -2, 0], [-43, -17, 0.1], [-41, -17, -0.06],
  [-39, -17, 0.04], [-37, -17, 0], [-44, -23, -0.08], [-42, -23, 0.05],
  [-34, -23, 0],
];
const HOUSE_COLORS = ["#c9b8a3", "#b7c0c9", "#cbb9a0", "#b0a89c", "#c4b2b2"];
const ROOF_COLORS = ["#5b4a3f", "#374151", "#6b3f36", "#4a5568"];

function Districts({ low }: { low: boolean }) {
  const officeTex = useMemo(
    () => facadeTexture("#8fa3b8", "#1e3a4c", "#f5d98b", 6, 10, 11),
    []
  );
  const resTex = useMemo(
    () => facadeTexture("#b8a88f", "#2c3a45", "#f5d98b", 5, 5, 23),
    []
  );
  const shopTex = useMemo(
    () => facadeTexture("#7d8ca3", "#16283a", "#ffe9b8", 6, 2, 37),
    []
  );
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const roofGeo = useMemo(() => new THREE.CylinderGeometry(0.01, 0.78, 1, 4, 1), []);
  const officeMat = useMemo(() => new THREE.MeshStandardMaterial({ map: officeTex, roughness: 0.6 }), [officeTex]);
  const resMat = useMemo(() => new THREE.MeshStandardMaterial({ map: resTex, roughness: 0.85 }), [resTex]);
  const shopMat = useMemo(() => new THREE.MeshStandardMaterial({ map: shopTex, roughness: 0.8 }), [shopTex]);
  const houseMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), []);
  const roofCapMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b8cbd1", roughness: 0.85 }), []);
  const roofMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), []);

  const offices: InstanceItem[] = OFFICES.map(([x, z, h], i) => ({
    pos: [x, h / 2, z],
    scale: [3 + (i % 3), h, 3 + ((i + 1) % 2)],
  }));
  // A compact instanced background district gives the city depth at overview
  // scale without adding individual draw calls or pretending buildings are nodes.
  const backgroundOffices: InstanceItem[] = useMemo(() => {
    const random = mulberry32(1024);
    const items: InstanceItem[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        const height = 2.5 + random() * (row === 0 ? 7 : 5);
        items.push({
          pos: [-25 + col * 5.2 + random(), height / 2, -25 - row * 4.2],
          scale: [2.5 + random(), height, 2.3 + random()],
        });
      }
    }
    return items;
  }, []);
  const residential: InstanceItem[] = RESIDENTIAL.map(([x, z, h], i) => ({
    pos: [x, h / 2, z],
    scale: [3.4, h, 3],
  }));
  const shops: InstanceItem[] = SHOPS.map(([x, z]) => ({
    pos: [x, 0.9, z],
    scale: [2.2, 1.8, 1.6],
  }));
  const bodies: InstanceItem[] = HOUSES.map(([x, z], i) => ({
    pos: [x, 0.8, z],
    scale: [2.2, 1.6, 1.9],
    rotY: HOUSES[i][2],
    color: HOUSE_COLORS[i % HOUSE_COLORS.length],
  }));
  const roofs: InstanceItem[] = HOUSES.map(([x, z], i) => ({
    pos: [x, 2.15, z],
    scale: [2.0, 1.1, 1.7],
    rotY: HOUSES[i][2] + Math.PI / 4,
    color: ROOF_COLORS[i % ROOF_COLORS.length],
  }));

  return (
    <group>
      <Instanced geometry={boxGeo} material={officeMat} items={offices} castShadow={!low} />
      <Instanced geometry={boxGeo} material={officeMat} items={backgroundOffices} castShadow={!low} />
      {/* Three stepped waterfront landmarks give the district a legible skyline. */}
      <Instanced geometry={boxGeo} material={officeMat} items={[
        { pos: [14.5, 6, -24], scale: [3.5, 12, 3.2] },
        { pos: [20, 8, -25], scale: [3.8, 16, 3.4] },
        { pos: [26, 5.5, -25], scale: [3.4, 11, 3.1] },
      ]} castShadow={!low} />
      <Instanced geometry={boxGeo} material={roofCapMat} items={[
        { pos: [14.5, 12.12, -24], scale: [3.6, 0.24, 3.3] },
        { pos: [20, 16.12, -25], scale: [3.9, 0.24, 3.5] },
        { pos: [26, 11.12, -25], scale: [3.5, 0.24, 3.2] },
        { pos: [20, 16.7, -25], scale: [1.9, 1, 1.8] },
      ]} />
      <Instanced geometry={boxGeo} material={roofCapMat} items={[...offices, ...backgroundOffices].map((item) => ({
        pos: [item.pos[0], item.pos[1] * 2 + 0.06, item.pos[2]],
        scale: [(item.scale?.[0] ?? 1) + 0.08, 0.12, (item.scale?.[2] ?? 1) + 0.08],
      }))} />
      <Instanced geometry={boxGeo} material={resMat} items={residential} castShadow={!low} />
      <Instanced geometry={boxGeo} material={shopMat} items={shops} castShadow={!low} />
      <Instanced geometry={boxGeo} material={houseMat} items={bodies} castShadow={!low} />
      <Instanced geometry={roofGeo} material={roofMat} items={roofs} castShadow={!low} />
      {/* suburban school + yard */}
      <mesh position={[9, 1, -14.8]} castShadow={!low}>
        <boxGeometry args={[6, 2, 3]} />
        <meshStandardMaterial color="#b3543f" roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[9, 0.03, -16.8]}>
        <planeGeometry args={[7, 2]} />
        <meshStandardMaterial color="#7a8c4f" roughness={1} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* harbor                                                              */
/* ------------------------------------------------------------------ */

function Harbor({ low }: { low: boolean }) {
  const piles = useMemo(() => {
    const items: InstanceItem[] = [];
    for (const px of [-5, 3]) {
      for (let z = 0.5; z <= 4.5; z += 1) {
        items.push({ pos: [px - 0.7, -0.3, z] });
        items.push({ pos: [px + 0.7, -0.3, z] });
      }
    }
    return items;
  }, []);
  const pileGeo = useMemo(() => new THREE.CylinderGeometry(0.09, 0.09, 1.4, 6), []);
  const pileMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#4a3f35", roughness: 1 }), []);
  const containers = useMemo(() => {
    const rnd = mulberry32(99);
    const cols = ["#b3543f", "#3f6fb5", "#4d8c5a", "#c2a44a", "#7a6fc0"];
    const items: InstanceItem[] = [];
    for (let i = 0; i < 18; i++) {
      items.push({
        pos: [-8.5 + (i % 6) * 1.3, 0.55 + Math.floor(i / 12) * 1.1, -0.5 + Math.floor((i % 12) / 6) * 1.4],
        color: cols[Math.floor(rnd() * cols.length)],
      });
    }
    return items;
  }, []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1.2, 1, 1.2), []);
  const boxMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }), []);
  return (
    <group>
      {/* breakwater arms */}
      <mesh position={[-11, 0.4, 6]} rotation={[0, 0.35, 0]} castShadow={!low}>
        <boxGeometry args={[1.6, 1.2, 10]} />
        <meshStandardMaterial color="#6b7280" roughness={1} />
      </mesh>
      <mesh position={[9, 0.4, 6]} rotation={[0, -0.35, 0]} castShadow={!low}>
        <boxGeometry args={[1.6, 1.2, 10]} />
        <meshStandardMaterial color="#6b7280" roughness={1} />
      </mesh>
      {/* piers */}
      {[-5, 3].map((x) => (
        <mesh key={x} position={[x, 0.35, 2.2]} castShadow={!low} receiveShadow>
          <boxGeometry args={[1.8, 0.3, 5]} />
          <meshStandardMaterial color="#8a7f70" roughness={0.95} />
        </mesh>
      ))}
      <Instanced geometry={pileGeo} material={pileMat} items={piles} />
      {/* portal cranes */}
      {[[-7.5, -0.5], [5.5, -0.5]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {[[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]].map(([lx, lz], j) => (
            <mesh key={j} position={[lx, 2, lz]} castShadow={!low}>
              <boxGeometry args={[0.25, 4, 0.25]} />
              <meshStandardMaterial color="#c2a44a" roughness={0.6} metalness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 4.1, 0]} castShadow={!low}>
            <boxGeometry args={[2.4, 0.3, 2]} />
            <meshStandardMaterial color="#c2a44a" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, 3.2, 1.6]}>
            <boxGeometry args={[0.12, 1.6, 0.12]} />
            <meshStandardMaterial color="#44403c" roughness={0.8} />
          </mesh>
        </group>
      ))}
      <Instanced geometry={boxGeo} material={boxMat} items={containers} castShadow={!low} />
      {/* channel buoys (clear of the sea lanes) */}
      {[[-6, 8], [2, 10], [8, 8]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.4, 0]}>
            <coneGeometry args={[0.3, 1, 8]} />
            <meshStandardMaterial color={i % 2 ? "#16a34a" : "#dc2626"} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1, 0]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial color="#fef9c3" emissive="#fde047" emissiveIntensity={1.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* airport                                                             */
/* ------------------------------------------------------------------ */

function Airport({ low }: { low: boolean }) {
  const bars = useMemo(() => {
    const items: InstanceItem[] = [];
    for (const x of [35.5, 50.5]) {
      for (let dz = -1; dz <= 1; dz += 0.5) items.push({ pos: [x, 0.05, -1 + dz], scale: [0.5, 1, 0.35] });
    }
    for (let x = 37; x <= 50; x += 2) items.push({ pos: [x, 0.05, -1], scale: [0.6, 1, 0.18] });
    return items;
  }, []);
  const barGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1.6, 0.3);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const barMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#f5f5f4" }), []);
  const fence = useMemo(() => {
    const items: InstanceItem[] = [];
    for (let x = 33; x <= 53; x += 2) {
      items.push({ pos: [x, 0.5, 2.5] });
      items.push({ pos: [x, 0.5, -10.5] });
    }
    return items;
  }, []);
  const fenceGeo = useMemo(() => new THREE.BoxGeometry(0.12, 1, 0.12), []);
  const fenceMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#78716c", roughness: 0.8 }), []);
  return (
    <group>
      {/* runway + taxiway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[43, 0.03, -1]} receiveShadow>
        <planeGeometry args={[18, 3]} />
        <meshStandardMaterial color="#292524" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[43, 0.03, -4.5]} receiveShadow>
        <planeGeometry args={[18, 2]} />
        <meshStandardMaterial color="#44403c" roughness={0.95} />
      </mesh>
      <Instanced geometry={barGeo} material={barMat} items={bars} />
      {/* control tower */}
      <mesh position={[49.5, 3, -7]} castShadow={!low}>
        <cylinderGeometry args={[0.5, 0.7, 6, 10]} />
        <meshStandardMaterial color="#a8a29e" roughness={0.8} />
      </mesh>
      <mesh position={[49.5, 6.4, -7]} castShadow={!low}>
        <cylinderGeometry args={[1.1, 0.8, 0.9, 10]} />
        <meshStandardMaterial color="#0f2f42" roughness={0.3} metalness={0.4} />
      </mesh>
      {/* hangars: walls + pyramid roof + dark door face */}
      {[[34.5, -8.5], [38, -8.5]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.8, 0]} castShadow={!low}>
            <boxGeometry args={[3.4, 1.6, 3]} />
            <meshStandardMaterial color="#7d8ca3" roughness={0.7} metalness={0.2} />
          </mesh>
          <mesh position={[0, 2.2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow={!low}>
            <cylinderGeometry args={[0.01, 2.5, 1.2, 4, 1]} />
            <meshStandardMaterial color="#5b6b7d" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.8, 1.52]}>
            <planeGeometry args={[2.6, 1.4]} />
            <meshStandardMaterial color="#1c1917" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* windsock */}
      <mesh position={[52.5, 1.5, -4]}>
        <cylinderGeometry args={[0.05, 0.05, 3, 6]} />
        <meshStandardMaterial color="#78716c" roughness={0.7} />
      </mesh>
      <mesh position={[52.9, 2.8, -4]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.25, 1.2, 8]} />
        <meshStandardMaterial color="#ea580c" roughness={0.7} />
      </mesh>
      <Instanced geometry={fenceGeo} material={fenceMat} items={fence} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* vegetation + hills                                                  */
/* ------------------------------------------------------------------ */

function Vegetation({ low }: { low: boolean }) {
  const { trunks, canopies, broadleaf } = useMemo(() => {
    const rnd = mulberry32(7);
    const trunks: InstanceItem[] = [];
    const canopies: InstanceItem[] = [];
    const broadleaf: InstanceItem[] = [];
    // keep-out: water, roads, rail, runway, buildings, node pads (approx pads)
    const clearOf = (x: number, z: number) => {
      if (z > -0.5) return false;
      if (Math.abs(z + 6) < 2.6) return false;
      if (Math.abs(z + 9.5) < 1.2) return false;
      if (Math.abs(z + 12) < 2) return false;
      if (x > 32 && x < 54 && z > -11 && z < 3) return false;
      if (x > -48 && x < -28 && z > -22 && z < -18) return false;
      for (const [bx, bz] of [[-6, -3], [2, -2], [4, -10], [20, -4], [42, -6.5], [-40, -20], [-10, -6], [-15, -20], [15, -20], [25, -20]]) {
        if (Math.hypot(x - bx, z - bz) < 2.2) return false;
      }
      return true;
    };
    let guard = 0;
    const target = low ? 70 : 170;
    while (trunks.length < target && guard++ < 4000) {
      const x = -70 + rnd() * 140;
      const z = -70 + rnd() * 68;
      if (!clearOf(x, z)) continue;
      const s = 0.8 + rnd() * 0.9;
      trunks.push({ pos: [x, 0.8 * s, z], scale: [s, s, s] });
      const crown: InstanceItem = {
        pos: [x, 2.4 * s, z],
        scale: [s, s, s],
        color: rnd() < 0.5 ? "#34784c" : "#55925c",
      };
      (trunks.length % 3 === 0 ? broadleaf : canopies).push(crown);
    }
    return { trunks, canopies, broadleaf };
  }, [low]);
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6), []);
  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#57534e", roughness: 1 }), []);
  const canopyGeo = useMemo(() => new THREE.ConeGeometry(1.1, 2.4, 8), []);
  const canopyMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 1 }), []);
  const broadleafGeo = useMemo(() => new THREE.IcosahedronGeometry(1.15, 1), []);
  const hills: [number, number, number, number][] = [
    // x, z, radius, height
    [-58, -28, 12, 6], [-55, -55, 14, 8], [0, -70, 16, 9],
    [40, -60, 13, 7], [62, -30, 12, 6], [-62, -10, 10, 5],
  ];
  return (
    <group>
      <Instanced geometry={trunkGeo} material={trunkMat} items={trunks} />
      <Instanced geometry={canopyGeo} material={canopyMat} items={canopies} castShadow={!low} />
      <Instanced geometry={broadleafGeo} material={canopyMat} items={broadleaf} castShadow={!low} />
      {hills.map(([x, z, r, h], i) => (
        <mesh key={i} position={[x, h / 2 - 0.5, z]}>
          <coneGeometry args={[r, h, 7]} />
          <meshStandardMaterial color={i % 2 ? "#4d6b3c" : "#55703f"} roughness={1} />
        </mesh>
      ))}
      {/* distant offshore silhouettes: depth cue, static scenery */}
      {[[-30, 75], [25, 85]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.8, z]}>
          <boxGeometry args={[6, 1.6, 1.8]} />
          <meshStandardMaterial color="#24384a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* key buildings (selectable)                                          */
/* ------------------------------------------------------------------ */

function KeyBuildings({
  selectedId,
  onPick,
}: {
  selectedId: string | null;
  onPick: (id: string | null) => void;
}) {
  const defs: Record<string, { size: [number, number, number]; color: string; roof?: string }> = {
    "bld-datacenter": { size: [5, 2.5, 4], color: "#5b6b7d" },
    "bld-port-office": { size: [3, 2, 2.5], color: "#a89c86" },
    "bld-terminal": { size: [8, 2.5, 3], color: "#9fb2c5" },
    "bld-school": { size: [3.4, 1.8, 2.6], color: "#b3543f" },
    "bld-clinic": { size: [2.6, 1.6, 2.2], color: "#e7e5e4" },
  };
  return (
    <group>
      {BUILDINGS.map((b) => {
        const d = defs[b.id];
        const [w, h, dep] = d.size;
        const selected = selectedId === b.id;
        return (
          <group key={b.id} position={b.pos}>
            <mesh
              position={[0, h / 2, 0]}
              castShadow
              onClick={(e) => {
                e.stopPropagation();
                onPick(b.id);
              }}
            >
              <boxGeometry args={[w, h, dep]} />
              <meshStandardMaterial
                color={d.color}
                roughness={0.8}
                emissive={selected ? "#2dd4bf" : "#000000"}
                emissiveIntensity={selected ? 0.25 : 0}
              />
            </mesh>
            {/* roof cap */}
            <mesh position={[0, h + 0.08, 0]}>
              <boxGeometry args={[w + 0.2, 0.16, dep + 0.2]} />
              <meshStandardMaterial color="#3f3f46" roughness={0.9} />
            </mesh>
            {/* rooftop mast on networked buildings */}
            {b.nodeIds.length > 0 && (
              <group position={[w / 2 - 0.4, h, 0]}>
                <mesh position={[0, 0.8, 0]}>
                  <cylinderGeometry args={[0.05, 0.06, 1.6, 6]} />
                  <meshStandardMaterial color="#78716c" roughness={0.6} />
                </mesh>
                <mesh position={[0, 1.7, 0]}>
                  <sphereGeometry args={[0.09, 8, 8]} />
                  <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.4} />
                </mesh>
              </group>
            )}
            {selected && (
              <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[Math.max(w, dep) / 2 + 0.4, Math.max(w, dep) / 2 + 0.8, 40]} />
                <meshBasicMaterial color="#2dd4bf" transparent opacity={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* water tank near the settlement */}
      <group position={[-35.5, 0, -17.5]}>
        <mesh position={[0, 2.2, 0]}>
          <cylinderGeometry args={[0.9, 0.9, 1.6, 12]} />
          <meshStandardMaterial color="#9fb2c5" roughness={0.7} />
        </mesh>
        {[[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.7, z]}>
            <boxGeometry args={[0.12, 1.4, 0.12]} />
            <meshStandardMaterial color="#57534e" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* ambient parked vehicles + pedestrians (static scenery)              */
/* ------------------------------------------------------------------ */

function Ambient() {
  return (
    <group>
      {/* docked vessels alongside the piers */}
      <group position={[-3.5, 0, 2.5]} rotation={[0, Math.PI / 2, 0]}>
        <ShipModel color="#1f4d5a" />
      </group>
      <group position={[4.5, 0, 2.8]} rotation={[0, Math.PI / 2, 0]}>
        <ShipModel color="#5a4a1f" />
      </group>
      {/* parked aircraft near the hangars */}
      <group position={[37, 0.4, -3]} rotation={[0, Math.PI / 2, 0]}>
        <AircraftModel />
      </group>
      {/* parked cars: city + suburb */}
      <group position={[-9, 0, -7.2]} rotation={[0, 0.08, 0]}>
        <CarModel color="#7c3aed" />
      </group>
      <group position={[-4, 0, -7.4]} rotation={[0, -0.05, 0]}>
        <CarModel color="#b8b0a0" />
      </group>
      <group position={[18, 0, -7.3]} rotation={[0, 0.04, 0]}>
        <CarModel color="#2f6f4f" />
      </group>
      {/* waiting pedestrians: plaza, harbor, school */}
      <group position={[1.2, 0.05, -1.4]}>
        <PersonModel />
      </group>
      <group position={[2.8, 0.05, -2.6]}>
        <PersonModel />
      </group>
      <group position={[-1, 0, 0.5]}>
        <PersonModel />
      </group>
      <group position={[-40.5, 0, -17.5]}>
        <PersonModel />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* main export                                                         */
/* ------------------------------------------------------------------ */

export function LivingWorldEnvironment({
  low,
  selectedBuildingId,
  onPickBuilding,
}: {
  low: boolean;
  selectedBuildingId: string | null;
  onPickBuilding: (id: string | null) => void;
}) {
  return (
    <group>
      <Ground />
      <CoastalDetail low={low} />
      <Roads low={low} />
      <Districts low={low} />
      <Harbor low={low} />
      <Airport low={low} />
      <Vegetation low={low} />
      <Ambient />
      <KeyBuildings selectedId={selectedBuildingId} onPick={onPickBuilding} />
    </group>
  );
}

