export const WORLD_CONFIG = {
  islandName: "AI Agency — Autonomous Business Headquarters",
  regionLore: "Level 42 Executive Tower — Autonomous Enterprise Floor",
  tacticalCamera: {
    position: [0, 22, 26] as [number, number, number],
    target: [0, 1.2, 0] as [number, number, number],
    fov: 46,
    minDistance: 6,
    maxDistance: 60,
    maxPolarAngle: Math.PI / 2 - 0.05,
  },
  environment: {
    fogColor: "#e2e8f0", // Daylight metropolis horizon
    fogNear: 80,
    fogFar: 260,
    officeWidth: 44,
    officeDepth: 34,
    sunPosition: [35, 40, 25] as [number, number, number],
    sunLight: {
      position: [35, 40, 25] as [number, number, number],
      color: "#fffbeb", // Warm natural morning sunlight through glass facade
      intensity: 3.2,
    },
    skyLight: {
      skyColor: "#bfdbfe", // Soft ambient sky
      groundColor: "#f1f5f9", // Crisp architectural interior bounce
      intensity: 1.5,
    },
    ambientLight: {
      color: "#ffffff",
      intensity: 1.1,
    },
  },
};

export const ISLAND_CAMERA_BOOKMARKS = [
  {
    id: "all-office",
    label: "Toàn Văn Phòng HQ",
    icon: "Building",
    cameraPosition: [0, 22, 26] as [number, number, number],
    targetPosition: [0, 1.2, 0] as [number, number, number],
  },
  {
    id: "executive-suite",
    label: "Executive Boardroom (CEO)",
    icon: "Crown",
    cameraPosition: [0, 6.5, -4] as [number, number, number],
    targetPosition: [0, 1.2, -10] as [number, number, number],
  },
  {
    id: "engineering-bay",
    label: "Engineering & Architecture Bay",
    icon: "Code",
    cameraPosition: [-8, 6.5, 2] as [number, number, number],
    targetPosition: [-14, 1.2, -4] as [number, number, number],
  },
  {
    id: "research-lab",
    label: "AI Research & Intelligence Lab",
    icon: "Brain",
    cameraPosition: [-8, 6.5, 16] as [number, number, number],
    targetPosition: [-14, 1.2, 10] as [number, number, number],
  },
  {
    id: "marketing-studio",
    label: "Marketing & Growth Studio",
    icon: "Sparkles",
    cameraPosition: [8, 6.5, 2] as [number, number, number],
    targetPosition: [14, 1.2, -4] as [number, number, number],
  },
  {
    id: "sales-wing",
    label: "Sales & Enterprise Wing",
    icon: "TrendingUp",
    cameraPosition: [8, 6.5, 16] as [number, number, number],
    targetPosition: [14, 1.2, 10] as [number, number, number],
  },
  {
    id: "finance-office",
    label: "Finance & Treasury Office",
    icon: "ShieldAlert",
    cameraPosition: [2, 6.0, 2] as [number, number, number],
    targetPosition: [6, 1.2, -4] as [number, number, number],
  },
  {
    id: "operations-hub",
    label: "Operations & Agent Recruitment Hub",
    icon: "Users",
    cameraPosition: [-2, 6.0, 2] as [number, number, number],
    targetPosition: [-6, 1.2, -4] as [number, number, number],
  },
  {
    id: "support-lounge",
    label: "Customer Success Lounge",
    icon: "Headphones",
    cameraPosition: [0, 6.0, 6] as [number, number, number],
    targetPosition: [0, 1.2, 12] as [number, number, number],
  },
];
