"use client";

import React from "react";
import * as THREE from "three";
import { Sparkles } from "@react-three/drei";
import { useWorldStore } from "@/store/worldStore";

// Pirate Sign Board / Marker Post behind Luffy (Image 2)
function PirateMarkerBoard() {
  return (
    <group position={[-0.8, 1.4, -0.6]} rotation={[0, 0.35, 0]}>
      {/* Timber Post */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 1.4, 8]} />
        <meshStandardMaterial color="#582f0e" roughness={0.8} />
      </mesh>
      {/* Board Frame */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[1.1, 0.65, 0.08]} />
        <meshStandardMaterial color="#78350f" roughness={0.7} />
      </mesh>
      {/* Sign Emblem Disc */}
      <mesh position={[0, 1.25, 0.05]}>
        <circleGeometry args={[0.24, 20]} />
        <meshStandardMaterial color="#fef08a" roughness={0.3} />
      </mesh>
    </group>
  );
}

export default function CaptainHQArea() {
  const selectArea = useWorldStore((s) => s.selectArea);
  const selectedAreaId = useWorldStore((s) => s.selectedAreaId);
  const isSelected = selectedAreaId === "captain_hq";

  return (
    <group
      position={[2, 2.2, 2]}
      onClick={(e) => {
        e.stopPropagation();
        selectArea("captain_hq");
      }}
    >
      {/* ========================================================
          3-TIERED CONCENTRIC ROUND BASALT ROCK PEDESTAL (Image 2)
          ======================================================== */}
      {/* Tier 1: Wide Dark Basalt Foundation Base */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[3.3, 3.7, 0.6, 32]} />
        <meshStandardMaterial color="#2d3139" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* Tier 1 Gold Rim Bevel (Raised slightly to prevent any Z-fighting) */}
      <mesh position={[0, 0.608, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 3.35, 32]} />
        <meshStandardMaterial color="#d97706" roughness={0.3} metalness={0.6} depthWrite={false} />
      </mesh>

      {/* Tier 2: Middle Concentric Basalt Step */}
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.3, 2.6, 0.55, 32]} />
        <meshStandardMaterial color="#373c46" roughness={0.8} metalness={0.1} />
      </mesh>
      {/* Tier 2 Gold Rim Bevel */}
      <mesh position={[0, 1.135, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.22, 2.34, 32]} />
        <meshStandardMaterial color="#d97706" roughness={0.3} metalness={0.6} depthWrite={false} />
      </mesh>

      {/* Tier 3: Top Basalt Summit Pedestal (Luffy Gear 5 command stage) */}
      <mesh position={[0, 1.35, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.7, 0.45, 32]} />
        <meshStandardMaterial color="#424855" roughness={0.75} metalness={0.15} />
      </mesh>
      {/* Top Golden Sun Ring Rim */}
      <mesh position={[0, 1.585, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.4, 1.54, 32]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.25} metalness={0.7} depthWrite={false} />
      </mesh>

      {/* Pirate Marker Sign Board behind Luffy */}
      <PirateMarkerBoard />

      {/* Divine Sun God Sparkles */}
      <Sparkles count={30} scale={6} size={3.5} speed={0.6} color="#fef08a" opacity={0.75} />

      {/* Warm Golden Sunlight Focus (Stable non-strobing point light) */}
      <pointLight position={[0, 4.0, 0]} color="#fff7ed" intensity={3.5} distance={14} />

      {/* Selection Halo */}
      {isSelected && (
        <mesh position={[0, 1.62, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.8, 2.2, 36]} />
          <meshBasicMaterial
            color="#ff4444"
            side={THREE.DoubleSide}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
