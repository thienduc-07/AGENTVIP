export interface DivisionFloorInfo {
  division: string;
  name: string;
  floor: number;
  floorCode: string;
  roomId: string;
  roomName: string;
  color: string;
  themeColor: string;
  workstations: Array<{
    id: string;
    deskPos: { x: number; z: number };
    chairPos: { x: number; z: number; rotY: number };
  }>;
}

export const DIVISION_FLOOR_MAPPING: Record<string, DivisionFloorInfo> = {
  // FLOOR 1: Operations, Support & Healthcare
  operations: {
    division: "operations",
    name: "Quản Trị Vận Hành & Nhân Sự",
    floor: 1,
    floorCode: "1F",
    roomId: "operations_hub",
    roomName: "Trung Tâm Vận Hành & Tiếp Tân",
    color: "#38bdf8",
    themeColor: "#38bdf8",
    workstations: [
      { id: "ops_1", deskPos: { x: -6.5, z: -4.5 }, chairPos: { x: -6.5, z: -3.0, rotY: Math.PI } },
      { id: "ops_2", deskPos: { x: -3.0, z: -4.5 }, chairPos: { x: -3.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  support: {
    division: "support",
    name: "Chăm Sóc & Hỗ Trợ Khách Hàng",
    floor: 1,
    floorCode: "1F",
    roomId: "support_lounge",
    roomName: "Phân Khu Support & Service Desk",
    color: "#0284c7",
    themeColor: "#38bdf8",
    workstations: [
      { id: "sup_1", deskPos: { x: 3.5, z: -4.5 }, chairPos: { x: 3.5, z: -3.0, rotY: Math.PI } },
      { id: "sup_2", deskPos: { x: 7.0, z: -4.5 }, chairPos: { x: 7.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  healthcare: {
    division: "healthcare",
    name: "Y Tế Doanh Nghiệp & Sức Khỏe",
    floor: 1,
    floorCode: "1F",
    roomId: "healthcare_desk",
    roomName: "Trạm Sức Khỏe & Phúc Lợi",
    color: "#10b981",
    themeColor: "#38bdf8",
    workstations: [
      { id: "health_1", deskPos: { x: -6.5, z: 4.5 }, chairPos: { x: -6.5, z: 3.0, rotY: 0 } },
    ],
  },

  // FLOOR 2: Finance & Specialized Advisory
  finance: {
    division: "finance",
    name: "Tài Chính, Ngân Sách & Kế Toán",
    floor: 2,
    floorCode: "2F",
    roomId: "finance_office",
    roomName: "Phòng Kiểm Soát Tài Chính & Ngân Sách",
    color: "#34d399",
    themeColor: "#34d399",
    workstations: [
      { id: "fin_1", deskPos: { x: -6.5, z: -4.5 }, chairPos: { x: -6.5, z: -3.0, rotY: Math.PI } },
      { id: "fin_2", deskPos: { x: -3.0, z: -4.5 }, chairPos: { x: -3.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  specialized: {
    division: "specialized",
    name: "Tư Vấn Chuyên Sâu, Thuế & Pháp Lý",
    floor: 2,
    floorCode: "2F",
    roomId: "specialized_advisory",
    roomName: "Khu Vực Cố Vấn Pháp Lý & Kiểm Toán",
    color: "#059669",
    themeColor: "#34d399",
    workstations: [
      { id: "spec_1", deskPos: { x: 3.5, z: -4.5 }, chairPos: { x: 3.5, z: -3.0, rotY: Math.PI } },
      { id: "spec_2", deskPos: { x: 7.0, z: -4.5 }, chairPos: { x: 7.0, z: -3.0, rotY: Math.PI } },
    ],
  },

  // FLOOR 3: Marketing, Paid Media & Sales
  marketing: {
    division: "marketing",
    name: "Tiếp Thị & Chiến Lược Tăng Trưởng",
    floor: 3,
    floorCode: "3F",
    roomId: "marketing_studio",
    roomName: "Studio Chiến Lược Marketing & Content",
    color: "#f472b6",
    themeColor: "#f472b6",
    workstations: [
      { id: "mkt_1", deskPos: { x: -6.5, z: -4.5 }, chairPos: { x: -6.5, z: -3.0, rotY: Math.PI } },
      { id: "mkt_2", deskPos: { x: -3.0, z: -4.5 }, chairPos: { x: -3.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  "paid-media": {
    division: "paid-media",
    name: "Truyền Thông Trả Phí & Quảng Cáo Số",
    floor: 3,
    floorCode: "3F",
    roomId: "media_pod",
    roomName: "Phân Khu Truyền Thông & Performance Ads",
    color: "#ec4899",
    themeColor: "#f472b6",
    workstations: [
      { id: "pm_1", deskPos: { x: -6.5, z: 4.5 }, chairPos: { x: -6.5, z: 3.0, rotY: 0 } },
    ],
  },
  sales: {
    division: "sales",
    name: "Phát Triển Thị Trường & Doanh Thu",
    floor: 3,
    floorCode: "3F",
    roomId: "sales_wing",
    roomName: "Cánh Kinh Doanh & Quan Hệ Đối Tác",
    color: "#fb7185",
    themeColor: "#f472b6",
    workstations: [
      { id: "sales_1", deskPos: { x: 3.5, z: -4.5 }, chairPos: { x: 3.5, z: -3.0, rotY: Math.PI } },
      { id: "sales_2", deskPos: { x: 7.0, z: -4.5 }, chairPos: { x: 7.0, z: -3.0, rotY: Math.PI } },
    ],
  },

  // FLOOR 4: Design, Product, Game Dev & Spatial Computing
  design: {
    division: "design",
    name: "Thiết Kế UI/UX & Bản Sắc Thương Hiệu",
    floor: 4,
    floorCode: "4F",
    roomId: "design_studio",
    roomName: "Xưởng Thiết Kế Giao Diện & Nghệ Thuật",
    color: "#a855f7",
    themeColor: "#c084fc",
    workstations: [
      { id: "des_1", deskPos: { x: -6.5, z: -4.5 }, chairPos: { x: -6.5, z: -3.0, rotY: Math.PI } },
      { id: "des_2", deskPos: { x: -3.0, z: -4.5 }, chairPos: { x: -3.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  product: {
    division: "product",
    name: "Quản Trị Sản Phẩm & Trải Nghiệm",
    floor: 4,
    floorCode: "4F",
    roomId: "product_pod",
    roomName: "Không Gian Định Hình Sản Phẩm (PM Hub)",
    color: "#8b5cf6",
    themeColor: "#c084fc",
    workstations: [
      { id: "prod_1", deskPos: { x: -11.5, z: 3.5 }, chairPos: { x: -11.5, z: 4.8, rotY: 0 } },
    ],
  },
  "project-management": {
    division: "project-management",
    name: "Quản Lý Dự Án & Điều Phối Scrum",
    floor: 4,
    floorCode: "4F",
    roomId: "pm_command",
    roomName: "Trung Tâm Điều Phối Dự Án (PM Command)",
    color: "#a78bfa",
    themeColor: "#c084fc",
    workstations: [
      { id: "pm_1", deskPos: { x: -3.5, z: 3.5 }, chairPos: { x: -3.5, z: 4.8, rotY: 0 } },
    ],
  },
  "game-development": {
    division: "game-development",
    name: "Phát Triển Game & Mô Phỏng Tương Tác",
    floor: 4,
    floorCode: "4F",
    roomId: "game_lab",
    roomName: "Phòng Thí Nghiệm Game & Realtime 3D",
    color: "#d946ef",
    themeColor: "#c084fc",
    workstations: [
      { id: "game_1", deskPos: { x: 7.0, z: -4.5 }, chairPos: { x: 7.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  "spatial-computing": {
    division: "spatial-computing",
    name: "Điện Toán Không Gian (Spatial / AR / VR)",
    floor: 4,
    floorCode: "4F",
    roomId: "spatial_lab",
    roomName: "Phòng Nghiên Cứu Không Gian Ảo AR/VR",
    color: "#c084fc",
    themeColor: "#c084fc",
    workstations: [
      { id: "spat_1", deskPos: { x: -6.5, z: 4.5 }, chairPos: { x: -6.5, z: 3.0, rotY: 0 } },
    ],
  },

  // FLOOR 5: Engineering, Security, Testing & GIS
  engineering: {
    division: "engineering",
    name: "Kỹ Thuật Hệ Thống & Microservices",
    floor: 5,
    floorCode: "5F",
    roomId: "engineering_bay",
    roomName: "Khu Vực Kỹ Sư Hệ Thống & Backend",
    color: "#38bdf8",
    themeColor: "#0284c7",
    workstations: [
      { id: "eng_1", deskPos: { x: -6.5, z: -4.5 }, chairPos: { x: -6.5, z: -3.0, rotY: Math.PI } },
      { id: "eng_2", deskPos: { x: -3.0, z: -4.5 }, chairPos: { x: -3.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  security: {
    division: "security",
    name: "Bảo Mật Thông Tin & An Ninh Mạng (SOC)",
    floor: 5,
    floorCode: "5F",
    roomId: "security_soc",
    roomName: "Trung Tâm Tác Chiến An Ninh Mạng SOC",
    color: "#ef4444",
    themeColor: "#0284c7",
    workstations: [
      { id: "sec_1", deskPos: { x: 3.5, z: -4.5 }, chairPos: { x: 3.5, z: -3.0, rotY: Math.PI } },
    ],
  },
  testing: {
    division: "testing",
    name: "Kiểm Thử & Đảm Bảo Chất Lượng (QA)",
    floor: 5,
    floorCode: "5F",
    roomId: "qa_lab",
    roomName: "Phòng Kiểm Thử Chất Lượng Phần Mềm",
    color: "#f59e0b",
    themeColor: "#0284c7",
    workstations: [
      { id: "test_1", deskPos: { x: 7.0, z: -4.5 }, chairPos: { x: 7.0, z: -3.0, rotY: Math.PI } },
    ],
  },
  gis: {
    division: "gis",
    name: "Hệ Thống Thông Tin Địa Lý & Bản Đồ",
    floor: 5,
    floorCode: "5F",
    roomId: "gis_center",
    roomName: "Trung Tâm Dữ Liệu Bản Đồ & GIS",
    color: "#06b6d4",
    themeColor: "#0284c7",
    workstations: [
      { id: "gis_1", deskPos: { x: -6.5, z: 4.5 }, chairPos: { x: -6.5, z: 3.0, rotY: 0 } },
    ],
  },

  // FLOOR 6: Executive, Research & Academic
  executive: {
    division: "executive",
    name: "Ban Điều Hành & Chiến Lược Cấp Cao",
    floor: 6,
    floorCode: "6F",
    roomId: "executive_suite",
    roomName: "Văn Phòng Tổng Giám Đốc (CEO Suite)",
    color: "#fbbf24",
    themeColor: "#f59e0b",
    workstations: [
      { id: "exec_1", deskPos: { x: -4.5, z: 0.0 }, chairPos: { x: -4.5, z: 1.5, rotY: Math.PI } },
    ],
  },
  research: {
    division: "research",
    name: "Viện Nghiên Cứu AI & Trí Tuệ Nhân Tạo",
    floor: 6,
    floorCode: "6F",
    roomId: "research_lab",
    roomName: "Phòng Nghiên Cứu Mô Hình AI Tương Lai",
    color: "#8b5cf6",
    themeColor: "#f59e0b",
    workstations: [
      { id: "res_1", deskPos: { x: 3.5, z: -4.5 }, chairPos: { x: 3.5, z: -3.0, rotY: Math.PI } },
    ],
  },
  academic: {
    division: "academic",
    name: "Hội Đồng Học Thuật & Nghiên Cứu Khoa Học",
    floor: 6,
    floorCode: "6F",
    roomId: "academic_fellowship",
    roomName: "Viện Hàn Lâm & Cố Vấn Khoa Học",
    color: "#d97706",
    themeColor: "#f59e0b",
    workstations: [
      { id: "acad_1", deskPos: { x: 7.0, z: -4.5 }, chairPos: { x: 7.0, z: -3.0, rotY: Math.PI } },
    ],
  },
};

export function resolveDivisionKey(divisionOrRoom: string): string {
  if (!divisionOrRoom) return "operations";
  const norm = divisionOrRoom.toLowerCase().trim();
  if (DIVISION_FLOOR_MAPPING[norm]) {
    return norm;
  }
  const entry = Object.values(DIVISION_FLOOR_MAPPING).find(
    d => d.roomId === norm || d.roomId.toLowerCase() === norm || d.division === norm
  );
  if (entry) {
    return entry.division;
  }
  return norm;
}

export function getFloorForDivision(divisionOrRoom: string): number {
  if (!divisionOrRoom) return 1;
  const norm = divisionOrRoom.toLowerCase().trim();
  if (DIVISION_FLOOR_MAPPING[norm]) {
    return DIVISION_FLOOR_MAPPING[norm].floor;
  }
  const entry = Object.values(DIVISION_FLOOR_MAPPING).find(
    d => d.roomId === norm || d.roomId.toLowerCase() === norm || d.division === norm
  );
  if (entry) {
    return entry.floor;
  }
  return 1;
}

// 4-Person Pod Island System (4 người 1 cụm bàn đảo rộng rãi, ngăn cách bởi vách tiêu âm & tủ credenza trang trí)
export const POD_SEAT_OFFSETS = [
  { dx: -1.05, dz: -0.65, chairDz: -1.35, rotY: 0 },         // Seat 0: NW
  { dx: 1.05, dz: -0.65, chairDz: -1.35, rotY: 0 },          // Seat 1: NE
  { dx: -1.05, dz: 0.65, chairDz: 1.35, rotY: Math.PI },     // Seat 2: SW
  { dx: 1.05, dz: 0.65, chairDz: 1.35, rotY: Math.PI },      // Seat 3: SE
];

// Dedicated pod centers for every division across all spacious floors (ROOM_W = 54, ROOM_D = 38)
// Exactly matching the architectural reference diorama (Image 2):
// - Glass Meeting Rooms & Executive Suites in Northwest (Z <= -6.5)
// - Open Kitchen, High Bar Counter & Beanbags in Northeast (Z <= -6.5)
// - Central Collaboration Lounge with Sofas & Area Rug in Center (Z in [-3.5, 4.0])
// - Elevator Core & Fluted Reception Desk in East (X >= 18.0)
// - Clean 4-Person Pod Islands in South Open Office (Z in [7.0, 16.0], X in [-18.0, 12.0])
export const DIVISION_POD_CENTERS: Record<string, Array<{ x: number; z: number }>> = {
  // FLOOR 1: Operations, Support & Healthcare (8 pods = 32 workstations)
  operations: [
    { x: -15.5, z: 8.5 },
    { x: -7.5, z: 8.5 },
    { x: -15.5, z: 14.0 },
  ],
  support: [
    { x: 0.5, z: 8.5 },
    { x: 8.5, z: 8.5 },
    { x: 0.5, z: 14.0 },
  ],
  healthcare: [
    { x: -7.5, z: 14.0 },
    { x: 8.5, z: 14.0 },
  ],

  // FLOOR 2: Finance & Specialized Advisory (8 pods = 32 workstations)
  finance: [
    { x: -15.5, z: 8.5 },
    { x: -7.5, z: 8.5 },
    { x: -15.5, z: 14.0 },
  ],
  specialized: [
    { x: 0.5, z: 8.5 },
    { x: 8.5, z: 8.5 },
    { x: -7.5, z: 14.0 },
    { x: 0.5, z: 14.0 },
    { x: 8.5, z: 14.0 },
  ],

  // FLOOR 3: Marketing, Paid-Media & Sales (8 pods = 32 workstations)
  marketing: [
    { x: -15.5, z: 8.5 },
    { x: -7.5, z: 8.5 },
    { x: -15.5, z: 14.0 },
  ],
  "paid-media": [
    { x: 0.5, z: 8.5 },
    { x: -7.5, z: 14.0 },
  ],
  sales: [
    { x: 8.5, z: 8.5 },
    { x: 0.5, z: 14.0 },
    { x: 8.5, z: 14.0 },
  ],

  // FLOOR 4: Design, Product, PM, Game Dev & Spatial Computing (8 pods = 32 workstations)
  design: [
    { x: -15.5, z: 8.5 },
    { x: -15.5, z: 14.0 },
  ],
  product: [
    { x: -7.5, z: 8.5 },
    { x: -7.5, z: 14.0 },
  ],
  "project-management": [
    { x: 0.5, z: 8.5 },
  ],
  "game-development": [
    { x: 8.5, z: 8.5 },
    { x: 8.5, z: 14.0 },
  ],
  "spatial-computing": [
    { x: 0.5, z: 14.0 },
  ],

  // FLOOR 5: Engineering, Security, Testing, GIS (8 pods = 32 workstations)
  engineering: [
    { x: -15.5, z: 8.5 },
    { x: -7.5, z: 8.5 },
    { x: -15.5, z: 14.0 },
  ],
  security: [
    { x: 0.5, z: 8.5 },
    { x: 0.5, z: 14.0 },
  ],
  testing: [
    { x: 8.5, z: 8.5 },
    { x: 8.5, z: 14.0 },
  ],
  gis: [
    { x: -7.5, z: 14.0 },
  ],

  // FLOOR 6: Executive, Research & Academic (8 pods = 32 workstations)
  research: [
    { x: -15.5, z: 8.5 },
    { x: -7.5, z: 8.5 },
    { x: -15.5, z: 14.0 },
  ],
  executive: [
    { x: 0.5, z: 8.5 },
    { x: 0.5, z: 14.0 },
  ],
  academic: [
    { x: 8.5, z: 8.5 },
    { x: -7.5, z: 14.0 },
    { x: 8.5, z: 14.0 },
  ],
};

export function getDivisionWorkstation(division: string, deskIndex: number): {
  deskPos: { x: number; z: number };
  chairPos: { x: number; z: number; rotY: number };
  podCenter: { x: number; z: number };
  podId: string;
  seatIndex: number;
} {
  const norm = division.toLowerCase().trim();
  const podCenters = DIVISION_POD_CENTERS[norm] || DIVISION_POD_CENTERS.engineering;

  // 4 seats per pod
  const podIdx = Math.floor(deskIndex / 4);
  const seatIdx = deskIndex % 4;
  const seat = POD_SEAT_OFFSETS[seatIdx];

  const center = podCenters[podIdx % podCenters.length] || { x: -10, z: 0 };
  const x = Math.round((center.x + seat.dx) * 100) / 100;
  const z = Math.round((center.z + seat.dz) * 100) / 100;
  const chairZ = Math.round((center.z + seat.chairDz) * 100) / 100;

  return {
    deskPos: { x, z },
    chairPos: { x, z: chairZ, rotY: seat.rotY },
    podCenter: center,
    podId: `pod-${norm}-${podIdx}`,
    seatIndex: seatIdx,
  };
}

