"use client";

import React, { useRef } from "react";
import * as THREE from "three";

export default function OfficeLighting() {
  const dirLightRef = useRef<THREE.DirectionalLight>(null);

  return (
    <group>
      {/* 1. Global Ambient Hemisphere Fill (Natural Sky & Ground Bounce) */}
      <hemisphereLight
        args={["#f0f9ff", "#0f172a", 0.65]}
      />

      {/* 2. Key Sun Directional Light with Soft Shadows covering 36m height */}
      <directionalLight
        ref={dirLightRef}
        position={[28, 54, 32]}
        intensity={1.35}
        color="#fffbeb"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={42}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0003}
      />

      {/* 3. Soft Opposite Daylight Fill */}
      <directionalLight
        position={[-24, 32, -26]}
        intensity={0.5}
        color="#e0f2fe"
      />

      {/* 4. Multi-Floor Vertical Fill Lights */}
      {[3.0, 9.0, 15.0, 21.0, 27.0, 33.0].map((ly, idx) => (
        <pointLight
          key={`floor-light-${idx}`}
          position={[0, ly, 4.0]}
          intensity={0.45}
          distance={24}
          decay={2}
          color="#f8fafc"
        />
      ))}
    </group>
  );
}

