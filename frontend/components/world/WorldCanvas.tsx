"use client";

import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useWorldStore } from "@/store/worldStore";
import { WORLD_CONFIG } from "@/data/worldConfig";
import { EffectComposer, Bloom, ToneMapping } from "@react-three/postprocessing";
import WorldLighting from "./WorldLighting";
import WorldCamera from "./WorldCamera";
import OfficeArchitecture from "./OfficeArchitecture";
import OfficeFurniture from "./OfficeFurniture";
import Pathways from "./Pathways";
import AgentCharacter from "./characters/AgentCharacter";
import TaskHandoffVFX from "./TaskHandoffVFX";

export default function WorldCanvas() {
  const agents = useWorldStore((s) => s.agents);
  const resetToTacticalOverview = useWorldStore((s) => s.resetToTacticalOverview);

  return (
    <div className="relative w-full h-full bg-slate-900">
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{
          position: WORLD_CONFIG.tacticalCamera.position,
          fov: WORLD_CONFIG.tacticalCamera.fov,
          near: 0.5,
          far: 350,
        }}
        gl={{
          antialias: true,
          alpha: false,
          logarithmicDepthBuffer: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        onPointerMissed={() => {
          resetToTacticalOverview();
        }}
        className="w-full h-full"
      >
        <color attach="background" args={[WORLD_CONFIG.environment.fogColor]} />
        <fog
          attach="fog"
          args={[
            WORLD_CONFIG.environment.fogColor,
            WORLD_CONFIG.environment.fogNear,
            WORLD_CONFIG.environment.fogFar,
          ]}
        />

        <Suspense fallback={null}>
          {/* Architectural Daylight & Sky Lighting */}
          <WorldLighting />

          {/* Luxury Open-Plan Corporate Office Structure */}
          <OfficeArchitecture />

          {/* Circulation Corridors & Hallways */}
          <Pathways />

          {/* Department Workstations, Desks, Boardroom & Lounge Furniture */}
          <OfficeFurniture />

          {/* 8 Stateful Autonomous Corporate Agents */}
          {Object.values(agents).map((agent) => (
            <AgentCharacter key={agent.id} agent={agent} />
          ))}

          {/* Corporate Telemetry & Data Stream VFX Handoff */}
          <TaskHandoffVFX />

          {/* Smooth Department & Desk Camera Controller */}
          <WorldCamera />

          {/* Architectural Post-Processing Pipeline (Bloom & ToneMapping) */}
          <EffectComposer multisampling={0} autoClear={false}>
            <Bloom
              luminanceThreshold={0.94}
              luminanceSmoothing={0.25}
              intensity={0.22}
              mipmapBlur
            />
            <ToneMapping />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
