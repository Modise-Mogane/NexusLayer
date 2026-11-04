"use client";

/* Stylized low-poly models for the maritime simulation world.
   Forms are built from three.js primitives composed to read as their
   subject at normal viewing distance. Satellite altitude is NOT to scale. */

export function ShipModel({ color = "#b91c1c" }: { color?: string }) {
  return (
    <group>
      {/* hull: tapered box reads as a vessel hull from above/side */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[4.2, 0.9, 1.6]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} />
      </mesh>
      {/* bow wedge: 4-sided cone laid horizontal, pointing +X */}
      <mesh position={[2.9, 0.35, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.8, 1.6, 4, 1]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} />
      </mesh>
      {/* deck */}
      <mesh position={[0, 0.85, 0]}>
        <boxGeometry args={[3.8, 0.12, 1.4]} />
        <meshStandardMaterial color="#d6d3d1" roughness={0.8} />
      </mesh>
      {/* bridge block */}
      <mesh position={[-1.1, 1.5, 0]}>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshStandardMaterial color="#f5f5f4" roughness={0.6} />
      </mesh>
      {/* bridge windows: inset dark band */}
      <mesh position={[-0.48, 1.65, 0]}>
        <boxGeometry args={[0.06, 0.4, 1.0]} />
        <meshStandardMaterial color="#0c4a6e" roughness={0.2} metalness={0.6} />
      </mesh>
      {/* mast + radar bar */}
      <mesh position={[-1.1, 2.6, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 1.2, 8]} />
        <meshStandardMaterial color="#44403c" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[-1.1, 3.1, 0]}>
        <boxGeometry args={[0.9, 0.08, 0.12]} />
        <meshStandardMaterial color="#44403c" roughness={0.6} />
      </mesh>
      {[-0.68, 0.68].map((z) => (
        <group key={z}>
          <mesh position={[0.2, 1.06, z]}><boxGeometry args={[3.1, 0.06, 0.06]} /><meshStandardMaterial color="#e8ece9" /></mesh>
          {[-0.8, 0.2, 1.2].map((x) => <mesh key={x} position={[x, 0.95, z]}><boxGeometry args={[0.05, 0.23, 0.05]} /><meshStandardMaterial color="#e8ece9" /></mesh>)}
        </group>
      ))}
      {/* funnel */}
      <mesh position={[0.4, 1.3, 0]}>
        <cylinderGeometry args={[0.28, 0.34, 0.9, 12]} />
        <meshStandardMaterial color="#1c1917" roughness={0.7} />
      </mesh>
    </group>
  );
}

export function TowerModel({ color = "#e7e5e4" }: { color?: string }) {
  return (
    <group>
      {/* Four tapered legs and cross bracing make the mast recognizable at
          close range while keeping the geometry independent of RF values. */}
      {[[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]].map(([x, z], i) => (
        <mesh key={i} position={[x * 0.55, 2.5, z * 0.55]} rotation={[z * 0.07, 0, -x * 0.07]}>
          <cylinderGeometry args={[0.065, 0.09, 5, 5]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      {[1, 2, 3, 4].map((y) => (
        <group key={y} position={[0, y, 0]}>
          {[-0.32, 0.32].map((z) => (
            <mesh key={z} position={[0, 0, z]} rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.9, 0.07, 0.07]} />
              <meshStandardMaterial color="#d85d4e" roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}
      {/* cross arms with panel antennas */}
      {[3.6, 4.2].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh>
            <boxGeometry args={[2.4, 0.12, 0.12]} />
            <meshStandardMaterial color="#57534e" roughness={0.6} metalness={0.4} />
          </mesh>
          {[-1.0, 0, 1.0].map((x) => (
            <mesh key={x} position={[x, 0.35, 0]}>
              <boxGeometry args={[0.28, 0.9, 0.18]} />
              <meshStandardMaterial color="#f5f5f4" roughness={0.5} />
            </mesh>
          ))}
        </group>
      ))}
      {/* equipment shelter */}
      <mesh position={[1.6, 0.6, 0.8]}>
        <boxGeometry args={[2.0, 1.2, 1.4]} />
        <meshStandardMaterial color="#a8a29e" roughness={0.8} />
      </mesh>
      {/* aviation warning lamp */}
      <mesh position={[0, 5.15, 0]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.6} />
      </mesh>
    </group>
  );
}

export function SatelliteModel() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[1.6, 1.6, 1.6]} />
        <meshStandardMaterial color="#d6d3d1" roughness={0.35} metalness={0.7} />
      </mesh>
      {[-2.4, 2.4].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[3.0, 0.08, 1.8]} />
          <meshStandardMaterial color="#1d4ed8" roughness={0.3} metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, -1.2, 0]}>
        <cylinderGeometry args={[0.5, 0.2, 0.8, 12]} />
        <meshStandardMaterial color="#a8a29e" roughness={0.5} metalness={0.5} />
      </mesh>
    </group>
  );
}

export function GatewayModel() {
  return (
    <group>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[2.4, 1.0, 1.8]} />
        <meshStandardMaterial color="#e7e5e4" roughness={0.7} />
      </mesh>
      {/* dish on a pedestal, tilted skyward */}
      <mesh position={[-1.6, 0.7, 0]}>
        <cylinderGeometry args={[0.15, 0.2, 1.4, 8]} />
        <meshStandardMaterial color="#78716c" roughness={0.6} />
      </mesh>
      <mesh position={[-1.6, 1.8, 0]} rotation={[0.5, 0, -0.5]}>
        <cylinderGeometry args={[1.1, 0.9, 0.18, 20]} />
        <meshStandardMaterial color="#f5f5f4" roughness={0.4} metalness={0.2} />
      </mesh>
    </group>
  );
}

export function InternetModel() {
  return (
    <group>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[3.0, 3.0, 2.2]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.7} />
      </mesh>
      {[0.7, 1.5, 2.3].map((y) => (
        <mesh key={y} position={[0, y, 1.12]}>
          <boxGeometry args={[2.6, 0.5, 0.04]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export function CarModel({ color = "#2563eb" }: { color?: string }) {
  return (
    <group>
      {/* chassis */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[3.6, 0.55, 1.7]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.5} />
      </mesh>
      {/* cabin */}
      <mesh position={[-0.2, 1.05, 0]}>
        <boxGeometry args={[1.9, 0.55, 1.5]} />
        <meshStandardMaterial color="#0f172a" roughness={0.15} metalness={0.7} />
      </mesh>
      {/* wheels */}
      {[[1.2, 0.85], [1.2, -0.85], [-1.2, 0.85], [-1.2, -0.85]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.32, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.24, 14]} />
          <meshStandardMaterial color="#1c1917" roughness={0.9} />
        </mesh>
      ))}
      {/* roof antenna fin */}
      <mesh position={[-0.9, 1.45, 0]}>
        <boxGeometry args={[0.3, 0.25, 0.08]} />
        <meshStandardMaterial color="#1c1917" roughness={0.6} />
      </mesh>
      {/* headlights */}
      {[-0.55, 0.55].map((z, i) => (
        <mesh key={i} position={[1.82, 0.5, z]}>
          <boxGeometry args={[0.06, 0.18, 0.3]} />
          <meshStandardMaterial color="#fef9c3" emissive="#fde047" emissiveIntensity={1.2} />
        </mesh>
      ))}
    </group>
  );
}

export function AircraftModel({ color = "#e2e8f0" }: { color?: string }) {
  return (
    <group>
      {/* fuselage along X */}
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.5, 0.35, 5.2, 12]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.5} />
      </mesh>
      {/* nose */}
      <mesh position={[2.9, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.5, 1.2, 12]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.5} />
      </mesh>
      {/* wings */}
      <mesh position={[0.2, -0.1, 0]}>
        <boxGeometry args={[1.4, 0.12, 7.2]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.4} metalness={0.5} />
      </mesh>
      {/* tailfin */}
      <mesh position={[-2.4, 0.7, 0]}>
        <boxGeometry args={[0.9, 1.4, 0.12]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[-2.4, 0.2, 0]}>
        <boxGeometry args={[0.8, 0.1, 2.6]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}

export function PhoneModel({ color = "#0f172a" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.7, 0]}>
        <boxGeometry args={[0.5, 0.9, 0.08]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.7, 0.05]}>
        <boxGeometry args={[0.42, 0.78, 0.02]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
}

export function PersonModel() {
  return (
    <group>
      <mesh position={[0, 0.7, 0]}>
        <capsuleGeometry args={[0.28, 0.8, 4, 10]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshStandardMaterial color="#d6a985" roughness={0.7} />
      </mesh>
    </group>
  );
}

export function LaptopModel() {
  return (
    <group>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[1.1, 0.08, 0.8]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.65, -0.36]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[1.1, 0.7, 0.06]} />
        <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.65, -0.32]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[1.0, 0.6, 0.02]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

export function AccessPointModel() {
  return (
    <group>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 2.2, 8]} />
        <meshStandardMaterial color="#78716c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.12, 16]} />
        <meshStandardMaterial color="#f5f5f4" roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.42, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

export function RouterModel({ color = "#1e293b" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[1.8, 1.2, 1.2]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {[0.35, 0.6, 0.85].map((y) => (
        <mesh key={y} position={[0, y, 0.61]}>
          <boxGeometry args={[1.5, 0.12, 0.03]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function GenericNodeModel({ color = "#64748b" }: { color?: string }) {
  return (
    <mesh position={[0, 0.5, 0]}>
      <boxGeometry args={[1.4, 1.0, 1.4]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}
