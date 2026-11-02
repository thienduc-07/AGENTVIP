"use client";

import React, { useMemo, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import MeetingPresentationScreen from "./MeetingPresentationScreen";
import { MeetingSeatingManager, DEFAULT_MEETING_SEATING_CONFIG } from "@/lib/meeting/seatingManager";
import { useMeetingStore } from "@/store/meetingStore";
import { Users, DoorOpen, Radio } from "lucide-react";

interface MeetingRoomProps {
  position?: [number, number, number];
  onEnterMeetingView?: () => void;
  onSelectChair?: (seatIndex: number, agentId?: string) => void;
  onSelectDisplay?: () => void;
}

export default function MeetingRoom({
  position = [0, 0, 3.5],
  onEnterMeetingView,
  onSelectChair,
  onSelectDisplay,
}: MeetingRoomProps) {
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const participants = useMeetingStore((s) => s.participants);
  const seatAssignments = useMeetingStore((s) => s.seatAssignments);
  const isMeetingViewActive = useMeetingStore((s) => s.isMeetingViewActive);
  const selectedParticipantId = useMeetingStore((s) => s.selectedParticipantId);

  const [hoveredChairIndex, setHoveredChairIndex] = useState<number | null>(null);
  const [isRoomHovered, setIsRoomHovered] = useState(false);

  // Initialize seating manager with this room center
  const seatingManager = useMemo(() => {
    return new MeetingSeatingManager({
      roomCenterX: 0,
      roomCenterY: 0,
      roomCenterZ: 0,
      tableLength: 5.6,
      tableWidth: 2.4,
      chairOffset: 0.65,
      maxCapacity: 10,
    });
  }, []);

  const seatsLayout = useMemo(() => seatingManager.calculateSeatingLayout(), [seatingManager]);

  // Determine room status glow color
  const statusColor = useMemo(() => {
    if (!activeMeeting) return "#64748b"; // Idle Slate
    if (activeMeeting.status === "IN_PROGRESS") return "#10b981"; // Live Green
    if (activeMeeting.status === "PAUSED") return "#f59e0b"; // Paused Amber
    if (activeMeeting.status === "WAITING_APPROVAL") return "#f97316"; // Approval Orange
    if (activeMeeting.status === "COMPLETED") return "#38bdf8"; // Completed Sky Blue
    return "#ef4444"; // Cancelled/Failed Red
  }, [activeMeeting?.status]);

  return (
    <group position={position}>
      {/* 1. Acoustic Carpet Floor Pad for Conference Room */}
      <mesh receiveShadow position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.8, 9.4]} />
        <meshStandardMaterial color="#0b1120" roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Carpet Border Accent Frame */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.8, 4.88, 48]} />
        <meshBasicMaterial color={statusColor} transparent opacity={0.5} />
      </mesh>

      {/* 2. Glass Perimeter Walls with Entrance Gap at South (+Z) */}
      {/* West Glass Wall */}
      <mesh position={[-3.8, 1.6, 0]}>
        <boxGeometry args={[0.08, 3.2, 9.2]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.88}
          roughness={0.12}
          transparent
          opacity={0.85}
          ior={1.5}
        />
      </mesh>

      {/* East Glass Wall */}
      <mesh position={[3.8, 1.6, 0]}>
        <boxGeometry args={[0.08, 3.2, 9.2]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.88}
          roughness={0.12}
          transparent
          opacity={0.85}
          ior={1.5}
        />
      </mesh>

      {/* North Wall (Behind Presentation Screen) */}
      <mesh position={[0, 1.6, -4.6]}>
        <boxGeometry args={[7.6, 3.2, 0.12]} />
        <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.3} />
      </mesh>

      {/* South Glass Partition with Entrance Gateway */}
      <mesh position={[-2.4, 1.6, 4.6]}>
        <boxGeometry args={[2.8, 3.2, 0.08]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.88}
          roughness={0.12}
          transparent
          opacity={0.85}
          ior={1.5}
        />
      </mesh>
      <mesh position={[2.4, 1.6, 4.6]}>
        <boxGeometry args={[2.8, 3.2, 0.08]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          transmission={0.88}
          roughness={0.12}
          transparent
          opacity={0.85}
          ior={1.5}
        />
      </mesh>

      {/* Entrance Overhead Portal Frame & Meeting Beacon */}
      <mesh position={[0, 3.2, 4.6]}>
        <boxGeometry args={[2.2, 0.18, 0.2]} />
        <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Dynamic Status LED Beacon above Doorway */}
      <mesh position={[0, 3.05, 4.65]}>
        <boxGeometry args={[1.6, 0.06, 0.04]} />
        <meshBasicMaterial color={statusColor} />
      </mesh>

      {/* Entrance Doorway 3D Billboard / Floating Callout */}
      {!isMeetingViewActive && (
        <Html
          position={[0, 3.6, 4.6]}
          center
          distanceFactor={18}
          className="pointer-events-auto select-none cursor-pointer"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              onEnterMeetingView?.();
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-2xl backdrop-blur-md text-xs font-semibold text-slate-100 hover:border-sky-400 hover:bg-slate-800 transition-all scale-95 hover:scale-100"
          >
            <div
              className="w-2.5 h-2.5 rounded-full animate-pulse shadow-sm"
              style={{ backgroundColor: statusColor }}
            />
            <span className="tracking-wide">PHÒNG HỌP ĐIỀU HÀNH</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-sky-400 border border-slate-700">
              {Object.keys(participants).length} đặc vụ
            </span>
            <DoorOpen className="w-3.5 h-3.5 text-slate-400" />
          </div>
        </Html>
      )}

      {/* 3. Executive Conference Table */}
      <group position={[0, 0, 0]}>
        {/* Table Top Surface (Dark Slate / Italian Marble) */}
        <mesh castShadow receiveShadow position={[0, 0.76, 0]}>
          <boxGeometry args={[2.4, 0.08, 5.6]} />
          <meshStandardMaterial color="#1e293b" roughness={0.2} metalness={0.3} />
        </mesh>

        {/* Center Table Brushed Metal Power & Cable Trough */}
        <mesh position={[0, 0.765, 0]}>
          <boxGeometry args={[0.35, 0.005, 4.6]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.8} />
        </mesh>

        {/* Integrated Center Ambient LED Strip */}
        <mesh position={[0, 0.77, 0]}>
          <boxGeometry args={[0.04, 0.005, 4.4]} />
          <meshBasicMaterial color={statusColor} transparent opacity={0.65} />
        </mesh>

        {/* Heavy Table Base Pedestals */}
        <mesh castShadow position={[0, 0.38, -1.8]}>
          <boxGeometry args={[1.2, 0.68, 0.4]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.6} />
        </mesh>
        <mesh castShadow position={[0, 0.38, 1.8]}>
          <boxGeometry args={[1.2, 0.68, 0.4]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.6} />
        </mesh>
      </group>

      {/* 4. Ergonomic Executive Conference Swivel Chairs */}
      {seatsLayout.map((seat) => {
        const isHovered = hoveredChairIndex === seat.seatIndex;
        // Check if chair is occupied by any participant
        const occupiedAgentId = Object.entries(seatAssignments).find(
          ([_, assign]) => assign.seatIndex === seat.seatIndex
        )?.[0];
        const isSelected = occupiedAgentId && selectedParticipantId === occupiedAgentId;

        return (
          <group
            key={seat.chairId}
            position={seat.position}
            rotation={[0, seat.rotationY, 0]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoveredChairIndex(seat.seatIndex);
            }}
            onPointerOut={() => setHoveredChairIndex(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSelectChair?.(seat.seatIndex, occupiedAgentId);
            }}
          >
            {/* Swivel Chair Chrome Piston Base */}
            <mesh castShadow position={[0, -0.22, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.4, 12]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
            </mesh>

            {/* Five-Star Base Plate */}
            <mesh position={[0, -0.4, 0]}>
              <cylinderGeometry args={[0.26, 0.28, 0.04, 12]} />
              <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
            </mesh>

            {/* Chair Seat Cushion */}
            <mesh castShadow position={[0, 0, 0]}>
              <boxGeometry args={[0.55, 0.08, 0.52]} />
              <meshStandardMaterial
                color={isSelected ? "#0284c7" : isHovered ? "#334155" : "#0f172a"}
                roughness={0.6}
                metalness={0.2}
              />
            </mesh>

            {/* Ergonomic Mesh Backrest */}
            <mesh castShadow position={[0, 0.36, -0.23]} rotation={[0.08, 0, 0]}>
              <boxGeometry args={[0.5, 0.65, 0.05]} />
              <meshStandardMaterial
                color={
                  seat.isHeadSeat
                    ? "#1e293b" // Head of table distinction
                    : isSelected
                    ? "#0369a1"
                    : isHovered
                    ? "#1e293b"
                    : "#0f172a"
                }
                roughness={0.5}
                metalness={0.3}
              />
            </mesh>

            {/* Headrest for Moderator / Executive Head Seat */}
            {seat.isHeadSeat && (
              <mesh position={[0, 0.74, -0.25]}>
                <boxGeometry args={[0.28, 0.14, 0.05]} />
                <meshStandardMaterial color="#0284c7" metalness={0.5} roughness={0.3} />
              </mesh>
            )}

            {/* Selection Highlight Ring under Chair */}
            {(isHovered || isSelected) && (
              <mesh position={[0, -0.41, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.32, 0.4, 24]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* 5. 3D Meeting Presentation Display Wall Screen */}
      <MeetingPresentationScreen
        position={[0, 1.85, -4.4]}
        rotation={[0, 0, 0]} // Faces South towards attendees
        width={4.2}
        height={2.3}
        onSelect={onSelectDisplay}
      />

      {/* 6. Overhead Architectural Meeting Room Lighting */}
      <pointLight position={[0, 3.2, 0]} intensity={18} color="#f8fafc" distance={10} decay={2} />
      <pointLight position={[0, 2.5, -3.2]} intensity={12} color="#38bdf8" distance={7} decay={2} />
    </group>
  );
}

