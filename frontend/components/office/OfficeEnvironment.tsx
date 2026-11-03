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
  style: number; // 0 = blue glass tower, 1 = silver corporate, 2 = white modern
}

interface EnvironmentTree {
  x: number;
  z: number;
  scale: number;
}

const UNIT_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const TREE_TRUNK_GEOMETRY = new THREE.CylinderGeometry(0.2, 0.35, 2.5, 8);
const TREE_FOLIAGE_GEOMETRY = new THREE.DodecahedronGeometry(1.4, 1);

// Modern Daylight Architectural Materials
const SKYLINE_GLASS_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#38bdf8",
  roughness: 0.1,
  metalness: 0.85,
});

const SKYLINE_SILVER_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#f8fafc",
  roughness: 0.25,
  metalness: 0.65,
});

const SKYLINE_WHITE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#e2e8f0",
  roughness: 0.4,
  metalness: 0.25,
});

const TREE_TRUNK_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#78350f",
  roughness: 0.8,
});

const TREE_FOLIAGE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#16a34a",
  roughness: 0.6,
  metalness: 0.05,
});

export default function OfficeEnvironment() {
  const glassRef = useRef<THREE.InstancedMesh>(null);
  const silverRef = useRef<THREE.InstancedMesh>(null);
  const whiteRef = useRef<THREE.InstancedMesh>(null);
  const treeTrunkRef = useRef<THREE.InstancedMesh>(null);
  const treeFoliageRef = useRef<THREE.InstancedMesh>(null);

  // 1. Dense International Metropolis Skyline (60 Skyscrapers clustered West, East and North)
  const { glassBuildings, silverBuildings, whiteBuildings } = useMemo(() => {
    const glass: SkylineBuilding[] = [];
    const silver: SkylineBuilding[] = [];
    const white: SkylineBuilding[] = [];

    const rawList: Array<{ x: number; z: number; w: number; d: number; h: number; s: number }> = [];

    // Cluster A: West Riverside Skyline (Visible behind the river on the left)
    for (let i = 0; i < 24; i++) {
      const x = -50 - (i % 6) * 9 - ((i * 7) % 6);
      const z = -45 + Math.floor(i / 6) * 22 - ((i * 11) % 8);
      const w = 10 + ((i * 7) % 10);
      const d = 10 + ((i * 5) % 10);
      const h = 42 + ((i * 17) % 75);
      const s = i % 3;
      rawList.push({ x, z, w, d, h, s });
    }

    // Cluster B: East Corporate Tech District
    for (let i = 0; i < 20; i++) {
      const x = 46 + (i % 5) * 10 + ((i * 5) % 8);
      const z = -40 + Math.floor(i / 5) * 20 - ((i * 9) % 7);
      const w = 11 + ((i * 6) % 9);
      const d = 11 + ((i * 7) % 9);
      const h = 38 + ((i * 19) % 65);
      const s = (i + 1) % 3;
      rawList.push({ x, z, w, d, h, s });
    }

    // Cluster C: North Horizon Backdrop Towers
    for (let i = 0; i < 16; i++) {
      const x = -36 + (i % 8) * 11;
      const z = -55 - Math.floor(i / 8) * 20 - ((i * 7) % 10);
      const w = 12 + ((i * 4) % 10);
      const d = 12 + ((i * 6) % 10);
      const h = 55 + ((i * 23) % 80);
      const s = (i + 2) % 3;
      rawList.push({ x, z, w, d, h, s });
    }

    rawList.forEach((item, idx) => {
      const b: SkylineBuilding = {
        id: idx,
        x: item.x,
        z: item.z,
        width: item.w,
        depth: item.d,
        height: item.h,
        style: item.s,
      };
      if (b.style === 0) glass.push(b);
      else if (b.style === 1) silver.push(b);
      else white.push(b);
    });

    return { glassBuildings: glass, silverBuildings: silver, whiteBuildings: white };
  }, []);

  // 2. Procedural Waterfront & Parklands Instanced Trees (70 Trees)
  const trees = useMemo(() => {
    const list: EnvironmentTree[] = [];
    // West Riverbank Promenade Trees
    for (let i = 0; i < 35; i++) {
      const z = -50 + i * 3.2;
      const x = -34 - ((i * 5) % 6);
      list.push({ x, z, scale: 0.9 + ((i * 13) % 40) / 100 });
    }
    // East Boulevard Landscaped Trees
    for (let i = 0; i < 25; i++) {
      const z = -40 + i * 3.6;
      const x = 32 + ((i * 7) % 6);
      list.push({ x, z, scale: 0.85 + ((i * 17) % 35) / 100 });
    }
    // South Plaza Entrance Flanking Trees
    [-18, -14, 14, 18].forEach((px, idx) => {
      [22, 28].forEach((pz, pIdx) => {
        list.push({ x: px, z: pz, scale: 1.1 + ((idx + pIdx) % 3) * 0.1 });
      });
    });

    return list;
  }, []);

  // Synchronize instanced meshes
  useEffect(() => {
    const dummy = new THREE.Object3D();

    const populateInstances = (
      ref: React.RefObject<THREE.InstancedMesh | null>,
      items: SkylineBuilding[]
    ) => {
      if (!ref.current) return;
      items.forEach((b, i) => {
        dummy.position.set(b.x, b.height / 2, b.z);
        dummy.scale.set(b.width, b.height, b.depth);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        ref.current?.setMatrixAt(i, dummy.matrix);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    };

    populateInstances(glassRef, glassBuildings);
    populateInstances(silverRef, silverBuildings);
    populateInstances(whiteRef, whiteBuildings);

    // Populate Trees
    if (treeTrunkRef.current && treeFoliageRef.current) {
      trees.forEach((t, i) => {
        // Trunk
        dummy.position.set(t.x, 1.25 * t.scale, t.z);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        treeTrunkRef.current?.setMatrixAt(i, dummy.matrix);

        // Foliage Crown
        dummy.position.set(t.x, 3.2 * t.scale, t.z);
        dummy.scale.set(t.scale * 1.3, t.scale * 1.5, t.scale * 1.3);
        dummy.updateMatrix();
        treeFoliageRef.current?.setMatrixAt(i, dummy.matrix);
      });

      treeTrunkRef.current.instanceMatrix.needsUpdate = true;
      treeFoliageRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [glassBuildings, silverBuildings, whiteBuildings, trees]);

  return (
    <group position={[0, -0.05, 0]}>
      {/* =========================================================================
          1. NATURAL DAYLIGHT WATER FEATURE (West River & Promenade Quay)
          ========================================================================= */}
      {/* River Water Surface */}
      <mesh position={[-52, -0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[32, 280]} />
        <meshPhysicalMaterial
          color="#38bdf8"
          roughness={0.05}
          metalness={0.8}
          transmission={0.4}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          reflectivity={0.9}
        />
      </mesh>

      {/* River Stone Promenade Embankment (Quay Wall) */}
      <mesh receiveShadow position={[-36.2, 0.4, 0]}>
        <boxGeometry args={[1.6, 1.2, 280]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.15} />
      </mesh>

      {/* Promenade Waterfront Walkway */}
      <mesh receiveShadow position={[-33, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5, 280]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.35} metalness={0.1} />
      </mesh>

      {/* =========================================================================
          2. LUSH GREEN PARKLANDS & BOULEVARD LAWNS
          ========================================================================= */}
      {/* West Riverbank Park Lawn */}
      <mesh receiveShadow position={[-26, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 280]} />
        <meshStandardMaterial color="#22c55e" roughness={0.75} />
      </mesh>

      {/* East Boulevard Park Lawn */}
      <mesh receiveShadow position={[30, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 280]} />
        <meshStandardMaterial color="#16a34a" roughness={0.75} />
      </mesh>

      {/* Distant Ground Base Plane (Extends to horizon) */}
      <mesh receiveShadow position={[0, -0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.8} />
      </mesh>

      {/* =========================================================================
          3. INSTANCED MODERN DAYTIME SKYSCRAPERS (Zero Individual Draw Calls)
          ========================================================================= */}
      <instancedMesh
        ref={glassRef}
        args={[UNIT_BOX_GEOMETRY, SKYLINE_GLASS_MATERIAL, glassBuildings.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={silverRef}
        args={[UNIT_BOX_GEOMETRY, SKYLINE_SILVER_MATERIAL, silverBuildings.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={whiteRef}
        args={[UNIT_BOX_GEOMETRY, SKYLINE_WHITE_MATERIAL, whiteBuildings.length]}
        castShadow
        receiveShadow
      />

      {/* =========================================================================
          4. INSTANCED PROMENADE & BOULEVARD TREES
          ========================================================================= */}
      <instancedMesh
        ref={treeTrunkRef}
        args={[TREE_TRUNK_GEOMETRY, TREE_TRUNK_MATERIAL, trees.length]}
        castShadow
      />
      <instancedMesh
        ref={treeFoliageRef}
        args={[TREE_FOLIAGE_GEOMETRY, TREE_FOLIAGE_MATERIAL, trees.length]}
        castShadow
      />
    </group>
  );
}
