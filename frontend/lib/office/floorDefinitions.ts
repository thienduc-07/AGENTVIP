export interface RoomDefinition {
  id: string;
  name: string;
  type: "office" | "meeting" | "server" | "lounge" | "reception" | "library" | "open_workspace";
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  wallHeight?: number;
  hasGlassPartitions?: boolean;
  accentColor?: string;
  labelPosition?: [number, number, number];
}

export interface FloorDefinition {
  id: string;
  floorNumber: number; // -1 for B1, 1 for F1, 2 for F2, etc.
  code: string;        // "B1", "F1", "F2", "F3", "F4", "F5"
  name: string;
  subtitle: string;
  themeColor: string;
  baseElevation: number;
  cameraPreset: {
    isometricPos: [number, number, number];
    lookAt: [number, number, number];
    fov?: number;
  };
  departments: string[];
  rooms: RoomDefinition[];
  spawnPoint: [number, number, number];
  elevatorDoorPos: [number, number, number];
  lighting: {
    ambientColor: string;
    ambientIntensity: number;
    accentLightColor?: string;
    accentLightPos?: [number, number, number];
  };
}

export const FLOOR_DEFINITIONS: Record<number, FloorDefinition> = {
  // B1: Server & Infrastructure
  [-1]: {
    id: "floor_b1",
    floorNumber: -1,
    code: "B1",
    name: "Server & Infrastructure",
    subtitle: "Phòng Máy Chủ & Hạ Tầng Mạng",
    themeColor: "#06b6d4",
    baseElevation: -6.0,
    cameraPreset: {
      isometricPos: [16.0, 8.5, 20.0],
      lookAt: [0, -5.0, 0],
      fov: 38,
    },
    departments: ["Infrastructure", "DevOps", "Security", "Operations"],
    rooms: [
      {
        id: "server_vault",
        name: "Phòng Máy Chủ Trung Tâm",
        type: "server",
        bounds: { minX: -14.0, maxX: -4.0, minZ: -10.0, maxZ: 2.0 },
        accentColor: "#06b6d4",
      },
      {
        id: "devops_monitoring",
        name: "Trung Tâm Giám Sát SOC & DevOps",
        type: "open_workspace",
        bounds: { minX: -2.0, maxX: 14.0, minZ: -10.0, maxZ: 2.0 },
        accentColor: "#38bdf8",
      },
      {
        id: "hardware_lab",
        name: "Phòng Thí Nghiệm & Sửa Chữa Thiết Bị",
        type: "office",
        bounds: { minX: -14.0, maxX: 14.0, minZ: 4.0, maxZ: 10.0 },
        accentColor: "#64748b",
      },
    ],
    spawnPoint: [-10.0, -5.5, 6.0],
    elevatorDoorPos: [-10.5, -6.0, 7.5],
    lighting: {
      ambientColor: "#e0f2fe",
      ambientIntensity: 0.7,
      accentLightColor: "#0ea5e9",
      accentLightPos: [-8.0, -2.5, -4.0],
    },
  },

  // F1: Reception & Executive
  [1]: {
    id: "floor_1",
    floorNumber: 1,
    code: "F1",
    name: "Reception & Executive",
    subtitle: "Đại Sảnh Tiếp Tân, CEO Suite & VIP Lounge",
    themeColor: "#f59e0b",
    baseElevation: 0.0,
    cameraPreset: {
      isometricPos: [18.0, 14.5, 22.0],
      lookAt: [0, 1.0, 0],
      fov: 38,
    },
    departments: ["Executive", "Operations", "Customer Success"],
    rooms: [
      {
        id: "reception_lobby",
        name: "Đại Sảnh Tiếp Tân",
        type: "reception",
        bounds: { minX: -6.0, maxX: 6.0, minZ: -2.0, maxZ: 8.0 },
        accentColor: "#f59e0b",
      },
      {
        id: "ceo_office",
        name: "Văn Phòng Giám Đốc (CEO Suite)",
        type: "office",
        bounds: { minX: -15.0, maxX: -6.0, minZ: -10.0, maxZ: -1.0 },
        accentColor: "#eab308",
      },
      {
        id: "vip_boardroom",
        name: "Phòng Họp Điều Hành VIP",
        type: "meeting",
        bounds: { minX: 6.0, maxX: 15.0, minZ: -10.0, maxZ: -1.0 },
        accentColor: "#f97316",
        hasGlassPartitions: true,
      },
      {
        id: "lounge_break",
        name: "VIP Lounge & Coffee Bar",
        type: "lounge",
        bounds: { minX: -15.0, maxX: -6.0, minZ: 0.0, maxZ: 10.0 },
        accentColor: "#10b981",
      },
    ],
    spawnPoint: [0.0, 0.5, 6.0],
    elevatorDoorPos: [-10.5, 0.0, 7.5],
    lighting: {
      ambientColor: "#fef3c7",
      ambientIntensity: 0.85,
      accentLightColor: "#fbbf24",
      accentLightPos: [0, 3.5, 1.5],
    },
  },

  // F2: Engineering & Architecture
  [2]: {
    id: "floor_2",
    floorNumber: 2,
    code: "F2",
    name: "Engineering & Architecture",
    subtitle: "Kỹ Thuật Phần Mềm, Frontend, Backend & QA",
    themeColor: "#10b981",
    baseElevation: 6.0,
    cameraPreset: {
      isometricPos: [18.0, 20.5, 22.0],
      lookAt: [0, 7.0, 0],
      fov: 38,
    },
    departments: ["Engineering", "Frontend", "Backend", "QA", "Architecture"],
    rooms: [
      {
        id: "dev_cluster_backend",
        name: "Phân Khu Kỹ Sư Backend & Hệ Thống",
        type: "open_workspace",
        bounds: { minX: -14.0, maxX: -2.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#10b981",
      },
      {
        id: "dev_cluster_frontend",
        name: "Phân Khu Frontend, UI/UX & Mobile",
        type: "open_workspace",
        bounds: { minX: 2.0, maxX: 14.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#06b6d4",
      },
      {
        id: "engineering_meeting",
        name: "Phòng Họp Kỹ Thuật (Scrum Room)",
        type: "meeting",
        bounds: { minX: -5.0, maxX: 5.0, minZ: -10.0, maxZ: -4.0 },
        hasGlassPartitions: true,
        accentColor: "#3b82f6",
      },
      {
        id: "qa_testing_lab",
        name: "Phòng Kiểm Thử & CI/CD Bench",
        type: "office",
        bounds: { minX: -14.0, maxX: -4.0, minZ: 3.0, maxZ: 9.0 },
        accentColor: "#8b5cf6",
      },
    ],
    spawnPoint: [-8.0, 6.5, 4.0],
    elevatorDoorPos: [-10.5, 6.0, 7.5],
    lighting: {
      ambientColor: "#ecfdf5",
      ambientIntensity: 0.85,
      accentLightColor: "#34d399",
      accentLightPos: [0, 9.5, 0],
    },
  },

  // F3: Data & AI Intelligence
  [3]: {
    id: "floor_3",
    floorNumber: 3,
    code: "F3",
    name: "Data & AI Intelligence",
    subtitle: "Nghiên Cứu Trí Tuệ Nhân Tạo & Khoa Học Dữ Liệu",
    themeColor: "#8b5cf6",
    baseElevation: 12.0,
    cameraPreset: {
      isometricPos: [18.0, 26.5, 22.0],
      lookAt: [0, 13.0, 0],
      fov: 38,
    },
    departments: ["AI Research", "Data Science", "Machine Learning"],
    rooms: [
      {
        id: "ai_model_lab",
        name: "Phòng Huấn Luyện Mô Hình AI & LLM",
        type: "open_workspace",
        bounds: { minX: -14.0, maxX: -2.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#8b5cf6",
      },
      {
        id: "data_analytics_pod",
        name: "Phân Khu Phân Tích & Data Pipeline",
        type: "open_workspace",
        bounds: { minX: 2.0, maxX: 14.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#a855f7",
      },
      {
        id: "ai_library",
        name: "Thư Viện Nghiên Cứu & Đọc Sách",
        type: "library",
        bounds: { minX: 4.0, maxX: 14.0, minZ: 2.0, maxZ: 9.0 },
        accentColor: "#d946ef",
      },
    ],
    spawnPoint: [-2.0, 12.5, 4.0],
    elevatorDoorPos: [-10.5, 12.0, 7.5],
    lighting: {
      ambientColor: "#f5f3ff",
      ambientIntensity: 0.85,
      accentLightColor: "#c084fc",
      accentLightPos: [0, 15.5, 0],
    },
  },

  // F4: Marketing & Creative
  [4]: {
    id: "floor_4",
    floorNumber: 4,
    code: "F4",
    name: "Marketing & Creative",
    subtitle: "Tiếp Thị Số, Nội Dung, Thiết Kế Đồ Họa & Tăng Trưởng",
    themeColor: "#ec4899",
    baseElevation: 18.0,
    cameraPreset: {
      isometricPos: [18.0, 32.5, 22.0],
      lookAt: [0, 19.0, 0],
      fov: 38,
    },
    departments: ["Marketing", "Sales", "Design", "Growth"],
    rooms: [
      {
        id: "creative_studio",
        name: "Xưởng Thiết Kế Sáng Tạo & Đồ Họa",
        type: "open_workspace",
        bounds: { minX: -14.0, maxX: -2.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#ec4899",
      },
      {
        id: "growth_marketing",
        name: "Trung Tâm Tăng Trưởng & Chiến Lược SEO",
        type: "open_workspace",
        bounds: { minX: 2.0, maxX: 14.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#f43f5e",
      },
      {
        id: "creative_lounge",
        name: "Không Gian Thư Giãn & Brainstorming",
        type: "lounge",
        bounds: { minX: -14.0, maxX: -4.0, minZ: 2.0, maxZ: 9.0 },
        accentColor: "#fb7185",
      },
    ],
    spawnPoint: [-4.0, 18.5, 4.0],
    elevatorDoorPos: [-10.5, 18.0, 7.5],
    lighting: {
      ambientColor: "#fdf2f8",
      ambientIntensity: 0.85,
      accentLightColor: "#f472b6",
      accentLightPos: [0, 21.5, 0],
    },
  },

  // F5: Engineering, Security, Testing & GIS
  [5]: {
    id: "floor_5",
    floorNumber: 5,
    code: "F5",
    name: "Engineering & Cybersecurity Bay",
    subtitle: "Kỹ Thuật Hệ Thống, Bảo Mật SOC, Kiểm Thử QA & GIS",
    themeColor: "#0284c7",
    baseElevation: 24.0,
    cameraPreset: {
      isometricPos: [18.0, 38.5, 22.0],
      lookAt: [0, 25.0, 0],
      fov: 38,
    },
    departments: ["Engineering", "Security", "Testing", "GIS"],
    rooms: [
      {
        id: "eng_core_bay",
        name: "Phân Khu Kỹ Sư Hệ Thống & Microservices",
        type: "open_workspace",
        bounds: { minX: -14.0, maxX: -2.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#38bdf8",
      },
      {
        id: "cyber_soc_room",
        name: "Trung Tâm Tác Chiến An Ninh Mạng SOC",
        type: "server",
        bounds: { minX: 2.0, maxX: 14.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#ef4444",
      },
      {
        id: "qa_bench_area",
        name: "Phòng Kiểm Thử Phần Mềm & Benchmarking",
        type: "office",
        bounds: { minX: 4.0, maxX: 14.0, minZ: 2.0, maxZ: 9.0 },
        accentColor: "#f59e0b",
      },
    ],
    spawnPoint: [-2.0, 24.5, 4.0],
    elevatorDoorPos: [-10.5, 24.0, 7.5],
    lighting: {
      ambientColor: "#f0f9ff",
      ambientIntensity: 0.85,
      accentLightColor: "#38bdf8",
      accentLightPos: [0, 27.5, 0],
    },
  },

  // F6: Executive, Research & Academic
  [6]: {
    id: "floor_6",
    floorNumber: 6,
    code: "F6",
    name: "Executive Suite & AI Neural Lab",
    subtitle: "Văn Phòng Tổng Giám Đốc, Nghiên Cứu AI & Hội Đồng Cố Vấn",
    themeColor: "#fbbf24",
    baseElevation: 30.0,
    cameraPreset: {
      isometricPos: [18.0, 44.5, 22.0],
      lookAt: [0, 31.0, 0],
      fov: 38,
    },
    departments: ["Executive", "Research", "Academic"],
    rooms: [
      {
        id: "ceo_penthouse",
        name: "Văn Phòng Tổng Giám Đốc (CEO Penthouse)",
        type: "office",
        bounds: { minX: -14.0, maxX: -2.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#fbbf24",
      },
      {
        id: "ai_neural_lab",
        name: "Viện Nghiên Cứu Mô Hình AI & RAG",
        type: "open_workspace",
        bounds: { minX: 2.0, maxX: 14.0, minZ: -9.0, maxZ: 1.0 },
        accentColor: "#8b5cf6",
      },
      {
        id: "boardroom_hall",
        name: "Phòng Họp Hội Đồng Quản Trị & Cố Vấn VIP",
        type: "meeting",
        bounds: { minX: -5.0, maxX: 5.0, minZ: 2.0, maxZ: 9.0 },
        hasGlassPartitions: true,
        accentColor: "#f59e0b",
      },
    ],
    spawnPoint: [-2.0, 30.5, 4.0],
    elevatorDoorPos: [-10.5, 30.0, 7.5],
    lighting: {
      ambientColor: "#fef3c7",
      ambientIntensity: 0.9,
      accentLightColor: "#f59e0b",
      accentLightPos: [0, 33.5, 0],
    },
  },
};

export const OVERVIEW_CAMERA_PRESET = {
  pos: [0, 22.0, 56.0] as [number, number, number],
  look: [0, 18.0, 0] as [number, number, number],
};

export function resolveFloorByDepartment(deptName: string): number {
  if (!deptName) return 1;
  const d = deptName.toLowerCase();
  if (d.includes("exec") || d.includes("ceo") || d.includes("board") || d.includes("research") || d.includes("academic") || d.includes("penthouse")) return 6;
  if (d.includes("eng") || d.includes("dev") || d.includes("qa") || d.includes("test") || d.includes("sec") || d.includes("gis") || d.includes("backend") || d.includes("system")) return 5;
  if (d.includes("design") || d.includes("product") || d.includes("game") || d.includes("spatial") || d.includes("ui") || d.includes("ux") || d.includes("art")) return 4;
  if (d.includes("market") || d.includes("media") || d.includes("sales") || d.includes("growth") || d.includes("ad") || d.includes("revenue")) return 3;
  if (d.includes("fin") || d.includes("account") || d.includes("budget") || d.includes("audit") || d.includes("special") || d.includes("tax")) return 2;
  if (d.includes("ops") || d.includes("support") || d.includes("health") || d.includes("service") || d.includes("help") || d.includes("reception")) return 1;
  return 1;
}

export function getFloorDefinition(floorNumber: number): FloorDefinition | null {
  return FLOOR_DEFINITIONS[floorNumber] || null;
}

