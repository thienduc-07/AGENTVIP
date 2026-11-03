"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";

export interface CorporateBuildingProps {
  activeFloor?: number; // 0 for all floors, 1 to 6 for specific floor
  isFloorIsolated?: boolean;
  onSelectFloor?: (floor: number) => void;
}

export const FLOOR_HEIGHT = 6.0;
export const TOTAL_FLOORS = 6;
export const BUILDING_WIDTH = 36.0;
export const BUILDING_DEPTH = 26.0;

export const FLOOR_METADATA = [
  { floor: 1, name: "LỄ TÂN & OPS", code: "T1", subtitle: "Lễ Tân & Ops", color: "#06b6d4", baseElevation: 0.0 },
  { floor: 2, name: "THIẾT KẾ", code: "T2", subtitle: "Thiết Kế", color: "#ec4899", baseElevation: 6.0 },
  { floor: 3, name: "MARKETING", code: "T3", subtitle: "Marketing", color: "#f59e0b", baseElevation: 12.0 },
  { floor: 4, name: "NGÂN HÀNG", code: "T4", subtitle: "Ngân Hàng", color: "#8b5cf6", baseElevation: 18.0 },
  { floor: 5, name: "KỸ THUẬT", code: "T5", subtitle: "Kỹ Thuật", color: "#10b981", baseElevation: 24.0 },
  { floor: 6, name: "CEO SUITE", code: "T6", subtitle: "CEO Suite", color: "#38bdf8", baseElevation: 30.0 },
];

// Shared Structural Geometries & Materials (Singletons)
const CORNER_COL_GEOMETRY = new THREE.BoxGeometry(0.75, 36.4, 0.75);
const CORNER_COL_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#f8fafc",
  metalness: 0.85,
  roughness: 0.2,
});

const LOUVER_GEOMETRY = new THREE.BoxGeometry(0.2, 36.0, 0.25);
const LOUVER_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#e2e8f0",
  metalness: 0.8,
  roughness: 0.25,
});

const WINDOW_GEOMETRY = new THREE.PlaneGeometry(4.4, 35.0);
const WINDOW_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: "#e0f2fe",
  transmission: 0.94,
  opacity: 0.35,
  transparent: true,
  roughness: 0.08,
  metalness: 0.1,
});

const MULLION_GEOMETRY = new THREE.BoxGeometry(0.22, 36.0, 0.12);
const MULLION_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#cbd5e1",
  metalness: 0.9,
  roughness: 0.15,
});

const SPANDREL_GEOMETRY = new THREE.BoxGeometry(0.35, 0.55, 26.0);
const SPANDREL_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#f8fafc",
  metalness: 0.85,
  roughness: 0.2,
});

const STEP_GEOMETRY = new THREE.BoxGeometry(1.4, 0.1, 0.45);
const STEP_MATERIAL = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.3, metalness: 0.1 });
const HANDRAIL_GEOMETRY = new THREE.CylinderGeometry(0.03, 0.03, 3.8);
const HANDRAIL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#cbd5e1", metalness: 0.95, roughness: 0.1 });
const LANDING_GEOMETRY = new THREE.BoxGeometry(3.2, 0.15, 1.5);
const LANDING_MATERIAL = new THREE.MeshStandardMaterial({ color: "#f1f5f9", metalness: 0.4, roughness: 0.3 });

function InstancedStaircase() {
  const stepsRef = useRef<THREE.InstancedMesh>(null);
  const handrailsRef = useRef<THREE.InstancedMesh>(null);
  const landingsRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    let stepCount = 0;
    let handrailCount = 0;

    for (let stairIdx = 0; stairIdx < 5; stairIdx++) {
      const sy = stairIdx * 6.0;

      // Flight 1: 6 steps
      for (let s = 0; s < 6; s++) {
        dummy.position.set(-0.8, sy + s * 0.5 + 0.25, -0.2 - s * 0.45);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        stepsRef.current?.setMatrixAt(stepCount++, dummy.matrix);
      }

      // Mid-floor landing
      dummy.position.set(0, sy + 3.0, -0.2 - 2.8);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      landingsRef.current?.setMatrixAt(stairIdx, dummy.matrix);

      // Flight 2: 6 steps
      for (let s = 0; s < 6; s++) {
        dummy.position.set(0.8, sy + 3.25 + s * 0.5, -0.2 - 2.4 + s * 0.45);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        stepsRef.current?.setMatrixAt(stepCount++, dummy.matrix);
      }

      // Handrails (Flight 1 & Flight 2)
      dummy.position.set(-1.5, sy + 1.8, -0.2 - 1.2);
      dummy.rotation.set(0.45, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      handrailsRef.current?.setMatrixAt(handrailCount++, dummy.matrix);

      dummy.position.set(1.5, sy + 4.8, -0.2 - 1.2);
      dummy.rotation.set(-0.45, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      handrailsRef.current?.setMatrixAt(handrailCount++, dummy.matrix);
    }

    if (stepsRef.current) stepsRef.current.instanceMatrix.needsUpdate = true;
    if (handrailsRef.current) handrailsRef.current.instanceMatrix.needsUpdate = true;
    if (landingsRef.current) landingsRef.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <instancedMesh ref={stepsRef} args={[STEP_GEOMETRY, STEP_MATERIAL, 60]} />
      <instancedMesh ref={landingsRef} args={[LANDING_GEOMETRY, LANDING_MATERIAL, 5]} />
      <instancedMesh ref={handrailsRef} args={[HANDRAIL_GEOMETRY, HANDRAIL_MATERIAL, 10]} />
    </group>
  );
}

const CEILING_LIGHT_GEOMETRY = new THREE.BoxGeometry(0.4, 0.03, 22.0);

function CorporateBuilding({
  activeFloor = 0,
  isFloorIsolated = false,
  onSelectFloor,
}: CorporateBuildingProps) {
  const animatedElevatorRef = useRef<THREE.Group>(null);
  const helicopterRotorRef = useRef<THREE.Group>(null);
  const helicopterTailRotorRef = useRef<THREE.Group>(null);

  // Animations: Elevator traverse & Helicopter rotor spin
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // Smooth sinusoidal elevator movement between Floor 1 (Y=0.5) and Floor 5 (Y=24.5)
    if (animatedElevatorRef.current) {
      const elevatorY = 12.5 + Math.sin(t * 0.35) * 11.5;
      animatedElevatorRef.current.position.y = elevatorY;
    }

    // Gentle idling rotor blade rotation for rooftop corporate helicopter
    if (helicopterRotorRef.current) {
      helicopterRotorRef.current.rotation.y = t * 6.0;
    }
    if (helicopterTailRotorRef.current) {
      helicopterTailRotorRef.current.rotation.x = t * 12.0;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* =========================================================================
          1. FOUNDATION PLAZA BASE SLAB (Light Granite)
          ========================================================================= */}
      <mesh receiveShadow position={[0, -0.25, 0]}>
        <boxGeometry args={[46.0, 0.5, 34.0]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* =========================================================================
          2. STRUCTURAL WHITE ALUMINUM CORNER COLUMNS (Y = 0 to 36m)
          ========================================================================= */}
      {[
        [-17.8, -12.8],
        [17.8, -12.8],
        [-17.8, 12.8],
        [17.8, 12.8],
      ].map(([x, z], idx) => (
        <mesh
          key={`col-${idx}`}
          position={[x, 18.0, z]}
          geometry={CORNER_COL_GEOMETRY}
          material={CORNER_COL_MATERIAL}
          castShadow
          receiveShadow
        />
      ))}

      {/* =========================================================================
          3. REAR (NORTH) ARCHITECTURAL CURTAIN WALL (Z = -13.0m)
          ========================================================================= */}
      <group position={[0, 18.0, -13.0]}>
        {/* Light warm gray architectural core backing wall */}
        <mesh receiveShadow>
          <boxGeometry args={[36.0, 36.0, 0.35]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.3} metalness={0.15} />
        </mesh>

        {/* Vertical Architectural Louvers / Mullions */}
        {[-15, -10, -5, 0, 5, 10, 15].map((x) => (
          <mesh
            key={`louver-${x}`}
            position={[x, 0, 0.22]}
            geometry={LOUVER_GEOMETRY}
            material={LOUVER_MATERIAL}
          />
        ))}

        {/* Clear daytime back windows */}
        {[-12.5, -7.5, -2.5, 2.5, 7.5, 12.5].map((x) => (
          <mesh
            key={`win-${x}`}
            position={[x, 0, 0.18]}
            geometry={WINDOW_GEOMETRY}
            material={WINDOW_MATERIAL}
          />
        ))}
      </group>

      {/* =========================================================================
          4. SIDE GLASS CURTAIN WALLS (WEST X = -18.0m & EAST X = +18.0m)
          ========================================================================= */}
      {[-18.0, 18.0].map((x, sideIdx) => (
        <group key={`side-wall-${sideIdx}`} position={[x, 18.0, 0]}>
          {/* Main Clear Architectural Glass Curtain Pane */}
          <mesh receiveShadow renderOrder={10}>
            <boxGeometry args={[0.15, 36.0, 26.0]} />
            <meshPhysicalMaterial
              color="#e0f2fe"
              transmission={0.95}
              roughness={0.05}
              transparent
              opacity={0.35}
              ior={1.5}
              reflectivity={0.7}
              depthWrite={true}
            />
          </mesh>

          {/* Structural Vertical Mullions every 4.5m along Z */}
          {[-11, -6.5, -2, 2.5, 7, 11.5].map((z) => (
            <mesh
              key={`mullion-${sideIdx}-${z}`}
              position={[0, 0, z]}
              geometry={MULLION_GEOMETRY}
              material={MULLION_MATERIAL}
            />
          ))}

          {/* Horizontal Spandrel Beams between Floors */}
          {[6.0, 12.0, 18.0, 24.0, 30.0].map((y) => (
            <mesh
              key={`spandrel-${sideIdx}-${y}`}
              position={[0, y - 18.0, 0]}
              geometry={SPANDREL_GEOMETRY}
              material={SPANDREL_MATERIAL}
            />
          ))}
        </group>
      ))}

      {/* =========================================================================
          5. ROOFTOP HELIPAD, CORPORATE HELICOPTER & TERRACE GARDEN (Y = 36.0m)
          ========================================================================= */}
      <group position={[0, 36.0, 0]}>
        {/* Main Roof Slab (Light Travertine) */}
        <mesh receiveShadow position={[0, 0.2, 0]}>
          <boxGeometry args={[36.4, 0.4, 26.4]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.3} metalness={0.15} />
        </mesh>

        {/* Crisp White Architectural Crown Perimeter Parapet */}
        <mesh position={[0, 0.9, -13.0]}>
          <boxGeometry args={[36.4, 1.2, 0.3]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[-18.0, 0.9, 0]}>
          <boxGeometry args={[0.3, 1.2, 26.4]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[18.0, 0.9, 0]}>
          <boxGeometry args={[0.3, 1.2, 26.4]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
        </mesh>

        {/* Clear Glass Balustrade on Rooftop Front (South) */}
        <mesh position={[0, 0.8, 13.0]}>
          <boxGeometry args={[36.0, 1.1, 0.06]} />
          <meshPhysicalMaterial
            color="#e0f2fe"
            transmission={0.95}
            transparent
            opacity={0.65}
            roughness={0.04}
          />
        </mesh>

        {/* ---------------------------------------------------------------------
            ROOFTOP HELIPAD (Centered at [0, 0.42, 0])
            --------------------------------------------------------------------- */}
        <group position={[0, 0.42, 0]}>
          {/* Helipad Circular Landing Deck */}
          <mesh receiveShadow position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[5.2, 48]} />
            <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.2} />
          </mesh>

          {/* White Outer Safety Circle */}
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[4.6, 4.9, 48]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>

          {/* Bold White Helipad 'H' Marking */}
          {/* Left Vertical Bar */}
          <mesh position={[-1.2, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.45, 3.2]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          {/* Right Vertical Bar */}
          <mesh position={[1.2, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.45, 3.2]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          {/* Center Crossbar */}
          <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2.0, 0.45]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>

          {/* Helipad Perimeter Green Warning Beacon Lights */}
          {[0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4].map((rad, idx) => (
            <mesh
              key={`heli-beacon-${idx}`}
              position={[Math.cos(rad) * 4.9, 0.08, Math.sin(rad) * 4.9]}
            >
              <cylinderGeometry args={[0.06, 0.06, 0.12, 12]} />
              <meshBasicMaterial color="#22c55e" />
            </mesh>
          ))}

          {/* -----------------------------------------------------------------
              CORPORATE TWIN-ENGINE HELICOPTER (White & Cyan Corporate Livery)
              ----------------------------------------------------------------- */}
          <group position={[0, 0.25, 0]}>
            {/* Landing Skids */}
            {[-0.9, 0.9].map((sx, idx) => (
              <group key={`skid-${idx}`} position={[sx, 0.12, 0]}>
                {/* Horizontal Runner Skid */}
                <mesh castShadow position={[0, 0, 0]}>
                  <boxGeometry args={[0.08, 0.06, 4.4]} />
                  <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.15} />
                </mesh>
                {/* Curved Front Tips */}
                <mesh position={[0, 0.1, 2.2]} rotation={[0.4, 0, 0]}>
                  <boxGeometry args={[0.08, 0.06, 0.4]} />
                  <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.15} />
                </mesh>
                {/* Vertical Struts connecting to fuselage */}
                {[-1.0, 1.0].map((sz, sIdx) => (
                  <mesh key={`strut-${idx}-${sIdx}`} position={[0, 0.28, sz]}>
                    <cylinderGeometry args={[0.03, 0.03, 0.5]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.15} />
                  </mesh>
                ))}
              </group>
            ))}

            {/* Aerodynamic Helicopter Fuselage */}
            <mesh castShadow receiveShadow position={[0, 1.05, 0.3]}>
              <boxGeometry args={[1.7, 1.35, 3.8]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.15} metalness={0.3} />
            </mesh>

            {/* Cyan Corporate Accent Stripe along Fuselage */}
            <mesh position={[0, 0.9, 0.3]}>
              <boxGeometry args={[1.72, 0.2, 3.82]} />
              <meshStandardMaterial color="#0284c7" roughness={0.2} metalness={0.5} />
            </mesh>

            {/* Rounded Cockpit Windscreen (Blue Glass) */}
            <mesh position={[0, 1.15, 2.1]} rotation={[-0.4, 0, 0]}>
              <boxGeometry args={[1.65, 0.85, 0.8]} />
              <meshPhysicalMaterial
                color="#0f172a"
                transmission={0.4}
                roughness={0.08}
                metalness={0.8}
              />
            </mesh>

            {/* Tail Boom extending backwards */}
            <mesh castShadow position={[0, 1.25, -2.8]}>
              <cylinderGeometry args={[0.2, 0.35, 3.4, 16]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.3} />
            </mesh>

            {/* Vertical Tail Fin */}
            <mesh castShadow position={[0, 1.85, -4.4]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.08, 1.1, 0.7]} />
              <meshStandardMaterial color="#0284c7" roughness={0.2} metalness={0.4} />
            </mesh>

            {/* Horizontal Tail Stabilizer Wings */}
            <mesh position={[0, 1.35, -4.2]}>
              <boxGeometry args={[1.5, 0.05, 0.35]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.2} />
            </mesh>

            {/* Tail Rotor (Animated Spin) */}
            <group ref={helicopterTailRotorRef} position={[0.1, 2.1, -4.5]}>
              <mesh>
                <boxGeometry args={[0.04, 0.9, 0.1]} />
                <meshStandardMaterial color="#0f172a" metalness={0.8} />
              </mesh>
            </group>

            {/* Main Rotor Mast & Engine Cowling */}
            <mesh position={[0, 1.8, 0.4]}>
              <cylinderGeometry args={[0.3, 0.45, 0.5, 16]} />
              <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
            </mesh>

            {/* Main Rotor Blades (Animated Spin) */}
            <group ref={helicopterRotorRef} position={[0, 2.1, 0.4]}>
              {/* Rotor Hub */}
              <mesh>
                <cylinderGeometry args={[0.22, 0.22, 0.12, 16]} />
                <meshStandardMaterial color="#0f172a" metalness={0.9} />
              </mesh>
              {/* 4 Main Carbon Fiber Rotor Blades */}
              {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rotAngle, rIdx) => (
                <mesh
                  key={`rotor-blade-${rIdx}`}
                  position={[Math.sin(rotAngle) * 2.6, 0, Math.cos(rotAngle) * 2.6]}
                  rotation={[0, rotAngle, 0]}
                >
                  <boxGeometry args={[0.22, 0.02, 5.0]} />
                  <meshStandardMaterial color="#020617" roughness={0.3} metalness={0.6} />
                </mesh>
              ))}
            </group>
          </group>
        </group>

        {/* ---------------------------------------------------------------------
            ROOFTOP LANDSCAPED TERRACE GARDEN (Lush Greenery, Seating, Pergolas)
            --------------------------------------------------------------------- */}
        {[-11.5, 11.5].map((tx, idx) => (
          <group key={`terrace-garden-${idx}`} position={[tx, 0.42, 0]}>
            {/* Lush Green Lawn Ground */}
            <mesh receiveShadow position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[9.5, 20.0]} />
              <meshStandardMaterial color="#22c55e" roughness={0.8} />
            </mesh>

            {/* Teak Wood Decking Accent Pathway */}
            <mesh receiveShadow position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[3.0, 19.5]} />
              <meshStandardMaterial color="#b45309" roughness={0.6} />
            </mesh>

            {/* Outdoor Lounge Sofas & Coffee Tables */}
            <group position={[idx === 0 ? -2.2 : 2.2, 0.25, 4.0]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[1.2, 0.5, 2.8]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.4} />
              </mesh>
              <mesh castShadow position={[1.2 * (idx === 0 ? 1 : -1), 0.15, 0]}>
                <boxGeometry args={[0.8, 0.25, 1.8]} />
                <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.5} />
              </mesh>
            </group>

            {/* Potted Ornamental Trees in White Cube Planters */}
            {[-6.0, 0.0, 6.0].map((pz, pIdx) => (
              <group key={`roof-tree-${idx}-${pIdx}`} position={[idx === 0 ? -2.8 : 2.8, 0, pz]}>
                <mesh castShadow position={[0, 0.45, 0]}>
                  <boxGeometry args={[0.9, 0.9, 0.9]} />
                  <meshStandardMaterial color="#ffffff" roughness={0.2} />
                </mesh>
                <mesh castShadow position={[0, 1.4, 0]}>
                  <cylinderGeometry args={[0.08, 0.1, 1.0, 8]} />
                  <meshStandardMaterial color="#78350f" roughness={0.8} />
                </mesh>
                <mesh castShadow position={[0, 2.2, 0]}>
                  <sphereGeometry args={[0.85, 12, 12]} />
                  <meshStandardMaterial color="#16a34a" roughness={0.7} />
                </mesh>
              </group>
            ))}
          </group>
        ))}

        {/* Corporate Communication Antenna & Red Navigation Beacon */}
        <group position={[-16.0, 4.0, -11.0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.08, 0.25, 7.5, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.1} />
          </mesh>
          <mesh position={[0, 3.8, 0]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <pointLight color="#ef4444" intensity={2.0} distance={15} position={[0, 3.8, 0]} />
        </group>
      </group>

      {/* =========================================================================
          6. CENTRAL GLASS ELEVATOR & STAIR CORE (X = 0, Z = -5 to -10m)
          ========================================================================= */}
      <group position={[0, 0, -7.5]}>
        {/* Core Rear Shear Wall Enclosure (Light Travertine) */}
        <mesh position={[0, 18.0, -1.8]} receiveShadow>
          <boxGeometry args={[11.0, 36.0, 0.3]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.3} roughness={0.3} />
        </mesh>

        {/* Core Side Walls */}
        {[-5.4, 5.4].map((cx, idx) => (
          <mesh key={`core-side-${idx}`} position={[cx, 18.0, 0.5]} receiveShadow>
            <boxGeometry args={[0.3, 36.0, 4.5]} />
            <meshStandardMaterial color="#f1f5f9" metalness={0.3} roughness={0.3} />
          </mesh>
        ))}

        {/* Twin Vertical Glass Elevator Shafts */}
        <mesh position={[-2.4, 18.0, 2.5]}>
          <boxGeometry args={[3.2, 36.0, 3.0]} />
          <meshPhysicalMaterial
            color="#e0f2fe"
            transmission={0.96}
            transparent
            opacity={0.2}
            roughness={0.06}
          />
        </mesh>
        <mesh position={[2.4, 18.0, 2.5]}>
          <boxGeometry args={[3.2, 36.0, 3.0]} />
          <meshPhysicalMaterial
            color="#e0f2fe"
            transmission={0.96}
            transparent
            opacity={0.2}
            roughness={0.06}
          />
        </mesh>

        {/* Vertical Elevator Guide Rails */}
        {[-3.8, -1.0, 1.0, 3.8].map((rx, idx) => (
          <mesh key={`rail-${idx}`} position={[rx, 18.0, 2.5]}>
            <boxGeometry args={[0.08, 36.0, 0.08]} />
            <meshStandardMaterial color="#38bdf8" metalness={0.9} roughness={0.1} />
          </mesh>
        ))}

        {/* ANIMATED GLASS ELEVATOR CAB 1 (Left Shaft, smoothly moving between floors) */}
        <group ref={animatedElevatorRef} position={[-2.4, 1.5, 2.5]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 2.8, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 1.4, 1.1]}>
            <boxGeometry args={[2.4, 2.7, 0.05]} />
            <meshPhysicalMaterial color="#e0f2fe" transmission={0.94} transparent opacity={0.6} roughness={0.08} />
          </mesh>
          <mesh position={[-1.2, 1.4, 0]}>
            <boxGeometry args={[0.05, 2.7, 2.2]} />
            <meshPhysicalMaterial color="#e0f2fe" transmission={0.94} transparent opacity={0.6} roughness={0.08} />
          </mesh>
          <mesh position={[1.2, 1.4, 0]}>
            <boxGeometry args={[0.05, 2.7, 2.2]} />
            <meshPhysicalMaterial color="#e0f2fe" transmission={0.94} transparent opacity={0.6} roughness={0.08} />
          </mesh>
          <pointLight color="#fffbeb" intensity={1.5} distance={6} position={[0, 2.5, 0]} />
        </group>

        {/* STATIONED ELEVATOR CAB 2 (Right Shaft, stationed at Executive Floor 6) */}
        <group position={[2.4, 31.5, 2.5]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 2.8, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 1.4, 1.1]}>
            <boxGeometry args={[2.4, 2.7, 0.05]} />
            <meshPhysicalMaterial color="#e0f2fe" transmission={0.94} transparent opacity={0.6} roughness={0.08} />
          </mesh>
          <pointLight color="#fffbeb" intensity={1.2} distance={6} position={[0, 2.5, 0]} />
        </group>

        {/* ARCHITECTURAL SWITCHBACK STAIRCASES */}
        <InstancedStaircase />
      </group>

      {/* =========================================================================
          7. SIX DETAILED FLOOR SLABS, CEILINGS & LEFT-EDGE ARCHITECTURAL SIGNAGE
          ========================================================================= */}
      {FLOOR_METADATA.map((info) => {
        const floorNum = info.floor;
        const elevation = info.baseElevation;
        const isCurrentFloorActive = activeFloor === floorNum;
        const isDimmed = isFloorIsolated && activeFloor > 0 && !isCurrentFloorActive;

        return (
          <group key={`floor-level-${floorNum}`} position={[0, elevation, 0]}>
            {/* Architectural Cozy Light Oak Floor Slab */}
            <mesh receiveShadow position={[0, -0.22, 0]}>
              <boxGeometry args={[BUILDING_WIDTH, 0.44, BUILDING_DEPTH]} />
              <meshStandardMaterial
                color="#ebd9c4"
                roughness={0.45}
                metalness={0.02}
                transparent={isDimmed}
                opacity={isDimmed ? 0.3 : 1.0}
              />
            </mesh>

            {/* Crisp White Architectural Fascia Trim on Slab Edge */}
            <mesh position={[0, -0.22, 13.02]}>
              <boxGeometry args={[BUILDING_WIDTH + 0.1, 0.46, 0.08]} />
              <meshStandardMaterial
                color={isCurrentFloorActive ? info.color : "#ffffff"}
                metalness={0.7}
                roughness={0.2}
              />
            </mesh>

            {/* Recessed Ceiling with Embedded LED Downlight Strips */}
            <group position={[0, 5.78, 0]}>
              {/* White Ceiling Acoustic Plane */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[BUILDING_WIDTH - 0.2, 0.08, BUILDING_DEPTH - 0.2]} />
                <meshStandardMaterial
                  color="#ffffff"
                  roughness={0.4}
                  metalness={0.05}
                  transparent={isDimmed}
                  opacity={isDimmed ? 0.2 : 0.98}
                />
              </mesh>

              {/* Longitudinal Recessed Ceiling Warm LED Strips */}
              {[-8.0, 0.0, 8.0].map((lx, lIdx) => (
                <mesh
                  key={`ceiling-light-${floorNum}-${lIdx}`}
                  position={[lx, -0.05, 0]}
                  geometry={CEILING_LIGHT_GEOMETRY}
                >
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive={isDimmed ? "#cbd5e1" : "#fffbeb"}
                    emissiveIntensity={isDimmed ? 0.2 : 0.85}
                  />
                </mesh>
              ))}

              {/* Department Floor Accent Ambient Light */}
              {!isDimmed && (
                <pointLight
                  color={info.color}
                  intensity={0.35}
                  distance={18}
                  position={[0, -0.5, 0]}
                />
              )}
            </group>

            {/* South Open Cutaway Toughened Glass Balustrade (Height = 1.1m) */}
            <group position={[0, 0.55, 12.95]} renderOrder={10}>
              <mesh>
                <boxGeometry args={[BUILDING_WIDTH - 0.8, 1.1, 0.05]} />
                <meshPhysicalMaterial
                  color="#e0f2fe"
                  transmission={0.95}
                  transparent
                  opacity={isDimmed ? 0.15 : 0.55}
                  roughness={0.04}
                  ior={1.5}
                  depthWrite={true}
                />
              </mesh>
              <mesh position={[0, 0.55, 0]}>
                <boxGeometry args={[BUILDING_WIDTH - 0.6, 0.08, 0.1]} />
                <meshStandardMaterial color="#f8fafc" metalness={0.9} roughness={0.15} />
              </mesh>
            </group>

            {/* =================================================================
                COMPACT ARCHITECTURAL FLOOR SIGNAGE (ALIGNED ON EXTERIOR LEFT EDGE)
                Matching reference image: T6 CEO Suite, T5 Kỹ Thuật, etc.
                ================================================================= */}
            <group
              position={[-20.2, 3.0, 4.0]}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectFloor) onSelectFloor(floorNum);
              }}
            >
              <Html
                position={[0, 0, 0]}
                center
                distanceFactor={22}
                className="select-none"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectFloor) onSelectFloor(floorNum);
                  }}
                  className={`group px-3 py-2 rounded-xl flex items-center gap-2.5 transition-all duration-200 cursor-pointer shadow-lg whitespace-nowrap backdrop-blur-md border ${
                    isCurrentFloorActive
                      ? "bg-slate-900/95 border-sky-400 text-sky-100 ring-2 ring-sky-400/50 shadow-sky-500/30 scale-105"
                      : "bg-slate-900/80 hover:bg-slate-900/95 border-slate-700/70 text-slate-200 hover:border-slate-500 hover:scale-102"
                  }`}
                >
                  {/* Floor Code Pill */}
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono font-black text-[11px] tracking-wider text-white shadow-sm`}
                    style={{ backgroundColor: info.color }}
                  >
                    {info.code}
                  </span>

                  {/* Floor Name */}
                  <span className="font-semibold text-xs tracking-wide">
                    {info.subtitle}
                  </span>
                </button>
              </Html>
            </group>

            {/* Perimeter Glow Halo when floor is actively focused */}
            {isCurrentFloorActive && (
              <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[BUILDING_WIDTH + 0.4, BUILDING_DEPTH + 0.4]} />
                <meshBasicMaterial
                  color={info.color}
                  transparent
                  opacity={0.25}
                  wireframe
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

export default React.memo(CorporateBuilding, (prev, next) => {
  return prev.activeFloor === next.activeFloor && prev.isFloorIsolated === next.isFloorIsolated;
});
