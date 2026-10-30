"use client";

import React, { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { WorldAgentStatus } from "@/types";

interface CorporateAgentAvatarProps {
  status: WorldAgentStatus;
  color: string;
  appearance: string;
  isWorking?: boolean;
}

export default function CorporateAgentAvatar({
  status,
  color,
  appearance,
  isWorking = false,
}: CorporateAgentAvatarProps) {
  const avatarGroup = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const lanyardRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    // Natural subtle breathing motion
    if (avatarGroup.current) {
      avatarGroup.current.position.y = Math.sin(t * 1.8) * 0.015;
    }

    // Head subtle glance
    if (headRef.current) {
      headRef.current.rotation.y = Math.sin(t * 0.8) * 0.08;
      headRef.current.rotation.x = Math.sin(t * 1.2) * 0.04;
    }

    // Working typing animation vs idle posture
    if (status === "working" || isWorking) {
      if (leftArmRef.current && rightArmRef.current) {
        leftArmRef.current.rotation.x = -1.2 + Math.sin(t * 16) * 0.12;
        leftArmRef.current.rotation.z = 0.35 + Math.cos(t * 14) * 0.08;
        rightArmRef.current.rotation.x = -1.2 + Math.cos(t * 15) * 0.12;
        rightArmRef.current.rotation.z = -0.35 + Math.sin(t * 15) * 0.08;
      }
    } else {
      if (leftArmRef.current && rightArmRef.current) {
        leftArmRef.current.rotation.x = -0.3 + Math.sin(t * 1.5) * 0.04;
        leftArmRef.current.rotation.z = 0.2;
        rightArmRef.current.rotation.x = -0.3 + Math.cos(t * 1.5) * 0.04;
        rightArmRef.current.rotation.z = -0.2;
      }
    }
  });

  return (
    <group ref={avatarGroup} position={[0, 0, 0]}>
      {/* 1. Dress Shoes / Feet */}
      {[-0.14, 0.14].map((fx, idx) => (
        <group key={idx} position={[fx, 0.06, 0.02]}>
          <mesh castShadow>
            <boxGeometry args={[0.13, 0.08, 0.28]} />
            <meshStandardMaterial color="#090d16" roughness={0.2} metalness={0.6} />
          </mesh>
        </group>
      ))}

      {/* 2. Tailored Trousers / Slacks */}
      {[-0.14, 0.14].map((lx, idx) => (
        <mesh key={idx} castShadow position={[lx, 0.44, 0]}>
          <cylinderGeometry args={[0.075, 0.065, 0.72, 16]} />
          <meshStandardMaterial color="#0f172a" roughness={0.7} />
        </mesh>
      ))}

      {/* 3. Pelvis & Waist Belt with Metallic Buckle */}
      <mesh castShadow position={[0, 0.82, 0]}>
        <cylinderGeometry args={[0.22, 0.2, 0.14, 16]} />
        <meshStandardMaterial color="#0f172a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.86, 0.12]}>
        <boxGeometry args={[0.08, 0.05, 0.02]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.9} roughness={0.1} />
      </mesh>

      {/* 4. Torso with Tailored Executive Blazer Jacket */}
      <group position={[0, 1.16, 0]}>
        {/* Crisp Collared Dress Shirt */}
        <mesh castShadow position={[0, 0, 0]}>
          <cylinderGeometry args={[0.24, 0.21, 0.58, 16]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} />
        </mesh>
        {/* Blazer Exterior Shell (Department Color Tone) */}
        <mesh castShadow position={[0, -0.02, 0]}>
          <cylinderGeometry args={[0.255, 0.23, 0.54, 16]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.15} />
        </mesh>
        {/* Blazer Lapel V-Neck */}
        <mesh position={[0, 0.14, 0.14]}>
          <boxGeometry args={[0.14, 0.28, 0.04]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
        {/* Silk Tie / Accent Collar */}
        <mesh position={[0, 0.08, 0.16]}>
          <boxGeometry args={[0.05, 0.24, 0.02]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>
        {/* Corporate Security Lanyard / Identification Card */}
        <group position={[0, -0.05, 0.17]}>
          <mesh ref={lanyardRef} castShadow>
            <boxGeometry args={[0.08, 0.12, 0.005]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive={color}
              emissiveIntensity={0.25}
            />
          </mesh>
        </group>
      </group>

      {/* 5. Articulated Arms & Hands */}
      {/* Left Arm */}
      <group ref={leftArmRef} position={[-0.3, 1.38, 0]}>
        {/* Shoulder & Bicep */}
        <mesh castShadow position={[0, -0.16, 0]}>
          <cylinderGeometry args={[0.065, 0.055, 0.32, 12]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {/* Forearm */}
        <mesh castShadow position={[0, -0.38, 0.08]}>
          <cylinderGeometry args={[0.055, 0.045, 0.28, 12]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {/* Hand */}
        <mesh castShadow position={[0, -0.54, 0.14]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color="#fcd34d" roughness={0.6} />
        </mesh>
      </group>

      {/* Right Arm */}
      <group ref={rightArmRef} position={[0.3, 1.38, 0]}>
        {/* Shoulder & Bicep */}
        <mesh castShadow position={[0, -0.16, 0]}>
          <cylinderGeometry args={[0.065, 0.055, 0.32, 12]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {/* Forearm */}
        <mesh castShadow position={[0, -0.38, 0.08]}>
          <cylinderGeometry args={[0.055, 0.045, 0.28, 12]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {/* Hand */}
        <mesh castShadow position={[0, -0.54, 0.14]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color="#fcd34d" roughness={0.6} />
        </mesh>
      </group>

      {/* 6. Neck and Professional Stylized Head */}
      <group ref={headRef} position={[0, 1.5, 0]}>
        {/* Neck */}
        <mesh castShadow position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.06, 0.07, 0.12, 12]} />
          <meshStandardMaterial color="#fcd34d" roughness={0.6} />
        </mesh>
        {/* Head */}
        <mesh castShadow position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.15, 20, 20]} />
          <meshStandardMaterial color="#fcd34d" roughness={0.5} />
        </mesh>
        {/* Professional Styled Hair (Modern Sleek Cut) */}
        <mesh castShadow position={[0, 0.23, -0.02]}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
      </group>

      {/* 7. Subtle Translucent Neural Halo Ring (Thinking / Autonomous Operation) */}
      {status === "working" && (
        <group position={[0, 1.95, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.26, 0.015, 16, 32]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={1.2}
              transparent
              opacity={0.85}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
