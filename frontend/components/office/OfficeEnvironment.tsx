"use client";

import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";

interface SkylineBuilding {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  isGlass: boolean;
}

const UNIT_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const SKYLINE_GLASS_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  roughness: 0.15,
  metalness: 0.85,
});
const SKYLINE_SOLID_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#1e293b",
  roughness: 0.75,
  metalness: 0.25,
});

export default function OfficeEnvironment() {
  const glassRef = useRef<THREE.InstancedMesh>(null);
  const solidRef = useRef<THREE.InstancedMesh>(null);

  // Procedural futuristic metropolis backdrop scaled for a multi-floor skyscraper
  const { glassBuildings, solidBuildings } = useMemo(() => {
    const glass: SkylineBuilding[] = [];
    const solid: SkylineBuilding[] = [];
    const count = 48;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 75 + ((i * 17) % 35);
      const width = 10 + ((i * 13) % 12);
      const depth = 10 + ((i * 11) % 12);
      const height = 45 + ((i * 29) % 65);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const isGlass = i % 3 !== 0;

      const item: SkylineBuilding = { id: i, x, z, width, depth, height, isGlass };
      if (isGlass) glass.push(item);
      else solid.push(item);
    }

    return { glassBuildings: glass, solidBuildings: solid };
  }, []);

  useEffect(() => {
    const dummy = new THREE.Object3D();

    // 1. Position and scale glass skyscraper instances
    glassBuildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height / 2 - 4, b.z);
      dummy.scale.set(b.width, b.height, b.depth);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      glassRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (glassRef.current) {
      glassRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. Position and scale solid skyscraper instances
    solidBuildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height / 2 - 4, b.z);
      dummy.scale.set(b.width, b.height, b.depth);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      solidRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (solidRef.current) {
      solidRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [glassBuildings, solidBuildings]);

  return (
    <group>
      {/* Instanced Glass Skyline Skyscrapers (1 Draw Call) */}
      <instancedMesh
        ref={glassRef}
        args={[UNIT_BOX_GEOMETRY, SKYLINE_GLASS_MATERIAL, glassBuildings.length]}
        receiveShadow
      />

      {/* Instanced Solid Concrete Skyscrapers (1 Draw Call) */}
      <instancedMesh
        ref={solidRef}
        args={[UNIT_BOX_GEOMETRY, SKYLINE_SOLID_MATERIAL, solidBuildings.length]}
        receiveShadow
      />
    </group>
  );
}
