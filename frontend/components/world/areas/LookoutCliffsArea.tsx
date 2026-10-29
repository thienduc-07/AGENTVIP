"use client";

import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Sparkles, Float } from "@react-three/drei";
import { useWorldStore } from "@/store/worldStore";

// White Coastal Lighthouse with Glass Dome & Telescope (Image 2)
function CoastalLighthouse({ position }: { position: [number, number, number] }) {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (lightRef.current) {
      lightRef.current.intensity = 2.5 + Math.sin(t * 3.0) * 0.8;
    }
  });

  return (
    <group position={position}>
      {/* Stone Foundation Base */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.4, 1.6, 0.8, 16]} />
        <meshStandardMaterial color="#475569" roughness={0.8} />
      </mesh>
      {/* White Tapered Tower */}
      <mesh position={[0, 2.0, 0]} castShadow>
        <cylinderGeometry args={[1.0, 1.35, 2.6, 16]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.35} />
      </mesh>
      {/* Blue Accent Ring */}
      <mesh position={[0, 3.35, 0]}>
        <cylinderGeometry args={[1.1, 1.1, 0.22, 16]} />
        <meshStandardMaterial color="#0284c7" />
      </mesh>
      {/* Glass Observation Dome with Astronomical Instrument inside */}
      <mesh position={[0, 4.0, 0]}>
        <sphereGeometry args={[0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial
          color="#bae6fd"
          transparent
          opacity={0.65}
          roughness={0.15}
        />
      </mesh>
      {/* Golden Telescope/Instrument inside Dome */}
      <mesh position={[0, 3.9, 0]} rotation={[0.4, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.9, 8]} />
        <meshStandardMaterial color="#f59e0b" metalness={0.85} roughness={0.25} />
      </mesh>
      {/* Rotating Lantern Light */}
      <pointLight ref={lightRef} position={[0, 4.1, 0]} color="#fef08a" intensity={3.5} distance={15} />
    </group>
  );
}

// Dense Tall Green Bamboo Stalks along Southeast Coast (Image 2)
function BambooForest({ position }: { position: [number, number, number] }) {
  const stalks = useMemo(() => {
    const list: Array<{ x: number; z: number; height: number; scale: number }> = [];
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 1.6 - 0.4;
      const radius = 1.8 + (i % 4) * 0.45;
      list.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        height: 3.8 + (i % 3) * 0.7,
        scale: 0.8 + (i % 3) * 0.2,
      });
    }
    return list;
  }, []);

  return (
    <group position={position}>
      {stalks.map((s, idx) => (
        <group key={`bamboo-${idx}`} position={[s.x, 0, s.z]}>
          {/* Bamboo Main Stem with Segment Rings */}
          <mesh position={[0, s.height / 2, 0]} castShadow>
            <cylinderGeometry args={[0.07 * s.scale, 0.08 * s.scale, s.height, 8]} />
            <meshStandardMaterial color="#22c55e" roughness={0.6} />
          </mesh>
          {/* Node Rings */}
          {[1.0, 2.0, 3.0].map((ry) => (
            <mesh key={`ring-${ry}`} position={[0, ry, 0]}>
              <cylinderGeometry args={[0.09 * s.scale, 0.09 * s.scale, 0.04, 8]} />
              <meshStandardMaterial color="#15803d" />
            </mesh>
          ))}
          {/* Green Foliage Crown */}
          <mesh position={[0, s.height, 0]}>
            <sphereGeometry args={[0.35 * s.scale, 8, 8]} />
            <meshStandardMaterial color="#16a34a" roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Zoro's Emerald Enma Dragon Flame VFX
function EnmaDragonFlame() {
  const flameGroupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (flameGroupRef.current) {
      flameGroupRef.current.rotation.y = t * 2.8;
    }
  });

  return (
    <group ref={flameGroupRef} position={[0, 0.9, 0]}>
      {/* 3 Swirling Emerald Sword Waves */}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((rad, i) => (
        <mesh key={`enma-slash-${i}`} position={[Math.cos(rad) * 1.1, 0.4, Math.sin(rad) * 1.1]} rotation={[0.2, rad, 0.4]}>
          <planeGeometry args={[1.0, 0.3]} />
          <meshBasicMaterial
            color="#00ffaa"
            transparent
            opacity={0.8}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function LookoutCliffsArea() {
  const selectedAreaId = useWorldStore((s) => s.selectedAreaId);
  const hoveredAreaId = useWorldStore((s) => s.hoveredAreaId);
  const selectArea = useWorldStore((s) => s.selectArea);
  const setHoveredArea = useWorldStore((s) => s.setHoveredArea);

  const isSelected = selectedAreaId === "lookout_cliffs";
  const isHovered = hoveredAreaId === "lookout_cliffs";

  return (
    <group
      position={[6, 3.6, 11]}
      onClick={(e) => {
        e.stopPropagation();
        selectArea("lookout_cliffs");
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHoveredArea("lookout_cliffs");
      }}
      onPointerOut={() => setHoveredArea(null)}
    >
      {/* ========================================================
          ZORO'S ELEVATED ROCK BLUFF WITH LUSH GRASS TOP (Image 2)
          ======================================================== */}
      {/* Steep Grey Cliff Rock Base */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.7, 3.3, 1.4, 24]} />
        <meshStandardMaterial color="#64748b" roughness={0.85} />
      </mesh>
      {/* Flat Top Cap with Lush Green Grass */}
      <mesh position={[0, 1.12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.65, 2.7, 0.2, 24]} />
        <meshStandardMaterial color="#3d8f2e" roughness={0.65} />
      </mesh>

      {/* Authentic Japanese Stone Lantern (Ishidōrō) from User Reference Image */}
      <group position={[1.35, 1.22, 0.25]} rotation={[0, -0.3, 0]}>
        {/* Base Pedestal (Kiso) */}
        <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.26, 0.32, 0.16, 8]} />
          <meshStandardMaterial color="#475569" roughness={0.9} />
        </mesh>
        {/* Pillar Shaft (Sao) */}
        <mesh position={[0, 0.32, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.16, 0.34, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.85} />
        </mesh>
        {/* Middle Platform Shelf (Chūdai) */}
        <mesh position={[0, 0.52, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.24, 0.08, 8]} />
          <meshStandardMaterial color="#475569" roughness={0.9} />
        </mesh>
        {/* Fire Chamber Box (Hibukuro) */}
        <mesh position={[0, 0.68, 0]}>
          <cylinderGeometry args={[0.18, 0.20, 0.24, 6]} />
          <meshStandardMaterial color="#334155" roughness={0.8} />
        </mesh>
        {/* Warm Internal Lantern Glow */}
        <pointLight position={[0, 0.68, 0]} color="#fef08a" intensity={1.8} distance={3} />
        {/* Umbrella Stone Roof Cap (Kasa) */}
        <mesh position={[0, 0.86, 0]} castShadow>
          <coneGeometry args={[0.34, 0.16, 8]} />
          <meshStandardMaterial color="#475569" roughness={0.9} />
        </mesh>
        {/* Top Jewel Finial (Hōju) */}
        <mesh position={[0, 0.98, 0]} castShadow>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.8} />
        </mesh>
      </group>

      {/* Sliced Bamboo Stalk on Left with clean Katana diagonal cut (Image Reference) */}
      <group position={[-1.35, 1.22, 0.4]} rotation={[0.12, 0.4, 0.2]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <cylinderGeometry args={[0.10, 0.12, 0.8, 8]} />
          <meshStandardMaterial color="#16a34a" roughness={0.6} />
        </mesh>
        {/* Clean diagonal Katana slash cap */}
        <mesh position={[0, 0.8, 0]} rotation={[0.45, 0, 0.3]}>
          <circleGeometry args={[0.10, 8]} />
          <meshStandardMaterial color="#86efac" />
        </mesh>
      </group>

      {/* White Coastal Lighthouse beside Zoro's cliff (Image 2) */}
      <CoastalLighthouse position={[4.0, 0, 1.5]} />

      {/* Dense Tall Green Bamboo Forest along the shore */}
      <BambooForest position={[4.0, 0, 4.0]} />

      {/* Emerald Aura & Katana Sparkles */}
      <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.2}>
        <Sparkles count={25} scale={[5, 3, 5]} size={3.5} speed={0.6} color="#00ffaa" opacity={0.7} />
      </Float>

      {/* Tactical Selection Ring */}
      {(isSelected || isHovered) && (
        <mesh position={[0, 1.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.2, 3.7, 36]} />
          <meshBasicMaterial
            color={isSelected ? "#00ffaa" : "#34d399"}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
