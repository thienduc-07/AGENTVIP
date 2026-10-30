"use client";

import React from "react";
import { Sky, Environment } from "@react-three/drei";
import { WORLD_CONFIG } from "@/data/worldConfig";

export default function WorldLighting() {
  const { sunLight, skyLight, ambientLight } = WORLD_CONFIG.environment;

  return (
    <group>
      {/* 1. Natural Metropolis Daylight Sky */}
      <Sky
        sunPosition={sunLight.position}
        turbidity={1.5}
        rayleigh={1.2}
        mieCoefficient={0.003}
        mieDirectionalG={0.85}
      />

      {/* 2. City Environment HDRI for Glass & Metallic Architecture Reflections */}
      <Environment preset="city" environmentIntensity={0.8} />

      {/* 3. Ambient Office Fill Light */}
      <ambientLight color={ambientLight.color} intensity={ambientLight.intensity} />

      {/* 4. Natural Daylight Sun through Glass Curtain Wall */}
      <directionalLight
        position={sunLight.position}
        color={sunLight.color}
        intensity={sunLight.intensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1.0}
        shadow-camera-far={120}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-bias={-0.0001}
      />

      {/* 5. Hemisphere Light (Architectural Interior Daylight & Flooring Bounce) */}
      <hemisphereLight
        args={[skyLight.skyColor, skyLight.groundColor, skyLight.intensity]}
      />

      {/* 6. Recessed LED Architectural Downlight - Executive Boardroom */}
      <spotLight
        position={[0, 7.5, -10]}
        target-position={[0, 0, -10]}
        color="#ffffff"
        intensity={2.8}
        angle={0.6}
        penumbra={0.7}
        distance={15}
      />

      {/* 7. Recessed LED Architectural Downlight - Engineering Bay */}
      <spotLight
        position={[-14, 7.5, -4]}
        target-position={[-14, 0, -4]}
        color="#e0f2fe"
        intensity={2.4}
        angle={0.6}
        penumbra={0.7}
        distance={15}
      />

      {/* 8. Recessed LED Architectural Downlight - Marketing Studio */}
      <spotLight
        position={[14, 7.5, -4]}
        target-position={[14, 0, -4]}
        color="#fff1f2"
        intensity={2.4}
        angle={0.6}
        penumbra={0.7}
        distance={15}
      />
    </group>
  );
}
