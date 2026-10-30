"use client";

import React from "react";

export default function Pathways() {
  return (
    <group position={[0, 0.006, 0]}>
      {/* Central Circulation Spine (North-South Hallway from Executive to Lounge) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.4, 26]} />
        <meshStandardMaterial
          color="#334155"
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* East-West Cross Corridor (Connecting Engineering Bay to Marketing Studio) */}
      <mesh position={[0, 0, -4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[32, 2.2]} />
        <meshStandardMaterial
          color="#334155"
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* East-West Cross Corridor (Connecting AI Research Lab to Sales Wing) */}
      <mesh position={[0, 0, 10]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[32, 2.2]} />
        <meshStandardMaterial
          color="#334155"
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* Subtle Glowing Floor LED Inset Guides */}
      {[-1.2, 1.2].map((x, idx) => (
        <mesh key={idx} position={[x, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.04, 26]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      ))}
    </group>
  );
}
