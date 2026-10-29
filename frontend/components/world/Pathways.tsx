"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { getGroundHeight } from "@/utils/terrainPhysics";

export default function Pathways() {
  // Stepping stones along paths, placed securely on ground using getGroundHeight
  const harborToVillageStones = useMemo(() => {
    const stones: [number, number, number, number][] = [];
    const count = 16;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = -16 + t * 6; // from Sunny pier [-16, 16] to Baratie [-10, 2]
      const z = 16 - t * 14;
      const y = getGroundHeight(x, z) + 0.05;
      const rot = (i % 2 === 0 ? 0.1 : -0.15) + Math.sin(i);
      stones.push([x, y, z, rot]);
    }
    return stones;
  }, []);

  const villageToSummitStones = useMemo(() => {
    const stones: [number, number, number, number][] = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = -10 + t * 12; // from Baratie [-10, 2] to Luffy [2, 2]
      const z = 2 + t * 0;
      const y = getGroundHeight(x, z) + 0.05;
      const rot = Math.cos(i) * 0.2;
      stones.push([x, y, z, rot]);
    }
    return stones;
  }, []);

  const summitToZoroStones = useMemo(() => {
    const stones: [number, number, number, number][] = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = 2 + t * 4; // from Luffy [2, 2] to Zoro [6, 11]
      const z = 2 + t * 9;
      const y = getGroundHeight(x, z) + 0.05;
      const rot = (i % 2 === 0 ? 0.08 : -0.1);
      stones.push([x, y, z, rot]);
    }
    return stones;
  }, []);

  const pathwayLanterns = useMemo(() => {
    const points: [number, number][] = [
      [-14, 12],
      [-11, 6],
      [-4, 2],
      [4, 6],
      [5, 9],
    ];
    return points.map(([x, z]) => ({
      pos: [x, getGroundHeight(x, z), z] as [number, number, number],
    }));
  }, []);

  return (
    <group>
      {/* --- HARBOR TO VILLAGE COBBLESTONE PATH --- */}
      {harborToVillageStones.map(([x, y, z, rot], idx) => (
        <mesh
          key={`h-v-stone-${idx}`}
          position={[x, y, z]}
          rotation={[0, rot, 0]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[1.6, 0.14, 1.0]} />
          <meshStandardMaterial color="#57534e" roughness={0.8} />
        </mesh>
      ))}

      {/* --- VILLAGE TO SUMMIT PATH --- */}
      {villageToSummitStones.map(([x, y, z, rot], idx) => (
        <mesh
          key={`v-s-stone-${idx}`}
          position={[x, y, z]}
          rotation={[0, rot, 0]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[1.6, 0.15, 1.0]} />
          <meshStandardMaterial color="#e7e5e4" roughness={0.65} />
        </mesh>
      ))}

      {/* --- SUMMIT TO ZORO PATH --- */}
      {summitToZoroStones.map(([x, y, z, rot], idx) => (
        <mesh
          key={`s-z-stone-${idx}`}
          position={[x, y, z]}
          rotation={[0, rot, 0]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[1.5, 0.14, 1.0]} />
          <meshStandardMaterial color="#44403c" roughness={0.85} />
        </mesh>
      ))}

      {/* --- PATHWAY WOODEN LANTERNS --- */}
      {pathwayLanterns.map((lamp, i) => (
        <group key={`path-lamp-${i}`} position={lamp.pos}>
          {/* Wooden post */}
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.2, 8]} />
            <meshStandardMaterial color="#451a03" />
          </mesh>
          {/* Lantern Head */}
          <mesh position={[0, 1.25, 0]} castShadow>
            <boxGeometry args={[0.26, 0.32, 0.26]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} />
          </mesh>
          {/* Lantern Core */}
          <mesh position={[0, 1.25, 0]}>
            <boxGeometry args={[0.18, 0.24, 0.18]} />
            <meshStandardMaterial color="#fef08a" emissive="#f59e0b" emissiveIntensity={0.8} />
          </mesh>
          {(i === 0 || i === 3) && (
            <pointLight position={[0, 1.25, 0]} color="#fef08a" intensity={1.2} distance={5} />
          )}
        </group>
      ))}
    </group>
  );
}
