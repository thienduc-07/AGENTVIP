"use client";

import React, { useMemo } from "react";
import * as THREE from "three";

interface SkylineBuilding {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  isGlass: boolean;
}

export default function OfficeEnvironment() {
  // Procedural futuristic metropolis backdrop
  const skylineBuildings = useMemo<SkylineBuilding[]>(() => {
    const buildings: SkylineBuilding[] = [];
    const count = 42;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 58 + ((i * 17) % 25);
      const width = 7 + ((i * 13) % 9);
      const depth = 7 + ((i * 11) % 9);
      const height = 25 + ((i * 23) % 45);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const isGlass = i % 3 !== 0;
      buildings.push({ id: i, x, z, width, depth, height, isGlass });
    }
    return buildings;
  }, []);

  return (
    <group>
      {/* Distant Skyline Skyscrapers */}
      {skylineBuildings.map((b) => (
        <group key={b.id} position={[b.x, b.height / 2 - 4, b.z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[b.width, b.height, b.depth]} />
            <meshStandardMaterial
              color={b.isGlass ? "#0f172a" : "#1e293b"}
              roughness={b.isGlass ? 0.15 : 0.75}
              metalness={b.isGlass ? 0.85 : 0.25}
            />
          </mesh>
          {/* Subtle Window Glow Strips */}
          {b.isGlass && (
            <mesh position={[0, 0, b.depth / 2 + 0.05]}>
              <planeGeometry args={[b.width * 0.85, b.height * 0.9]} />
              <meshBasicMaterial
                color="#38bdf8"
                transparent
                opacity={0.12}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* Exterior Glass Curtain Wall / Floor-to-Ceiling Windows */}
      {/* North Window Wall */}
      <mesh position={[0, 4.5, -17.5]}>
        <boxGeometry args={[46, 9, 0.2]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.92}
          opacity={1}
          transparent
          roughness={0.08}
          ior={1.5}
          reflectivity={0.6}
        />
      </mesh>

      {/* South Window Wall */}
      <mesh position={[0, 4.5, 25.5]}>
        <boxGeometry args={[46, 9, 0.2]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.92}
          opacity={1}
          transparent
          roughness={0.08}
          ior={1.5}
          reflectivity={0.6}
        />
      </mesh>

      {/* West Window Wall */}
      <mesh position={[-23, 4.5, 4]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[43, 9, 0.2]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.92}
          opacity={1}
          transparent
          roughness={0.08}
          ior={1.5}
          reflectivity={0.6}
        />
      </mesh>

      {/* East Window Wall */}
      <mesh position={[23, 4.5, 4]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[43, 9, 0.2]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.92}
          opacity={1}
          transparent
          roughness={0.08}
          ior={1.5}
          reflectivity={0.6}
        />
      </mesh>

      {/* Architectural Window Mullions / Steel Columns */}
      {[-23, -11.5, 0, 11.5, 23].map((x, idx) => (
        <group key={`mullion-n-${idx}`} position={[x, 4.5, -17.4]}>
          <mesh castShadow>
            <boxGeometry args={[0.3, 9, 0.4]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {[-23, -11.5, 0, 11.5, 23].map((x, idx) => (
        <group key={`mullion-s-${idx}`} position={[x, 4.5, 25.4]}>
          <mesh castShadow>
            <boxGeometry args={[0.3, 9, 0.4]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

