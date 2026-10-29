"use client";

import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useWorldStore } from "@/store/worldStore";
import { getOceanWaveHeight } from "../Ocean";
import { applyAnimeCelShading } from "@/lib/animeCelShading";
import { THOUSAND_SUNNY_CONFIG } from "@/config/islandManifest";

// Long Wooden Mooring Pier Connecting Southwest Beach to Thousand Sunny (Image 2)
function WoodenMooringPier() {
  // Stretches from beach at [-14.5, 0.5, 14.5] to ship boarding ramp at [-21.5, 0.4, 19.5]
  return (
    <group position={[-18.0, 0.45, 17.0]} rotation={[0, 0.62, 0]}>
      {/* Main Timber Deck (9m long pier) */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[9.2, 0.22, 2.6]} />
        <meshStandardMaterial color="#78350f" roughness={0.8} />
      </mesh>

      {/* Cross Timber Planks */}
      {[-4.0, -3.0, -2.0, -1.0, 0, 1.0, 2.0, 3.0, 4.0].map((px, i) => (
        <mesh key={`plank-${i}`} position={[px, 0.12, 0]}>
          <boxGeometry args={[0.1, 0.04, 2.58]} />
          <meshStandardMaterial color="#451a03" />
        </mesh>
      ))}

      {/* Pilings sunk into ocean bed */}
      {[-3.8, -1.9, 0, 1.9, 3.8].flatMap((px) =>
        [-1.05, 1.05].map((pz, idx) => (
          <mesh key={`pier-stilt-${px}-${pz}-${idx}`} position={[px, -0.9, pz]} castShadow>
            <cylinderGeometry args={[0.1, 0.14, 1.8, 8]} />
            <meshStandardMaterial color="#3e1f07" roughness={0.9} />
          </mesh>
        ))
      )}

      {/* Wooden Railings */}
      {[-1.2, 1.2].map((rz) => (
        <group key={`rail-${rz}`} position={[0, 0.55, rz]}>
          {/* Top Rail Bar */}
          <mesh>
            <boxGeometry args={[9.0, 0.08, 0.08]} />
            <meshStandardMaterial color="#92400e" />
          </mesh>
          {/* Vertical Posts */}
          {[-4.0, -2.0, 0, 2.0, 4.0].map((vx, vi) => (
            <mesh key={`post-${vi}`} position={[vx, -0.28, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.55, 6]} />
              <meshStandardMaterial color="#78350f" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// 3 Vertical Ocean Geysers / Water Fountains beside Sunny Pier (Exactly matching Image 2)
function ThreeOceanGeysers() {
  const geyser1Ref = useRef<THREE.Mesh>(null);
  const geyser2Ref = useRef<THREE.Mesh>(null);
  const geyser3Ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (geyser1Ref.current) {
      geyser1Ref.current.scale.y = 1.0 + Math.sin(t * 3.5) * 0.25;
      geyser1Ref.current.rotation.y = t * 1.5;
    }
    if (geyser2Ref.current) {
      geyser2Ref.current.scale.y = 1.0 + Math.sin(t * 3.5 + 1.2) * 0.28;
      geyser2Ref.current.rotation.y = -t * 1.8;
    }
    if (geyser3Ref.current) {
      geyser3Ref.current.scale.y = 1.0 + Math.sin(t * 3.5 + 2.4) * 0.22;
      geyser3Ref.current.rotation.y = t * 1.2;
    }
  });

  return (
    <group>
      {[
        { ref: geyser1Ref, pos: [-17.2, 0, 12.8], height: 3.2, radius: 0.45 },
        { ref: geyser2Ref, pos: [-19.8, 0, 11.2], height: 3.8, radius: 0.52 },
        { ref: geyser3Ref, pos: [-22.5, 0, 13.5], height: 3.4, radius: 0.48 },
      ].map((g, idx) => (
        <group key={`geyser-${idx}`} position={g.pos as [number, number, number]}>
          {/* Vertical Spouting Water Column */}
          <mesh ref={g.ref} position={[0, g.height * 0.5, 0]}>
            <cylinderGeometry args={[g.radius * 0.6, g.radius * 1.2, g.height, 12]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0284c7"
              emissiveIntensity={0.65}
              roughness={0.1}
              transparent
              opacity={0.88}
            />
          </mesh>
          {/* Surface Foam Splash Ring */}
          <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[g.radius * 0.8, g.radius * 2.2, 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function SunnyShipyardArea() {
  const selectedAreaId = useWorldStore((s) => s.selectedAreaId);
  const hoveredAreaId = useWorldStore((s) => s.hoveredAreaId);
  const selectArea = useWorldStore((s) => s.selectArea);
  const setHoveredArea = useWorldStore((s) => s.setHoveredArea);

  const shipRef = useRef<THREE.Group>(null);
  const isSelected = selectedAreaId === "sunny_shipyard";
  const isHovered = hoveredAreaId === "sunny_shipyard";

  // Load Thousand Sunny GLB Model with Anime Cel-Shading
  const { scene } = useGLTF(THOUSAND_SUNNY_CONFIG.modelPath);
  const { sunnyScene, normalizedScale } = useMemo(() => {
    const clone = scene.clone(true);
    applyAnimeCelShading(clone);

    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.z);
    const scale = THOUSAND_SUNNY_CONFIG.targetLength / Math.max(maxDim, 0.001);

    // Create centered wrapper with exact waterline calibration
    const wrapper = new THREE.Group();
    wrapper.add(clone);

    // Center X & Z so roll/pitch occurs along midship axis
    // Keel sits at box.min.y. Submerge lower hull by 1.6m so deck sits comfortably at +2.2m above water surface
    const keelDepthModelUnits = 1.6 / scale;
    clone.position.set(-center.x, -box.min.y - keelDepthModelUnits, -center.z);

    return { sunnyScene: wrapper, normalizedScale: scale };
  }, [scene]);

  // Buoyant wave rocking animation for moored ship
  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    if (shipRef.current) {
      const wave = getOceanWaveHeight(
        THOUSAND_SUNNY_CONFIG.position[0],
        THOUSAND_SUNNY_CONFIG.position[2],
        time
      );
      // Gentle buoyant pitch and roll matching ocean surface
      shipRef.current.position.y = wave.height * 0.15;
      shipRef.current.rotation.z = wave.roll * 0.22;
      shipRef.current.rotation.x = wave.pitch * 0.18;
    }
  });

  return (
    <group>
      {/* Thousand Sunny 3D Model floating offshore in southwest ocean (Image 2) */}
      <group
        position={THOUSAND_SUNNY_CONFIG.position}
        rotation={THOUSAND_SUNNY_CONFIG.rotation}
        onClick={(e) => {
          e.stopPropagation();
          selectArea("sunny_shipyard");
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHoveredArea("sunny_shipyard");
        }}
        onPointerOut={() => setHoveredArea(null)}
      >
        <group ref={shipRef}>
          <primitive object={sunnyScene} scale={normalizedScale} />
        </group>

        {/* Selection Ring around Thousand Sunny */}
        {(isSelected || isHovered) && (
          <mesh position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[7.0, 7.8, 36]} />
            <meshBasicMaterial
              color="#06b6d4"
              side={THREE.DoubleSide}
              transparent
              opacity={0.85}
            />
          </mesh>
        )}
      </group>

      {/* 3 Ocean Splash Geysers / Fountains (Image 2) */}
      <ThreeOceanGeysers />

      {/* Long Wooden Mooring Pier Connecting Southwest Shore to Sunny (Image 2) */}
      <WoodenMooringPier />
    </group>
  );
}

useGLTF.preload(THOUSAND_SUNNY_CONFIG.modelPath);
