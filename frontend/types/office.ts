export type CanonicalAgentState =
  | "IDLE"
  | "QUEUED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING"
  | "WAITING_APPROVAL"
  | "THINKING"
  | "WORKING"
  | "PAUSED"
  | "REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ERROR"
  | "OFFLINE";

export interface StateVisualConfig {
  label: string;
  badgeColor: string;
  beaconColor: string;
  emissiveIntensity: number;
  animationType: "idle" | "thinking" | "walking" | "working" | "waiting" | "reviewing" | "celebrating" | "error";
  monitorColor: string;
  ambientVfx?: "beacon" | "typing" | "alert_ring" | "document_glow" | "pulse_green" | "sparks_red" | "fade";
}

export const CANONICAL_STATE_CONFIGS: Record<CanonicalAgentState, StateVisualConfig> = {
  IDLE: {
    label: "Nghỉ ngơi / Chờ lệnh",
    badgeColor: "#64748b",
    beaconColor: "#94a3b8",
    emissiveIntensity: 0.15,
    animationType: "idle",
    monitorColor: "#0284c7",
  },
  QUEUED: {
    label: "Đang xếp hàng",
    badgeColor: "#eab308",
    beaconColor: "#facc15",
    emissiveIntensity: 0.45,
    animationType: "thinking",
    monitorColor: "#eab308",
    ambientVfx: "beacon",
  },
  ASSIGNED: {
    label: "Đã giao nhiệm vụ",
    badgeColor: "#06b6d4",
    beaconColor: "#22d3ee",
    emissiveIntensity: 0.5,
    animationType: "walking",
    monitorColor: "#06b6d4",
  },
  IN_PROGRESS: {
    label: "Đang thực thi",
    badgeColor: "#3b82f6",
    beaconColor: "#60a5fa",
    emissiveIntensity: 0.85,
    animationType: "working",
    monitorColor: "#3b82f6",
    ambientVfx: "typing",
  },
  WAITING: {
    label: "Chờ phê duyệt",
    badgeColor: "#f97316",
    beaconColor: "#fb923c",
    emissiveIntensity: 0.75,
    animationType: "waiting",
    monitorColor: "#f97316",
    ambientVfx: "alert_ring",
  },
  REVIEW: {
    label: "Thẩm định / Review",
    badgeColor: "#8b5cf6",
    beaconColor: "#a78bfa",
    emissiveIntensity: 0.7,
    animationType: "reviewing",
    monitorColor: "#8b5cf6",
    ambientVfx: "document_glow",
  },
  COMPLETED: {
    label: "Hoàn tất bàn giao",
    badgeColor: "#10b981",
    beaconColor: "#34d399",
    emissiveIntensity: 0.9,
    animationType: "celebrating",
    monitorColor: "#10b981",
    ambientVfx: "pulse_green",
  },
  FAILED: {
    label: "Lỗi thực thi",
    badgeColor: "#ef4444",
    beaconColor: "#f87171",
    emissiveIntensity: 0.9,
    animationType: "error",
    monitorColor: "#ef4444",
    ambientVfx: "sparks_red",
  },
  CANCELLED: {
    label: "Đã hủy bỏ",
    badgeColor: "#475569",
    beaconColor: "#64748b",
    emissiveIntensity: 0.2,
    animationType: "idle",
    monitorColor: "#334155",
    ambientVfx: "fade",
  },
  WAITING_APPROVAL: {
    label: "Chờ phê duyệt",
    badgeColor: "#f97316",
    beaconColor: "#fb923c",
    emissiveIntensity: 0.8,
    animationType: "waiting",
    monitorColor: "#f97316",
    ambientVfx: "alert_ring",
  },
  THINKING: {
    label: "Đang phân tích",
    badgeColor: "#a855f7",
    beaconColor: "#c084fc",
    emissiveIntensity: 0.75,
    animationType: "thinking",
    monitorColor: "#a855f7",
    ambientVfx: "beacon",
  },
  WORKING: {
    label: "Đang thực thi nhiệm vụ",
    badgeColor: "#3b82f6",
    beaconColor: "#60a5fa",
    emissiveIntensity: 0.85,
    animationType: "working",
    monitorColor: "#3b82f6",
    ambientVfx: "typing",
  },
  PAUSED: {
    label: "Tạm dừng (Paused)",
    badgeColor: "#f59e0b",
    beaconColor: "#fbbf24",
    emissiveIntensity: 0.5,
    animationType: "idle",
    monitorColor: "#d97706",
  },
  ERROR: {
    label: "Lỗi hệ thống",
    badgeColor: "#ef4444",
    beaconColor: "#f87171",
    emissiveIntensity: 0.9,
    animationType: "error",
    monitorColor: "#ef4444",
    ambientVfx: "sparks_red",
  },
  OFFLINE: {
    label: "Ngoại tuyến (Offline)",
    badgeColor: "#475569",
    beaconColor: "#64748b",
    emissiveIntensity: 0.1,
    animationType: "idle",
    monitorColor: "#1e293b",
  },
};

export type OfficeSelection =
  | { type: "none" }
  | { type: "agent"; id: string }
  | { type: "workstation"; id: string }
  | { type: "department"; id: string };

export interface OfficeCameraPreset {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

