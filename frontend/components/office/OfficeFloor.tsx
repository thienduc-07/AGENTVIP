"use client";

import React from "react";
import * as THREE from "three";

export default function OfficeFloor() {
  return (
    <group>
      {/* 1. Main Luxury Terrazzo Architectural Floor */}
      <mesh receiveShadow position={[0, -0.05, 4]}>
        <boxGeometry args={[46, 0.1, 43]} />
        <meshStandardMaterial
          color="#f8fafc"
          roughness={0.25}
          metalness={0.08}
        />
      </mesh>

      {/* 2. Central Primary Spine Corridor (North-South Walkway) */}
      <mesh receiveShadow position={[0, 0.003, 4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5, 42]} />
        <meshStandardMaterial
          color="#f1f5f9"
          roughness={0.45}
          metalness={0.05}
        />
      </mesh>

      {/* 3. Cross-Corridor East-West Arteries */}
      {/* North Cross Corridor (between Engineering/Research and Executive) */}
      <mesh receiveShadow position={[0, 0.003, -8.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[44, 3.5]} />
        <meshStandardMaterial
          color="#f1f5f9"
          roughness={0.45}
          metalness={0.05}
        />
      </mesh>

      {/* South Cross Corridor (between Sales/Marketing and Operations/Finance) */}
      <mesh receiveShadow position={[0, 0.003, 15.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[44, 3.5]} />
        <meshStandardMaterial
          color="#f1f5f9"
          roughness={0.45}
          metalness={0.05}
        />
      </mesh>

      {/* 4. Subtle Tactile Corridor Guide Lights (Embedded LED floor strips) */}
      {[-2.5, 2.5].map((x, idx) => (
        <mesh key={`floor-led-${idx}`} position={[x, 0.006, 4]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.06, 42]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} />
        </mesh>
      ))}

      {/* 5. Central Collaborative Atrium Circle (Reception & Town Hall Hub) */}
      <mesh receiveShadow position={[0, 0.004, 3.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[4.2, 48]} />
        <meshStandardMaterial
          color="#e2e8f0"
          roughness={0.35}
          metalness={0.12}
        />
      </mesh>

      {/* Outer Atrium Accent Ring */}
      <mesh position={[0, 0.005, 3.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.25, 4.35, 48]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.65} />
      </mesh>

      {/* 6. Perimeter Baseboard Floor Trim */}
      {/* North Trim */}
      <mesh position={[0, 0.12, -17.4]}>
        <boxGeometry args={[46, 0.24, 0.08]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* South Trim */}
      <mesh position={[0, 0.12, 25.4]}>
        <boxGeometry args={[46, 0.24, 0.08]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* West Trim */}
      <mesh position={[-22.95, 0.12, 4]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[43, 0.24, 0.08]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* East Trim */}
      <mesh position={[22.95, 0.12, 4]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[43, 0.24, 0.08]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}

