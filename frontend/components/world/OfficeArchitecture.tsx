"use client";

import React, { useMemo } from "react";
import * as THREE from "three";

export default function OfficeArchitecture() {
  // Generate procedural skyline buildings in distance
  const skylineBuildings = useMemo(() => {
    const buildings = [];
    const count = 38;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 55 + Math.random() * 25;
      const width = 6 + Math.random() * 8;
      const depth = 6 + Math.random() * 8;
      const height = 20 + Math.random() * 50;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const isGlass = Math.random() > 0.4;
      buildings.push({ id: i, x, z, width, depth, height, isGlass });
    }
    return buildings;
  }, []);

  return (
    <group>
      {/* 1. Main Luxury Corporate Office Floor (Terrazzo / Polished Finish) */}
      <mesh receiveShadow position={[0, -0.05, 0]}>
        <boxGeometry args={[44, 0.1, 34]} />
        <meshStandardMaterial
          color="#f8fafc"
          roughness={0.22}
          metalness={0.12}
        />
      </mesh>

      {/* Department Floor Carpeting Accents */}
      {/* Executive Suite (Navy Blue Wool Carpet) */}
      <mesh receiveShadow position={[0, 0.005, -10]}>
        <planeGeometry args={[14, 10]} />
        <meshStandardMaterial
          color="#1e293b"
          roughness={0.7}
          metalness={0.05}
        />
        <meshStandardMaterial attach="material" color="#0f172a" />
      </mesh>

      {/* Engineering Bay (Technical Slate Carpet) */}
      <mesh receiveShadow position={[-14, 0.005, -4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>

      {/* AI Research Lab (Purple/Indigo Carpet) */}
      <mesh receiveShadow position={[-14, 0.005, 10]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#1e1b4b" roughness={0.8} />
      </mesh>

      {/* Marketing Studio (Warm Amber Carpet) */}
      <mesh receiveShadow position={[14, 0.005, -4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#271b1e" roughness={0.8} />
      </mesh>

      {/* Sales Wing (Emerald Slate Carpet) */}
      <mesh receiveShadow position={[14, 0.005, 10]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#062e24" roughness={0.8} />
      </mesh>

      {/* Customer Success Lounge (Warm Greige Carpet) */}
      <mesh receiveShadow position={[0, 0.005, 11]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial color="#132a2f" roughness={0.8} />
      </mesh>

      {/* 2. Perimeter Floor Trim / Baseboard */}
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[44.4, 0.2, 34.4]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} wireframe={false} />
      </mesh>

      {/* 3. Ceiling Structure with Acoustic Baffles & Linear Lighting */}
      <group position={[0, 5.2, 0]}>
        {/* Ceiling Slab */}
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[44, 0.1, 34]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.9} />
        </mesh>

        {/* Acoustic Baffle Slats */}
        {Array.from({ length: 15 }).map((_, i) => (
          <mesh key={i} position={[0, -0.2, -14 + i * 2]}>
            <boxGeometry args={[42, 0.25, 0.08]} />
            <meshStandardMaterial color="#475569" roughness={0.7} />
          </mesh>
        ))}

        {/* Linear LED Troffers (Warm White Glowing Ribbons) */}
        {[-14, 0, 14].map((x, i) => (
          <group key={i} position={[x, -0.05, 0]}>
            <mesh>
              <boxGeometry args={[0.2, 0.05, 28]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
      </group>

      {/* 4. Floor-to-Ceiling Exterior Glass Facade (Curtain Walls) */}
      {/* North Glass Wall (Behind Executive Boardroom) */}
      <group position={[0, 2.6, -17]}>
        <mesh>
          <boxGeometry args={[44, 5.2, 0.1]} />
          <meshPhysicalMaterial
            color="#94a3b8"
            transmission={0.92}
            opacity={1}
            transparent
            roughness={0.05}
            ior={1.5}
            thickness={0.2}
          />
        </mesh>
        {/* Mullions */}
        {Array.from({ length: 11 }).map((_, i) => (
          <mesh key={i} position={[-20 + i * 4, 0, 0.08]}>
            <boxGeometry args={[0.12, 5.2, 0.16]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* South Glass Wall */}
      <group position={[0, 2.6, 17]}>
        <mesh>
          <boxGeometry args={[44, 5.2, 0.1]} />
          <meshPhysicalMaterial
            color="#94a3b8"
            transmission={0.92}
            opacity={1}
            transparent
            roughness={0.05}
            ior={1.5}
            thickness={0.2}
          />
        </mesh>
        {Array.from({ length: 11 }).map((_, i) => (
          <mesh key={i} position={[-20 + i * 4, 0, -0.08]}>
            <boxGeometry args={[0.12, 5.2, 0.16]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* West Glass Wall (Engineering side) */}
      <group position={[-22, 2.6, 0]}>
        <mesh>
          <boxGeometry args={[0.1, 5.2, 34]} />
          <meshPhysicalMaterial
            color="#94a3b8"
            transmission={0.92}
            opacity={1}
            transparent
            roughness={0.05}
            ior={1.5}
            thickness={0.2}
          />
        </mesh>
        {Array.from({ length: 9 }).map((_, i) => (
          <mesh key={i} position={[0.08, 0, -16 + i * 4]}>
            <boxGeometry args={[0.16, 5.2, 0.12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* East Glass Wall (Marketing/Sales side) */}
      <group position={[22, 2.6, 0]}>
        <mesh>
          <boxGeometry args={[0.1, 5.2, 34]} />
          <meshPhysicalMaterial
            color="#94a3b8"
            transmission={0.92}
            opacity={1}
            transparent
            roughness={0.05}
            ior={1.5}
            thickness={0.2}
          />
        </mesh>
        {Array.from({ length: 9 }).map((_, i) => (
          <mesh key={i} position={[-0.08, 0, -16 + i * 4]}>
            <boxGeometry args={[0.16, 5.2, 0.12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* 5. Interior Glass Partitions for Executive Boardroom */}
      <group position={[0, 1.8, -5]}>
        {/* Left glass partition */}
        <mesh position={[-4.5, 0, 0]}>
          <boxGeometry args={[5, 3.6, 0.08]} />
          <meshPhysicalMaterial
            color="#cbd5e1"
            transmission={0.88}
            transparent
            roughness={0.1}
            ior={1.45}
          />
        </mesh>
        {/* Right glass partition */}
        <mesh position={[4.5, 0, 0]}>
          <boxGeometry args={[5, 3.6, 0.08]} />
          <meshPhysicalMaterial
            color="#cbd5e1"
            transmission={0.88}
            transparent
            roughness={0.1}
            ior={1.45}
          />
        </mesh>
        {/* Center Glass Door Portal Frame */}
        <mesh position={[0, 1.8, 0]}>
          <boxGeometry args={[4, 0.1, 0.12]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Matte Black Frame Posts */}
        {[-7, -2, 2, 7].map((x, idx) => (
          <mesh key={idx} position={[x, 0, 0]}>
            <boxGeometry args={[0.1, 3.6, 0.12]} />
            <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
          </mesh>
        ))}
      </group>

      {/* 6. Architectural Structural Columns (Round White Concrete) */}
      {[
        [-8, -8],
        [8, -8],
        [-8, 4],
        [8, 4],
      ].map(([x, z], idx) => (
        <group key={idx} position={[x, 2.6, z]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.5, 0.5, 5.2, 32]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.4} />
          </mesh>
          {/* Base Trim */}
          <mesh position={[0, -2.55, 0]}>
            <cylinderGeometry args={[0.56, 0.56, 0.1, 32]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* 7. Lush Indoor Greenery & Living Wall Accent */}
      {/* Living Green Wall (West Side service divider) */}
      <group position={[-21.6, 2.2, 0]}>
        <mesh>
          <boxGeometry args={[0.2, 4.0, 10]} />
          <meshStandardMaterial color="#166534" roughness={0.9} />
        </mesh>
        {/* Clustered foliage nodules */}
        {Array.from({ length: 28 }).map((_, i) => (
          <mesh
            key={i}
            position={[
              0.15,
              -1.5 + (i % 7) * 0.5,
              -4 + Math.floor(i / 7) * 2.5 + (Math.random() * 0.4 - 0.2),
            ]}
          >
            <sphereGeometry args={[0.35 + Math.random() * 0.15, 8, 8]} />
            <meshStandardMaterial
              color={i % 2 === 0 ? "#15803d" : "#22c55e"}
              roughness={0.8}
            />
          </mesh>
        ))}
      </group>

      {/* Designer Planter Boxes with Fiddle-Leaf Figs / Tropical Office Plants */}
      {[
        [-7, 0, -5],
        [7, 0, -5],
        [-7, 0, 7],
        [7, 0, 7],
        [-1, 0, 7],
        [1, 0, 7],
      ].map(([px, py, pz], idx) => (
        <group key={idx} position={[px, 0, pz]}>
          {/* Planter Pot */}
          <mesh castShadow position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.38, 0.3, 0.9, 16]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} />
          </mesh>
          {/* Soil */}
          <mesh position={[0, 0.88, 0]}>
            <cylinderGeometry args={[0.36, 0.36, 0.05, 16]} />
            <meshStandardMaterial color="#3f2e1e" roughness={0.9} />
          </mesh>
          {/* Plant Stems & Lush Leaves */}
          <group position={[0, 0.9, 0]}>
            <mesh position={[0, 0.4, 0]}>
              <cylinderGeometry args={[0.04, 0.05, 0.8, 8]} />
              <meshStandardMaterial color="#14532d" />
            </mesh>
            {/* Broad Foliage Leaves */}
            {Array.from({ length: 6 }).map((_, lIdx) => {
              const leafAngle = (lIdx / 6) * Math.PI * 2;
              return (
                <mesh
                  key={lIdx}
                  position={[
                    Math.cos(leafAngle) * 0.25,
                    0.4 + lIdx * 0.15,
                    Math.sin(leafAngle) * 0.25,
                  ]}
                  rotation={[0.4, leafAngle, 0.5]}
                >
                  <sphereGeometry args={[0.22, 0.08, 0.35]} />
                  <meshStandardMaterial color="#16a34a" roughness={0.6} />
                </mesh>
              );
            })}
          </group>
        </group>
      ))}

      {/* 8. Distant Metropolis Skyline (Visible outside the glass curtain walls) */}
      <group position={[0, 0, 0]}>
        {skylineBuildings.map((b) => (
          <mesh key={b.id} position={[b.x, b.height / 2 - 5, b.z]}>
            <boxGeometry args={[b.width, b.height, b.depth]} />
            <meshStandardMaterial
              color={b.isGlass ? "#64748b" : "#475569"}
              metalness={b.isGlass ? 0.7 : 0.2}
              roughness={b.isGlass ? 0.2 : 0.7}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
