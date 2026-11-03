"use client";

import React, { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { FLOOR_DEFINITIONS, FloorDefinition } from "@/lib/office/floorDefinitions";

export type ElevatorState = "IDLE" | "DOORS_CLOSING" | "MOVING" | "ARRIVED" | "DOORS_OPENING";

interface ElevatorSystemProps {
  currentFloor: number;
  activeFloor: number;
  onSelectFloor: (floorNum: number) => void;
  isIsolated?: boolean;
}

// Shared Geometries & Materials (Singletons)
const CABIN_FRAME_GEO = new THREE.BoxGeometry(2.4, 3.6, 2.2);
const DOOR_GEO = new THREE.BoxGeometry(0.72, 3.2, 0.06);
const CABIN_FLOOR_GEO = new THREE.BoxGeometry(2.2, 0.08, 2.0);
const CABIN_CEILING_GEO = new THREE.BoxGeometry(2.2, 0.08, 2.0);
const WALL_GEO = new THREE.BoxGeometry(0.08, 3.2, 2.0);
const BACK_WALL_GEO = new THREE.BoxGeometry(2.2, 3.2, 0.08);
const CALL_PANEL_GEO = new THREE.BoxGeometry(0.2, 0.45, 0.04);
const CALL_BUTTON_GEO = new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16);

const BRASS_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#d4af37",
  metalness: 0.85,
  roughness: 0.25,
});

const DARK_STEEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#1e293b",
  metalness: 0.9,
  roughness: 0.2,
});

const WOOD_PANEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#78350f",
  roughness: 0.6,
});

const GLOW_GREEN_MATERIAL = new THREE.MeshBasicMaterial({ color: "#10b981" });
const GLOW_AMBER_MATERIAL = new THREE.MeshBasicMaterial({ color: "#f59e0b" });

export default function ElevatorSystem({
  currentFloor,
  activeFloor,
  onSelectFloor,
  isIsolated = false,
}: ElevatorSystemProps) {
  const [isOpenRemote, setIsOpenRemote] = useState<boolean>(false);
  const [elevatorState, setElevatorState] = useState<ElevatorState>("IDLE");
  const [targetFloor, setTargetFloor] = useState<number>(activeFloor);
  const [doorProgress, setDoorProgress] = useState<number>(1.0); // 1 = fully open, 0 = closed

  const leftDoorRef = useRef<THREE.Group>(null);
  const rightDoorRef = useRef<THREE.Group>(null);

  // Transition state machine
  const handleRequestFloor = (floor: number) => {
    if (floor === activeFloor && elevatorState === "IDLE") {
      setIsOpenRemote(false);
      return;
    }
    if (elevatorState !== "IDLE") return;

    setTargetFloor(floor);
    setIsOpenRemote(false);
    setElevatorState("DOORS_CLOSING");
  };

  useFrame((_, delta) => {
    const speed = delta * 2.8;

    if (elevatorState === "DOORS_CLOSING") {
      setDoorProgress((prev) => {
        const next = Math.max(0, prev - speed);
        if (next === 0) {
          // Doors fully closed, begin camera / floor move
          setElevatorState("MOVING");
          onSelectFloor(targetFloor);
          setTimeout(() => {
            setElevatorState("ARRIVED");
          }, 850);
        }
        return next;
      });
    } else if (elevatorState === "ARRIVED") {
      // Arrived at destination floor, begin opening doors
      setElevatorState("DOORS_OPENING");
    } else if (elevatorState === "DOORS_OPENING") {
      setDoorProgress((prev) => {
        const next = Math.min(1.0, prev + speed);
        if (next >= 1.0) {
          setElevatorState("IDLE");
        }
        return next;
      });
    }

    // Apply door slide
    if (leftDoorRef.current && rightDoorRef.current) {
      const slide = doorProgress * 0.65;
      leftDoorRef.current.position.x = -0.38 - slide;
      rightDoorRef.current.position.x = 0.38 + slide;
    }
  });

  // Determine current elevation
  const activeDef = FLOOR_DEFINITIONS[activeFloor] || FLOOR_DEFINITIONS[1];
  const baseY = activeDef ? activeDef.baseElevation : 0;
  const elevatorX = -10.5;
  const elevatorZ = 7.5;

  return (
    <group position={[elevatorX, baseY, elevatorZ]}>
      {/* 1. Elevator Outer Shaft Frame */}
      <mesh position={[0, 1.8, 0]} geometry={CABIN_FRAME_GEO} material={DARK_STEEL_MATERIAL} />

      {/* 2. Elevator Interior Cab Floor & Ceiling */}
      <mesh position={[0, 0.05, 0]} geometry={CABIN_FLOOR_GEO} material={BRASS_MATERIAL} />
      <mesh position={[0, 3.4, 0]} geometry={CABIN_CEILING_GEO} material={DARK_STEEL_MATERIAL} />

      {/* Warm Interior Spot / Downlight */}
      <pointLight color="#fef08a" intensity={1.2} distance={5} position={[0, 3.2, 0]} />

      {/* Interior Walls */}
      <mesh position={[-1.05, 1.7, 0]} geometry={WALL_GEO} material={WOOD_PANEL_MATERIAL} />
      <mesh position={[1.05, 1.7, 0]} geometry={WALL_GEO} material={WOOD_PANEL_MATERIAL} />
      <mesh position={[0, 1.7, -1.05]} geometry={BACK_WALL_GEO} material={BRASS_MATERIAL} />

      {/* 3. Sliding Doors (Front at z = +1.02) */}
      <group position={[0, 1.6, 1.02]}>
        {/* Left Sliding Leaf */}
        <group ref={leftDoorRef} position={[-0.38, 0, 0]}>
          <mesh geometry={DOOR_GEO} material={BRASS_MATERIAL} castShadow />
        </group>
        {/* Right Sliding Leaf */}
        <group ref={rightDoorRef} position={[0.38, 0, 0]}>
          <mesh geometry={DOOR_GEO} material={BRASS_MATERIAL} castShadow />
        </group>
      </group>

      {/* 4. Floor Indicator Display Header above doors */}
      <group position={[0, 3.3, 1.12]}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1.2, 0.3, 0.04]} />
          <meshStandardMaterial color="#090d16" roughness={0.2} />
        </mesh>
        <Html position={[0, 0, 0.03]} center distanceFactor={14} className="select-none pointer-events-none">
          <div className="flex items-center gap-2 px-2.5 py-0.5 rounded-lg bg-black/80 border border-amber-500/50 shadow-md">
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">
              {elevatorState === "MOVING" ? "▲ MOVING" : `ELEVATOR ${activeDef.code}`}
            </span>
          </div>
        </Html>
      </group>

      {/* 5. Interactive Call Button Panel beside Door at [1.4, 1.4, 1.05] */}
      <group
        position={[1.35, 1.4, 1.05]}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpenRemote((prev) => !prev);
        }}
      >
        <mesh geometry={CALL_PANEL_GEO} material={BRASS_MATERIAL} />
        <mesh
          position={[0, 0.08, 0.03]}
          rotation={[Math.PI / 2, 0, 0]}
          geometry={CALL_BUTTON_GEO}
          material={elevatorState !== "IDLE" ? GLOW_AMBER_MATERIAL : GLOW_GREEN_MATERIAL}
        />
        <mesh
          position={[0, -0.08, 0.03]}
          rotation={[Math.PI / 2, 0, 0]}
          geometry={CALL_BUTTON_GEO}
          material={BRASS_MATERIAL}
        />

        {/* Floating Call Hint Icon */}
        <Html position={[0, 0.35, 0.05]} center distanceFactor={16}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpenRemote((prev) => !prev);
            }}
            className="px-2 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-black uppercase shadow-lg shadow-amber-500/40 flex items-center gap-1 transition-transform hover:scale-105 active:scale-95"
          >
            <span>🚪 Thang Máy</span>
          </button>
        </Html>
      </group>

      {/* 6. Floating Interactive Elevator Remote Control Panel */}
      {isOpenRemote && (
        <Html position={[1.8, 1.8, 1.4]} center distanceFactor={12} className="select-none z-50">
          <div className="w-64 p-4 rounded-2xl bg-slate-950/95 border-2 border-amber-500/70 shadow-2xl backdrop-blur-xl text-slate-100 flex flex-col gap-3 font-sans animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                <span className="font-extrabold text-xs tracking-wider uppercase text-amber-300">
                  ELEVATOR CONTROL
                </span>
              </div>
              <button
                onClick={() => setIsOpenRemote(false)}
                className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Current Status */}
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px]">
              <span className="text-slate-300">Tầng Hiện Tại:</span>
              <span className="font-black text-amber-400">{activeDef.code} — {activeDef.name}</span>
            </div>

            {/* Floor Buttons List */}
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
              {/* Overview Mode */}
              <button
                onClick={() => handleRequestFloor(0)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeFloor === 0
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30"
                    : "bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-7 text-left font-black text-amber-400">ALL</span>
                  <span>Toàn Cảnh (Overview)</span>
                </div>
                <span>🏛️</span>
              </button>

              {/* Individual Floors */}
              {[
                { f: 5, code: "F5", name: "Finance & Operations", icon: "📊" },
                { f: 4, code: "F4", name: "Marketing & Creative", icon: "🎨" },
                { f: 3, code: "F3", name: "Data & AI Intelligence", icon: "🧠" },
                { f: 2, code: "F2", name: "Engineering & Arch", icon: "💻" },
                { f: 1, code: "F1", name: "Reception & Executive", icon: "👑" },
                { f: -1, code: "B1", name: "Server & Infrastructure", icon: "🖥️" },
              ].map(({ f, code, name, icon }) => {
                const isSelected = activeFloor === f;
                return (
                  <button
                    key={f}
                    onClick={() => handleRequestFloor(f)}
                    disabled={elevatorState !== "IDLE"}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/40"
                        : "bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 hover:border-amber-500/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-7 text-left font-black ${isSelected ? "text-slate-950" : "text-amber-400"}`}>
                        {code}
                      </span>
                      <span className="truncate">{name}</span>
                    </div>
                    <span>{icon}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

