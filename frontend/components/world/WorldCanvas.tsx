"use client";

import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useWorldStore } from "@/store/worldStore";
import { WORLD_CONFIG } from "@/data/worldConfig";
import { EffectComposer, Bloom, ToneMapping } from "@react-three/postprocessing";
import WorldLighting from "./WorldLighting";
import WorldCamera from "./WorldCamera";
import Ocean from "./Ocean";
import IslandTerrain from "./IslandTerrain";
import Pathways from "./Pathways";
import HarborArea from "./areas/HarborArea";
import SunnyShipyardArea from "./areas/SunnyShipyardArea";
import StrawHatVillageArea from "./areas/StrawHatVillageArea";
import WorkshopArea from "./areas/WorkshopArea";
import LibraryArea from "./areas/LibraryArea";
import CaptainHQArea from "./areas/CaptainHQArea";
import LookoutCliffsArea from "./areas/LookoutCliffsArea";
import AgentCharacter from "./characters/AgentCharacter";
import TaskHandoffVFX from "./TaskHandoffVFX";

export default function WorldCanvas() {
  const agents = useWorldStore((s) => s.agents);
  const resetToTacticalOverview = useWorldStore((s) => s.resetToTacticalOverview);

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
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
          toneMappingExposure: 1.15,
        }}
        onPointerMissed={() => {
          // Deselect when clicking on ocean or empty space
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
          {/* Stylized Lighting & Sky Dome */}
          <WorldLighting />

          {/* Ocean Waves */}
          <Ocean />

          {/* 3D Multi-tiered Island Landmass */}
          <IslandTerrain />

          {/* Interconnecting Roads and Stone Stairs */}
          <Pathways />

          {/* 7 Distinct Multi-Level Island Tiers */}
          <HarborArea />
          <SunnyShipyardArea />
          <StrawHatVillageArea />
          <WorkshopArea />
          <LibraryArea />
          <CaptainHQArea />
          <LookoutCliffsArea />

          {/* 10 Stateful Straw Hat Agent Characters */}
          {Object.values(agents).map((agent) => (
            <AgentCharacter key={agent.id} agent={agent} />
          ))}

          {/* Anime Task Handoff & Skill Projectile Particle System */}
          <TaskHandoffVFX />

          {/* Smooth Free Orbit Camera Controller */}
          <WorldCamera />

          {/* Anime Post-Processing Pipeline (Zero-flicker Bloom & ToneMapping) */}
          <EffectComposer multisampling={0} autoClear={false}>
            <Bloom
              luminanceThreshold={0.92}
              luminanceSmoothing={0.3}
              intensity={0.28}
              mipmapBlur
            />
            <ToneMapping />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
