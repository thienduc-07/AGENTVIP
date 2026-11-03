"use client";

import React, { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import Workstation, { WorkstationData } from "./Workstation";

export interface DepartmentZoneData {
  department: string;
  zone: string;
  base_x: number;
  base_y: number;
  base_z: number;
  max_physical_desks: number;
  desk_spacing_x: number;
  desk_spacing_z: number;
  color?: string;
  workstations: WorkstationData[];
}

interface DepartmentZoneProps {
  data: DepartmentZoneData;
  isSelected?: boolean;
  selectedWorkstationId?: string | null;
  renderWorkstations?: boolean;
  onSelectDepartment?: (deptName: string) => void;
  onSelectWorkstation?: (workstationId: string) => void;
}

const DEPARTMENT_COLORS: Record<string, string> = {
  Executive: "#38bdf8",
  Engineering: "#10b981",
  "AI Research": "#a855f7",
  Marketing: "#f59e0b",
  Sales: "#06b6d4",
  Operations: "#64748b",
  Finance: "#eab308",
  "Customer Success": "#ec4899",
};

function DepartmentZone({
  data,
  isSelected = false,
  selectedWorkstationId,
  renderWorkstations = false,
  onSelectDepartment,
  onSelectWorkstation,
}: DepartmentZoneProps) {
  const [isHovered, setIsHovered] = useState(false);

  const deptColor = data.color || DEPARTMENT_COLORS[data.department] || "#38bdf8";

  // Compute carpet size based on max desks and spacing
  const cols = Math.min(data.max_physical_desks, 4);
  const rows = Math.ceil(data.max_physical_desks / cols);
  const carpetWidth = Math.max(8.5, cols * (data.desk_spacing_x || 2.2) + 2.4);
  const carpetDepth = Math.max(7.5, rows * (data.desk_spacing_z || 2.0) + 2.8);

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (onSelectDepartment) {
      onSelectDepartment(data.department);
    }
  };

  return (
    <group
      position={[data.base_x, data.base_y || 0, data.base_z]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
      }}
      onPointerOut={() => setIsHovered(false)}
    >
      {/* 1. Department Floor Light Carpet Accent (Warm Linen Wool Rug) */}
      <mesh receiveShadow position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[carpetWidth, carpetDepth]} />
        <meshStandardMaterial
          color="#f3ebe1"
          roughness={0.5}
          metalness={0.02}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* 2. Department Boundary Subtle Accent Line */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[carpetWidth + 0.12, carpetDepth + 0.12]} />
        <meshBasicMaterial
          color={isSelected ? "#38bdf8" : deptColor}
          transparent
          opacity={isSelected ? 0.75 : isHovered ? 0.4 : 0.15}
          wireframe
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* 3. Floating Department Overhead Label (Only shown on hover or when department is selected) */}
      {(isSelected || isHovered) && (
        <Html position={[0, 3.2, -carpetDepth / 2 + 0.5]} center distanceFactor={18}>
          <div
            className={`px-3 py-1 rounded-full backdrop-blur-md border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all duration-150 flex items-center gap-1.5 shadow-md ${
              isSelected
                ? "bg-sky-950/90 border-sky-400 text-sky-200 ring-2 ring-sky-400/40"
                : "bg-slate-900/90 border-slate-600 text-slate-100"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (onSelectDepartment) onSelectDepartment(data.department);
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: deptColor }}
            />
            <span>{data.department}</span>
            <span className="text-[10px] text-slate-400 font-normal">
              ({data.workstations.filter((w) => w.assigned_employee).length}/{data.max_physical_desks} Bàn)
            </span>
          </div>
        </Html>
      )}

      {/* 4. Child Workstation Array within this Department Zone */}
      {renderWorkstations &&
        data.workstations.map((ws) => (
          <Workstation
            key={ws.workstation_id}
            data={{
              ...ws,
              pos_x: ws.pos_x - data.base_x,
              pos_z: ws.pos_z - data.base_z,
            }}
            isSelected={selectedWorkstationId === ws.workstation_id}
            onSelect={onSelectWorkstation}
          />
        ))}
    </group>
  );
}

export default React.memo(DepartmentZone, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.selectedWorkstationId === next.selectedWorkstationId &&
    prev.data.department === next.data.department &&
    prev.data.workstations.length === next.data.workstations.length &&
    prev.data.base_x === next.data.base_x &&
    prev.data.base_y === next.data.base_y &&
    prev.data.base_z === next.data.base_z &&
    prev.data.workstations === next.data.workstations
  );
});
