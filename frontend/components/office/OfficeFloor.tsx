"use client";

import React from "react";
import * as THREE from "three";

export default function OfficeFloor() {
  return (
    <group position={[0, -0.05, 0]}>
      {/* =========================================================================
          1. GRAND ENTRANCE PLAZA PAVING (Light Travertine & Granite)
          ========================================================================= */}
      <mesh receiveShadow position={[0, -0.02, 0]}>
        <boxGeometry args={[56, 0.08, 44]} />
        <meshStandardMaterial
          color="#f1f5f9"
          roughness={0.4}
          metalness={0.08}
        />
      </mesh>

      {/* Plaza Center Paved Esplanade */}
      <mesh receiveShadow position={[0, 0.02, 16.0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18, 14]} />
        <meshStandardMaterial
          color="#e2e8f0"
          roughness={0.35}
          metalness={0.12}
        />
      </mesh>

      {/* Embedded Warm Architectural LED Accent Strips */}
      {[-8.5, 8.5].map((px, idx) => (
        <mesh key={`path-led-${idx}`} position={[px, 0.03, 16.0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.08, 14]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      ))}

      {/* =========================================================================
          2. GRAND ENTRANCE STAIRCASE (5 Broad Limestone Steps Leading to Floor 1)
          ========================================================================= */}
      <group position={[0, 0, 13.5]}>
        {[0, 1, 2, 3, 4].map((stepIdx) => {
          const stepY = stepIdx * 0.12 + 0.06;
          const stepZ = (4 - stepIdx) * 0.65;
          const stepWidth = 16.0 - stepIdx * 0.4;
          return (
            <mesh
              key={`grand-step-${stepIdx}`}
              receiveShadow
              castShadow
              position={[0, stepY, stepZ]}
            >
              <boxGeometry args={[stepWidth, 0.12, 0.7]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.3} metalness={0.1} />
            </mesh>
          );
        })}

        {/* Flanking Staircase Limestone Cheek Walls */}
        {[-8.2, 8.2].map((wx, idx) => (
          <group key={`stair-cheek-${idx}`} position={[wx, 0.45, 1.5]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.4, 0.9, 3.8]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.15} />
            </mesh>
            {/* LED strip on cheek wall */}
            <mesh position={[idx === 0 ? 0.21 : -0.21, 0.4, 0]}>
              <boxGeometry args={[0.02, 0.04, 3.6]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
          </group>
        ))}
      </group>

      {/* =========================================================================
          3. SYMMETRICAL TIERED CIRCULAR WATER FOUNTAIN (Directly in Front of Entrance)
          ========================================================================= */}
      <group position={[0, 0, 19.5]}>
        {/* Outer Circular Flowerbed Ring with Manicured Boxwood Shrub */}
        <mesh receiveShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[4.4, 4.6, 0.24, 32]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh receiveShadow position={[0, 0.25, 0]}>
          <cylinderGeometry args={[4.2, 4.2, 0.1, 32]} />
          <meshStandardMaterial color="#15803d" roughness={0.8} />
        </mesh>

        {/* Tier 1 Main Fountain Basin */}
        <mesh castShadow receiveShadow position={[0, 0.35, 0]}>
          <cylinderGeometry args={[3.2, 3.4, 0.45, 32]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.25} metalness={0.15} />
        </mesh>

        {/* Fountain Water Surface */}
        <mesh position={[0, 0.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[3.0, 32]} />
          <meshStandardMaterial
            color="#38bdf8"
            roughness={0.04}
            metalness={0.85}
          />
        </mesh>

        {/* Tier 2 Center Pedestal */}
        <mesh castShadow position={[0, 0.75, 0]}>
          <cylinderGeometry args={[0.9, 1.1, 0.6, 24]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.2} metalness={0.2} />
        </mesh>

        {/* Center Vertical Spray Jet Plume */}
        <mesh position={[0, 1.55, 0]}>
          <cylinderGeometry args={[0.15, 0.45, 1.3, 16, 1, true]} />
          <meshStandardMaterial
            color="#e0f2fe"
            transparent
            opacity={0.8}
            roughness={0.05}
          />
        </mesh>
        <mesh position={[0, 2.2, 0]}>
          <sphereGeometry args={[0.32, 16, 16]} />
          <meshStandardMaterial
            color="#ffffff"
            transparent
            opacity={0.85}
            roughness={0.1}
          />
        </mesh>

        {/* Underwater Illuminated Cyan Glow */}
        <pointLight color="#38bdf8" intensity={1.5} distance={7} position={[0, 0.8, 0]} />
      </group>

      {/* =========================================================================
          4. SYMMETRICAL FLANKING GARDEN PLANTERS & MANICURED SHRUBS
          ========================================================================= */}
      {[-13.5, 13.5].map((gx, idx) => (
        <group key={`garden-bed-${idx}`} position={[gx, 0, 18.5]}>
          {/* White Travertine Planter Basin */}
          <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
            <boxGeometry args={[4.2, 0.6, 6.5]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Top Soil Layer */}
          <mesh position={[0, 0.61, 0]}>
            <boxGeometry args={[3.8, 0.05, 6.1]} />
            <meshStandardMaterial color="#166534" roughness={0.9} />
          </mesh>
          {/* Symmetrical Rounded Shrub Spheres */}
          {[-1.8, 0, 1.8].map((sz, sIdx) => (
            <mesh
              key={`shrub-${idx}-${sIdx}`}
              castShadow
              position={[0, 0.95, sz]}
            >
              <sphereGeometry args={[0.65, 12, 12]} />
              <meshStandardMaterial color="#22c55e" roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      {/* =========================================================================
          5. FOREGROUND ROADWAY & CURB (Asphalt Avenue running across)
          ========================================================================= */}
      <group position={[0, 0, 26.5]}>
        {/* Granite Road Curb */}
        <mesh receiveShadow position={[0, 0.08, -3.2]}>
          <boxGeometry args={[56, 0.16, 0.4]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.2} />
        </mesh>

        {/* Asphalt Roadway */}
        <mesh receiveShadow position={[0, 0.01, 0]}>
          <boxGeometry args={[56, 0.05, 6.0]} />
          <meshStandardMaterial color="#334155" roughness={0.85} metalness={0.15} />
        </mesh>

        {/* White Dashed Center Lane Markings */}
        {[-20, -12, -4, 4, 12, 20].map((lx) => (
          <mesh key={`lane-${lx}`} position={[lx, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[3.5, 0.22]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}

        {/* Symmetrical Road Edge Markings */}
        <mesh position={[0, 0.04, -2.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[56, 0.15]} />
          <meshBasicMaterial color="#f8fafc" />
        </mesh>
        <mesh position={[0, 0.04, 2.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[56, 0.15]} />
          <meshBasicMaterial color="#f8fafc" />
        </mesh>

        {/* Parked Corporate Executive Car on the Right Side */}
        <group position={[14.0, 0.32, 1.2]} rotation={[0, -Math.PI / 2, 0]}>
          {/* Main Car Chassis / Lower Body */}
          <mesh castShadow receiveShadow position={[0, 0.2, 0]}>
            <boxGeometry args={[1.9, 0.45, 4.2]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.15} />
          </mesh>
          {/* Cabin & Tinted Windows */}
          <mesh castShadow position={[0, 0.6, -0.2]}>
            <boxGeometry args={[1.65, 0.42, 2.4]} />
            <meshPhysicalMaterial
              color="#0f172a"
              transmission={0.4}
              roughness={0.1}
              metalness={0.8}
            />
          </mesh>
          {/* Headlights & Taillights */}
          <mesh position={[0.7, 0.2, 2.11]}>
            <boxGeometry args={[0.3, 0.12, 0.05]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[-0.7, 0.2, 2.11]}>
            <boxGeometry args={[0.3, 0.12, 0.05]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.7, 0.22, -2.11]}>
            <boxGeometry args={[0.35, 0.12, 0.05]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <mesh position={[-0.7, 0.22, -2.11]}>
            <boxGeometry args={[0.35, 0.12, 0.05]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          {/* 4 Wheels */}
          {[
            [-0.92, 0, 1.2],
            [0.92, 0, 1.2],
            [-0.92, 0, -1.2],
            [0.92, 0, -1.2],
          ].map(([wx, wy, wz], wIdx) => (
            <mesh
              key={`car-wheel-${wIdx}`}
              castShadow
              position={[wx, wy, wz]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.32, 0.32, 0.22, 16]} />
              <meshStandardMaterial color="#0f172a" roughness={0.7} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
