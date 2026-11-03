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
  // Procedural futuristic metropolis backdrop scaled for a multi-floor skyscraper
  const skylineBuildings = useMemo<SkylineBuilding[]>(() => {
    const buildings: SkylineBuilding[] = [];
    const count = 48;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 75 + ((i * 17) % 35);
      const width = 10 + ((i * 13) % 12);
      const depth = 10 + ((i * 11) % 12);
      const height = 45 + ((i * 29) % 65);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const isGlass = i % 3 !== 0;
      buildings.push({ id: i, x, z, width, depth, height, isGlass });
    }
    return buildings;
  }, []);

  return (
    <group>
      {/* Distant Skyline Skyscrapers surrounding the Corporate Headquarters */}
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
          {/* Subtle Window Glow Strips on Distant Skyscrapers */}
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
    </group>
  );
}

