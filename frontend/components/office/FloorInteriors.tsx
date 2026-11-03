"use client";

import React from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";

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
          FLOOR 1: GRAND RECEPTION, VIP LOUNGE & OPERATIONS (Y = 0.0m)
          ========================================================================= */}
      <group position={[0, 0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 1}>
        {/* Center Back Wall: Warm Vertical Wood Slat Feature Wall with Illuminated "PROVIPAGENT" Logo */}
        <group position={[0, 2.6, -5.2]}>
          {/* Wood Feature Panel */}
          <mesh receiveShadow>
            <boxGeometry args={[14.0, 4.2, 0.15]} />
            <meshStandardMaterial color="#78350f" roughness={0.65} metalness={0.05} />
          </mesh>
          {/* Thin Vertical Wood Slats */}
          {[-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6].map((sx) => (
            <mesh key={`slat-${sx}`} position={[sx, 0, 0.09]}>
              <boxGeometry args={[0.08, 4.2, 0.04]} />
              <meshStandardMaterial color="#451a03" roughness={0.5} />
            </mesh>
          ))}
          {/* Warm Halo Backlight */}
          <pointLight color="#fef08a" intensity={0.9} distance={8} position={[0, 0.5, 0.5]} />

          {/* Crisp Illuminated Brand Signage */}
          <Html position={[0, 0.4, 0.12]} center distanceFactor={18} className="select-none pointer-events-none">
            <div className="flex flex-col items-center justify-center">
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-slate-950/80 border border-sky-400/40 shadow-2xl backdrop-blur-md">
                <div className="w-5 h-5 rounded-lg bg-sky-500 flex items-center justify-center font-black text-white text-[11px] shadow-md shadow-sky-500/50">
                  P
                </div>
                <span className="font-extrabold text-sm tracking-widest text-white uppercase drop-shadow-md">
                  PROVIPAGENT
                </span>
              </div>
            </div>
          </Html>
        </group>

        {/* Grand Curved Reception Desk at [0, 0, 1.8] */}
        <group position={[0, 0, 1.8]}>
          {/* Curved Counter Top (White Marble) */}
          <mesh castShadow receiveShadow position={[0, 1.05, 0]}>
            <cylinderGeometry args={[3.4, 3.4, 0.12, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.15} metalness={0.1} />
          </mesh>
          {/* Champagne Metallic Desk Base */}
          <mesh castShadow position={[0, 0.5, 0]}>
            <cylinderGeometry args={[3.2, 3.2, 1.0, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.3} metalness={0.4} />
          </mesh>
          {/* LED Backlit Counter Trim */}
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[3.25, 3.25, 0.08, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          {/* Receptionist Computer Screens */}
          {[-0.6, 0.6].map((rx, idx) => (
            <mesh key={`rec-mon-${idx}`} position={[rx, 1.35, -0.6]} rotation={[0, Math.PI, 0]}>
              <boxGeometry args={[0.7, 0.45, 0.04]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
          ))}
          {/* Receptionist Chairs */}
          {[-0.6, 0.6].map((rx, idx) => (
            <mesh key={`rec-chair-${idx}`} position={[rx, 0.5, -1.2]}>
              <cylinderGeometry args={[0.28, 0.32, 0.8, 16]} />
              <meshStandardMaterial color="#334155" metalness={0.6} />
            </mesh>
          ))}
        </group>

        {/* Left VIP Lounge: Emerald Green & Mustard Yellow Velvet Armchairs at [-9.0, 0, 4.0] */}
        <group position={[-9.0, 0, 4.0]}>
          {/* Emerald Green Velvet Sofa */}
          <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
            <boxGeometry args={[1.2, 0.85, 3.2]} />
            <meshStandardMaterial color="#065f46" roughness={0.65} />
          </mesh>
          {/* Mustard Yellow Velvet Armchairs */}
          {[-1.2, 1.2].map((az, idx) => (
            <mesh key={`mustard-chair-${idx}`} castShadow receiveShadow position={[2.4, 0.45, az]}>
              <boxGeometry args={[0.9, 0.85, 0.9]} />
              <meshStandardMaterial color="#d97706" roughness={0.65} />
            </mesh>
          ))}
          {/* White Marble Circular Coffee Table */}
          <mesh castShadow receiveShadow position={[1.2, 0.35, 0]}>
            <cylinderGeometry args={[0.8, 0.8, 0.3, 24]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.2} />
          </mesh>
          {/* Indoor Potted Ficus Palm in White Ceramic Pot */}
          <group position={[-1.8, 0, 2.5]}>
            <mesh castShadow position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.5, 0.4, 1.0, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </mesh>
            <mesh castShadow position={[0, 1.6, 0]}>
              <sphereGeometry args={[0.85, 12, 12]} />
              <meshStandardMaterial color="#16a34a" roughness={0.7} />
            </mesh>
          </group>
        </group>

        {/* Right Lounge: Coffee Bar & Meeting Breakout at [9.0, 0, 4.0] */}
        <group position={[9.0, 0, 4.0]}>
          {/* Modern Cream Leather Sofa */}
          <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
            <boxGeometry args={[1.2, 0.85, 3.2]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.6} />
          </mesh>
          {/* Teal Velvet Armchairs */}
          {[-1.2, 1.2].map((az, idx) => (
            <mesh key={`teal-chair-${idx}`} castShadow receiveShadow position={[-2.4, 0.45, az]}>
              <boxGeometry args={[0.9, 0.85, 0.9]} />
              <meshStandardMaterial color="#0e7490" roughness={0.65} />
            </mesh>
          ))}
          {/* Coffee Table */}
          <mesh castShadow receiveShadow position={[-1.2, 0.35, 0]}>
            <cylinderGeometry args={[0.8, 0.8, 0.3, 24]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.2} />
          </mesh>
          {/* Indoor Tree */}
          <group position={[1.8, 0, 2.5]}>
            <mesh castShadow position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.5, 0.4, 1.0, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </mesh>
            <mesh castShadow position={[0, 1.6, 0]}>
              <sphereGeometry args={[0.85, 12, 12]} />
              <meshStandardMaterial color="#16a34a" roughness={0.7} />
            </mesh>
          </group>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 2: DESIGN & CREATIVE STUDIO (Y = 6.0m)
          ========================================================================= */}
      <group position={[0, 6.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 2}>
        {/* Back Wall Signage */}
        <group position={[-9.0, 3.2, -5.2]}>
          <Html position={[0, 0, 0.1]} center distanceFactor={20} className="select-none pointer-events-none">
            <div className="px-3 py-1 rounded-lg bg-pink-950/80 border border-pink-400/40 text-pink-200 font-bold text-xs tracking-wider uppercase shadow-lg">
              DESIGN STUDIO & CREATIVE
            </div>
          </Html>
        </group>

        {/* Central Design Collaboration Table with Colorful Designer Chairs at [0, 0, 3.0] */}
        <group position={[0, 0, 3.0]}>
          {/* Large Round White Collaboration Table */}
          <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
            <cylinderGeometry args={[2.2, 2.2, 0.08, 32]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.3, 0.45, 0.7, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
          </mesh>
          {/* Laptops on Table */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, idx) => (
            <mesh key={`laptop-${idx}`} position={[Math.sin(ang) * 1.3, 0.8, Math.cos(ang) * 1.3]} rotation={[0, ang + Math.PI, 0]}>
              <boxGeometry args={[0.35, 0.02, 0.25]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
            </mesh>
          ))}
          {/* 4 Colorful Designer Chairs (Mustard, Teal, Coral, Violet) */}
          {[
            { a: 0, c: "#f59e0b" },
            { a: Math.PI / 2, c: "#06b6d4" },
            { a: Math.PI, c: "#f43f5e" },
            { a: (3 * Math.PI) / 2, c: "#8b5cf6" },
          ].map((item, idx) => (
            <group key={`des-chair-${idx}`} position={[Math.sin(item.a) * 2.0, 0.45, Math.cos(item.a) * 2.0]} rotation={[0, item.a + Math.PI, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.5, 0.8, 0.5]} />
                <meshStandardMaterial color={item.c} roughness={0.5} />
              </mesh>
            </group>
          ))}
        </group>

        {/* Mobile Architectural Moodboards & Wireframe Pinup Boards at [-5.0, 0, 1.5] */}
        <group position={[-5.0, 1.4, 1.5]} rotation={[0, 0.2, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[3.2, 1.8, 0.08]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
          {/* Color Palettes & Wireframe Swatches */}
          {[-1.0, -0.3, 0.4, 1.1].map((px, idx) => (
            <mesh key={`swatch-${idx}`} position={[px, 0.2, 0.05]}>
              <planeGeometry args={[0.55, 0.8]} />
              <meshBasicMaterial color={["#ec4899", "#8b5cf6", "#06b6d4", "#10b981"][idx]} />
            </mesh>
          ))}
        </group>

        {/* Right Creative Lounge at [8.5, 0, 4.0] */}
        <group position={[8.5, 0, 4.0]}>
          <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
            <boxGeometry args={[1.2, 0.85, 3.0]} />
            <meshStandardMaterial color="#1e293b" roughness={0.6} />
          </mesh>
          <mesh castShadow position={[-1.2, 0.35, 0]}>
            <boxGeometry args={[0.8, 0.3, 1.8]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.2} />
          </mesh>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 3: MARKETING & GROWTH (Y = 12.0m)
          ========================================================================= */}
      <group position={[0, 12.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 3}>
        {/* Back Wall Signage */}
        <group position={[9.0, 3.2, -5.2]}>
          <Html position={[0, 0, 0.1]} center distanceFactor={20} className="select-none pointer-events-none">
            <div className="px-3 py-1 rounded-lg bg-amber-950/80 border border-amber-400/40 text-amber-200 font-bold text-xs tracking-wider uppercase shadow-lg">
              MARKETING & GROWTH
            </div>
          </Html>
        </group>

        {/* Center Marketing Collaboration Island at [0, 0, 2.5] */}
        <group position={[0, 0, 2.5]}>
          <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
            <boxGeometry args={[4.5, 0.08, 1.8]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.25} metalness={0.1} />
          </mesh>
          {[-1.8, 1.8].map((lx, idx) => (
            <mesh key={`mkt-leg-${idx}`} position={[lx, 0.35, 0]}>
              <boxGeometry args={[0.1, 0.7, 1.6]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
            </mesh>
          ))}
          {/* Growth Analytics Display Screen */}
          <mesh position={[0, 1.5, -0.6]} rotation={[0, 0, 0]}>
            <boxGeometry args={[2.4, 1.2, 0.06]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          <mesh position={[0, 1.5, -0.56]}>
            <planeGeometry args={[2.3, 1.1]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>
        </group>

        {/* Right Breakout Lounge with Pastel Sofas at [9.0, 0, 4.0] */}
        <group position={[9.0, 0, 4.0]}>
          <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
            <boxGeometry args={[1.2, 0.85, 3.2]} />
            <meshStandardMaterial color="#0284c7" roughness={0.65} />
          </mesh>
          <mesh castShadow position={[-1.4, 0.35, 0]}>
            <boxGeometry args={[1.0, 0.3, 2.0]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.2} />
          </mesh>
        </group>
      </group>

      {/* =========================================================================
          FLOOR 4: BANKING, FINANCE & AI RESEARCH (Y = 18.0m)
          ========================================================================= */}
      <group position={[0, 18.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 4}>
        {/* Back Wall Signage: "BANKING & FINANCE" */}
        <group position={[-9.0, 3.2, -5.2]}>
          <Html position={[0, 0, 0.1]} center distanceFactor={20} className="select-none pointer-events-none">
            <div className="px-3 py-1 rounded-lg bg-indigo-950/80 border border-indigo-400/40 text-indigo-200 font-bold text-xs tracking-wider uppercase shadow-lg">
              BANKING & FINANCE
            </div>
          </Html>
        </group>

        {/* Left Side: Financial Analytics Trading Screens & Charts */}
        <group position={[-11.0, 1.8, -2.5]}>
          <mesh castShadow>
            <boxGeometry args={[0.08, 1.6, 6.0]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          {/* Glowing Green/Red Financial Candlestick Chart */}
          <mesh position={[0.05, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[5.8, 1.4]} />
            <meshBasicMaterial color="#059669" />
          </mesh>
        </group>

        {/* High-Density AI Server Racks on Right Side at [11.0, 0, -2.5] */}
        <group position={[11.0, 0, -2.5]}>
          {[-1.5, 0, 1.5].map((rz, idx) => (
            <group key={`fin-server-${idx}`} position={[0, 1.35, rz]}>
              <mesh castShadow>
                <boxGeometry args={[0.9, 2.7, 1.0]} />
                <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.15} />
              </mesh>
              {/* Pulsing Status LEDs */}
              {Array.from({ length: 6 }).map((_, lIdx) => (
                <mesh key={`fin-led-${lIdx}`} position={[-0.46, lIdx * 0.35 - 0.9, 0]}>
                  <boxGeometry args={[0.02, 0.04, 0.7]} />
                  <meshBasicMaterial color="#38bdf8" />
                </mesh>
              ))}
            </group>
          ))}
          <pointLight color="#38bdf8" intensity={1.2} distance={6} position={[-0.8, 1.8, 0]} />
        </group>
      </group>

      {/* =========================================================================
          FLOOR 5: ENGINEERING INNOVATION & ARCHITECTURE (Y = 24.0m)
          ========================================================================= */}
      <group position={[0, 24.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 5}>
        {/* Back Wall Signage: "ENGINEERING INNOVATION" */}
        <group position={[-9.0, 3.2, -5.2]}>
          <Html position={[0, 0, 0.1]} center distanceFactor={20} className="select-none pointer-events-none">
            <div className="px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-400/40 text-emerald-200 font-bold text-xs tracking-wider uppercase shadow-lg">
              ENGINEERING INNOVATION
            </div>
          </Html>
        </group>

        {/* Large Microservice Topology & Node Architecture Wall Screen at [0, 2.2, -5.1] */}
        <group position={[0, 2.2, -5.1]}>
          <mesh receiveShadow>
            <boxGeometry args={[8.0, 2.4, 0.08]} />
            <meshStandardMaterial color="#020617" roughness={0.2} metalness={0.8} />
          </mesh>
          {/* Illuminated Cyan Network Display Face */}
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[7.8, 2.2]} />
            <meshBasicMaterial color="#0284c7" />
          </mesh>
          <pointLight color="#38bdf8" intensity={1.5} distance={7} position={[0, 0, 0.5]} />
        </group>

        {/* Double-Sided Rolling Sprint / Kanban Board at [5.0, 1.3, 2.0] */}
        <group position={[5.0, 1.3, 2.0]}>
          <mesh castShadow>
            <boxGeometry args={[2.6, 1.6, 0.06]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.1} />
          </mesh>
          {/* Post-it / Kanban Task Cards */}
          {[-0.8, 0, 0.8].map((kx, idx) => (
            <mesh key={`kanban-${idx}`} position={[kx, 0.2, 0.04]}>
              <planeGeometry args={[0.55, 0.6]} />
              <meshBasicMaterial color={["#f59e0b", "#10b981", "#38bdf8"][idx]} />
            </mesh>
          ))}
        </group>
      </group>

      {/* =========================================================================
          FLOOR 6: EXECUTIVE PENTHOUSE & GRAND BOARDROOM (Y = 30.0m)
          ========================================================================= */}
      <group position={[0, 30.0, 0]} visible={!isFloorIsolated || activeFloor === 0 || activeFloor === 6}>
        {/* CEO Office Back Wall Feature: Backlit 3D "CEO" Signage at [-9.0, 2.8, -5.1] */}
        <group position={[-9.0, 2.8, -5.1]}>
          <mesh receiveShadow>
            <boxGeometry args={[8.5, 3.8, 0.15]} />
            <meshStandardMaterial color="#1c1917" roughness={0.5} metalness={0.2} />
          </mesh>
          {/* Fluted Vertical Dark Walnut Strips */}
          {[-3.5, -2, -0.5, 1, 2.5].map((wx) => (
            <mesh key={`ceo-slat-${wx}`} position={[wx, 0, 0.09]}>
              <boxGeometry args={[0.08, 3.8, 0.03]} />
              <meshStandardMaterial color="#0c0a09" roughness={0.4} />
            </mesh>
          ))}
          {/* Backlit Golden CEO Signage */}
          <Html position={[0, 0.4, 0.12]} center distanceFactor={18} className="select-none pointer-events-none">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-slate-950/80 border border-amber-400/50 shadow-2xl backdrop-blur-md">
              <span className="font-black text-base tracking-widest text-amber-300 uppercase drop-shadow-[0_0_12px_rgba(251,191,36,0.6)]">
                CEO
              </span>
            </div>
          </Html>
          <pointLight color="#f59e0b" intensity={1.2} distance={6} position={[0, 0.4, 0.5]} />
        </group>

        {/* Luxury CEO Executive Desk at [-9.0, 0, -2.5] */}
        <group position={[-9.0, 0, -2.5]}>
          <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
            <boxGeometry args={[3.2, 0.08, 1.5]} />
            <meshStandardMaterial color="#292524" roughness={0.25} metalness={0.2} />
          </mesh>
          {/* Brushed Brass Leg Pillars */}
          {[-1.4, 1.4].map((dx, idx) => (
            <mesh key={`ceo-leg-${idx}`} position={[dx, 0.35, 0]}>
              <boxGeometry args={[0.15, 0.7, 1.3]} />
              <meshStandardMaterial color="#d97706" metalness={0.9} roughness={0.15} />
            </mesh>
          ))}
          {/* Executive Dual Monitors */}
          <mesh position={[0, 1.25, -0.4]}>
            <boxGeometry args={[1.5, 0.55, 0.04]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          {/* Executive Leather High-Back Chair */}
          <mesh position={[0, 0.65, -1.0]}>
            <boxGeometry args={[0.7, 1.0, 0.6]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.5} />
          </mesh>
        </group>

        {/* Private CEO Lounge: Cream Leather Sectional Sofa at [-10.5, 0, 3.5] */}
        <group position={[-10.5, 0, 3.5]}>
          <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
            <boxGeometry args={[1.2, 0.85, 3.2]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.5} />
          </mesh>
          <mesh castShadow position={[1.4, 0.35, 0]}>
            <boxGeometry args={[1.0, 0.3, 2.0]} />
            <meshStandardMaterial color="#1c1917" roughness={0.2} metalness={0.8} />
          </mesh>
        </group>

        {/* Executive 3D Boardroom (Right Wing) at [8.5, 0, 0] */}
        <group position={[8.5, 0, 0]}>
          {/* Glass Partition Wall */}
          <mesh position={[-4.5, 1.6, 0]}>
            <boxGeometry args={[0.08, 3.2, 10.0]} />
            <meshPhysicalMaterial color="#e0f2fe" transmission={0.95} transparent opacity={0.35} roughness={0.05} />
          </mesh>
          {/* Grand Boardroom Table (Smoked Glass & Brass) */}
          <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
            <boxGeometry args={[6.2, 0.08, 2.2]} />
            <meshPhysicalMaterial color="#1e293b" transmission={0.4} roughness={0.1} metalness={0.7} />
          </mesh>
          {/* Executive Leather Boardroom Chairs */}
          {[-2.2, -0.7, 0.7, 2.2].map((cx, idx) => (
            <React.Fragment key={`bd-chair-${idx}`}>
              <mesh position={[cx, 0.55, 1.4]} rotation={[0, Math.PI, 0]}>
                <boxGeometry args={[0.55, 0.85, 0.55]} />
                <meshStandardMaterial color="#0f172a" roughness={0.5} />
              </mesh>
              <mesh position={[cx, 0.55, -1.4]}>
                <boxGeometry args={[0.55, 0.85, 0.55]} />
                <meshStandardMaterial color="#0f172a" roughness={0.5} />
              </mesh>
            </React.Fragment>
          ))}
          {/* Large Presentation Display Screen on East Wall */}
          <mesh position={[3.8, 1.8, 0]}>
            <boxGeometry args={[0.06, 1.8, 4.2]} />
            <meshStandardMaterial color="#020617" />
          </mesh>
          <mesh position={[3.75, 1.8, 0]}>
            <planeGeometry args={[4.0, 1.6]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export default React.memo(FloorInteriors, (prev, next) => {
  return prev.activeFloor === next.activeFloor && prev.isFloorIsolated === next.isFloorIsolated;
});
