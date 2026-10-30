"use client";

import React from "react";
import * as THREE from "three";

// Helper component for standard ergonomic workstation
function WorkstationDesk({
  position,
  rotation = [0, 0, 0],
  screenColor = "#0ea5e9",
  screenContent = "code",
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  screenColor?: string;
  screenContent?: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Desk Surface (Solid Natural White Oak Top) */}
      <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
        <boxGeometry args={[2.4, 0.06, 1.1]} />
        <meshStandardMaterial color="#d4a373" roughness={0.4} />
      </mesh>

      {/* Matte Black Steel Desk Legs */}
      {[-1.1, 1.1].map((x, idx) => (
        <group key={idx} position={[x, 0.37, 0]}>
          <mesh castShadow position={[0, 0, 0]}>
            <boxGeometry args={[0.08, 0.74, 0.95]} />
            <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[0, -0.36, 0]}>
            <boxGeometry args={[0.12, 0.04, 1.05]} />
            <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* Cable Management Raceway & Power Bar */}
      <mesh position={[0, 0.65, -0.4]}>
        <boxGeometry args={[1.8, 0.12, 0.1]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>

      {/* Dual / Triple Monitors on Articulated Monitor Arms */}
      <group position={[0, 0.77, -0.2]}>
        {/* Monitor Stand Base & Arm */}
        <mesh position={[0, 0.18, -0.15]}>
          <cylinderGeometry args={[0.025, 0.03, 0.4, 12]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>

        {/* Center Primary Curved Ultrawide Display */}
        <group position={[0, 0.36, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.1, 0.5, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Glowing Screen */}
          <mesh position={[0, 0, 0.022]}>
            <planeGeometry args={[1.06, 0.46]} />
            <meshStandardMaterial
              color="#090d16"
              emissive={screenColor}
              emissiveIntensity={0.65}
              roughness={0.2}
            />
          </mesh>
        </group>

        {/* Left Angled Companion Display */}
        <group position={[-0.72, 0.36, 0.08]} rotation={[0, 0.35, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.5, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.022]}>
            <planeGeometry args={[0.46, 0.46]} />
            <meshStandardMaterial
              color="#090d16"
              emissive={screenColor}
              emissiveIntensity={0.45}
              roughness={0.2}
            />
          </mesh>
        </group>

        {/* Right Angled Companion Display */}
        <group position={[0.72, 0.36, 0.08]} rotation={[0, -0.35, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.5, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.022]}>
            <planeGeometry args={[0.46, 0.46]} />
            <meshStandardMaterial
              color="#090d16"
              emissive={screenColor}
              emissiveIntensity={0.45}
              roughness={0.2}
            />
          </mesh>
        </group>
      </group>

      {/* Desk Accessories: Keyboard, Mousepad, Coffee Mug */}
      <mesh position={[0, 0.772, 0.15]}>
        <boxGeometry args={[0.45, 0.01, 0.14]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[0.35, 0.771, 0.15]}>
        <boxGeometry args={[0.2, 0.005, 0.22]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[-0.45, 0.81, 0.2]}>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>

      {/* Ergonomic Office Chair */}
      <group position={[0, 0, 0.75]} rotation={[0, Math.PI, 0]}>
        {/* Chair Seat */}
        <mesh castShadow position={[0, 0.48, 0]}>
          <boxGeometry args={[0.52, 0.08, 0.5]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
        {/* Mesh Backrest */}
        <mesh castShadow position={[0, 0.85, 0.22]} rotation={[-0.1, 0, 0]}>
          <boxGeometry args={[0.48, 0.65, 0.05]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        {/* Armrests */}
        {[-0.27, 0.27].map((cx, idx) => (
          <mesh key={idx} position={[cx, 0.68, 0.05]}>
            <boxGeometry args={[0.06, 0.04, 0.26]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        ))}
        {/* Gas Cylinder & 5-Star Wheel Base */}
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.04, 5]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

export default function OfficeFurniture() {
  return (
    <group>
      {/* ================================================================= */}
      {/* 1. EXECUTIVE BOARDROOM & SUITE ([0, 0, -10])                     */}
      {/* ================================================================= */}
      <group position={[0, 0, -10]}>
        {/* Executive Conference Table (Calacatta Gold Oval Marble) */}
        <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
          <cylinderGeometry args={[2.8, 2.8, 0.08, 32, 1, false]} />
          <meshStandardMaterial
            color="#fdfcf7"
            roughness={0.15}
            metalness={0.1}
          />
        </mesh>
        {/* Center Metal Inset with Power Connectivity */}
        <mesh position={[0, 0.785, 0]}>
          <boxGeometry args={[1.4, 0.01, 0.4]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Sculptural Double Fluted Bronze Table Base */}
        {[-1.2, 1.2].map((bx, idx) => (
          <mesh key={idx} castShadow position={[bx, 0.35, 0]}>
            <cylinderGeometry args={[0.45, 0.55, 0.7, 24]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}

        {/* 8 Executive Leather Swivel Chairs around Table */}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const dist = 2.4;
          const cx = Math.cos(angle) * dist;
          const cz = Math.sin(angle) * dist;
          return (
            <group
              key={i}
              position={[cx, 0, cz]}
              rotation={[0, -angle + Math.PI / 2, 0]}
            >
              <mesh castShadow position={[0, 0.48, 0]}>
                <boxGeometry args={[0.55, 0.08, 0.52]} />
                <meshStandardMaterial color="#0f172a" roughness={0.5} />
              </mesh>
              <mesh castShadow position={[0, 0.88, -0.22]}>
                <boxGeometry args={[0.52, 0.72, 0.06]} />
                <meshStandardMaterial color="#0f172a" roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.22, 0]}>
                <cylinderGeometry args={[0.035, 0.035, 0.44, 8]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
              </mesh>
            </group>
          );
        })}

        {/* Wall-Mounted Ultra-Wide Executive Dashboard Display */}
        <group position={[0, 2.8, -6.8]}>
          <mesh castShadow>
            <boxGeometry args={[6.2, 2.2, 0.08]} />
            <meshStandardMaterial color="#020617" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Glowing Dashboard Screen */}
          <mesh position={[0, 0, 0.045]}>
            <planeGeometry args={[6.0, 2.0]} />
            <meshStandardMaterial
              color="#090d16"
              emissive="#3b82f6"
              emissiveIntensity={0.5}
              roughness={0.2}
            />
          </mesh>
        </group>
      </group>

      {/* ================================================================= */}
      {/* 2. ENGINEERING & ARCHITECTURE BAY ([-14, 0, -4])                  */}
      {/* ================================================================= */}
      <WorkstationDesk
        position={[-14, 0, -4]}
        rotation={[0, 0, 0]}
        screenColor="#0ea5e9"
      />
      {/* Micro-Server Rack Enclosure */}
      <group position={[-18.5, 0, -4]}>
        <mesh castShadow position={[0, 1.1, 0]}>
          <boxGeometry args={[0.9, 2.2, 1.0]} />
          <meshStandardMaterial color="#090d16" metalness={0.9} roughness={0.3} />
        </mesh>
        {/* Blinking Activity LEDs */}
        {Array.from({ length: 6 }).map((_, idx) => (
          <mesh key={idx} position={[0.46, 0.4 + idx * 0.25, 0]}>
            <planeGeometry args={[0.04, 0.04]} />
            <meshBasicMaterial color={idx % 2 === 0 ? "#0ea5e9" : "#10b981"} />
          </mesh>
        ))}
      </group>

      {/* ================================================================= */}
      {/* 3. AI RESEARCH & INTELLIGENCE LAB ([-14, 0, 10])                  */}
      {/* ================================================================= */}
      <WorkstationDesk
        position={[-14, 0, 10]}
        rotation={[0, 0, 0]}
        screenColor="#8b5cf6"
      />
      {/* Holographic Neural Graph Pedestal */}
      <group position={[-18.5, 0, 10]}>
        <mesh castShadow position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.6, 0.7, 1.0, 16]} />
          <meshStandardMaterial color="#1e1b4b" roughness={0.3} metalness={0.8} />
        </mesh>
        {/* Glowing Neural Node Sphere */}
        <mesh position={[0, 1.4, 0]}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial
            color="#8b5cf6"
            emissive="#a855f7"
            emissiveIntensity={1.2}
            wireframe
          />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 4. MARKETING & GROWTH STUDIO ([14, 0, -4])                        */}
      {/* ================================================================= */}
      <WorkstationDesk
        position={[14, 0, -4]}
        rotation={[0, 0, 0]}
        screenColor="#f43f5e"
      />
      {/* Creative Campaign Moodboard Display */}
      <group position={[18.5, 0, -4]}>
        <mesh castShadow position={[0, 1.4, 0]}>
          <boxGeometry args={[0.08, 1.6, 2.4]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        <mesh position={[-0.045, 1.4, 0]}>
          <planeGeometry args={[2.3, 1.5]} />
          <meshStandardMaterial
            color="#1c1917"
            emissive="#f43f5e"
            emissiveIntensity={0.4}
          />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 5. SALES & ENTERPRISE SOLUTIONS WING ([14, 0, 10])                */}
      {/* ================================================================= */}
      <WorkstationDesk
        position={[14, 0, 10]}
        rotation={[0, 0, 0]}
        screenColor="#10b981"
      />
      {/* Client Negotiation Lounge Nook */}
      <group position={[18.5, 0, 10]}>
        {/* Glass Round Discussion Table */}
        <mesh castShadow position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.7, 0.7, 0.04, 24]} />
          <meshPhysicalMaterial color="#ffffff" transmission={0.9} roughness={0.1} />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.5, 12]} />
          <meshStandardMaterial color="#0f172a" metalness={0.9} />
        </mesh>
        {/* Leather Armchairs */}
        {[-0.9, 0.9].map((ax, idx) => (
          <mesh key={idx} castShadow position={[ax, 0.42, 0]}>
            <boxGeometry args={[0.55, 0.48, 0.55]} />
            <meshStandardMaterial color="#062e24" roughness={0.7} />
          </mesh>
        ))}
      </group>

      {/* ================================================================= */}
      {/* 6. FINANCE & TREASURY OFFICE ([6, 0, -4])                         */}
      {/* ================================================================= */}
      <WorkstationDesk
        position={[6, 0, -4]}
        rotation={[0, 0, 0]}
        screenColor="#eab308"
      />

      {/* ================================================================= */}
      {/* 7. OPERATIONS & RECRUITMENT HUB ([-6, 0, -4])                     */}
      {/* ================================================================= */}
      <WorkstationDesk
        position={[-6, 0, -4]}
        rotation={[0, 0, 0]}
        screenColor="#06b6d4"
      />

      {/* ================================================================= */}
      {/* 8. CUSTOMER SUCCESS & CLIENT LOUNGE ([0, 0, 11])                  */}
      {/* ================================================================= */}
      <group position={[0, 0, 11]}>
        {/* Modular L-Shaped Contemporary Sofa (Deep Slate Navy) */}
        <group position={[0, 0.38, 0]}>
          <mesh castShadow position={[-1.2, 0, 0]}>
            <boxGeometry args={[2.4, 0.42, 1.0]} />
            <meshStandardMaterial color="#1e293b" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0.7, 0, 0.7]}>
            <boxGeometry args={[1.4, 0.42, 2.4]} />
            <meshStandardMaterial color="#1e293b" roughness={0.9} />
          </mesh>
          {/* Sofa Backrest */}
          <mesh castShadow position={[-1.2, 0.35, -0.4]}>
            <boxGeometry args={[2.4, 0.45, 0.25]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[1.3, 0.35, 0.7]}>
            <boxGeometry args={[0.25, 0.45, 2.4]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} />
          </mesh>
        </group>

        {/* Low Solid Walnut Coffee Table */}
        <mesh castShadow position={[-0.8, 0.22, 0.8]}>
          <boxGeometry args={[1.2, 0.24, 0.7]} />
          <meshStandardMaterial color="#45281a" roughness={0.4} />
        </mesh>

        {/* Enterprise SLA Uptime Display Screen (99.98% SLA Status) */}
        <group position={[0, 2.5, 3.8]}>
          <mesh castShadow>
            <boxGeometry args={[3.2, 1.4, 0.06]} />
            <meshStandardMaterial color="#0f172a" metalness={0.9} />
          </mesh>
          <mesh position={[0, 0, 0.035]}>
            <planeGeometry args={[3.0, 1.2]} />
            <meshStandardMaterial
              color="#042f2e"
              emissive="#14b8a6"
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}
