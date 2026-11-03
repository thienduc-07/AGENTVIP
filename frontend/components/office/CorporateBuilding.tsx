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
  { floor: 1, name: "LỄ TÂN & VẬN HÀNH", nameEn: "Reception & Operations", color: "#06b6d4", baseElevation: 0.0 },
  { floor: 2, name: "THIẾT KẾ & SÁNG TẠO", nameEn: "Design & Creative", color: "#ec4899", baseElevation: 6.0 },
  { floor: 3, name: "TIẾP THỊ & TĂNG TRƯỞNG", nameEn: "Marketing & Growth", color: "#f59e0b", baseElevation: 12.0 },
  { floor: 4, name: "NGHIÊN CỨU & DỮ LIỆU", nameEn: "Research & Data Science", color: "#8b5cf6", baseElevation: 18.0 },
  { floor: 5, name: "KỸ THUẬT & HỆ THỐNG", nameEn: "Engineering & Architecture", color: "#10b981", baseElevation: 24.0 },
  { floor: 6, name: "BAN ĐIỀU HÀNH & PHÒNG HỌP", nameEn: "Executive Penthouse & Boardroom", color: "#38bdf8", baseElevation: 30.0 },
];

// Shared Structural Geometries & Materials (Singletons)
const CORNER_COL_GEOMETRY = new THREE.BoxGeometry(0.7, 36.4, 0.7);
const CORNER_COL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", metalness: 0.85, roughness: 0.2 });

const LOUVER_GEOMETRY = new THREE.BoxGeometry(0.2, 36.0, 0.25);
const LOUVER_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", metalness: 0.85, roughness: 0.2 });

const WINDOW_GEOMETRY = new THREE.PlaneGeometry(4.4, 35.0);
const WINDOW_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: "#38bdf8",
  transmission: 0.88,
  opacity: 0.35,
  transparent: true,
  roughness: 0.15,
  metalness: 0.2,
});

const MULLION_GEOMETRY = new THREE.BoxGeometry(0.25, 36.0, 0.12);
const MULLION_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0f172a", metalness: 0.9, roughness: 0.15 });

const SPANDREL_GEOMETRY = new THREE.BoxGeometry(0.3, 0.45, 26.0);
const SPANDREL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", metalness: 0.8, roughness: 0.25 });

const STEP_GEOMETRY = new THREE.BoxGeometry(1.4, 0.1, 0.45);
const STEP_MATERIAL = new THREE.MeshStandardMaterial({ color: "#d4a373", roughness: 0.5 });
const HANDRAIL_GEOMETRY = new THREE.CylinderGeometry(0.03, 0.03, 3.8);
const HANDRAIL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#f8fafc", metalness: 0.9, roughness: 0.1 });
const LANDING_GEOMETRY = new THREE.BoxGeometry(3.2, 0.15, 1.5);
const LANDING_MATERIAL = new THREE.MeshStandardMaterial({ color: "#1e293b", metalness: 0.6, roughness: 0.3 });

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

const CEILING_LIGHT_GEOMETRY = new THREE.BoxGeometry(0.3, 0.02, 22.0);

function CorporateBuilding({
  activeFloor = 0,
  isFloorIsolated = false,
  onSelectFloor,
}: CorporateBuildingProps) {
  const animatedElevatorRef = useRef<THREE.Group>(null);

  // Animate glass elevator cab smoothly traversing between floors
  useFrame(({ clock }) => {
    if (animatedElevatorRef.current) {
      const t = clock.getElapsedTime();
      // Smooth sinusoidal elevator movement between Floor 1 (Y=0.5) and Floor 5 (Y=24.5)
      const elevatorY = 12.5 + Math.sin(t * 0.35) * 11.5;
      animatedElevatorRef.current.position.y = elevatorY;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* =========================================================================
          1. FOUNDATION PLAZA SLAB
          ========================================================================= */}
      <mesh receiveShadow position={[0, -0.25, 0]}>
        <boxGeometry args={[46.0, 0.5, 34.0]} />
        <meshStandardMaterial color="#0f172a" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Exterior Plaza Ground Grid Lines */}
      <gridHelper
        args={[46, 23, "#38bdf8", "#1e293b"]}
        position={[0, 0.005, 0]}
      />

      {/* =========================================================================
          2. STRUCTURAL HEAVY STEEL CORNER COLUMNS (Y = 0 to 36m)
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
        {/* Solid insulated back panel with architectural ribs */}
        <mesh receiveShadow>
          <boxGeometry args={[36.0, 36.0, 0.35]} />
          <meshStandardMaterial color="#0b1120" roughness={0.65} metalness={0.35} />
        </mesh>

        {/* Vertical Architectural Louvers / Ribs */}
        {[-15, -10, -5, 0, 5, 10, 15].map((x) => (
          <mesh
            key={`louver-${x}`}
            position={[x, 0, 0.22]}
            geometry={LOUVER_GEOMETRY}
            material={LOUVER_MATERIAL}
          />
        ))}

        {/* Windows between ribs */}
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
          {/* Main Glass Curtain Pane */}
          <mesh receiveShadow>
            <boxGeometry args={[0.15, 36.0, 26.0]} />
            <meshPhysicalMaterial
              color="#94a3b8"
              transmission={0.92}
              roughness={0.08}
              transparent
              opacity={0.35}
              ior={1.5}
              reflectivity={0.6}
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
          5. ROOF TERRACE & ARCHITECTURAL CROWN (Y = 36.0m)
          ========================================================================= */}
      <group position={[0, 36.0, 0]}>
        {/* Main Roof Slab */}
        <mesh receiveShadow position={[0, 0.2, 0]}>
          <boxGeometry args={[36.4, 0.4, 26.4]} />
          <meshStandardMaterial color="#0b1120" roughness={0.8} metalness={0.3} />
        </mesh>

        {/* Architectural Crown Perimeter Parapet */}
        <mesh position={[0, 0.9, -13.0]}>
          <boxGeometry args={[36.4, 1.2, 0.3]} />
          <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[-18.0, 0.9, 0]}>
          <boxGeometry args={[0.3, 1.2, 26.4]} />
          <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[18.0, 0.9, 0]}>
          <boxGeometry args={[0.3, 1.2, 26.4]} />
          <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.2} />
        </mesh>

        {/* South Front Glass Railing on Roof Terrace */}
        <mesh position={[0, 0.8, 13.0]}>
          <boxGeometry args={[36.0, 1.1, 0.06]} />
          <meshPhysicalMaterial
            color="#38bdf8"
            transmission={0.92}
            transparent
            opacity={0.65}
            roughness={0.05}
          />
        </mesh>

        {/* Rooftop Mechanical & HVAC Enclosures */}
        <group position={[0, 1.5, -6.0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[12.0, 2.2, 6.0]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Exhaust Grilles */}
          {[-4, 0, 4].map((gx) => (
            <mesh key={`hvac-grille-${gx}`} position={[gx, 1.15, 0]}>
              <cylinderGeometry args={[1.2, 1.2, 0.4, 24]} />
              <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
            </mesh>
          ))}
        </group>

        {/* Corporate Communication Antenna & Beacon */}
        <group position={[-16.0, 4.0, -11.0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.08, 0.25, 7.5, 16]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.1} />
          </mesh>
          <mesh position={[0, 3.8, 0]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <pointLight color="#ef4444" intensity={2.0} distance={15} position={[0, 3.8, 0]} />
        </group>
      </group>

      {/* =========================================================================
          6. CENTRAL ELEVATOR & STAIR CORE (X = 0, Z = -5 to -10m)
          ========================================================================= */}
      <group position={[0, 0, -7.5]}>
        {/* Core Shear Wall Enclosure */}
        <mesh position={[0, 18.0, -1.8]} receiveShadow>
          <boxGeometry args={[11.0, 36.0, 0.3]} />
          <meshStandardMaterial color="#0b1329" metalness={0.5} roughness={0.4} />
        </mesh>

        {/* Core Side Walls */}
        {[-5.4, 5.4].map((cx, idx) => (
          <mesh key={`core-side-${idx}`} position={[cx, 18.0, 0.5]} receiveShadow>
            <boxGeometry args={[0.3, 36.0, 4.5]} />
            <meshStandardMaterial color="#0b1329" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}

        {/* Twin Vertical Glass Elevator Shafts */}
        {/* Left Elevator Shaft Glass Frame */}
        <mesh position={[-2.4, 18.0, 2.5]}>
          <boxGeometry args={[3.2, 36.0, 3.0]} />
          <meshPhysicalMaterial
            color="#38bdf8"
            transmission={0.94}
            transparent
            opacity={0.2}
            roughness={0.1}
          />
        </mesh>
        {/* Right Elevator Shaft Glass Frame */}
        <mesh position={[2.4, 18.0, 2.5]}>
          <boxGeometry args={[3.2, 36.0, 3.0]} />
          <meshPhysicalMaterial
            color="#38bdf8"
            transmission={0.94}
            transparent
            opacity={0.2}
            roughness={0.1}
          />
        </mesh>

        {/* Vertical Elevator Guide Rails */}
        {[-3.8, -1.0, 1.0, 3.8].map((rx, idx) => (
          <mesh key={`rail-${idx}`} position={[rx, 18.0, 2.5]}>
            <boxGeometry args={[0.08, 36.0, 0.08]} />
            <meshStandardMaterial color="#38bdf8" metalness={0.9} roughness={0.1} />
          </mesh>
        ))}

        {/* ANIMATED ELEVATOR CAB 1 (Left Shaft, smoothly moving between floors) */}
        <group ref={animatedElevatorRef} position={[-2.4, 1.5, 2.5]}>
          {/* Cab Floor & Ceiling */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 2.8, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Glass Cab Walls */}
          <mesh position={[0, 1.4, 1.1]}>
            <boxGeometry args={[2.4, 2.7, 0.05]} />
            <meshPhysicalMaterial color="#38bdf8" transmission={0.92} transparent opacity={0.6} roughness={0.1} />
          </mesh>
          <mesh position={[-1.2, 1.4, 0]}>
            <boxGeometry args={[0.05, 2.7, 2.2]} />
            <meshPhysicalMaterial color="#38bdf8" transmission={0.92} transparent opacity={0.6} roughness={0.1} />
          </mesh>
          <mesh position={[1.2, 1.4, 0]}>
            <boxGeometry args={[0.05, 2.7, 2.2]} />
            <meshPhysicalMaterial color="#38bdf8" transmission={0.92} transparent opacity={0.6} roughness={0.1} />
          </mesh>
          {/* Warm Interior Cab Downlight */}
          <pointLight color="#f8fafc" intensity={1.5} distance={5} position={[0, 2.5, 0]} />
        </group>

        {/* STATIONED ELEVATOR CAB 2 (Right Shaft, stationed at Executive Floor 6) */}
        <group position={[2.4, 31.5, 2.5]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 2.8, 0]}>
            <boxGeometry args={[2.5, 0.12, 2.3]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 1.4, 1.1]}>
            <boxGeometry args={[2.4, 2.7, 0.05]} />
            <meshPhysicalMaterial color="#38bdf8" transmission={0.92} transparent opacity={0.6} roughness={0.1} />
          </mesh>
          <pointLight color="#38bdf8" intensity={1.2} distance={5} position={[0, 2.5, 0]} />
        </group>

        {/* ARCHITECTURAL SWITCHBACK STAIRCASES connecting each floor (Instanced) */}
        <InstancedStaircase />
      </group>

      {/* =========================================================================
          7. SIX DETAILED FLOOR SLABS, CEILINGS & FRONT GLASS BALUSTRADES
          ========================================================================= */}
      {FLOOR_METADATA.map((info) => {
        const floorNum = info.floor;
        const elevation = info.baseElevation;
        const isCurrentFloorActive = activeFloor === floorNum;
        const isDimmed = isFloorIsolated && activeFloor > 0 && !isCurrentFloorActive;

        return (
          <group key={`floor-level-${floorNum}`} position={[0, elevation, 0]}>
            {/* Architectural Post-Tensioned Concrete Floor Slab */}
            <mesh receiveShadow position={[0, -0.22, 0]}>
              <boxGeometry args={[BUILDING_WIDTH, 0.44, BUILDING_DEPTH]} />
              <meshStandardMaterial
                color="#f8fafc"
                roughness={0.22}
                metalness={0.06}
                transparent={isDimmed}
                opacity={isDimmed ? 0.3 : 1.0}
              />
            </mesh>

            {/* Dark Metallic Fascia Trim on Slab Edge */}
            <mesh position={[0, -0.22, 13.02]}>
              <boxGeometry args={[BUILDING_WIDTH + 0.1, 0.46, 0.08]} />
              <meshStandardMaterial
                color={isCurrentFloorActive ? info.color : "#0f172a"}
                metalness={0.8}
                roughness={0.2}
              />
            </mesh>

            {/* Recessed Ceiling with Embedded LED Downlight Strips (Above this floor) */}
            <group position={[0, 5.78, 0]}>
              {/* Ceiling Acoustic Tile Plane */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[BUILDING_WIDTH - 0.2, 0.08, BUILDING_DEPTH - 0.2]} />
                <meshStandardMaterial
                  color="#1e293b"
                  roughness={0.8}
                  metalness={0.1}
                  transparent={isDimmed}
                  opacity={isDimmed ? 0.2 : 0.95}
                />
              </mesh>

              {/* Longitudinal Recessed Ceiling LED Strips */}
              {[-8.0, 0.0, 8.0].map((lx, lIdx) => (
                <mesh
                  key={`ceiling-light-${floorNum}-${lIdx}`}
                  position={[lx, -0.05, 0]}
                  geometry={CEILING_LIGHT_GEOMETRY}
                >
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive={isDimmed ? "#334155" : "#e2e8f0"}
                    emissiveIntensity={isDimmed ? 0.2 : 0.85}
                  />
                </mesh>
              ))}

              {/* Department Floor Accent Ambient Light */}
              {!isDimmed && (
                <pointLight
                  color={info.color}
                  intensity={0.4}
                  distance={18}
                  position={[0, -0.5, 0]}
                />
              )}
            </group>

            {/* South Open Cutaway Safety Glass Balustrade (Height = 1.1m) */}
            <group position={[0, 0.55, 12.95]}>
              {/* Toughened Laminated Glass Panel */}
              <mesh>
                <boxGeometry args={[BUILDING_WIDTH - 0.8, 1.1, 0.05]} />
                <meshPhysicalMaterial
                  color="#94a3b8"
                  transmission={0.92}
                  transparent
                  opacity={isDimmed ? 0.15 : 0.55}
                  roughness={0.06}
                  ior={1.5}
                />
              </mesh>
              {/* Brushed Stainless Steel Top Cap Rail */}
              <mesh position={[0, 0.55, 0]}>
                <boxGeometry args={[BUILDING_WIDTH - 0.6, 0.08, 0.1]} />
                <meshStandardMaterial color="#f8fafc" metalness={0.9} roughness={0.15} />
              </mesh>
            </group>

            {/* Large Illuminated Department Badge on Core Front Wall */}
            <group
              position={[0, 3.8, -4.8]}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectFloor) onSelectFloor(floorNum);
              }}
            >
              {/* Backing Signboard Plaque */}
              <mesh>
                <boxGeometry args={[8.8, 1.4, 0.08]} />
                <meshStandardMaterial
                  color={isCurrentFloorActive ? "#0284c7" : "#0f172a"}
                  metalness={0.7}
                  roughness={0.25}
                />
              </mesh>
              {/* Glowing Floor Accent Strip */}
              <mesh position={[0, -0.65, 0.05]}>
                <boxGeometry args={[8.7, 0.08, 0.02]} />
                <meshBasicMaterial color={info.color} />
              </mesh>

              {/* Floating HTML Text for Sharp Crisp Floor Title */}
              <Html
                position={[0, 0, 0.08]}
                center
                distanceFactor={24}
                className="pointer-events-none select-none"
              >
                <div
                  className={`px-3 py-1.5 rounded-lg flex flex-col items-center justify-center transition-all ${
                    isCurrentFloorActive
                      ? "bg-sky-950/90 border border-sky-400 text-sky-100 shadow-lg shadow-sky-500/30 ring-2 ring-sky-400/50"
                      : "bg-slate-900/80 border border-slate-700/60 text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: info.color }}
                    />
                    <span className="font-mono font-black text-[12px] tracking-wider uppercase">
                      TẦNG {floorNum} · {info.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans tracking-wide">
                    {info.nameEn}
                  </span>
                </div>
              </Html>
            </group>

            {/* Perimeter Glow Halo when floor is actively focused */}
            {isCurrentFloorActive && (
              <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[BUILDING_WIDTH + 0.4, BUILDING_DEPTH + 0.4]} />
                <meshBasicMaterial
                  color={info.color}
                  transparent
                  opacity={0.3}
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

