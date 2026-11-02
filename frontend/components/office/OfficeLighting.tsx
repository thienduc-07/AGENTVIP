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

      {/* 2. Key Sun Directional Light with Soft Shadows */}
      <directionalLight
        ref={dirLightRef}
        position={[24, 38, -18]}
        intensity={1.25}
        color="#fffbeb"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={95}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-bias={-0.0004}
      />

      {/* 3. Soft Opposite Daylight Fill (Prevents Harsh Dark Shadows) */}
      <directionalLight
        position={[-22, 24, 26]}
        intensity={0.42}
        color="#e0f2fe"
      />

      {/* 4. Executive Suite Overhead Soft Downlight */}
      <pointLight
        position={[0, 6.5, -12]}
        intensity={0.8}
        distance={18}
        decay={2}
        color="#38bdf8"
      />

      {/* 5. Central Hub Overhead Downlight */}
      <pointLight
        position={[0, 7.5, 4]}
        intensity={0.65}
        distance={22}
        decay={2}
        color="#f8fafc"
      />
    </group>
  );
}
