"use client";

import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useWorldStore } from "@/store/worldStore";

export const CORPORATE_SKILLS: Record<
  string,
  {
    name: string;
    vietnameseName: string;
    color: string;
    trailColor: string;
    icon: string;
  }
> = {
  "agent-exec-ceo": {
    name: "Executive Strategy & Governance",
    vietnameseName: "Chỉ Đạo Chiến Lược & Phê Duyệt Cấp Cao",
    color: "#3b82f6",
    trailColor: "#1d4ed8",
    icon: "🏛️",
  },
  "agent-eng-lead": {
    name: "System Architecture & Sandbox",
    vietnameseName: "Kiến Trúc Kỹ Thuật & Sandbox Thực Thi",
    color: "#0ea5e9",
    trailColor: "#0284c7",
    icon: "💻",
  },
  "agent-research-ai": {
    name: "Market Intelligence & AI Research",
    vietnameseName: "Nghiên Cứu AI & Đồ Thị Tri Thức",
    color: "#8b5cf6",
    trailColor: "#6d28d9",
    icon: "🔬",
  },
  "agent-mkt-growth": {
    name: "Brand Strategy & Growth Marketing",
    vietnameseName: "Định Vị Thương Hiệu & Tăng Trưởng",
    color: "#f43f5e",
    trailColor: "#be123c",
    icon: "📈",
  },
  "agent-sales-director": {
    name: "Enterprise Solutions & Sales",
    vietnameseName: "Kinh Doanh Doanh Nghiệp & Hợp Đồng",
    color: "#10b981",
    trailColor: "#047857",
    icon: "🤝",
  },
  "agent-fin-controller": {
    name: "Financial Ledger & Budget Auditing",
    vietnameseName: "Kiểm Toán Ngân Sách & Sổ Cái",
    color: "#eab308",
    trailColor: "#a16207",
    icon: "⚖️",
  },
  "agent-ops-recruiter": {
    name: "Operations & Agent Recruitment",
    vietnameseName: "Vận Hành & Tuyển Dụng Agent",
    color: "#06b6d4",
    trailColor: "#0e7490",
    icon: "⚙️",
  },
  "agent-support-lead": {
    name: "Customer Success & SLA Monitoring",
    vietnameseName: "Thành Công Khách Hàng & SLA",
    color: "#14b8a6",
    trailColor: "#0f766e",
    icon: "🎧",
  },
};

export default function TaskHandoffVFX() {
  const activeHandoff = useWorldStore((s) => s.activeHandoff);
  const agents = useWorldStore((s) => s.agents);

  const pointsRef = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);

  const particleCount = 48;
  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    return { positions: pos, colors: col };
  }, []);

  useFrame(() => {
    if (!activeHandoff) return;

    const fromAgent = agents[activeHandoff.fromAgentId];
    const toAgent = agents[activeHandoff.toAgentId];
    if (!fromAgent || !toAgent) return;

    const start = new THREE.Vector3(fromAgent.position[0], 1.4, fromAgent.position[2]);
    const end = new THREE.Vector3(toAgent.position[0], 1.4, toAgent.position[2]);

    const elapsed = Date.now() - activeHandoff.startTime;
    const progress = Math.min(1.0, elapsed / activeHandoff.duration);

    // Quadratic Bezier arc
    const mid = start.clone().lerp(end, 0.5);
    mid.y += 2.4; // Elegant arc height across office

    const p0 = start.clone().lerp(mid, progress);
    const p1 = mid.clone().lerp(end, progress);
    const currentPoint = p0.lerp(p1, progress);

    if (coreRef.current) {
      coreRef.current.position.copy(currentPoint);
    }

    if (pointsRef.current) {
      const skill = CORPORATE_SKILLS[activeHandoff.fromAgentId] || {
        color: "#3b82f6",
        trailColor: "#1d4ed8",
      };
      const mainCol = new THREE.Color(skill.color);

      const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = pointsRef.current.geometry.attributes.color as THREE.BufferAttribute;

      for (let i = 0; i < particleCount; i++) {
        const offset = (i / particleCount) * 0.4;
        const trailProgress = Math.max(0, progress - offset * 0.15);
        const t0 = start.clone().lerp(mid, trailProgress);
        const t1 = mid.clone().lerp(end, trailProgress);
        const pt = t0.lerp(t1, trailProgress);

        posAttr.setXYZ(
          i,
          pt.x + (Math.random() - 0.5) * 0.15,
          pt.y + (Math.random() - 0.5) * 0.15,
          pt.z + (Math.random() - 0.5) * 0.15
        );

        colAttr.setXYZ(i, mainCol.r, mainCol.g, mainCol.b);
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  });

  if (!activeHandoff) return null;

  const skill = CORPORATE_SKILLS[activeHandoff.fromAgentId] || {
    color: "#3b82f6",
  };

  return (
    <group>
      {/* Leading Glowing Digital Packet Sphere */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive={skill.color}
          emissiveIntensity={2.5}
        />
      </mesh>

      {/* Trailing Particle Telemetry Stream */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[colors, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.14}
          vertexColors
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
