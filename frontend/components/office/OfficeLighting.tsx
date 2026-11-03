"use client";

import React, { useRef } from "react";
import * as THREE from "three";

export default function OfficeLighting() {
  const dirLightRef = useRef<THREE.DirectionalLight>(null);

  return (
    <group>
      {/* 1. Global Ambient Hemisphere Fill (Natural Blue Sky & Warm Ground Bounce) */}
      <hemisphereLight
        args={["#e0f2fe", "#fef3c7", 0.95]}
      />

      {/* 2. Key Sun Directional Light with Crisp Natural Shadows covering entire 36m headquarters */}
      <directionalLight
        ref={dirLightRef}
        position={[32, 60, 36]}
        intensity={1.75}
        color="#fffdf2"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={46}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0003}
      />

      {/* 3. Soft Opposite Sky Blue Fill Light */}
      <directionalLight
        position={[-30, 40, -30]}
        intensity={0.65}
        color="#bae6fd"
      />

      {/* 4. Front Architectural Soft Fill for Facade Clarity */}
      <directionalLight
        position={[0, 20, 45]}
        intensity={0.4}
        color="#ffffff"
      />

      {/* 5. Multi-Floor Warm Architectural Interior Downlights (Floors 1 to 6) */}
      {[3.0, 9.0, 15.0, 21.0, 27.0, 33.0].map((ly, idx) => (
        <group key={`floor-light-group-${idx}`}>
          {/* Center warm ambient interior glow */}
          <pointLight
            position={[0, ly, 2.0]}
            intensity={0.65}
            distance={28}
            decay={2}
            color="#fffbeb"
          />
          {/* Flanking soft interior bounce */}
          <pointLight
            position={[-10.0, ly, -2.0]}
            intensity={0.4}
            distance={18}
            decay={2}
            color="#fef9c3"
          />
          <pointLight
            position={[10.0, ly, -2.0]}
            intensity={0.4}
            distance={18}
            decay={2}
            color="#fef9c3"
          />
        </group>
      ))}
    </group>
  );
}

