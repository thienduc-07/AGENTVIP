"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { Monitor, Cpu, ShieldCheck, Database, Palette, Users, Sparkles } from "lucide-react";

export interface FloorInteriorsProps {
  activeFloor?: number;
  isFloorIsolated?: boolean;
}

function FloorInteriors({
  activeFloor = 0,
  isFloorIsolated = false,
}: FloorInteriorsProps) {
  return (
    <group>
      {/* =========================================================================
          FLOOR 1: RECEPTION, LOBBY, OPERATIONS & FINANCE (Y = 0.0m)
          ========================================================================= */}
      <group position={[0, 0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 1}>
        {/* Main Curved Reception Desk at [0, 0, 4.0] */}
        <group position={[0, 0, 4.0]}>
          {/* Curved Counter Top */}
          <mesh castShadow receiveShadow position={[0, 1.05, 0]}>
            <cylinderGeometry args={[3.2, 3.2, 0.12, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.15} metalness={0.1} />
          </mesh>
          {/* Wood Slat Desk Base */}
          <mesh castShadow position={[0, 0.5, 0]}>
            <cylinderGeometry args={[3.0, 3.0, 1.0, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
            <meshStandardMaterial color="#78350f" roughness={0.6} metalness={0.05} />
          </mesh>
          {/* LED Backlit Counter Trim */}
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[3.05, 3.05, 0.08, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
            <meshBasicMaterial color="#06b6d4" />
          </mesh>
          {/* Receptionist Computer Screen */}
          <mesh position={[0, 1.35, -0.6]} rotation={[0, Math.PI, 0]}>
            <boxGeometry args={[0.9, 0.55, 0.04]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          {/* Receptionist Ergonomic Chair */}
          <mesh position={[0, 0.5, -1.2]}>
            <cylinderGeometry args={[0.3, 0.35, 0.8, 16]} />
            <meshStandardMaterial color="#1e293b" metalness={0.6} />
          </mesh>

          {/* Floating Holographic Agency Emblem above Reception */}
          <group position={[0, 2.5, 0]}>
            <mesh rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.5, 0.5, 0.5]} />
              <meshStandardMaterial
                color="#06b6d4"
                emissive="#0891b2"
                emissiveIntensity={0.8}
                wireframe
              />
            </mesh>
            <pointLight color="#06b6d4" intensity={1.2} distance={6} />
          </group>
        </group>

        {/* Lobby Waiting Lounge at [-8.0, 0, 6.0] */}
        <group position={[-8.0, 0, 6.0]}>
          {/* Luxury Modern Sofa 1 (Facing East) */}
          <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
            <boxGeometry args={[1.1, 0.84, 3.2]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          {/* Luxury Modern Sofa 2 (Facing West) */}
          <mesh castShadow receiveShadow position={[3.2, 0.42, 0]}>
            <boxGeometry args={[1.1, 0.84, 3.2]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          {/* Dark Glass Coffee Table in Center */}
          <mesh castShadow receiveShadow position={[1.6, 0.32, 0]}>
            <boxGeometry args={[1.4, 0.3, 2.2]} />
            <meshStandardMaterial color="#020617" roughness={0.1} metalness={0.9} />
          </mesh>
          {/* Indoor Planter with Greenery */}
          <group position={[-1.6, 0, 2.4]}>
            <mesh castShadow position={[0, 0.4, 0]}>
              <cylinderGeometry args={[0.45, 0.35, 0.8, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.3} />
            </mesh>
            <mesh castShadow position={[0, 1.1, 0]}>
              <sphereGeometry args={[0.65, 12, 12]} />
              <meshStandardMaterial color="#15803d" roughness={0.8} />
            </mesh>
          </group>
        </group>

        {/* Visitor Refreshment & Coffee Bar at [12.0, 0, 6.0] */}
        <group position={[12.0, 0, 6.0]}>
          <mesh castShadow receiveShadow position={[0, 0.55, 0]}>
            <boxGeometry args={[3.4, 1.1, 1.2]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh position={[0, 1.12, 0]}>
            <boxGeometry args={[3.5, 0.05, 1.25]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.1} />
          </mesh>
          {/* Espresso Machine */}
          <mesh castShadow position={[-0.8, 1.35, 0]}>
            <boxGeometry args={[0.5, 0.45, 0.4]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Bar Stools */}
          {[-1.0, 0, 1.0].map((bx, idx) => (
            <mesh key={`stool-${idx}`} position={[bx, 0.4, 1.0]}>
              <cylinderGeometry args={[0.22, 0.22, 0.8, 16]} />
              <meshStandardMaterial color="#d97706" roughness={0.5} />
            </mesh>
          ))}
        </group>

        {/* Operations Hub Signboard at [-11.0, 0, -4.0] */}
        <group position={[-11.0, 0, -4.0]}>
          {/* Glass Partition Wall */}
          <mesh position={[0, 1.6, -2.5]}>
            <boxGeometry args={[9.5, 3.2, 0.08]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.9} transparent opacity={0.4} roughness={0.1} />
          </mesh>
          {/* Operations Dispatch Terminal Rack */}
          <mesh castShadow position={[-4.0, 1.2, 1.0]}>
            <boxGeometry args={[0.5, 2.4, 1.2]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} />
          </mesh>
        </group>

        {/* Finance & Treasury Wing at [11.0, 0, -4.0] */}
        <group position={[11.0, 0, -4.0]}>
          {/* Glass Partition Wall */}
          <mesh position={[0, 1.6, -2.5]}>
            <boxGeometry args={[9.5, 3.2, 0.08]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.9} transparent opacity={0.4} roughness={0.1} />
          </mesh>
          {/* Secure Financial Vault / Server Display */}
          <mesh castShadow position={[4.0, 1.2, -1.0]}>
            <boxGeometry args={[0.6, 2.2, 1.4]} />
            <meshStandardMaterial color="#020617" metalness={0.9} roughness={0.1} />
          </mesh>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 2: DESIGN & CREATIVE STUDIO (Y = 6.0m)
          ========================================================================= */}
      <group position={[0, 6.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 2}>
        {/* Collaborative Design Prototype Showcase Table at [0, 0, 2.0] */}
        <group position={[0, 0, 2.0]}>
          <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
            <cylinderGeometry args={[2.0, 2.0, 0.9, 32]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* 3D Wireframe Hologram of Next-Gen UI Component */}
          <mesh position={[0, 1.4, 0]} rotation={[0.4, 0.4, 0]}>
            <torusKnotGeometry args={[0.35, 0.1, 64, 16]} />
            <meshStandardMaterial color="#ec4899" emissive="#db2777" emissiveIntensity={0.6} wireframe />
          </mesh>
          <pointLight color="#ec4899" intensity={0.8} distance={5} position={[0, 1.4, 0]} />
        </group>

        {/* Design System Pinup / Mood Wall along West Wall at X = -16.5 */}
        <group position={[-16.5, 1.8, 0]}>
          <mesh receiveShadow>
            <boxGeometry args={[0.1, 3.2, 16.0]} />
            <meshStandardMaterial color="#0f172a" roughness={0.6} />
          </mesh>
          {/* Color Palettes and Layout Swatches */}
          {[-6, -3, 0, 3, 6].map((mz, idx) => (
            <mesh key={`mood-${idx}`} position={[0.08, 0, mz]}>
              <planeGeometry args={[0.02, 1.8]} />
              <meshBasicMaterial color={["#ec4899", "#8b5cf6", "#38bdf8", "#10b981", "#f59e0b"][idx]} />
            </mesh>
          ))}
        </group>

        {/* Creative Brainstorming Lounge with Round Ottomans at [-2.0, 0, 7.5] */}
        <group position={[-2.0, 0, 7.5]}>
          {[-1.2, 0, 1.2].map((ox, idx) => (
            <mesh key={`ottoman-${idx}`} castShadow position={[ox, 0.22, 0]}>
              <cylinderGeometry args={[0.45, 0.45, 0.44, 24]} />
              <meshStandardMaterial color={["#ec4899", "#a855f7", "#06b6d4"][idx]} roughness={0.7} />
            </mesh>
          ))}
        </group>
      </group>

      {/* =========================================================================
          FLOOR 3: MARKETING & GROWTH (Y = 12.0m)
          ========================================================================= */}
      <group position={[0, 12.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 3}>
        {/* VP Marketing Private Corner Glass Office at [-11.0, 0, -5.0] */}
        <group position={[-11.0, 0, -5.0]}>
          {/* Glass Partition Enclosure */}
          <mesh position={[0, 1.6, 2.5]}>
            <boxGeometry args={[9.5, 3.2, 0.08]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.9} transparent opacity={0.4} roughness={0.1} />
          </mesh>
          <mesh position={[4.7, 1.6, 0]}>
            <boxGeometry args={[0.08, 3.2, 5.0]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.9} transparent opacity={0.4} roughness={0.1} />
          </mesh>
          {/* Marketing Whiteboard */}
          <mesh position={[0, 1.6, -2.4]}>
            <boxGeometry args={[4.2, 1.8, 0.05]} />
            <meshStandardMaterial color="#ffffff" roughness={0.1} />
          </mesh>
        </group>

        {/* Enterprise Sales Bullpen & Revenue Ticker Wall at [14.0, 1.8, -2.0] */}
        <group position={[14.0, 1.8, -2.0]}>
          {/* Revenue Ticker Display */}
          <mesh>
            <boxGeometry args={[0.08, 1.2, 6.5]} />
            <meshStandardMaterial color="#020617" />
          </mesh>
          <mesh position={[-0.05, 0, 0]}>
            <planeGeometry args={[6.3, 1.0]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>
        </group>

        {/* Sales Pitch Conference Pod at [0, 0, 5.5] */}
        <group position={[0, 0, 5.5]}>
          {/* Glass Pod Walls */}
          <mesh position={[0, 1.6, 0]}>
            <boxGeometry args={[6.5, 3.2, 4.5]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.92} transparent opacity={0.35} roughness={0.08} />
          </mesh>
          {/* Pitch Table & 4 Chairs */}
          <mesh castShadow receiveShadow position={[0, 0.73, 0]}>
            <cylinderGeometry args={[1.4, 1.4, 0.06, 32]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.4} />
          </mesh>
          {[-1.0, 1.0].map((cx, idx) => (
            <React.Fragment key={`chair-pod-${idx}`}>
              <mesh position={[cx, 0.45, 0]}>
                <boxGeometry args={[0.45, 0.85, 0.45]} />
                <meshStandardMaterial color="#334155" />
              </mesh>
              <mesh position={[0, 0.45, cx]}>
                <boxGeometry args={[0.45, 0.85, 0.45]} />
                <meshStandardMaterial color="#334155" />
              </mesh>
            </React.Fragment>
          ))}
          {/* Pitch Display Screen */}
          <mesh position={[0, 1.6, -2.15]}>
            <boxGeometry args={[2.2, 1.2, 0.06]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 4: RESEARCH & DATA SCIENCE (Y = 18.0m)
          ========================================================================= */}
      <group position={[0, 18.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 4}>
        {/* Chief AI Scientist Suite at [-11.0, 0, -5.0] */}
        <group position={[-11.0, 0, -5.0]}>
          <mesh position={[0, 1.6, 2.5]}>
            <boxGeometry args={[9.5, 3.2, 0.08]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.9} transparent opacity={0.4} roughness={0.1} />
          </mesh>
          {/* Scientific Research Hologram */}
          <mesh position={[0, 1.5, 0]}>
            <icosahedronGeometry args={[0.4, 1]} />
            <meshStandardMaterial color="#8b5cf6" emissive="#7c3aed" emissiveIntensity={0.8} wireframe />
          </mesh>
          <pointLight color="#8b5cf6" intensity={1.0} distance={6} position={[0, 1.5, 0]} />
        </group>

        {/* High-Density GPU Server Room at [10.0, 0, -5.0] */}
        <group position={[10.0, 0, -5.0]}>
          {/* Dark Glass Server Room Enclosure */}
          <mesh position={[0, 1.6, 0]}>
            <boxGeometry args={[7.5, 3.2, 5.0]} />
            <meshPhysicalMaterial color="#1e1b4b" transmission={0.85} transparent opacity={0.5} roughness={0.1} />
          </mesh>
          {/* 4 Tall GPU Server Racks with Blinking Blue/Cyan LED Strips */}
          {[-2.2, -0.7, 0.8, 2.3].map((rx, idx) => (
            <group key={`server-${idx}`} position={[rx, 1.35, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.9, 2.7, 1.1]} />
                <meshStandardMaterial color="#020617" metalness={0.95} roughness={0.1} />
              </mesh>
              {/* Pulsing Status LEDs */}
              {Array.from({ length: 8 }).map((_, lIdx) => (
                <mesh key={`led-${lIdx}`} position={[0, lIdx * 0.3 - 1.0, 0.56]}>
                  <boxGeometry args={[0.75, 0.04, 0.02]} />
                  <meshStandardMaterial
                    color="#38bdf8"
                    emissive="#0284c7"
                    emissiveIntensity={0.9}
                  />
                </mesh>
              ))}
            </group>
          ))}
          <pointLight color="#38bdf8" intensity={1.5} distance={7} position={[0, 2.0, 0]} />
        </group>

        {/* Strategy War Room at [0, 0, 5.5] */}
        <group position={[0, 0, 5.5]}>
          {/* Round Glass Conference Table */}
          <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
            <cylinderGeometry args={[1.8, 1.8, 0.06, 32]} />
            <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.6} />
          </mesh>
          {/* Center Holographic Data Globe */}
          <mesh position={[0, 1.3, 0]}>
            <sphereGeometry args={[0.35, 16, 16]} />
            <meshStandardMaterial color="#a855f7" emissive="#9333ea" emissiveIntensity={0.8} wireframe />
          </mesh>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 5: ENGINEERING & ARCHITECTURE (Y = 24.0m)
          ========================================================================= */}
      <group position={[0, 24.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 5}>
        {/* Principal Architect Suite at [-11.0, 0, -5.0] */}
        <group position={[-11.0, 0, -5.0]}>
          <mesh position={[0, 1.6, 2.5]}>
            <boxGeometry args={[9.5, 3.2, 0.08]} />
            <meshPhysicalMaterial color="#94a3b8" transmission={0.9} transparent opacity={0.4} roughness={0.1} />
          </mesh>
          {/* Architecture Topology Wall Board */}
          <mesh position={[0, 1.6, -2.4]}>
            <boxGeometry args={[4.5, 1.8, 0.05]} />
            <meshStandardMaterial color="#0f172a" roughness={0.2} />
          </mesh>
        </group>

        {/* Large DevOps & CI/CD Telemetry Screen at [15.0, 1.8, -4.0] */}
        <group position={[15.0, 1.8, -4.0]}>
          <mesh>
            <boxGeometry args={[0.08, 1.8, 5.5]} />
            <meshStandardMaterial color="#020617" />
          </mesh>
          <mesh position={[-0.05, 0, 0]}>
            <planeGeometry args={[5.3, 1.6]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>
        </group>

        {/* Agile Standup Zone with Scrum Board at [0, 0, 4.0] */}
        <group position={[0, 0, 4.0]}>
          {/* Circular Standup Mat */}
          <mesh receiveShadow position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[2.5, 32]} />
            <meshStandardMaterial color="#1e293b" roughness={0.8} />
          </mesh>
          {/* Double-Sided Rolling Whiteboard / Kanban */}
          <group position={[0, 1.2, -2.0]}>
            <mesh castShadow>
              <boxGeometry args={[2.8, 1.6, 0.08]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.1} />
            </mesh>
            <mesh position={[0, -0.9, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.8]} />
              <meshStandardMaterial color="#0f172a" metalness={0.8} />
            </mesh>
          </group>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 6: EXECUTIVE PENTHOUSE & GRAND BOARDROOM (Y = 30.0m)
          ========================================================================= */}
      <group position={[0, 30.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 6}>
        {/* CEO Executive Suite at [-9.0, 0, -3.0] */}
        <group position={[-9.0, 0, -3.0]}>
          {/* Luxury Executive Desk (Dark Walnut Finish) */}
          <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
            <boxGeometry args={[2.8, 0.08, 1.4]} />
            <meshStandardMaterial color="#1c1917" roughness={0.3} metalness={0.15} />
          </mesh>
          {/* Desk Base Pillars */}
          {[-1.2, 1.2].map((dx, idx) => (
            <mesh key={`desk-base-${idx}`} castShadow position={[dx, 0.35, 0]}>
              <boxGeometry args={[0.25, 0.7, 1.2]} />
              <meshStandardMaterial color="#0c0a09" metalness={0.9} roughness={0.1} />
            </mesh>
          ))}
          {/* Executive High-Back Leather Chair */}
          <group position={[0, 0.55, -0.9]}>
            <mesh castShadow>
              <boxGeometry args={[0.65, 0.95, 0.55]} />
              <meshStandardMaterial color="#0a0a0a" roughness={0.6} />
            </mesh>
            <mesh position={[0, -0.3, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.4, 16]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.9} roughness={0.1} />
            </mesh>
          </group>
          {/* Executive Visitor Armchairs */}
          {[-0.8, 0.8].map((vx, idx) => (
            <mesh key={`vis-armchair-${idx}`} castShadow position={[vx, 0.45, 1.1]}>
              <boxGeometry args={[0.55, 0.75, 0.55]} />
              <meshStandardMaterial color="#292524" roughness={0.7} />
            </mesh>
          ))}
          {/* Executive Credenza & Trophy Archive */}
          <mesh castShadow position={[-1.2, 0.55, -2.2]}>
            <boxGeometry args={[2.2, 1.1, 0.6]} />
            <meshStandardMaterial color="#1c1917" roughness={0.4} />
          </mesh>
          {/* Corporate Flag / Insignia Mast */}
          <group position={[-2.4, 1.5, -2.0]}>
            <mesh>
              <cylinderGeometry args={[0.04, 0.04, 3.0]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.95} />
            </mesh>
            <mesh position={[0.4, 1.0, 0]}>
              <boxGeometry args={[0.7, 0.5, 0.02]} />
              <meshStandardMaterial color="#38bdf8" roughness={0.4} />
            </mesh>
          </group>
        </group>

        {/* Private CEO Lounge at [-11.0, 0, 5.0] */}
        <group position={[-11.0, 0, 5.0]}>
          <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
            <boxGeometry args={[1.2, 0.84, 3.0]} />
            <meshStandardMaterial color="#0c0a09" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[1.4, 0.3, 0]}>
            <boxGeometry args={[1.0, 0.28, 1.6]} />
            <meshStandardMaterial color="#1c1917" roughness={0.2} metalness={0.8} />
          </mesh>
        </group>

        {/* Rooftop Observation Deck & Terrace at [0, 0, 8.5] */}
        <group position={[0, 0, 8.5]}>
          {/* Teak Wood Decking */}
          <mesh receiveShadow position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[12.0, 5.0]} />
            <meshStandardMaterial color="#78350f" roughness={0.65} metalness={0.05} />
          </mesh>
          {/* Outdoor Architectural Planters */}
          {[-5.0, 5.0].map((px, idx) => (
            <mesh key={`terrace-plant-${idx}`} castShadow position={[px, 0.5, 0]}>
              <boxGeometry args={[1.2, 1.0, 1.2]} />
              <meshStandardMaterial color="#0f172a" roughness={0.3} />
            </mesh>
          ))}
        </group>

        {/* Central High-Risk Executive Authorization Pedestal at [-2.0, 0, 0] */}
        <group position={[-2.0, 0, 0]}>
          <mesh castShadow position={[0, 0.55, 0]}>
            <cylinderGeometry args={[0.35, 0.45, 1.1, 16]} />
            <meshStandardMaterial color="#020617" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* Glowing Biometric Authorization Scanner Screen */}
          <mesh position={[0, 1.12, 0]} rotation={[-0.3, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.05, 16]} />
            <meshStandardMaterial
              color="#f59e0b"
              emissive="#d97706"
              emissiveIntensity={0.8}
            />
          </mesh>
          <pointLight color="#f59e0b" intensity={0.9} distance={4} position={[0, 1.3, 0]} />
        </group>
      </group>
    </group>
  );
}

export default React.memo(FloorInteriors, (prev, next) => {
  return prev.activeFloor === next.activeFloor && prev.isFloorIsolated === next.isFloorIsolated;
});
