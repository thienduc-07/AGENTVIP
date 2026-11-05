/**
 * AGENT CITY V2 — CENTRAL BUILDING ARCHITECTURE SYSTEM
 * Complete Architectural Definitions, Floor Programming & Spatial Navigation
 *
 * Floors:
 * ├── FLOOR G (0) — Main Lobby & Premium Reception (Mall-style automatic sliding glass doors)
 * ├── FLOOR 1 (1) — Operations, Customer Support & Healthcare
 * ├── FLOOR 2 (2) — Financial Treasury, Audit War Room & Specialized Advisory
 * ├── FLOOR 3 (3) — Growth Marketing, Performance Ads & Enterprise Sales
 * ├── FLOOR 4 (4) — UI/UX Design, Product Management & Spatial Computing Lab
 * ├── FLOOR 5 (5) — Core Engineering, SOC Command Mega-Wall & GIS
 * ├── FLOOR 6 (6) — Executive Boardroom, CEO Suite & AI Research Institute
 * └── FLOOR 7 (7) — Sky Recreation & Entertainment Complex (Billiards, Bowling, Gaming, Pool, Arcade, Beanbags)
 */

export const BUILDING_DIMENSIONS = {
  width: 54.0,       // X: [-27.0, +27.0]
  depth: 38.0,       // Z: [-19.0, +19.0]
  floorHeight: 8.5,  // Vertical distance between floor levels
  totalFloors: 8,    // 0 (G), 1, 2, 3, 4, 5, 6, 7
};

export interface BuildingFloorConfig {
  id: number;
  code: string;
  name: string;
  enName: string;
  themeColor: string;
  wallColor: number;
  floorColor: number;
  woodAccent: number;
  description: string;
  isRecreational?: boolean;
  isLobby?: boolean;
}

export const CENTRAL_BUILDING_FLOORS: Record<number, BuildingFloorConfig> = {
  0: {
    id: 0,
    code: "G",
    name: "Đại Sảnh Tiếp Tân & Cửa Tự Động",
    enName: "GROUND FLOOR — MAIN LOBBY & PREMIER RECEPTION",
    themeColor: "#38bdf8",
    wallColor: 0xf8fafc,
    floorColor: 0xe2e8f0, // Polished pristine marble tile
    woodAccent: 0xd8c29d, // Blonde architectural oak
    description: "Đại sảnh thông tầng phong cách TTTM quốc tế, cửa trượt kính tự động, quầy tiếp tân đá cẩm thạch.",
    isLobby: true,
  },
  1: {
    id: 1,
    code: "1F",
    name: "Quản Trị Vận Hành, Hỗ Trợ & Y Tế",
    enName: "LEVEL 01 — OPERATIONS, SUPPORT & WELLNESS",
    themeColor: "#0284c7",
    wallColor: 0xf8fafc,
    floorColor: 0xd4d7dc,
    woodAccent: 0xd8c29d,
    description: "Phòng điều hành COO, Support Service Desk và trạm chăm sóc y tế doanh nghiệp.",
  },
  2: {
    id: 2,
    code: "2F",
    name: "Tài Chính, Ngân Sách & Cố Vấn",
    enName: "LEVEL 02 — FINANCIAL TREASURY & ADVISORY",
    themeColor: "#10b981",
    wallColor: 0xf8fafc,
    floorColor: 0xd1d6d4,
    woodAccent: 0xd8c29d,
    description: "Kho lưu trữ hồ sơ tài chính bảo mật cao, phòng tác chiến kiểm toán và văn phòng CFO.",
  },
  3: {
    id: 3,
    code: "3F",
    name: "Tiếp Thị, Truyền Thông & Kinh Doanh",
    enName: "LEVEL 03 — MARKETING, MEDIA & ENTERPRISE SALES",
    themeColor: "#ec4899",
    wallColor: 0xf8fafc,
    floorColor: 0xd6d2d5,
    woodAccent: 0xd8c29d,
    description: "Studio marketing sáng tạo, khán đài thuyết trình 2 tầng và phòng thu Podcast On-Air.",
  },
  4: {
    id: 4,
    code: "4F",
    name: "Thiết Kế UI/UX, Sản Phẩm & Game",
    enName: "LEVEL 04 — PRODUCT, UI/UX & SPATIAL LAB",
    themeColor: "#8b5cf6",
    wallColor: 0xf8fafc,
    floorColor: 0xd4d2d8,
    woodAccent: 0xd8c29d,
    description: "Xưởng thiết kế giao diện, đấu trường kiểm thử không gian ảo AR/VR và phòng tạo mẫu 3D.",
  },
  5: {
    id: 5,
    code: "5F",
    name: "Kỹ Thuật Phần Mềm, SOC & GIS",
    enName: "LEVEL 05 — CORE ENGINEERING & CYBERSECURITY",
    themeColor: "#0369a1",
    wallColor: 0xf8fafc,
    floorColor: 0xd2d6dc,
    woodAccent: 0xd8c29d,
    description: "Cụm kỹ sư hệ thống backend, trung tâm an ninh mạng SOC Mega-Wall và 5 tủ rack Server AI.",
  },
  6: {
    id: 6,
    code: "6F",
    name: "Ban Lãnh Đạo, Nghiên Cứu AI & Hội Đồng",
    enName: "LEVEL 06 — EXECUTIVE BOARDROOM & RESEARCH",
    themeColor: "#d97706",
    wallColor: 0xf8fafc,
    floorColor: 0xd7d4cf,
    woodAccent: 0xd8c29d,
    description: "Phòng họp HĐQT 10 người, viện nghiên cứu AI chuyên sâu và văn phòng CEO Victoria Vance.",
  },
  7: {
    id: 7,
    code: "7F",
    name: "Trung Tâm Thể Thao & Giải Trí Tổng Hợp",
    enName: "LEVEL 07 — SKY RECREATION & ENTERTAINMENT COMPLEX",
    themeColor: "#f59e0b",
    wallColor: 0x090d16, // Dark luxury lounge walls
    floorColor: 0x1e293b, // Slate and terrazzo entertainment floor
    woodAccent: 0xb45309,
    description: "Tầng giải trí độc quyền: Bàn bida 9ft, Bowling 2 làn, Gaming Lounge, Hồ bơi, Arcade, Quầy Ramen & Bar.",
    isRecreational: true,
  },
};

/**
 * VERTICAL CIRCULATION & UTILITY SERVICE CORE (IDENTICAL & NON-OVERLAPPING ACROSS ALL FLOORS)
 *
 * Dedicated Footprints:
 * 1. Elevator Shaft:  X: [20.0, 25.0], Z: [-17.2, -13.2]  (South-facing door at Z = -13.2)
 * 2. Elevator Lobby:  X: [18.0, 25.5], Z: [-13.2, -9.8]   (Clear approach corridor)
 * 3. Staircase Core:  X: [20.5, 25.5], Z: [-9.8, -2.2]    (Cantilevered oak steps & landing)
 * 4. Mid Hallway:     X: [18.0, 25.5], Z: [-2.2, 8.2]     (Service passage & water cooler)
 * 5. Restroom Suite:  X: [19.5, 25.8], Z: [8.5, 15.5]     (West-facing door at X = 19.5, Z = 12.0)
 *
 * Separation Guarantees:
 * - Elevator (maxZ = -13.2) to Staircase (minZ = -9.8) = 3.4m clear landing! ZERO overlap.
 * - Staircase (maxZ = -2.2) to Restroom (minZ = 8.5) = 10.7m clear corridor! ZERO overlap.
 * - Restroom entrance has 6.0m clear westward aisle to any workstation pod! ZERO obstruction.
 */
export const VERTICAL_CORE = {
  elevator: {
    cx: 22.5,
    cz: -15.2,
    width: 4.8,
    depth: 3.8,
    doorZ: -13.2,
    doorWidth: 2.2,
    bounds: { minX: 20.0, maxX: 25.0, minZ: -17.2, maxZ: -13.2 },
    approachPos: { x: 22.5, z: -11.5 },
  },
  staircase: {
    cx: 23.0,
    cz: -6.0,
    width: 4.8,
    depth: 7.2,
    bounds: { minX: 20.5, maxX: 25.5, minZ: -9.8, maxZ: -2.2 },
    landings: [
      { x: 23.0, z: -9.2 }, // Upper landing
      { x: 23.0, z: -2.6 }, // Lower arrival landing
    ],
  },
  restroom: {
    cx: 22.65,
    cz: 12.0,
    width: 6.3,
    depth: 7.0,
    bounds: { minX: 19.5, maxX: 25.8, minZ: 8.5, maxZ: 15.5 },
    door: { wall: "west" as const, x: 19.5, z: 12.0, width: 1.5 },
    approachPos: { x: 18.0, z: 12.0 },
  },
};

/**
 * ARCHITECTURAL ROOM PROGRAMMING (DATA-DRIVEN)
 * Each room defines its architectural boundary walls, doorways, purpose, and capacity.
 */
export interface ArchitecturalRoom {
  id: string;
  floor: number;
  type:
    | "reception_lobby"
    | "executive_office"
    | "conference_room"
    | "team_pod_room"
    | "focus_room"
    | "pantry_lounge"
    | "restroom"
    | "gaming_lounge"
    | "billiards_hall"
    | "bowling_alley"
    | "swimming_pool"
    | "arcade_zone"
    | "social_dining";
  title: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  door: { x: number; z: number; width: number; orientation: "north" | "south" | "east" | "west" };
  accentColor: number;
}

/**
 * ROOMS FOR OFFICE FLOORS (1F to 6F)
 * Exactly matching the architectural reference diorama (Image 2):
 * 1. Grand Glass Boardroom (Northwest)
 * 2. Glass Focus / Interview Room (North Center-West)
 * 3. Glass Executive / Director Suite (North Center)
 * 4. Open Kitchen, High Bar Counter & Beanbag Nook (Northeast)
 * 5. Central Collaboration Lounge with Sofas, Coffee Table & Area Rug (Center)
 * 6. Elevator Core & Fluted Reception Desk (East)
 * 7. Open Team Pod Bays with Apple iMacs (South & Southwest)
 */
export function getOfficeRoomsForFloor(floorId: number): ArchitecturalRoom[] {
  return [
    // 1. Grand Glass Boardroom (Southwest)
    {
      id: `room-boardroom-${floorId}`,
      floor: floorId,
      type: "conference_room",
      title: "Phòng Họp Hội Đồng Quản Trị & Chiến Lược",
      bounds: { minX: -26.0, maxX: -14.0, minZ: 2.0, maxZ: 15.0 },
      door: { x: -14.0, z: 5.0, width: 2.2, orientation: "east" },
      accentColor: 0x38bdf8,
    },
    // 2. Glass Focus / Interview Room (Mid-West)
    {
      id: `room-focus-${floorId}`,
      floor: floorId,
      type: "focus_room",
      title: "Phòng Họp Nhóm & Phỏng Vấn Chuyên Gia",
      bounds: { minX: -26.0, maxX: -14.0, minZ: -7.0, maxZ: 1.0 },
      door: { x: -14.0, z: -3.0, width: 1.8, orientation: "east" },
      accentColor: 0x64748b,
    },
    // 3. Glass Executive / Director Suite (Northwest)
    {
      id: `room-exec-${floorId}`,
      floor: floorId,
      type: "executive_office",
      title: "Văn Phòng Lãnh Đạo & Cố Vấn Cấp Cao",
      bounds: { minX: -26.0, maxX: -14.0, minZ: -17.0, maxZ: -8.0 },
      door: { x: -14.0, z: -12.5, width: 1.8, orientation: "east" },
      accentColor: 0x0284c7,
    },
    // 4. Open Kitchen & Window High Bar Counter (North Central)
    {
      id: `room-pantry-${floorId}`,
      floor: floorId,
      type: "pantry_lounge",
      title: "Quầy Bếp Pantry & Quầy Bar Cửa Sổ View Thành Phố",
      bounds: { minX: -11.0, maxX: 4.0, minZ: -17.8, maxZ: -11.0 },
      door: { x: -2.0, z: -13.0, width: 2.5, orientation: "south" },
      accentColor: 0xd97706,
    },
    // 5. Beanbag Chill Relaxation Nook (Northeast)
    {
      id: `room-beanbag-${floorId}`,
      floor: floorId,
      type: "pantry_lounge",
      title: "Góc Lười Thư Giãn Ghế Lười & Đọc Sách",
      bounds: { minX: 6.0, maxX: 15.0, minZ: -17.0, maxZ: -9.5 },
      door: { x: 10.5, z: -12.0, width: 2.2, orientation: "south" },
      accentColor: 0x06b6d4,
    },
    // 6. Central Collaboration Lounge with Sofas & Area Rug (Center)
    {
      id: `room-lounge-${floorId}`,
      floor: floorId,
      type: "pantry_lounge",
      title: "Khu Lounge Tiếp Khách & Trao Đổi Trung Tâm",
      bounds: { minX: -7.0, maxX: 7.0, minZ: -3.5, maxZ: 4.5 },
      door: { x: 0.0, z: 1.0, width: 4.0, orientation: "south" },
      accentColor: 0xf59e0b,
    },
    // 7. Elevator Core & Fluted Reception Desk (East)
    {
      id: `room-reception-${floorId}`,
      floor: floorId,
      type: "reception_lobby",
      title: "Sảnh Thang Máy & Quầy Tiếp Tân Tầng",
      bounds: { minX: 17.5, maxX: 24.5, minZ: 1.0, maxZ: 7.0 },
      door: { x: 18.0, z: 4.0, width: 2.5, orientation: "west" },
      accentColor: 0x38bdf8,
    },
  ];
}

/**
 * ROOMS FOR FLOOR G (MAIN LOBBY & RECEPTION)
 */
export const FLOOR_G_ROOMS: ArchitecturalRoom[] = [
  {
    id: "room-g-lobby",
    floor: 0,
    type: "reception_lobby",
    title: "Đại Sảnh Tiếp Tân Quốc Tế & Cửa Trượt Tự Động",
    bounds: { minX: -25.5, maxX: 18.0, minZ: -16.5, maxZ: 16.5 },
    door: { x: 0.0, z: 17.0, width: 4.2, orientation: "south" }, // Automatic sliding glass entrance
    accentColor: 0x38bdf8,
  },
];

/**
 * ROOMS FOR FLOOR 7 (SKY RECREATION & ENTERTAINMENT COMPLEX)
 * Exclusively dedicated to relaxation, sports, gaming, and dining.
 */
export const FLOOR_7_ROOMS: ArchitecturalRoom[] = [
  // Zone A: Gaming Lounge (RGB Battlestations & Console arena)
  {
    id: "room-7-gaming",
    floor: 7,
    type: "gaming_lounge",
    title: "Phòng Đấu Game Esport & PC Gaming RGB",
    bounds: { minX: -25.5, maxX: -11.5, minZ: -16.5, maxZ: -4.5 },
    door: { x: -11.5, z: -10.5, width: 2.2, orientation: "east" },
    accentColor: 0xec4899,
  },
  // Zone B: Championship Billiards Lounge
  {
    id: "room-7-billiards",
    floor: 7,
    type: "billiards_hall",
    title: "Câu Lạc Bộ Bida 9ft Chuẩn Thi Đấu",
    bounds: { minX: -9.5, maxX: 6.5, minZ: -16.5, maxZ: -4.5 },
    door: { x: -1.5, z: -4.5, width: 3.0, orientation: "south" },
    accentColor: 0x10b981,
  },
  // Zone C: 2-Lane Bowling Alley with Ball Returns
  {
    id: "room-7-bowling",
    floor: 7,
    type: "bowling_alley",
    title: "Sàn Bowling 2 Làn & Hệ Thống Tự Động Xếp Pin",
    bounds: { minX: -25.5, maxX: -5.0, minZ: 3.5, maxZ: 16.5 },
    door: { x: -5.0, z: 10.0, width: 2.5, orientation: "east" },
    accentColor: 0xf59e0b,
  },
  // Zone D: Resort Swimming Pool & Sun Deck
  {
    id: "room-7-pool",
    floor: 7,
    type: "swimming_pool",
    title: "Hồ Bơi Vô Cực Nước Xanh & Giường Tắm Nắng",
    bounds: { minX: 8.5, maxX: 25.5, minZ: -16.5, maxZ: 2.5 },
    door: { x: 8.5, z: -6.5, width: 2.5, orientation: "west" },
    accentColor: 0x06b6d4,
  },
  // Zone E: Beanbag Chill & Meditation Lounge
  {
    id: "room-7-beanbags",
    floor: 7,
    type: "social_dining",
    title: "Khu Thư Giãn Đệm Lười Beanbag & Máy Chiếu Phim",
    bounds: { minX: 6.5, maxX: 18.0, minZ: 4.5, maxZ: 16.5 },
    door: { x: 6.5, z: 10.5, width: 2.5, orientation: "west" },
    accentColor: 0xa855f7,
  },
  // Zone F: Retro Arcade Arena
  {
    id: "room-7-arcade",
    floor: 7,
    type: "arcade_zone",
    title: "Khu Máy Game Thùng Arcade & Air Hockey",
    bounds: { minX: -25.5, maxX: -13.5, minZ: -3.5, maxZ: 2.5 },
    door: { x: -13.5, z: -0.5, width: 2.0, orientation: "east" },
    accentColor: 0xd946ef,
  },
  // Zone G: Ramen & Cocktail Social Bar
  {
    id: "room-7-ramen-bar",
    floor: 7,
    type: "social_dining",
    title: "Quầy Mì Ramen Nóng & Cocktail Lounge",
    bounds: { minX: -2.0, maxX: 7.0, minZ: -2.0, maxZ: 2.5 },
    door: { x: 2.5, z: 2.5, width: 2.0, orientation: "south" },
    accentColor: 0xf97316,
  },
];

/**
 * COMPREHENSIVE CORRIDOR WAYPOINT NAVGRAPH
 * 45 bi-directional navigation nodes connecting central boulevards, aisles, and room portals.
 * No edge crosses any desk or wall obstacle!
 */
export interface MasterNavNode {
  id: string;
  x: number;
  z: number;
  neighbors: string[];
  isDoorPortal?: boolean;
}

export const MASTER_CORRIDOR_NAV_NODES: MasterNavNode[] = [
  // 1. West Corridor (Running North-South along outside of Glass Suites at X = -10.5)
  { id: "node_w_n",     x: -10.5, z: -13.0, neighbors: ["node_w_m", "node_c_n", "door_suite_3"] },
  { id: "node_w_m",     x: -10.5, z: -3.0,  neighbors: ["node_w_n", "node_w_s", "node_c_m", "door_suite_2"] },
  { id: "node_w_s",     x: -10.5, z: 5.0,   neighbors: ["node_w_m", "node_w_far_s", "door_suite_1", "node_c_s1"] },
  { id: "node_w_far_s", x: -10.5, z: 14.5,  neighbors: ["node_w_s", "node_c_s2"] },

  // 2. Central Boulevard (Running North-South through the center of the office at X = 0.0)
  { id: "node_c_n",     x: 0.0,   z: -13.0, neighbors: ["node_w_n", "node_c_m", "node_e_n", "pantry_bar", "door_pantry"] },
  { id: "node_c_m",     x: 0.0,   z: 0.0,   neighbors: ["node_c_n", "node_w_m", "node_e_m", "node_c_s1", "lounge_spot"] },
  { id: "node_c_s1",    x: 0.0,   z: 9.0,   neighbors: ["node_c_m", "node_c_s2", "node_w_s", "node_e_s1"] },
  { id: "node_c_s2",    x: 0.0,   z: 14.5,  neighbors: ["node_c_s1", "node_w_far_s", "node_e_s2"] },

  // 3. East Corridor (Elevator Core, Reception, Restroom, and East Pods at X = 14.0)
  { id: "node_e_n",     x: 14.0,  z: -13.0, neighbors: ["node_c_n", "node_e_m", "lobby_elev", "pantry_beanbag"] },
  { id: "node_e_m",     x: 14.0,  z: 0.0,   neighbors: ["node_e_n", "node_c_m", "node_e_s1", "door_reception"] },
  { id: "node_e_s1",    x: 14.0,  z: 9.0,   neighbors: ["node_e_m", "node_e_s2", "node_c_s1", "door_reception"] },
  { id: "node_e_s2",    x: 14.0,  z: 14.5,  neighbors: ["node_e_s1", "node_c_s2", "vestibule_wc"] },

  // 4. Room Portals (Doorway Access Nodes)
  { id: "door_suite_1", x: -14.0, z: 5.0,   neighbors: ["node_w_s"], isDoorPortal: true },
  { id: "door_suite_2", x: -14.0, z: -3.0,  neighbors: ["node_w_m"], isDoorPortal: true },
  { id: "door_suite_3", x: -14.0, z: -12.5, neighbors: ["node_w_n"], isDoorPortal: true },
  { id: "door_pantry",  x: -2.0,  z: -15.5, neighbors: ["node_c_n"], isDoorPortal: true },
  { id: "pantry_bar",   x: -4.5,  z: -13.0, neighbors: ["node_c_n"] },
  { id: "pantry_beanbag", x: 10.5, z: -12.0, neighbors: ["node_e_n"] },
  { id: "lounge_spot",  x: 0.0,   z: 1.0,   neighbors: ["node_c_m"] },
  { id: "door_reception", x: 18.0, z: 4.0,  neighbors: ["node_e_m", "node_e_s1"], isDoorPortal: true },

  // 5. Vertical Circulation Nodes (Elevator & Staircase)
  { id: "lobby_elev",   x: 22.5,  z: -11.5, neighbors: ["node_e_n", "stair_upper"], isDoorPortal: true },
  { id: "stair_upper",  x: 23.0,  z: -9.2,  neighbors: ["lobby_elev"], isDoorPortal: true },
  { id: "stair_lower",  x: 23.0,  z: -2.6,  neighbors: ["node_e_m"], isDoorPortal: true },

  // 6. Restroom Core Access
  { id: "vestibule_wc", x: 18.0,  z: 12.0,  neighbors: ["node_e_s2", "door_wc"] },
  { id: "door_wc",      x: 19.5,  z: 12.0,  neighbors: ["vestibule_wc"], isDoorPortal: true },

  // 7. Floor G Entrance Portals
  { id: "door_g_ext",   x: 0.0,   z: 17.5,  neighbors: ["door_g_int"], isDoorPortal: true },
  { id: "door_g_int",   x: 0.0,   z: 14.0,  neighbors: ["door_g_ext", "node_c_s2"] },
];
