"use client";

import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Sparkles, Float } from "@react-three/drei";
import { getGroundHeight, isInsideCharacterExclusionZone } from "@/utils/terrainPhysics";
import { applyAnimeCelShading, getAnimeGradientMap } from "@/lib/animeCelShading";

// Animated Two-Tier Mountain Waterfall (Matching Image 2)
function TwoTierWaterfall() {
  const upperFallRef = useRef<THREE.Mesh>(null);
  const lowerFallRef = useRef<THREE.Mesh>(null);
  const splashRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (upperFallRef.current) {
      (upperFallRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.85 + Math.sin(t * 2.0) * 0.1;
    }
    if (lowerFallRef.current) {
      (lowerFallRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.9 + Math.sin(t * 2.2) * 0.1;
    }
    if (splashRef.current) {
      splashRef.current.scale.setScalar(1.0 + Math.sin(t * 3.0) * 0.08);
    }
  });

  return (
    <group position={[0, 0, -11]}>
      {/* Tier 1: High Mountain Cascade (y ~ 14 down to 7.2) */}
      <mesh
        ref={upperFallRef}
        position={[0, 10.5, -4.2]}
        rotation={[0.18, 0, 0]}
      >
        <planeGeometry args={[2.8, 7.2]} />
        <meshStandardMaterial
          color="#e0f2fe"
          emissive="#38bdf8"
          emissiveIntensity={0.8}
          roughness={0.1}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Mid-Tier Stone Basin Shelf */}
      <mesh position={[0, 7.0, -3.2]} castShadow receiveShadow>
        <boxGeometry args={[4.2, 0.6, 2.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>

      {/* Mid-Tier Splash Foam */}
      <mesh position={[0, 7.35, -2.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 1.8, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
      </mesh>

      {/* Tier 2: Lower Plunge into Central Lagoon (y ~ 7 down to 0.3) */}
      <mesh
        ref={lowerFallRef}
        position={[0, 3.8, -1.8]}
        rotation={[0.08, 0, 0]}
      >
        <planeGeometry args={[3.4, 6.8]} />
        <meshStandardMaterial
          color="#e0f2fe"
          emissive="#38bdf8"
          emissiveIntensity={0.85}
          roughness={0.1}
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* Bottom Lagoon Splash Foam & Mist */}
      <mesh
        ref={splashRef}
        position={[0, 0.4, -0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.8, 2.6, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>
      <pointLight position={[0, 1.5, 0]} color="#7dd3fc" intensity={2.5} distance={8} />
    </group>
  );
}

export default function IslandTerrain() {
  // 1. High-Poly Continuous Sculpted Terrain Mesh matching terrainPhysics.ts
  const { terrainGeometry, terrainMaterial } = useMemo(() => {
    const width = 64;
    const height = 64;
    const segments = 220; // ~48,000 vertices for crisp sharp cliffs and 60 FPS
    const geo = new THREE.PlaneGeometry(width, height, segments, segments);

    const pos = geo.attributes.position;
    const count = pos.count;

    const colors = new Float32Array(count * 3);
    const colorSandLight = new THREE.Color("#f6e3ba");
    const colorSandDark = new THREE.Color("#ebd09e");
    const colorGrassLush = new THREE.Color("#4da83b");
    const colorGrassDeep = new THREE.Color("#3d8f2e");
    const colorGrassBright = new THREE.Color("#62bf4e");
    const colorRockLight = new THREE.Color("#7a8288");
    const colorRockMedium = new THREE.Color("#5a626a");
    const colorRockDark = new THREE.Color("#43494f");

    for (let i = 0; i < count; i++) {
      const px = pos.getX(i);
      const pz = -pos.getY(i); // rotate plane to XZ later

      const h = getGroundHeight(px, pz);
      pos.setZ(i, h);

      // Smooth multi-layered color blending (NO checkerboard, NO zebra stripes)
      const r = Math.hypot(px * 0.85, pz * 0.95);
      const tempColor = new THREE.Color();

      // 1. Natural Grass Variation (Continuous smooth noise blend)
      const grassNoise = (Math.sin(px * 0.22 + 1.5) * Math.cos(pz * 0.22 - 0.7) + 1.0) * 0.5;
      const grassColor = tempColor.copy(colorGrassLush).lerp(
        grassNoise > 0.5 ? colorGrassBright : colorGrassDeep,
        Math.abs(grassNoise - 0.5) * 1.6
      );

      // 2. Sand Beach Gradient
      const sandBlend = THREE.MathUtils.clamp((r - 21.0) / 4.5, 0, 1);
      const sandColor = new THREE.Color().copy(colorSandDark).lerp(colorSandLight, sandBlend);

      // 3. Mountain Karst Limestone Gradient
      const rockNoise = (Math.sin(px * 0.45) * Math.sin(pz * 0.45) + 1.0) * 0.5;
      const rockColor = new THREE.Color().copy(colorRockMedium).lerp(
        rockNoise > 0.5 ? colorRockLight : colorRockDark,
        Math.abs(rockNoise - 0.5) * 1.5
      );

      // Final Blended Color
      let finalColor: THREE.Color;
      if (h < 0.65 || r > 23.5) {
        finalColor = sandColor;
      } else if (r > 20.5 && h < 1.2) {
        const tSand = THREE.MathUtils.clamp((r - 20.5) / 3.0, 0, 1);
        finalColor = grassColor.clone().lerp(sandColor, tSand);
      } else if (pz < -7 || h > 5.5) {
        const tRock = THREE.MathUtils.clamp((h - 5.0) / 3.5, 0, 1);
        finalColor = grassColor.clone().lerp(rockColor, Math.max(tRock, pz < -9 ? 0.95 : 0.6));
      } else {
        finalColor = grassColor;
      }

      colors[i * 3] = finalColor.r;
      colors[i * 3 + 1] = finalColor.g;
      colors[i * 3 + 2] = finalColor.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getAnimeGradientMap(),
    });

    return { terrainGeometry: geo, terrainMaterial: mat };
  }, []);

  // 2. Load Environment 3D GLB Models
  const { scene: palmRaw } = useGLTF("/models/environment/tropical_palm.glb");
  const { scene: sakuraRaw } = useGLTF("/models/environment/sakura_tree.glb");
  const { scene: tangerineRaw } = useGLTF("/models/environment/tangerine_tree.glb");
  const { scene: bambooRaw } = useGLTF("/models/environment/bamboo_stalk.glb");
  const { scene: rockRaw } = useGLTF("/models/environment/mossy_rock.glb");

  const palmScene = useMemo(() => {
    const c = palmRaw.clone(true);
    applyAnimeCelShading(c);
    return c;
  }, [palmRaw]);

  const sakuraScene = useMemo(() => {
    const c = sakuraRaw.clone(true);
    applyAnimeCelShading(c);
    return c;
  }, [sakuraRaw]);

  const tangerineScene = useMemo(() => {
    const c = tangerineRaw.clone(true);
    applyAnimeCelShading(c);
    return c;
  }, [tangerineRaw]);

  const bambooScene = useMemo(() => {
    const c = bambooRaw.clone(true);
    applyAnimeCelShading(c);
    return c;
  }, [bambooRaw]);

  const rockScene = useMemo(() => {
    const c = rockRaw.clone(true);
    applyAnimeCelShading(c);
    return c;
  }, [rockRaw]);

  // 3. Dense Placements filtered by isInsideCharacterExclusionZone (NO CHARACTER OBSCURATION!)
  const palmTransforms = useMemo(() => {
    const candidates: [number, number, number, number][] = [
      // Pier & Dock approaches (Image 2)
      [-12, 14, 1.25, 0.4],
      [-15, 12, 1.2, 1.1],
      [-13, 9, 1.15, 2.2],
      [-8, 12, 1.2, 0.8],
      // Southern curved beach shoreline
      [-22, 14, 1.2, 0.4],
      [-19, 21, 1.1, 1.2],
      [-14, 19, 1.15, 0.8],
      [-6, 22, 1.2, 1.5],
      [1, 23, 1.1, 0.2],
      [7, 22, 1.15, 1.8],
      [13, 19, 1.25, 1.4],
      [18, 15, 1.1, 0.7],
      [22, 9, 1.2, 2.4],
      [24, -2, 1.15, 1.1],
      // Baratie shore & central hill grove
      [-7, 2.5, 1.1, 2.6],
      [-13, 5, 1.15, 0.9],
      [-1, -2.8, 1.2, 1.3],
      [4.5, -2.5, 1.1, 0.5],
      [-12, -22, 1.05, 2.8],
      [10, -22, 1.1, 0.9],
    ];
    return candidates
      .filter(([x, z]) => !isInsideCharacterExclusionZone(x, z, 0.5))
      .map(([x, z, s, r]) => ({
        pos: [x, getGroundHeight(x, z), z] as [number, number, number],
        scale: s,
        rotY: r,
      }));
  }, []);

  const sakuraTransforms = useMemo(() => {
    const candidates: [number, number, number, number][] = [
      // Dense pink Sakura canopy on northwestern hill (Image 2)
      [-18, -4, 1.25, 0.3],
      [-16, -9, 1.35, 1.5],
      [-12, -10, 1.2, 2.1],
      [-20, -7, 1.15, 0.8],
      [-17, -2, 1.2, 2.7],
      [-11, -4, 1.1, 1.2],
      [-22, -4, 1.3, 0.5],
      [-19, 0, 1.2, 1.9],
      [-15, -6, 1.25, 2.4],
      [-14, -13, 1.3, 0.7],
      [-18, -12, 1.2, 1.6],
      [-21, -1, 1.15, 2.9],
    ];
    return candidates
      .filter(([x, z]) => !isInsideCharacterExclusionZone(x, z, 0.4))
      .map(([x, z, s, r]) => ({
        pos: [x, getGroundHeight(x, z), z] as [number, number, number],
        scale: s,
        rotY: r,
      }));
  }, []);

  const tangerineTransforms = useMemo(() => {
    const candidates: [number, number, number][] = [
      [8, 4, 1.2],
      [11, 4, 1.3],
      [12, -1, 1.15],
      [10, -3, 1.1],
      [7, -2, 1.05],
      [14, 2, 1.2],
      [9, 6.5, 1.15],
      [13, 5.5, 1.2],
      [15, -2, 1.1],
    ];
    return candidates
      .filter(([x, z]) => !isInsideCharacterExclusionZone(x, z, 0.4))
      .map(([x, z, s]) => ({
        pos: [x, getGroundHeight(x, z), z] as [number, number, number],
        scale: s,
      }));
  }, []);

  const bambooTransforms = useMemo(() => {
    const list: { pos: [number, number, number]; scale: number; rotY: number }[] = [];
    for (let i = 0; i < 34; i++) {
      const radius = 1.8 + Math.random() * 4.2;
      const angle = Math.random() * Math.PI * 2;
      const x = 7.5 + Math.cos(angle) * radius;
      const z = 12.0 + Math.sin(angle) * radius;
      if (!isInsideCharacterExclusionZone(x, z, 0.3)) {
        list.push({
          pos: [x, getGroundHeight(x, z), z],
          scale: 0.85 + Math.random() * 0.4,
          rotY: Math.random() * Math.PI * 2,
        });
      }
    }
    return list;
  }, []);

  const rockTransforms = useMemo(() => {
    const candidates: [number, number, number][] = [
      [-24, 12, 1.8],
      [-18, 22, 1.7],
      [14, 20, 1.9],
      [24, 6, 2.0],
      [22, 16, 1.5],
      [0, -22, 2.2],
      [-8, -18, 1.6],
      [16, 10, 1.7],
      [-6, 16, 1.5],
      [8, 15, 1.6],
    ];
    return candidates
      .filter(([x, z]) => !isInsideCharacterExclusionZone(x, z, 0.6))
      .map(([x, z, s]) => ({
        pos: [x, getGroundHeight(x, z) - 0.2, z] as [number, number, number],
        scale: s,
      }));
  }, []);

  return (
    <group>
      {/* 1. SEAMLESS SCULPTED HIGH-POLY TERRAIN (NO STACKED CYLINDERS) */}
      <mesh
        geometry={terrainGeometry}
        material={terrainMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        castShadow
      />

      {/* 2. CENTRAL TURQUOISE LAGOON WATER SURFACE (Matching Image 2) */}
      <mesh position={[-3, 0.25, -3]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[4.8, 36]} />
        <meshStandardMaterial
          color="#06b6d4"
          roughness={0.1}
          metalness={0.25}
          transparent
          opacity={0.88}
        />
      </mesh>

      {/* 3. TWO-TIER CASCADING WATERFALL FROM NORTHERN MOUNTAINS (Matching Image 2) */}
      <TwoTierWaterfall />

      {/* 4. TROPICAL PALMS (GLB) */}
      {palmTransforms.map((p, i) => (
        <group key={`palm-${i}`} position={p.pos} scale={p.scale} rotation={[0, p.rotY, 0]}>
          <primitive object={palmScene.clone()} />
        </group>
      ))}

      {/* 5. SAKURA CHERRY BLOSSOM TREES (GLB) on Chopper's Hill */}
      {sakuraTransforms.map((p, i) => (
        <group key={`sakura-${i}`} position={p.pos} scale={p.scale} rotation={[0, p.rotY, 0]}>
          <primitive object={sakuraScene.clone()} />
        </group>
      ))}

      {/* 6. NAMI'S TANGERINE ORCHARD (GLB) */}
      {tangerineTransforms.map((p, i) => (
        <group key={`tangerine-${i}`} position={p.pos} scale={p.scale}>
          <primitive object={tangerineScene.clone()} />
        </group>
      ))}

      {/* 7. ZORO'S DENSE BAMBOO GROVE (GLB) */}
      {bambooTransforms.map((p, i) => (
        <group key={`bamboo-${i}`} position={p.pos} scale={p.scale} rotation={[0, p.rotY, 0]}>
          <primitive object={bambooScene.clone()} />
        </group>
      ))}

      {/* 8. MOSSY BOULDERS (GLB) */}
      {rockTransforms.map((p, i) => (
        <group key={`rock-${i}`} position={p.pos} scale={p.scale}>
          <primitive object={rockScene.clone()} />
        </group>
      ))}

      {/* 9. DRIFTING PINK SAKURA BLOSSOM PETALS OVER CHOPPER'S HILL (Image 2) */}
      <Sparkles
        position={[-16, 5.2, -6]}
        count={50}
        scale={[14, 6, 14]}
        size={3.2}
        speed={0.65}
        color="#f472b6"
        opacity={0.88}
      />
    </group>
  );
}

useGLTF.preload("/models/environment/tropical_palm.glb");
useGLTF.preload("/models/environment/sakura_tree.glb");
useGLTF.preload("/models/environment/tangerine_tree.glb");
useGLTF.preload("/models/environment/bamboo_stalk.glb");
useGLTF.preload("/models/environment/mossy_rock.glb");
