"use client";

import React from "react";
import * as THREE from "three";

export default function OfficeFloor() {
  return (
    <group position={[0, -0.05, 0]}>
      {/* 1. Surrounding Plaza Pedestrian Paving */}
      <mesh receiveShadow position={[0, -0.02, 0]}>
        <boxGeometry args={[56, 0.08, 44]} />
        <meshStandardMaterial
          color="#0b1120"
          roughness={0.8}
          metalness={0.15}
        />
      </mesh>

      {/* 2. South Plaza Grand Entrance Pathway (Walkway leading to Floor 1 Lobby) */}
      <mesh receiveShadow position={[0, 0.02, 18.0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial
          color="#1e293b"
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* Embedded LED Pathway Accent Strips */}
      {[-5.0, 5.0].map((px, idx) => (
        <mesh key={`path-led-${idx}`} position={[px, 0.03, 18.0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.08, 10]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      ))}

      {/* 3. Modern Perimeter Reflecting Pools (Water Features flanking entrance) */}
      {[-12.0, 12.0].map((wx, idx) => (
        <group key={`pool-${idx}`} position={[wx, 0.01, 18.0]}>
          {/* Pool Basin Rim */}
          <mesh receiveShadow position={[0, 0.08, 0]}>
            <boxGeometry args={[4.2, 0.16, 8.2]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Reflective Water Surface */}
          <mesh position={[0, 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[3.8, 7.8]} />
            <meshStandardMaterial
              color="#0284c7"
              roughness={0.05}
              metalness={0.9}
            />
          </mesh>
          {/* Underwater LED Glow */}
          <pointLight color="#38bdf8" intensity={0.5} distance={6} position={[0, 0.3, 0]} />
        </group>
      ))}
    </group>
  );
}
