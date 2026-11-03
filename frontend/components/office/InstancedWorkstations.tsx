"use client";

import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { WorkstationData } from "./Workstation";
import { CANONICAL_STATE_CONFIGS } from "@/types/office";
import { getDepartmentFloor } from "@/hooks/useOfficeSync";

interface InstancedWorkstationsProps {
  workstations: Record<string, WorkstationData>;
  selectedWorkstationId?: string | null;
  activeFloor?: number;
  isFloorIsolated?: boolean;
  onSelectWorkstation?: (workstationId: string) => void;
}

// Shared Workstation Geometries (Singletons)
const DESK_TOP_GEOMETRY = new THREE.BoxGeometry(2.2, 0.05, 1.0);
const DESK_LEG_GEOMETRY = new THREE.BoxGeometry(0.06, 0.72, 0.88);
const DESK_FOOT_GEOMETRY = new THREE.BoxGeometry(0.1, 0.03, 0.94);

const MONITOR_POLE_GEOMETRY = new THREE.CylinderGeometry(0.02, 0.025, 0.35, 8);
const MONITOR_WIDE_BODY_GEOMETRY = new THREE.BoxGeometry(1.05, 0.46, 0.03);
const SCREEN_WIDE_FACE_GEOMETRY = new THREE.PlaneGeometry(1.01, 0.42);
const MONITOR_PORT_BODY_GEOMETRY = new THREE.BoxGeometry(0.34, 0.46, 0.03);
const SCREEN_PORT_FACE_GEOMETRY = new THREE.PlaneGeometry(0.31, 0.42);

const CHAIR_CASTER_GEOMETRY = new THREE.CylinderGeometry(0.28, 0.28, 0.04, 5);
const CHAIR_POLE_GEOMETRY = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8);
const CHAIR_CUSHION_GEOMETRY = new THREE.BoxGeometry(0.5, 0.08, 0.48);
const CHAIR_BACKREST_GEOMETRY = new THREE.BoxGeometry(0.46, 0.52, 0.05);

const HALO_GEOMETRY = new THREE.PlaneGeometry(2.7, 2.2);

// Shared Workstation Materials (Singletons)
const DESK_WOOD_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#d4a373",
  roughness: 0.4,
  metalness: 0.05,
});
const STEEL_FRAME_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  metalness: 0.85,
  roughness: 0.2,
});
const SCREEN_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#090d16",
  roughness: 0.2,
});
const CHAIR_POLE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#334155",
  metalness: 0.8,
});
const CHAIR_CUSHION_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#1e293b",
  roughness: 0.7,
});
const CHAIR_BACKREST_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  roughness: 0.6,
});
const HALO_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#38bdf8",
  transparent: true,
  opacity: 0.4,
});

export default function InstancedWorkstations({
  workstations,
  selectedWorkstationId,
  activeFloor = 0,
  isFloorIsolated = false,
  onSelectWorkstation,
}: InstancedWorkstationsProps) {
  // Filter workstations based on active floor and isolation mode
  const visibleWorkstations = useMemo(() => {
    return Object.values(workstations).filter((ws) => {
      const floor = getDepartmentFloor(ws.department);
      return !isFloorIsolated || activeFloor === 0 || floor === activeFloor;
    });
  }, [workstations, activeFloor, isFloorIsolated]);

  const count = visibleWorkstations.length;
  const doubleCount = count * 2;

  // Refs for each instanced mesh
  const deskTopRef = useRef<THREE.InstancedMesh>(null);
  const deskLegsRef = useRef<THREE.InstancedMesh>(null);
  const deskFeetRef = useRef<THREE.InstancedMesh>(null);
  const monPoleRef = useRef<THREE.InstancedMesh>(null);
  const monWideBodyRef = useRef<THREE.InstancedMesh>(null);
  const monWideScreenRef = useRef<THREE.InstancedMesh>(null);
  const monPortBodyRef = useRef<THREE.InstancedMesh>(null);
  const monPortScreenRef = useRef<THREE.InstancedMesh>(null);
  const chairCasterRef = useRef<THREE.InstancedMesh>(null);
  const chairPoleRef = useRef<THREE.InstancedMesh>(null);
  const chairCushionRef = useRef<THREE.InstancedMesh>(null);
  const chairBackrestRef = useRef<THREE.InstancedMesh>(null);

  // Position and update all matrices when visible workstations change
  useEffect(() => {
    if (count === 0) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    visibleWorkstations.forEach((ws, i) => {
      const wx = ws.pos_x;
      const wy = ws.pos_y || 0;
      const wz = ws.pos_z;

      // Determine screen emissive color from occupant state
      const isOccupied = ws.occupancy_status === "occupied" || !!ws.assigned_employee;
      const state = ws.occupant_state || "IDLE";
      const config = CANONICAL_STATE_CONFIGS[state] || CANONICAL_STATE_CONFIGS.IDLE;
      const screenHex = isOccupied ? config.monitorColor : "#1e293b";
      color.set(screenHex);

      // 1. Desk Top [wx, wy + 0.73, wz]
      dummy.position.set(wx, wy + 0.73, wz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      deskTopRef.current?.setMatrixAt(i, dummy.matrix);

      // 2. Desk Legs (Left: wx - 0.98, Right: wx + 0.98)
      const legIdx1 = i * 2;
      const legIdx2 = i * 2 + 1;
      dummy.position.set(wx - 0.98, wy + 0.36, wz);
      dummy.updateMatrix();
      deskLegsRef.current?.setMatrixAt(legIdx1, dummy.matrix);
      dummy.position.set(wx - 0.98, wy + 0.015, wz);
      dummy.updateMatrix();
      deskFeetRef.current?.setMatrixAt(legIdx1, dummy.matrix);

      dummy.position.set(wx + 0.98, wy + 0.36, wz);
      dummy.updateMatrix();
      deskLegsRef.current?.setMatrixAt(legIdx2, dummy.matrix);
      dummy.position.set(wx + 0.98, wy + 0.015, wz);
      dummy.updateMatrix();
      deskFeetRef.current?.setMatrixAt(legIdx2, dummy.matrix);

      // 3. Monitor Rig
      // Pole
      dummy.position.set(wx, wy + 0.76 + 0.16, wz - 0.35);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      monPoleRef.current?.setMatrixAt(i, dummy.matrix);

      // Main Ultrawide Monitor Body & Screen
      dummy.position.set(wx, wy + 0.76 + 0.32, wz - 0.25);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      monWideBodyRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(wx, wy + 0.76 + 0.32, wz - 0.25 + 0.018);
      dummy.updateMatrix();
      monWideScreenRef.current?.setMatrixAt(i, dummy.matrix);
      monWideScreenRef.current?.setColorAt(i, color);

      // Secondary Portrait Monitor Body & Screen
      dummy.position.set(wx - 0.68, wy + 0.76 + 0.32, wz - 0.25 + 0.06);
      dummy.rotation.set(0, 0.32, 0);
      dummy.updateMatrix();
      monPortBodyRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(wx - 0.68 + Math.sin(0.32) * 0.018, wy + 0.76 + 0.32, wz - 0.25 + 0.06 + Math.cos(0.32) * 0.018);
      dummy.updateMatrix();
      monPortScreenRef.current?.setMatrixAt(i, dummy.matrix);
      monPortScreenRef.current?.setColorAt(i, color);

      // 4. Ergonomic Chair (Facing desk, rotated 180 degrees)
      const chairZ = wz + 0.55;
      dummy.rotation.set(0, Math.PI, 0);

      dummy.position.set(wx, wy + 0.06, chairZ);
      dummy.updateMatrix();
      chairCasterRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(wx, wy + 0.24, chairZ);
      dummy.updateMatrix();
      chairPoleRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(wx, wy + 0.44, chairZ);
      dummy.updateMatrix();
      chairCushionRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(wx, wy + 0.72, chairZ + 0.22);
      dummy.rotation.set(0.08, Math.PI, 0);
      dummy.updateMatrix();
      chairBackrestRef.current?.setMatrixAt(i, dummy.matrix);
    });

    // Mark instance matrices and colors as updated
    [
      deskTopRef,
      deskLegsRef,
      deskFeetRef,
      monPoleRef,
      monWideBodyRef,
      monWideScreenRef,
      monPortBodyRef,
      monPortScreenRef,
      chairCasterRef,
      chairPoleRef,
      chairCushionRef,
      chairBackrestRef,
    ].forEach((ref) => {
      if (ref.current) {
        ref.current.instanceMatrix.needsUpdate = true;
      }
    });

    if (monWideScreenRef.current?.instanceColor) {
      monWideScreenRef.current.instanceColor.needsUpdate = true;
    }
    if (monPortScreenRef.current?.instanceColor) {
      monPortScreenRef.current.instanceColor.needsUpdate = true;
    }
  }, [visibleWorkstations, count]);

  // Click handler resolving instanceId -> workstation_id
  const handleInstancedClick = (e: any) => {
    e.stopPropagation();
    const instId = e.instanceId;
    if (instId !== undefined && instId !== null && instId >= 0 && instId < visibleWorkstations.length) {
      const ws = visibleWorkstations[instId];
      if (ws && onSelectWorkstation) {
        onSelectWorkstation(ws.workstation_id);
      }
    }
  };

  const selectedWs = selectedWorkstationId ? workstations[selectedWorkstationId] : null;

  if (count === 0) return null;

  return (
    <group onClick={handleInstancedClick}>
      {/* 1. Desk Tops (Cast Shadow) */}
      <instancedMesh
        ref={deskTopRef}
        args={[DESK_TOP_GEOMETRY, DESK_WOOD_MATERIAL, count]}
        castShadow
        receiveShadow
      />

      {/* 2. Desk Legs & Feet */}
      <instancedMesh
        ref={deskLegsRef}
        args={[DESK_LEG_GEOMETRY, STEEL_FRAME_MATERIAL, doubleCount]}
      />
      <instancedMesh
        ref={deskFeetRef}
        args={[DESK_FOOT_GEOMETRY, STEEL_FRAME_MATERIAL, doubleCount]}
      />

      {/* 3. Dual Monitor Stands, Bodies & Screens */}
      <instancedMesh
        ref={monPoleRef}
        args={[MONITOR_POLE_GEOMETRY, STEEL_FRAME_MATERIAL, count]}
      />
      <instancedMesh
        ref={monWideBodyRef}
        args={[MONITOR_WIDE_BODY_GEOMETRY, STEEL_FRAME_MATERIAL, count]}
      />
      <instancedMesh
        ref={monWideScreenRef}
        args={[SCREEN_WIDE_FACE_GEOMETRY, SCREEN_MATERIAL, count]}
      />
      <instancedMesh
        ref={monPortBodyRef}
        args={[MONITOR_PORT_BODY_GEOMETRY, STEEL_FRAME_MATERIAL, count]}
      />
      <instancedMesh
        ref={monPortScreenRef}
        args={[SCREEN_PORT_FACE_GEOMETRY, SCREEN_MATERIAL, count]}
      />

      {/* 4. Ergonomic Chairs */}
      <instancedMesh
        ref={chairCasterRef}
        args={[CHAIR_CASTER_GEOMETRY, STEEL_FRAME_MATERIAL, count]}
      />
      <instancedMesh
        ref={chairPoleRef}
        args={[CHAIR_POLE_GEOMETRY, CHAIR_POLE_MATERIAL, count]}
      />
      <instancedMesh
        ref={chairCushionRef}
        args={[CHAIR_CUSHION_GEOMETRY, CHAIR_CUSHION_MATERIAL, count]}
      />
      <instancedMesh
        ref={chairBackrestRef}
        args={[CHAIR_BACKREST_GEOMETRY, CHAIR_BACKREST_MATERIAL, count]}
      />

      {/* 5. Selected Workstation Highlight Floor Halo */}
      {selectedWs && (
        <mesh
          position={[selectedWs.pos_x, (selectedWs.pos_y || 0) + 0.008, selectedWs.pos_z]}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={HALO_GEOMETRY}
          material={HALO_MATERIAL}
        />
      )}
    </group>
  );
}

