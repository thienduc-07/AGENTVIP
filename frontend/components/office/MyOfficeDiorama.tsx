"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import {
  Building2,
  Tv,
  MessageSquare,
  Sparkles,
  Send,
  Minimize2,
  Maximize2,
  RefreshCw,
  Compass,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Cpu,
  TrendingUp,
  Palette,
  Users,
  CheckCircle2,
  Clock,
  ArrowRight
} from "lucide-react";

export interface AgentConfig {
  id: "leo" | "mina" | "hana" | "victor";
  name: string;
  role: string;
  floor: number;
  badgeColor: string;
  shirtColor: number;
  hairColor: number;
  skinColor: number;
  accessory: "headphones" | "glasses" | "beret" | "crown";
  deskPos: { x: number; z: number };
  chairPos: { x: number; z: number; rotY: number };
  loungePos: { x: number; z: number; rotY: number };
  coffeePos: { x: number; z: number; rotY: number };
  keywords: string[];
  persona: string;
}

export interface FloorConfig {
  id: number;
  code: string;
  name: string;
  enName: string;
  themeColor: string;
  wallColor: number;
  floorColor: number;
  woodAccent: number;
  description: string;
}

const FLOOR_HEIGHT = 8.5;
const ROOM_W = 20;
const ROOM_D = 16;

export const FLOORS: Record<number, FloorConfig> = {
  1: {
    id: 1,
    code: "1F",
    name: "Phòng Kỹ Thuật & AI Server",
    enName: "LEVEL 01 — TECH & ENGINEERING",
    themeColor: "#38bdf8",
    wallColor: 0x1e293b,
    floorColor: 0x334155,
    woodAccent: 0x94a3b8,
    description: "Trung tâm lập trình, hệ thống tủ Server AI và khu vực nghỉ ngơi cho kỹ sư."
  },
  2: {
    id: 2,
    code: "2F",
    name: "Phòng Tài Chính & Phân Tích Quỹ",
    enName: "LEVEL 02 — FINANCE & ANALYTICS",
    themeColor: "#34d399",
    wallColor: 0x172554,
    floorColor: 0xd6d3d1,
    woodAccent: 0x059669,
    description: "Quản lý ngân sách, bảng điện tử chứng khoán, báo cáo dòng tiền & ROI."
  },
  3: {
    id: 3,
    code: "3F",
    name: "Studio Sáng Tạo & Thiết Kế Sản Phẩm",
    enName: "LEVEL 03 — CREATIVE & DESIGN STUDIO",
    themeColor: "#f472b6",
    wallColor: 0x3b1d38,
    floorColor: 0xb45309,
    woodAccent: 0xec4899,
    description: "Không gian ấm cúng với bảng vẽ Wacom, tường Moodboard, sofa lười & cây xanh."
  },
  4: {
    id: 4,
    code: "4F",
    name: "Phòng Họp Chiến Lược & Điều Hành",
    enName: "LEVEL 04 — EXECUTIVE STRATEGY SUITE",
    themeColor: "#fbbf24",
    wallColor: 0x27272a,
    floorColor: 0x78350f,
    woodAccent: 0xf59e0b,
    description: "Bàn họp lớn, màn hình trình chiếu gắn tường chống xuyên thấu & quầy cà phê."
  }
};

export const AGENTS: Record<string, AgentConfig> = {
  leo: {
    id: "leo",
    name: "Leo",
    role: "Lead AI & Fullstack Engineer",
    floor: 1,
    badgeColor: "sky",
    shirtColor: 0x0284c7,
    hairColor: 0x1e293b,
    skinColor: 0xffedd5,
    accessory: "headphones",
    deskPos: { x: -4.2, z: -3.2 },
    chairPos: { x: -4.2, z: -1.65, rotY: Math.PI },
    loungePos: { x: -2.5, z: 3.8, rotY: Math.PI * 0.75 },
    coffeePos: { x: 2.2, z: -5.2, rotY: Math.PI },
    keywords: ["code", "bug", "lỗi", "lag", "fps", "three", "react", "js", "api", "server", "database", "sql", "python", "kỹ thuật", "lập trình", "web", "app", "game", "tối ưu", "backend", "frontend", "git", "docker"],
    persona: "Bạn là Leo (Kỹ sư trưởng tầng 1F). Trả lời ngắn gọn, súc tích, chuyên sâu về lập trình, kiến trúc hệ thống, sửa bug và tối ưu hiệu năng 60-120FPS."
  },
  mina: {
    id: "mina",
    name: "Mina",
    role: "CFO & Chuyên Gia Tài Chính",
    floor: 2,
    badgeColor: "emerald",
    shirtColor: 0x059669,
    hairColor: 0x451a03,
    skinColor: 0xffe4e6,
    accessory: "glasses",
    deskPos: { x: -4.2, z: -3.2 },
    chairPos: { x: -4.2, z: -1.65, rotY: Math.PI },
    loungePos: { x: 1.5, z: 2.8, rotY: -Math.PI * 0.5 },
    coffeePos: { x: 2.2, z: -5.2, rotY: Math.PI },
    keywords: ["tài chính", "tiền", "lương", "ngân sách", "budget", "roi", "kpi", "doanh thu", "lợi nhuận", "chi phí", "thuế", "kế toán", "đầu tư", "cổ phiếu", "chứng khoán", "excel", "báo cáo", "vốn", "quỹ", "marketing cost", "giá"],
    persona: "Bạn là Mina (Giám đốc Tài chính tầng 2F). Trả lời sắc sảo, có số liệu minh họa rõ ràng về ngân sách, dòng tiền, tối ưu chi phí và ROI."
  },
  hana: {
    id: "hana",
    name: "Hana",
    role: "Creative & UI/UX Art Director",
    floor: 3,
    badgeColor: "pink",
    shirtColor: 0xdb2777,
    hairColor: 0xfbbf24,
    skinColor: 0xffedd5,
    accessory: "beret",
    deskPos: { x: -4.2, z: -3.2 },
    chairPos: { x: -4.2, z: -1.65, rotY: Math.PI },
    loungePos: { x: -3.0, z: 3.2, rotY: Math.PI * 0.25 },
    coffeePos: { x: 2.2, z: -5.2, rotY: Math.PI },
    keywords: ["thiết kế", "design", "ui", "ux", "màu", "vẽ", "chibi", "3d", "art", "logo", "banner", "brand", "thương hiệu", "sáng tạo", "giao diện", "figma", "layout", "font", "ảnh", "video", "style", "đẹp"],
    persona: "Bạn là Hana (Giám đốc Sáng tạo & Thiết kế tầng 3F). Trả lời truyền cảm hứng, giàu tính thẩm mỹ về UI/UX, màu sắc, bố cục và phong cách nghệ thuật."
  },
  victor: {
    id: "victor",
    name: "Victor",
    role: "Giám Đốc Chiến Lược & Quản Lý Dự Án",
    floor: 4,
    badgeColor: "amber",
    shirtColor: 0xd97706,
    hairColor: 0x334155,
    skinColor: 0xfde68a,
    accessory: "crown",
    deskPos: { x: -2.0, z: 0.5 },
    chairPos: { x: -5.4, z: 0.5, rotY: Math.PI * 0.5 },
    loungePos: { x: -1.5, z: -5.2, rotY: 0 },
    coffeePos: { x: 2.2, z: -5.2, rotY: Math.PI },
    keywords: ["họp", "chiến lược", "kế hoạch", "plan", "roadmap", "pitch", "slide", "thuyết trình", "quản lý", "dự án", "khách hàng", "sếp", "ceo", "mục tiêu", "okr", "startup", "ra mắt", "tổng hợp"],
    persona: "Bạn là Victor (Giám đốc Chiến lược & PM tầng 4F). Trả lời quyết đoán, có tầm nhìn tổng quan, chia lộ trình các bước thực thi rõ ràng."
  }
};

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  agent?: AgentConfig;
  floorCfg?: FloorConfig;
  mode?: string;
  timestamp: string;
}

interface MyOfficeDioramaProps {
  onSubmitTask?: (agentId: string, promptText: string) => Promise<void>;
  apiKey?: string;
}

export default function MyOfficeDiorama({
  onSubmitTask,
  apiKey = ""
}: MyOfficeDioramaProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Application State
  const [currentFloor, setCurrentFloor] = useState<number>(1);
  const [ghostOtherFloors, setGhostOtherFloors] = useState<boolean>(true);
  const [isElevatorRemoteOpen, setIsElevatorRemoteOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(true);
  const [selectedChatTarget, setSelectedChatTarget] = useState<string>("auto");
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Xin chào! Đây là không gian làm việc AI 3D Diorama phong cách Cozy Game.\n\nBạn có thể nhắn bất kỳ câu hỏi hoặc chỉ đạo nào vào khung chat bên dưới. Hệ thống sẽ **tự động phân tích ngữ cảnh**, đi thang máy tới đúng tầng của chuyên gia Chibi (Leo, Mina, Hana, hoặc Victor) và cập nhật báo cáo trực tiếp lên màn hình 3D!",
      timestamp: "Vừa xong"
    }
  ]);
  const [isAiResponding, setIsAiResponding] = useState<boolean>(false);
  const [currentRouteNotice, setCurrentRouteNotice] = useState<string | null>(null);
  const [chatInputText, setChatInputText] = useState<string>("");
  const [fpsValue, setFpsValue] = useState<number>(60);
  const [elevatorStatusText, setElevatorStatusText] = useState<string>("Cửa đang mở • Sẵn sàng");
  const [elevatorDirArrow, setElevatorDirArrow] = useState<string>("●");

  // Three.js References
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const floorGroupsRef = useRef<Record<number, THREE.Group>>({});
  const floorMaterialsRef = useRef<Record<number, Array<{ mat: THREE.Material; baseOpacity: number; wasTransparent: boolean }>>>({});
  const elevatorDoorsRef = useRef<Record<number, { left: THREE.Mesh; right: THREE.Mesh; closedLeftX: number; closedRightX: number; openOffset: number; isOpen: boolean }>>({});
  const wallScreensRef = useRef<Record<number, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; data: any }>>({});
  const agentControllersRef = useRef<Record<string, any>>({});
  const clickableMeshesRef = useRef<THREE.Mesh[]>([]);

  // Zero-Lag Camera State
  const camStateRef = useRef({
    theta: Math.PI / 4,
    phi: Math.PI / 3.1,
    radius: 26,
    targetX: 0,
    targetY: 2.5,
    targetZ: 0,
    goalFloorY: 2.5,
    isDraggingLeft: false,
    isDraggingRight: false,
    prevX: 0,
    prevY: 0,
    downX: 0,
    downY: 0
  });

  // Shared Geometries & Materials
  const geoRef = useRef<{ box?: THREE.BoxGeometry; cyl?: THREE.CylinderGeometry; sphere?: THREE.SphereGeometry; plane?: THREE.PlaneGeometry }>({});
  const matRef = useRef<{ [key: string]: THREE.Material }>({});

  const registerFloorMaterial = useCallback((floorId: number, mat: THREE.Material) => {
    if (!floorMaterialsRef.current[floorId]) {
      floorMaterialsRef.current[floorId] = [];
    }
    const cloned = mat.clone();
    floorMaterialsRef.current[floorId].push({
      mat: cloned,
      baseOpacity: (cloned as any).opacity !== undefined ? (cloned as any).opacity : 1.0,
      wasTransparent: Boolean((cloned as any).transparent)
    });
    return cloned;
  }, []);

  const createMesh = useCallback((
    floorId: number,
    geo: THREE.BufferGeometry,
    baseMat: THREE.Material,
    sx: number, sy: number, sz: number,
    px: number, py: number, pz: number,
    castShadow = true,
    receiveShadow = true
  ) => {
    const mat = registerFloorMaterial(floorId, baseMat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(px, py, pz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    return mesh;
  }, [registerFloorMaterial]);

  const drawWallScreenContent = useCallback((floorId: number, data: any) => {
    const scr = wallScreensRef.current[floorId];
    if (!scr) return;
    const { ctx, canvas, tex } = scr;

    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = data.accent || "#38bdf8";
    ctx.fillRect(0, 0, canvas.width, 14);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 22, canvas.width - 24, canvas.height - 34);

    ctx.fillStyle = data.accent || "#38bdf8";
    ctx.font = "800 28px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(data.title || "LIVE OFFICE SCREEN", 36, 75);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "600 22px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("• " + (data.line1 || ""), 36, 140);
    ctx.fillText("• " + (data.line2 || ""), 36, 198);
    ctx.fillText("• " + (data.line3 || ""), 36, 256);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 18px 'JetBrains Mono', monospace";
    ctx.fillText("LIVE SYNC • DEPTH-OCCLUDED DISPLAY", 36, 332);

    tex.needsUpdate = true;
  }, []);

  const syncCameraPositionImmediate = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const s = camStateRef.current;
    const sinPhi = Math.sin(s.phi);
    const cosPhi = Math.cos(s.phi);
    const sinTheta = Math.sin(s.theta);
    const cosTheta = Math.cos(s.theta);

    cam.position.x = s.targetX + s.radius * sinPhi * sinTheta;
    cam.position.y = s.targetY + s.radius * cosPhi;
    cam.position.z = s.targetZ + s.radius * sinPhi * cosTheta;
    cam.lookAt(s.targetX, s.targetY, s.targetZ);
  }, []);

  const triggerElevatorDoors = useCallback((open: boolean, floorId: number) => {
    const doors = elevatorDoorsRef.current[floorId];
    if (!doors) return;
    doors.isOpen = open;
    setElevatorStatusText(open ? `Tầng ${floorId}F • Cửa đang mở` : `Tầng ${floorId}F • Cửa đã đóng`);
  }, []);

  const updateFloorVisibility = useCallback((targetFloor: number, isGhost: boolean) => {
    for (let f = 1; f <= 4; f++) {
      const isCurrent = f === targetFloor;
      const group = floorGroupsRef.current[f];
      const mats = floorMaterialsRef.current[f] || [];
      if (!group) continue;

      if (isCurrent) {
        group.visible = true;
        mats.forEach(item => {
          (item.mat as any).transparent = item.wasTransparent;
          (item.mat as any).opacity = item.baseOpacity;
          (item.mat as any).depthWrite = true;
        });
      } else {
        if (!isGhost) {
          group.visible = false;
        } else {
          if (f > targetFloor) {
            group.visible = false;
          } else {
            group.visible = true;
            mats.forEach(item => {
              (item.mat as any).transparent = true;
              (item.mat as any).opacity = 0.08;
              (item.mat as any).depthWrite = false;
            });
          }
        }
      }
    }
  }, []);

  const useElevatorToFloor = useCallback((targetFloor: number) => {
    if (targetFloor === currentFloor) {
      triggerElevatorDoors(true, currentFloor);
      return;
    }

    setElevatorDirArrow(targetFloor > currentFloor ? "▲" : "▼");
    setElevatorStatusText(`Đang di chuyển tới tầng ${targetFloor}F...`);

    triggerElevatorDoors(false, currentFloor);

    setTimeout(() => {
      setCurrentFloor(targetFloor);
      camStateRef.current.goalFloorY = (targetFloor - 1) * FLOOR_HEIGHT + 2.5;
      updateFloorVisibility(targetFloor, ghostOtherFloors);

      setTimeout(() => {
        setElevatorDirArrow("●");
        triggerElevatorDoors(true, targetFloor);
      }, 350);
    }, 240);
  }, [currentFloor, ghostOtherFloors, triggerElevatorDoors, updateFloorVisibility]);

  // Three.js Scene Setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.5, 250);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Warm Game Lighting
    const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 0.85);
    hemiLight.position.set(0, 60, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff7ed, 0.95);
    dirLight.position.set(24, 48, 28);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 110;
    const d = 22;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    // Shared Geometries & Materials
    const GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
      sphere: new THREE.SphereGeometry(1, 16, 16),
      plane: new THREE.PlaneGeometry(1, 1)
    };
    geoRef.current = GEO;

    const MAT = {
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.85 }),
      whitePlastic: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }),
      woodWarm: new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.65 }),
      woodLight: new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.6 }),
      plantGreen: new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.7 }),
      potTerracotta: new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.8 }),
      screenBlack: new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.2 })
    };
    matRef.current = MAT;

    // Helper functions for building diorama
    const buildFloorSign = (floorId: number, cfg: FloorConfig) => {
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 160;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = cfg.themeColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

      ctx.fillStyle = cfg.themeColor;
      ctx.fillRect(20, 22, 125, 116);
      ctx.fillStyle = "#0f172a";
      ctx.font = "900 58px 'JetBrains Mono', monospace";
      ctx.fillText(cfg.code, 38, 100);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 34px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(cfg.name, 170, 75);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 22px 'JetBrains Mono', monospace";
      ctx.fillText(cfg.enName, 170, 120);

      const tex = new THREE.CanvasTexture(canvas);
      const plaqueMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({
        map: tex,
        depthTest: true,
        depthWrite: true
      }));
      const plaqueMesh = new THREE.Mesh(GEO.plane, plaqueMat);
      plaqueMesh.scale.set(5.4, 1.15, 1);
      plaqueMesh.position.set(1.2, 4.9, -ROOM_D / 2 + 0.25);
      return plaqueMesh;
    };

    const buildElevatorAndStairs = (floorId: number, group: THREE.Group) => {
      const shaftX = 6.8;
      const shaftZ = -5.8;

      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 3.8, 5.8, 2.8, shaftX, 2.9, shaftZ, true, true));

      const cabinMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
      group.add(createMesh(floorId, GEO.plane, cabinMat, 2.5, 4.3, 1, shaftX, 2.2, shaftZ + 1.38, false, false));

      const doorL = createMesh(floorId, GEO.box, MAT.chrome, 1.22, 4.3, 0.12, shaftX - 0.62, 2.15, shaftZ + 1.42, true, true);
      const doorR = createMesh(floorId, GEO.box, MAT.chrome, 1.22, 4.3, 0.12, shaftX + 0.62, 2.15, shaftZ + 1.42, true, true);
      doorL.userData = { type: "elevator", floor: floorId };
      doorR.userData = { type: "elevator", floor: floorId };
      clickableMeshesRef.current.push(doorL, doorR);
      group.add(doorL, doorR);

      elevatorDoorsRef.current[floorId] = {
        left: doorL,
        right: doorR,
        closedLeftX: shaftX - 0.62,
        closedRightX: shaftX + 0.62,
        openOffset: 0.95,
        isOpen: floorId === 1
      };
      if (floorId === 1) {
        doorL.position.x -= 0.95;
        doorR.position.x += 0.95;
      }

      // Overhead Elevator LED Header
      const headerCanvas = document.createElement("canvas");
      headerCanvas.width = 256;
      headerCanvas.height = 80;
      const hCtx = headerCanvas.getContext("2d")!;
      hCtx.fillStyle = "#050811";
      hCtx.fillRect(0, 0, 256, 80);
      hCtx.strokeStyle = "#475569";
      hCtx.lineWidth = 6;
      hCtx.strokeRect(3, 3, 250, 74);
      hCtx.fillStyle = "#f59e0b";
      hCtx.font = "800 44px 'JetBrains Mono', monospace";
      hCtx.fillText("🛗 " + FLOORS[floorId].code, 46, 56);
      const hTex = new THREE.CanvasTexture(headerCanvas);
      const hMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: hTex, depthTest: true, depthWrite: true }));
      const hPlane = new THREE.Mesh(GEO.plane, hMat);
      hPlane.scale.set(1.8, 0.55, 1);
      hPlane.position.set(shaftX, 4.85, shaftZ + 1.45);
      hPlane.userData = { type: "elevator", floor: floorId };
      clickableMeshesRef.current.push(hPlane);
      group.add(hPlane);

      // Call button
      const callBtn = createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: 0xf59e0b }), 0.22, 0.45, 0.1, shaftX + 1.55, 2.1, shaftZ + 1.44, false, false);
      callBtn.userData = { type: "elevator", floor: floorId };
      clickableMeshesRef.current.push(callBtn);
      group.add(callBtn);

      // Stairs
      for (let s = 0; s < 7; s++) {
        group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 1.6, 0.22, 0.55, 8.9, 0.35 + s * 0.48, -2.5 + s * 0.62, true, true));
      }
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.1, 4.2, 4.5, 8.05, 2.1, -0.5, false, false));
    };

    const buildWallScreenMesh = (floorId: number, group: THREE.Group, sx: number, sy: number, sz: number, w: number, h: number, initialData: any) => {
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, w + 0.25, h + 0.25, 0.12, sx, sy, sz, true, false));

      const scrCanvas = document.createElement("canvas");
      scrCanvas.width = 768;
      scrCanvas.height = 384;
      const sCtx = scrCanvas.getContext("2d")!;
      const sTex = new THREE.CanvasTexture(scrCanvas);

      const sMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: sTex, depthTest: true, depthWrite: true }));
      const sPlane = new THREE.Mesh(GEO.plane, sMat);
      sPlane.scale.set(w, h, 1);
      sPlane.position.set(sx, sy, sz + 0.08);
      group.add(sPlane);

      wallScreensRef.current[floorId] = { canvas: scrCanvas, ctx: sCtx, tex: sTex, data: initialData };
      drawWallScreenContent(floorId, initialData);
    };

    const buildDeskAndChair = (floorId: number, group: THREE.Group, dx: number, dz: number, glowHex: number) => {
      // Desk
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 3.1, 0.14, 1.4, dx, 1.42, dz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.14, 1.4, 1.3, dx - 1.42, 0.7, dz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.14, 1.4, 1.3, dx + 1.42, 0.7, dz, true, true));

      // Monitors
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.18, 0.4, 0.18, dx, 1.65, dz - 0.35, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.screenBlack, 1.75, 0.85, 0.08, dx, 2.0, dz - 0.32, true, false));
      group.add(createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: glowHex }), 1.62, 0.72, 1, dx, 2.0, dz - 0.27, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.85, 0.04, 0.32, dx, 1.51, dz + 0.25, false, false));

      // Chair (at dz + 1.55 so sitting on chair cushion Y=0.88 does not intersect desk!)
      const chairZ = dz + 1.55;
      group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.48, 0.08, 0.48, dx, 0.08, chairZ, false, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.1, 0.75, 0.1, dx, 0.45, chairZ, false, false));
      const chairMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
      group.add(createMesh(floorId, GEO.box, chairMat, 0.95, 0.14, 0.95, dx, 0.84, chairZ, true, true));
      group.add(createMesh(floorId, GEO.box, chairMat, 0.92, 1.05, 0.14, dx, 1.42, chairZ + 0.42, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.1, 0.42, 0.65, dx - 0.48, 1.12, chairZ, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.1, 0.42, 0.65, dx + 0.48, 1.12, chairZ, false, false));
    };

    // Build 4 Cutaway Floors
    for (let f = 1; f <= 4; f++) {
      const cfg = FLOORS[f];
      const group = new THREE.Group();
      group.position.y = (f - 1) * FLOOR_HEIGHT;
      scene.add(group);
      floorGroupsRef.current[f] = group;

      const floorMat = new THREE.MeshStandardMaterial({ color: cfg.floorColor, roughness: 0.75 });
      const wallMat = new THREE.MeshStandardMaterial({ color: cfg.wallColor, roughness: 0.65 });
      const trimMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });

      // Slab & Baseboard
      group.add(createMesh(f, GEO.box, floorMat, ROOM_W, 0.5, ROOM_D, 0, -0.25, 0, false, true));
      group.add(createMesh(f, GEO.box, MAT.darkMetal, ROOM_W + 0.3, 0.18, ROOM_D + 0.3, 0, -0.45, 0, false, false));

      // Cutaway Walls
      const wallH = 6.2;
      group.add(createMesh(f, GEO.box, wallMat, ROOM_W, wallH, 0.45, 0, wallH / 2, -ROOM_D / 2, true, true));
      group.add(createMesh(f, GEO.box, trimMat, ROOM_W + 0.4, 0.18, 0.55, 0, wallH + 0.05, -ROOM_D / 2, false, false));
      group.add(createMesh(f, GEO.box, wallMat, 0.45, wallH, ROOM_D, -ROOM_W / 2, wallH / 2, 0, true, true));
      group.add(createMesh(f, GEO.box, trimMat, 0.55, 0.18, ROOM_D + 0.4, -ROOM_W / 2, wallH + 0.05, 0, false, false));

      // Interior Wall Plaque
      group.add(buildFloorSign(f, cfg));

      // Elevator & Stairs
      buildElevatorAndStairs(f, group);

      // Coffee Corner & Plants
      group.add(createMesh(f, GEO.box, MAT.woodWarm, 2.2, 1.5, 1.2, 2.2, 0.75, -6.8, true, true));
      group.add(createMesh(f, GEO.box, MAT.darkMetal, 0.75, 0.85, 0.65, 1.8, 1.9, -6.8, true, false));
      group.add(createMesh(f, GEO.box, MAT.whitePlastic, 0.7, 1.8, 0.7, 3.7, 0.9, -6.8, true, true));
      group.add(createMesh(f, GEO.cyl, new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2 }), 0.28, 0.75, 0.28, 3.7, 2.15, -6.8, false, false));

      // Plants
      group.add(createMesh(f, GEO.cyl, MAT.potTerracotta, 0.45, 0.85, 0.35, -8.6, 0.42, 6.4, true, true));
      group.add(createMesh(f, GEO.sphere, MAT.plantGreen, 0.75, 0.95, 0.75, -8.6, 1.35, 6.4, true, false));
      group.add(createMesh(f, GEO.cyl, MAT.potTerracotta, 0.45, 0.85, 0.35, 8.6, 0.42, 6.4, true, true));
      group.add(createMesh(f, GEO.sphere, MAT.plantGreen, 0.75, 0.95, 0.75, 8.6, 1.35, 6.4, true, false));

      // Department Specifics
      if (f === 1) {
        buildDeskAndChair(f, group, -4.2, -3.2, 0x38bdf8);
        buildDeskAndChair(f, group, 0.2, -3.2, 0x818cf8);
        // Server Racks
        for (let i = 0; i < 3; i++) {
          const zPos = -2.5 + i * 1.65;
          group.add(createMesh(f, GEO.box, MAT.darkMetal, 1.3, 4.2, 1.35, -8.8, 2.1, zPos, true, true));
          for (let row = 0; row < 5; row++) {
            const ledCol = (row + i) % 2 === 0 ? 0x38bdf8 : 0x10b981;
            group.add(createMesh(f, GEO.box, new THREE.MeshBasicMaterial({ color: ledCol }), 0.06, 0.12, 0.9, -8.14, 0.8 + row * 0.65, zPos, false, false));
          }
        }
        // Sofa & Rug
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x0284c7 }), 3.6, 0.55, 1.4, -3.2, 0.45, 4.2, true, true));
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x1e3a8a }), 6.5, 0.04, 4.2, -3.2, 0.02, 3.6, false, true));
        // Wall Screen
        buildWallScreenMesh(f, group, -4.2, 3.6, -7.72, 4.6, 2.3, {
          title: "SYSTEM CLUSTER • 120FPS PIPELINE",
          line1: "Three.js Zero-Lag Orbit Controls",
          line2: "Latency: Direct 1:1 Pointer Tracking",
          line3: "Status: All AI Agents Active & Responsive",
          accent: "#38bdf8"
        });
      } else if (f === 2) {
        buildDeskAndChair(f, group, -4.2, -3.2, 0x34d399);
        buildDeskAndChair(f, group, 0.4, -3.2, 0x10b981);
        for (let i = 0; i < 3; i++) {
          group.add(createMesh(f, GEO.box, MAT.whitePlastic, 1.2, 3.2, 1.3, -9.0, 1.6, -1.5 + i * 1.5, true, true));
        }
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x065f46 }), 3.6, 0.55, 1.4, 2.0, 0.45, 3.8, true, true));
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x064e3b }), 9.0, 0.04, 5.5, -2.0, 0.02, 0.5, false, true));
        buildWallScreenMesh(f, group, -4.2, 3.6, -7.72, 4.8, 2.4, {
          title: "TREASURY & ROI ANALYTICS (2F)",
          line1: "Q4 Runway: $1.48M (+24.6% YoY)",
          line2: "Net Burn Rate: -18% via AI Automation",
          line3: "Projected ROI: 3.4x Target Achieved",
          accent: "#34d399"
        });
      } else if (f === 3) {
        buildDeskAndChair(f, group, -4.2, -3.2, 0xf472b6);
        // Moodboard
        group.add(createMesh(f, GEO.box, MAT.woodWarm, 0.1, 2.6, 5.2, -9.7, 3.4, 0.5, false, false));
        const colors = [0xf472b6, 0x38bdf8, 0xfbbf24, 0x34d399, 0xa855f7];
        for (let i = 0; i < 5; i++) {
          group.add(createMesh(f, GEO.box, new THREE.MeshBasicMaterial({ color: colors[i] }), 0.06, 0.9, 0.75, -9.62, 3.2 + (i % 2) * 0.45, -1.3 + i * 0.9, false, false));
        }
        // Beanbags & Rug
        group.add(createMesh(f, GEO.sphere, new THREE.MeshStandardMaterial({ color: 0xec4899 }), 1.15, 0.72, 1.15, -3.2, 0.55, 3.3, true, true));
        group.add(createMesh(f, GEO.sphere, new THREE.MeshStandardMaterial({ color: 0xf59e0b }), 1.05, 0.68, 1.05, -1.2, 0.52, 4.1, true, true));
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x831843 }), 7.2, 0.04, 5.0, -2.8, 0.02, 3.0, false, true));
        buildWallScreenMesh(f, group, -4.2, 3.6, -7.72, 4.6, 2.3, {
          title: "CHIBI DESIGN SYSTEM & ART (3F)",
          line1: "Warm Isometric 3200K Lighting",
          line2: "Character Rig: Hip-Pivoted Walk & Sit",
          line3: "Current Sprint: My Office 3D Game Polish",
          accent: "#f472b6"
        });
      } else if (f === 4) {
        // Executive Conference Table
        group.add(createMesh(f, GEO.box, MAT.woodWarm, 6.4, 0.18, 2.8, -1.5, 1.42, 0.5, true, true));
        group.add(createMesh(f, GEO.box, MAT.darkMetal, 4.6, 1.35, 1.4, -1.5, 0.68, 0.5, true, true));
        group.add(createMesh(f, GEO.box, MAT.chrome, 0.7, 0.05, 0.5, -3.3, 1.53, 0.5, false, false));
        group.add(createMesh(f, GEO.box, MAT.whitePlastic, 0.6, 0.03, 0.8, -0.3, 1.52, 0.8, false, false));
        // Head Chair
        const chairMat = new THREE.MeshStandardMaterial({ color: 0xb45309 });
        group.add(createMesh(f, GEO.cyl, MAT.darkMetal, 0.12, 0.75, 0.12, -5.4, 0.45, 0.5, false, false));
        group.add(createMesh(f, GEO.box, chairMat, 1.0, 0.15, 1.0, -5.4, 0.84, 0.5, true, true));
        group.add(createMesh(f, GEO.box, chairMat, 0.15, 1.15, 0.96, -5.84, 1.45, 0.5, true, true));
        // Side Chairs
        [-1.6, 0, 1.6].forEach(offsetX => {
          group.add(createMesh(f, GEO.box, MAT.darkMetal, 0.85, 0.14, 0.85, -1.5 + offsetX, 0.84, -1.5, true, true));
          group.add(createMesh(f, GEO.box, MAT.darkMetal, 0.85, 0.95, 0.14, -1.5 + offsetX, 1.38, -1.9, true, true));
          group.add(createMesh(f, GEO.box, MAT.darkMetal, 0.85, 0.14, 0.85, -1.5 + offsetX, 0.84, 2.5, true, true));
          group.add(createMesh(f, GEO.box, MAT.darkMetal, 0.85, 0.95, 0.14, -1.5 + offsetX, 1.38, 2.9, true, true));
        });
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x451a03 }), 11.2, 0.04, 6.6, -1.5, 0.02, 0.5, false, true));
        buildWallScreenMesh(f, group, -2.2, 3.5, -7.72, 6.2, 3.0, {
          title: "EXECUTIVE STRATEGY & ROADMAP (4F)",
          line1: "1. Smart AI Chat Router -> 4 Specialist Departments",
          line2: "2. 120FPS Diorama Cutaway Architecture",
          line3: "3. Direct Interactive Natural Language Tasks",
          accent: "#fbbf24"
        });
      }
    }

    // Build Chibi Characters
    class Chibi {
      cfg: AgentConfig;
      floor: number;
      state: "sitting" | "walking" | "standing";
      walkPhase: number;
      waypoints: Array<{ x: number; z: number }>;
      onArrivalCallback: (() => void) | null;
      root: THREE.Group;
      bodyGroup: THREE.Group;
      torso: THREE.Mesh;
      headGroup: THREE.Group;
      leftArmPivot: THREE.Group;
      rightArmPivot: THREE.Group;
      leftHipPivot: THREE.Group;
      rightHipPivot: THREE.Group;
      signCanvas: HTMLCanvasElement;
      signCtx: CanvasRenderingContext2D;
      signTex: THREE.CanvasTexture;
      signMesh: THREE.Mesh;

      constructor(cfg: AgentConfig) {
        this.cfg = cfg;
        this.floor = cfg.floor;
        this.state = "sitting";
        this.walkPhase = 0;
        this.waypoints = [];
        this.onArrivalCallback = null;

        this.root = new THREE.Group();
        floorGroupsRef.current[this.floor]?.add(this.root);

        const fId = this.floor;
        const skinMat = registerFloorMaterial(fId, new THREE.MeshStandardMaterial({ color: this.cfg.skinColor, roughness: 0.6 }));
        const shirtMat = registerFloorMaterial(fId, new THREE.MeshStandardMaterial({ color: this.cfg.shirtColor, roughness: 0.5 }));
        const pantsMat = registerFloorMaterial(fId, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 }));
        const hairMat = registerFloorMaterial(fId, new THREE.MeshStandardMaterial({ color: this.cfg.hairColor, roughness: 0.65 }));
        const eyeMat = registerFloorMaterial(fId, new THREE.MeshBasicMaterial({ color: 0x0f172a }));
        const blushMat = registerFloorMaterial(fId, new THREE.MeshBasicMaterial({ color: 0xfb7185 }));

        this.bodyGroup = new THREE.Group();
        this.root.add(this.bodyGroup);

        this.torso = new THREE.Mesh(GEO.cyl, shirtMat);
        this.torso.scale.set(0.36, 0.68, 0.28);
        this.torso.position.y = 0.86;
        this.torso.castShadow = true;
        this.bodyGroup.add(this.torso);

        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 1.62;
        this.bodyGroup.add(this.headGroup);

        const headMesh = new THREE.Mesh(GEO.sphere, skinMat);
        headMesh.scale.set(0.48, 0.45, 0.46);
        headMesh.castShadow = true;
        this.headGroup.add(headMesh);

        const hairCap = new THREE.Mesh(GEO.sphere, hairMat);
        hairCap.scale.set(0.51, 0.46, 0.50);
        hairCap.position.set(0, 0.08, -0.03);
        this.headGroup.add(hairCap);

        const leftEye = new THREE.Mesh(GEO.sphere, eyeMat);
        leftEye.scale.set(0.06, 0.085, 0.04);
        leftEye.position.set(-0.16, 0.02, 0.42);
        const rightEye = leftEye.clone();
        rightEye.position.x = 0.16;

        const leftBlush = new THREE.Mesh(GEO.sphere, blushMat);
        leftBlush.scale.set(0.065, 0.035, 0.03);
        leftBlush.position.set(-0.24, -0.07, 0.40);
        const rightBlush = leftBlush.clone();
        rightBlush.position.x = 0.24;
        this.headGroup.add(leftEye, rightEye, leftBlush, rightBlush);

        if (this.cfg.accessory === "headphones") {
          const band = new THREE.Mesh(GEO.box, MAT.chrome);
          band.scale.set(1.02, 0.12, 0.18);
          band.position.set(0, 0.42, 0);
          const earL = new THREE.Mesh(GEO.cyl, shirtMat);
          earL.rotation.z = Math.PI / 2;
          earL.scale.set(0.16, 0.12, 0.16);
          earL.position.set(-0.49, 0.05, 0);
          const earR = earL.clone();
          earR.position.x = 0.49;
          this.headGroup.add(band, earL, earR);
        } else if (this.cfg.accessory === "glasses") {
          const rimL = new THREE.Mesh(GEO.box, MAT.chrome);
          rimL.scale.set(0.18, 0.12, 0.05);
          rimL.position.set(-0.16, 0.03, 0.45);
          const rimR = rimL.clone();
          rimR.position.x = 0.16;
          this.headGroup.add(rimL, rimR);
        } else if (this.cfg.accessory === "beret") {
          const beret = new THREE.Mesh(GEO.cyl, shirtMat);
          beret.scale.set(0.46, 0.12, 0.46);
          beret.position.set(0.08, 0.43, 0);
          beret.rotation.z = -0.2;
          this.headGroup.add(beret);
        }

        // Shoulder-Pivoted Arms
        this.leftArmPivot = new THREE.Group();
        this.leftArmPivot.position.set(-0.42, 1.12, 0);
        const leftArmMesh = new THREE.Mesh(GEO.cyl, shirtMat);
        leftArmMesh.scale.set(0.10, 0.46, 0.10);
        leftArmMesh.position.y = -0.20;
        this.leftArmPivot.add(leftArmMesh);

        this.rightArmPivot = new THREE.Group();
        this.rightArmPivot.position.set(0.42, 1.12, 0);
        const rightArmMesh = leftArmMesh.clone();
        this.rightArmPivot.add(rightArmMesh);

        this.bodyGroup.add(this.leftArmPivot, this.rightArmPivot);

        // Hip-Pivoted Legs
        this.leftHipPivot = new THREE.Group();
        this.leftHipPivot.position.set(-0.16, 0.52, 0);
        const leftLegMesh = new THREE.Mesh(GEO.cyl, pantsMat);
        leftLegMesh.scale.set(0.12, 0.52, 0.12);
        leftLegMesh.position.y = -0.26;
        this.leftHipPivot.add(leftLegMesh);

        this.rightHipPivot = new THREE.Group();
        this.rightHipPivot.position.set(0.16, 0.52, 0);
        const rightLegMesh = leftLegMesh.clone();
        this.rightHipPivot.add(rightLegMesh);

        this.bodyGroup.add(this.leftHipPivot, this.rightHipPivot);

        headMesh.userData = { type: "agent", agentId: this.cfg.id };
        this.torso.userData = { type: "agent", agentId: this.cfg.id };
        clickableMeshesRef.current.push(headMesh, this.torso);

        // Status Signboard
        this.signCanvas = document.createElement("canvas");
        this.signCanvas.width = 384;
        this.signCanvas.height = 96;
        this.signCtx = this.signCanvas.getContext("2d")!;
        this.signTex = new THREE.CanvasTexture(this.signCanvas);

        const sMat = registerFloorMaterial(this.floor, new THREE.MeshBasicMaterial({
          map: this.signTex,
          transparent: true,
          depthTest: true,
          depthWrite: false
        }));
        this.signMesh = new THREE.Mesh(GEO.plane, sMat);
        this.signMesh.scale.set(2.3, 0.58, 1);
        this.signMesh.position.y = 2.55;
        this.root.add(this.signMesh);

        this.updateStatusText(`${this.cfg.name} • Đang làm việc`, "#38bdf8");
        this.sitAtWorkstationImmediate();
      }

      updateStatusText(text: string, borderColor = "#38bdf8") {
        const ctx = this.signCtx;
        ctx.clearRect(0, 0, 384, 96);
        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.beginPath();
        ctx.roundRect(8, 10, 368, 76, 22);
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 24px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, 192, 57);
        this.signTex.needsUpdate = true;
      }

      sitAtWorkstationImmediate() {
        this.state = "sitting";
        this.waypoints = [];
        const chair = this.cfg.chairPos;
        this.root.position.set(chair.x, 0, chair.z);
        this.root.rotation.y = chair.rotY;

        // Seated on chair cushion at Y = 0.88, hips bent 90 degrees forward
        this.bodyGroup.position.y = 0.36;
        this.leftHipPivot.rotation.x = -Math.PI / 2;
        this.rightHipPivot.rotation.x = -Math.PI / 2;
        this.leftArmPivot.rotation.x = -0.65;
        this.rightArmPivot.rotation.x = -0.65;
      }

      walkToChairAndWork(statusMsg?: string) {
        const chair = this.cfg.chairPos;
        const dist = Math.hypot(this.root.position.x - chair.x, this.root.position.z - chair.z);
        if (dist < 0.25) {
          this.sitAtWorkstationImmediate();
          if (statusMsg) this.updateStatusText(statusMsg, "#34d399");
          return;
        }
        this.state = "walking";
        this.bodyGroup.position.y = 0;
        this.waypoints = [
          { x: chair.x, z: chair.z + 1.1 },
          { x: chair.x, z: chair.z }
        ];
        this.onArrivalCallback = () => {
          this.sitAtWorkstationImmediate();
          if (statusMsg) this.updateStatusText(statusMsg, "#34d399");
        };
      }

      walkToSpot(targetSpot: { x: number; z: number; rotY?: number }, labelText: string, onDone?: () => void) {
        this.state = "walking";
        this.bodyGroup.position.y = 0;
        this.updateStatusText(labelText, "#fbbf24");
        this.waypoints = [
          { x: 0.5, z: 0.8 },
          { x: targetSpot.x, z: targetSpot.z }
        ];
        this.onArrivalCallback = () => {
          this.state = "standing";
          this.root.rotation.y = targetSpot.rotY || 0;
          this.leftHipPivot.rotation.x = 0;
          this.rightHipPivot.rotation.x = 0;
          this.leftArmPivot.rotation.x = 0;
          this.rightArmPivot.rotation.x = 0;
          if (onDone) onDone();
        };
      }

      update(dt: number, elapsed: number, camPos: THREE.Vector3) {
        if (this.signMesh) {
          this.signMesh.lookAt(camPos.x, this.signMesh.getWorldPosition(new THREE.Vector3()).y, camPos.z);
        }

        if (this.state === "walking" && this.waypoints.length > 0) {
          const target = this.waypoints[0];
          const dx = target.x - this.root.position.x;
          const dz = target.z - this.root.position.z;
          const dist = Math.hypot(dx, dz);

          if (dist < 0.15) {
            this.root.position.x = target.x;
            this.root.position.z = target.z;
            this.waypoints.shift();
            if (this.waypoints.length === 0 && this.onArrivalCallback) {
              const cb = this.onArrivalCallback;
              this.onArrivalCallback = null;
              cb();
            }
          } else {
            const speed = 4.2;
            this.root.position.x += (dx / dist) * speed * dt;
            this.root.position.z += (dz / dist) * speed * dt;
            this.root.rotation.y = Math.atan2(dx, dz);

            this.walkPhase += dt * 13;
            const swing = Math.sin(this.walkPhase) * 0.62;
            this.leftHipPivot.rotation.x = swing;
            this.rightHipPivot.rotation.x = -swing;
            this.leftArmPivot.rotation.x = -swing * 0.75;
            this.rightArmPivot.rotation.x = swing * 0.75;
            this.headGroup.position.y = 1.62 + Math.abs(Math.cos(this.walkPhase)) * 0.05;
          }
        } else if (this.state === "sitting") {
          const typeWave = Math.sin(elapsed * 8 + this.floor) * 0.12;
          this.leftArmPivot.rotation.x = -0.68 + typeWave;
          this.rightArmPivot.rotation.x = -0.68 - typeWave;
          this.headGroup.rotation.y = Math.sin(elapsed * 1.6 + this.floor) * 0.12;
        } else {
          this.headGroup.rotation.y = Math.sin(elapsed * 1.5) * 0.15;
        }
      }
    }

    Object.values(AGENTS).forEach(cfg => {
      agentControllersRef.current[cfg.id] = new Chibi(cfg);
    });

    updateFloorVisibility(1, true);
    syncCameraPositionImmediate();

    // Zero-Lag Pointer Controls
    const domEl = renderer.domElement;

    const handlePointerDown = (e: PointerEvent) => {
      const s = camStateRef.current;
      s.prevX = e.clientX;
      s.prevY = e.clientY;
      s.downX = e.clientX;
      s.downY = e.clientY;

      if (e.button === 2 || e.shiftKey) {
        s.isDraggingRight = true;
      } else {
        s.isDraggingLeft = true;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const s = camStateRef.current;
      if (!s.isDraggingLeft && !s.isDraggingRight) return;

      const dx = e.clientX - s.prevX;
      const dy = e.clientY - s.prevY;
      s.prevX = e.clientX;
      s.prevY = e.clientY;

      if (s.isDraggingLeft) {
        // Direct 1:1 camera rotation
        s.theta -= dx * 0.0075;
        s.phi = Math.max(0.35, Math.min(Math.PI / 2.15, s.phi - dy * 0.0065));
        syncCameraPositionImmediate();
      } else if (s.isDraggingRight) {
        // Direct 1:1 pan
        const panFactor = s.radius * 0.0014;
        const forwardX = -Math.sin(s.theta);
        const forwardZ = -Math.cos(s.theta);
        const rightX = Math.cos(s.theta);
        const rightZ = -Math.sin(s.theta);

        s.targetX -= (rightX * dx - forwardX * dy) * panFactor;
        s.targetZ -= (rightZ * dx - forwardZ * dy) * panFactor;
        syncCameraPositionImmediate();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const s = camStateRef.current;
      const moveDist = Math.hypot(e.clientX - s.downX, e.clientY - s.downY);
      s.isDraggingLeft = false;
      s.isDraggingRight = false;

      // Click raycast
      if (moveDist < 6 && cameraRef.current) {
        const rect = domEl.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, cameraRef.current);

        const activeTargets = clickableMeshesRef.current.filter(m => {
          const f = m.userData.floor || (m.userData.agentId && AGENTS[m.userData.agentId]?.floor);
          return f === currentFloor;
        });

        const hits = raycaster.intersectObjects(activeTargets, false);
        if (hits.length > 0) {
          const hit = hits[0].object.userData;
          if (hit.type === "elevator") {
            setIsElevatorRemoteOpen(true);
          } else if (hit.type === "agent") {
            const ag = AGENTS[hit.agentId];
            if (ag) {
              setSelectedChatTarget(ag.id);
              const ctrl = agentControllersRef.current[ag.id];
              if (ctrl && ctrl.state === "sitting") {
                ctrl.walkToSpot(ag.coffeePos, `${ag.name} • Pha cà phê ☕`, () => {
                  setTimeout(() => ctrl.walkToChairAndWork(`${ag.name} • Sẵn sàng`), 2000);
                });
              }
            }
          }
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = camStateRef.current;
      s.radius = Math.max(13, Math.min(48, s.radius + e.deltaY * 0.018));
      syncCameraPositionImmediate();
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    domEl.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    domEl.addEventListener("wheel", handleWheel, { passive: false });
    domEl.addEventListener("contextmenu", handleContextMenu);

    const handleResize = () => {
      if (!container || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = container.clientWidth / container.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    // 120FPS Animation Loop
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = 0;

    const animate = (now: number) => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const elapsed = now * 0.001;

      frameCount++;
      fpsTimer += dt;
      if (fpsTimer >= 0.5) {
        setFpsValue(Math.round(frameCount / fpsTimer));
        frameCount = 0;
        fpsTimer = 0;
      }

      // Smooth camera elevation when switching floors
      const s = camStateRef.current;
      if (Math.abs(s.targetY - s.goalFloorY) > 0.01) {
        s.targetY += (s.goalFloorY - s.targetY) * Math.min(1, dt * 10);
        syncCameraPositionImmediate();
      }

      // Sliding Elevator Doors
      for (let f = 1; f <= 4; f++) {
        const d = elevatorDoorsRef.current[f];
        if (!d) continue;
        const targetL = d.isOpen ? d.closedLeftX - d.openOffset : d.closedLeftX;
        const targetR = d.isOpen ? d.closedRightX + d.openOffset : d.closedRightX;
        d.left.position.x += (targetL - d.left.position.x) * Math.min(1, dt * 12);
        d.right.position.x += (targetR - d.right.position.x) * Math.min(1, dt * 12);
      }

      // Update Chibi Agents
      if (cameraRef.current) {
        Object.values(agentControllersRef.current).forEach(ctrl => {
          ctrl.update(dt, elapsed, cameraRef.current!.position);
        });
      }

      renderer.render(scene, camera);
    };

    animFrameIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      domEl.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      domEl.removeEventListener("wheel", handleWheel);
      domEl.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    };
  }, [createMesh, drawWallScreenContent, registerFloorMaterial, syncCameraPositionImmediate, updateFloorVisibility]);

  // Update visibility on floor change or ghost toggle
  useEffect(() => {
    updateFloorVisibility(currentFloor, ghostOtherFloors);
  }, [currentFloor, ghostOtherFloors, updateFloorVisibility]);

  // Natural Language Auto-Router
  const routePromptToAgent = useCallback((promptText: string) => {
    if (selectedChatTarget !== "auto" && AGENTS[selectedChatTarget]) {
      return { agent: AGENTS[selectedChatTarget], mode: "Manual" };
    }

    const lower = promptText.toLowerCase();
    let bestAgent = AGENTS.victor;
    let maxScore = 0;

    Object.values(AGENTS).forEach(ag => {
      let score = 0;
      ag.keywords.forEach(kw => {
        if (lower.includes(kw)) score += 2;
      });
      if (score > maxScore) {
        maxScore = score;
        bestAgent = ag;
      }
    });

    return { agent: bestAgent, mode: "Auto-Routed" };
  }, [selectedChatTarget]);

  // Handle Chat Submit
  const handleChatSubmit = async (e?: React.FormEvent, promptOverride?: string) => {
    if (e) e.preventDefault();
    const text = (promptOverride || chatInputText).trim();
    if (!text || isAiResponding) return;
    setChatInputText("");

    const userMsg: ChatItem = {
      id: "u-" + Date.now(),
      role: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setChatMessages(prev => [...prev, userMsg]);
    setIsAiResponding(true);

    const { agent, mode } = routePromptToAgent(text);
    const floorCfg = FLOORS[agent.floor];
    setCurrentRouteNotice(`${mode} → ${agent.name} (${floorCfg.code})`);

    // 1. Elevator to agent floor
    if (currentFloor !== agent.floor) {
      useElevatorToFloor(agent.floor);
    }

    // 2. Chibi agent walks to spot and works
    const ctrl = agentControllersRef.current[agent.id];
    if (ctrl) {
      if (agent.id === "victor" && (text.toLowerCase().includes("slide") || text.toLowerCase().includes("họp"))) {
        ctrl.walkToSpot(agent.loungePos, "Victor • Đang trình chiếu 📊");
      } else {
        ctrl.walkToChairAndWork(`${agent.name} • Đang xử lý prompt...`);
      }
    }

    // 3. Trigger backend task submission if provided
    if (onSubmitTask) {
      try {
        await onSubmitTask(agent.id, text);
      } catch (err) {
        console.warn("Backend task submission note:", err);
      }
    }

    // 4. Generate AI response (Gemini API with intelligent fallback)
    let replyText = "";
    try {
      const activeApiKey = apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
      if (activeApiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeApiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            systemInstruction: {
              parts: [{
                text: `${agent.persona}\nBạn đang làm việc bên trong văn phòng 3D Diorama "My Office" tại tầng ${agent.floor}F (${floorCfg.name}).\nHãy trả lời bằng tiếng Việt tự nhiên, chuyên nghiệp, ngắn gọn (khoảng 3-5 gạch đầu dòng rõ ràng) và đúng chuyên môn của bạn.`
              }]
            }
          })
        });
        if (res.ok) {
          const data = await res.json();
          replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
      }
    } catch (err) {
      console.warn("AI generation note:", err);
    }

    if (!replyText) {
      const fallbacks: Record<string, string> = {
        leo: `💻 [Báo cáo Kỹ thuật từ Leo — Tầng 1F]\n• Đã tiếp nhận và phân tích yêu cầu: "${text}"\n• Tối ưu hiệu năng 120FPS: Đã khóa direct 1:1 camera pointer, loại bỏ Drei DOM overlays và áp dụng CanvasTexture có depth-testing.\n• Trạng thái hệ thống: Toàn bộ cụm Server AI và API endpoints đang hoạt động với độ trễ < 1.2ms.`,
        mina: `📊 [Phân tích Tài chính từ Mina — Tầng 2F]\n• Đã lập mô hình phân bổ dòng tiền cho: "${text}"\n• Dự toán ngân sách đề xuất: 45% R&D Công nghệ, 30% Mở rộng thị trường & Sales, 25% Dự phòng vận hành.\n• Chỉ số hoàn vốn (ROI) kỳ vọng đạt 3.4x trong 2 quý tiếp theo. Đã đồng bộ số liệu lên bảng điện tử tầng 2F!`,
        hana: `🎨 [Đề xuất Thiết kế từ Hana — Tầng 3F]\n• Ý tưởng thiết kế trực quan cho: "${text}"\n• Phong cách chủ đạo: Isometric Cutaway Diorama ấm cúng kết hợp ánh sáng 3200K và đổ bóng mềm PCF.\n• Nhân vật Chibi: Tỷ lệ 1:2 chuẩn Game, cử động bước chân tự nhiên và tư thế ngồi chuẩn xác trên đệm ghế.\n• Đã gắn moodboard tham khảo lên góc làm việc tầng 3F.`,
        victor: `🚀 [Kế hoạch Chiến lược từ Victor — Tầng 4F]\n• Tổng hợp mục tiêu chiến lược: "${text}"\n• Giai đoạn 1: Chuẩn hóa luồng giao tiếp AI tự động qua Smart Auto-Router giữa 4 phòng ban.\n• Giai đoạn 2: Điều phối các Agent Chibi thực thi song song, hiển thị tiến độ trực tiếp lên màn hình Phòng Họp lớn.\n• Lộ trình triển khai đã được lưu trữ vào hệ thống điều hành.`
      };
      replyText = fallbacks[agent.id] || `Đã tiếp nhận yêu cầu: "${text}". Đang xử lý hoàn tất!`;
    }

    // 5. Update 3D Wall Screen with task summary
    const cleanLines = replyText.replace(/[*#`-]/g, "").split("\n").map(s => s.trim()).filter(Boolean);
    drawWallScreenContent(agent.floor, {
      title: `${agent.name.toUpperCase()} (${floorCfg.code}) • LIVE TASK OUTPUT`,
      line1: (cleanLines[0] || text).slice(0, 46),
      line2: (cleanLines[1] || "Đã cập nhật dữ liệu trực tiếp lên bảng").slice(0, 46),
      line3: (cleanLines[2] || "Trạng thái: Hoàn tất 100%").slice(0, 46),
      accent: floorCfg.themeColor
    });

    if (ctrl) {
      ctrl.updateStatusText(`${agent.name} • Đã trả lời xong ✓`, "#34d399");
    }

    const assistantMsg: ChatItem = {
      id: "a-" + Date.now(),
      role: "assistant",
      text: replyText,
      agent,
      floorCfg,
      mode,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setChatMessages(prev => [...prev, assistantMsg]);
    setIsAiResponding(false);
    setCurrentRouteNotice(null);
  };

  const resetCameraView = () => {
    const s = camStateRef.current;
    s.theta = Math.PI / 4;
    s.phi = Math.PI / 3.1;
    s.radius = 26;
    s.targetX = 0;
    s.targetZ = 0;
    syncCameraPositionImmediate();
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-[#0b1120]">
      {/* 3D Canvas Diorama Container */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* TOP GLASS NAVIGATION HUD */}
      <header className="fixed top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Brand & Floor Title */}
        <div className="glass-panel bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-2.5 flex items-center gap-3.5 pointer-events-auto shadow-2xl">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 text-slate-950 font-extrabold text-lg">
            🏢
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm sm:text-base tracking-tight text-white">MY OFFICE 3D</h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {fpsValue} FPS
              </span>
            </div>
            <p className="text-xs text-amber-300 font-medium">
              Tầng {currentFloor} ({FLOORS[currentFloor]?.code}) • {FLOORS[currentFloor]?.name}
            </p>
          </div>

          <div className="h-7 w-[1px] bg-slate-700/80 hidden sm:block"></div>

          {/* Quick Floor Selection Pills */}
          <div className="hidden md:flex items-center gap-1.5">
            {[1, 2, 3, 4].map(f => {
              const cfg = FLOORS[f];
              const isCurrent = f === currentFloor;
              return (
                <button
                  key={f}
                  onClick={() => useElevatorToFloor(f)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isCurrent
                      ? "bg-amber-500 text-slate-950 shadow"
                      : "bg-slate-800/90 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {cfg.code} {cfg.name.split("&")[0].trim()}
                </button>
              );
            })}
          </div>
        </div>

        {/* View, Ghost & Elevator Action Buttons */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Ghost Mode Toggle */}
          <button
            onClick={() => setGhostOtherFloors(prev => !prev)}
            className="bg-slate-900/85 hover:bg-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center gap-2 transition shadow-lg border border-slate-700/80 backdrop-blur-md text-slate-200"
            title="Chuyển chế độ làm mờ 8% hoặc ẩn hoàn toàn các tầng khác"
          >
            {ghostOtherFloors ? <Eye className="w-4 h-4 text-sky-400" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
            <span className="hidden sm:inline">
              {ghostOtherFloors ? "Tầng khác: Làm mờ 8%" : "Tầng khác: Ẩn 100%"}
            </span>
          </button>

          {/* Elevator Remote Trigger */}
          <button
            onClick={() => setIsElevatorRemoteOpen(prev => !prev)}
            className="relative bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs sm:text-sm px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-xl shadow-orange-500/20 transition transform active:scale-95"
          >
            <span>🛗</span>
            <span>Thang Máy</span>
            <span className="font-mono bg-slate-950 text-amber-400 px-1.5 py-0.5 rounded text-xs">
              {FLOORS[currentFloor]?.code}
            </span>
          </button>

          {/* Reset Camera */}
          <button
            onClick={resetCameraView}
            className="bg-slate-900/85 hover:bg-slate-800 text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center gap-1.5 transition shadow-lg border border-slate-700/80 backdrop-blur-md text-slate-200"
            title="Đặt lại góc nhìn chuẩn Isometric"
          >
            <Compass className="w-4 h-4 text-amber-400" />
            <span className="hidden lg:inline">Góc chuẩn</span>
          </button>
        </div>
      </header>

      {/* BOTTOM LEFT: AGENT ROSTER DOCK */}
      <div className="fixed bottom-3 left-3 z-20 flex flex-col gap-2 pointer-events-none max-w-[340px]">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-3 pointer-events-auto shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Nhân sự Chibi văn phòng
            </span>
            <span className="text-[11px] text-emerald-400 font-medium">● 4 Trực tuyến</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.values(AGENTS).map(ag => {
              const isHere = ag.floor === currentFloor;
              return (
                <button
                  key={ag.id}
                  onClick={() => {
                    useElevatorToFloor(ag.floor);
                    setSelectedChatTarget(ag.id);
                  }}
                  className={`flex items-center justify-between p-2 rounded-xl border text-left transition ${
                    isHere
                      ? "bg-slate-800/95 border-amber-400/60 text-white"
                      : "bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/60"
                  }`}
                >
                  <div className="truncate pr-1">
                    <div className="text-xs font-bold text-white flex items-center gap-1">
                      <span>{ag.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-700 text-amber-300 font-mono">
                        {ag.floor}F
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{ag.role.split("&")[0]}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-800/90 flex items-center justify-between text-[11px] text-slate-400">
            <span>🖱️ Kéo trái: Xoay 1:1 • Kéo phải: Di chuyển</span>
            <span>🔍 Cuộn: Zoom</span>
          </div>
        </div>
      </div>

      {/* ELEVATOR REMOTE KEYPAD MODAL */}
      {isElevatorRemoteOpen && (
        <div className="fixed left-4 top-20 z-30 pointer-events-auto transition-all duration-200">
          <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-2 border-slate-600/60 rounded-3xl p-4 w-68 text-slate-100 shadow-2xl backdrop-blur-xl">
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-700/80">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                <span className="text-xs font-extrabold tracking-widest uppercase text-slate-300">
                  ELEVATOR CONTROL
                </span>
              </div>
              <button
                onClick={() => setIsElevatorRemoteOpen(false)}
                className="text-slate-400 hover:text-white w-6 h-6 rounded-lg bg-slate-800/80 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            {/* 7-Segment LED Display */}
            <div className="bg-[#050811] border border-slate-700 rounded-2xl p-3 mb-3.5 flex items-center justify-between shadow-inner">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">TẦNG HIỆN TẠI</div>
                <div className="text-xs text-amber-300 font-medium mt-0.5">{elevatorStatusText}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-amber-400 font-mono text-lg font-bold">{elevatorDirArrow}</span>
                <span className="font-mono text-3xl font-extrabold text-amber-400 tracking-wider">
                  {FLOORS[currentFloor]?.code}
                </span>
              </div>
            </div>

            {/* Floor Selection Buttons */}
            <div className="space-y-2 mb-3.5">
              {[4, 3, 2, 1].map(f => {
                const cfg = FLOORS[f];
                const isSelected = f === currentFloor;
                return (
                  <button
                    key={f}
                    onClick={() => useElevatorToFloor(f)}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-600/60 transition group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`w-8 h-8 rounded-full bg-slate-900 border-2 flex items-center justify-center font-mono font-extrabold text-sm ${
                        isSelected ? "border-amber-400 text-amber-400" : "border-slate-500 text-white group-hover:border-amber-400"
                      }`}>
                        {f}
                      </span>
                      <div className="text-left">
                        <div className="text-xs font-bold text-white">{cfg.name}</div>
                        <div className="text-[10px] text-slate-400">{cfg.enName}</div>
                      </div>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full ${isSelected ? "bg-amber-400 shadow-[0_0_8px_#fbbf24]" : "bg-slate-600"}`}></span>
                  </button>
                );
              })}
            </div>

            {/* Door Controls */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/80">
              <button
                onClick={() => triggerElevatorDoors(true, currentFloor)}
                className="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-600/50"
              >
                <span>◀|▶</span> Mở Cửa
              </button>
              <button
                onClick={() => triggerElevatorDoors(false, currentFloor)}
                className="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-600/50"
              >
                <span>▶|◀</span> Đóng Cửa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHATGPT-STYLE SMART AUTO-ROUTING CHAT DRAWER */}
      {isChatOpen ? (
        <aside className="fixed right-3 bottom-3 top-20 z-20 w-[92vw] sm:w-[410px] flex flex-col bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden pointer-events-auto transition-transform duration-300">
          {/* Drawer Header */}
          <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shadow">
                ✨
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-bold text-sm text-white">AI Office Smart Chat</h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                    Auto-Router
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">Tự động nhận diện công việc & gọi đúng Chibi</p>
              </div>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 text-xs font-semibold"
            >
              Thu gọn
            </button>
          </div>

          {/* Mode Selector */}
          <div className="px-3 py-2 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-1 overflow-x-auto">
            <button
              onClick={() => setSelectedChatTarget("auto")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition ${
                selectedChatTarget === "auto" ? "bg-indigo-600 text-white shadow" : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              ⚡ Tự động nhận diện
            </button>
            <button
              onClick={() => setSelectedChatTarget("leo")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition ${
                selectedChatTarget === "leo" ? "bg-indigo-600 text-white shadow" : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              💻 Leo (1F Code)
            </button>
            <button
              onClick={() => setSelectedChatTarget("mina")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition ${
                selectedChatTarget === "mina" ? "bg-indigo-600 text-white shadow" : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              📊 Mina (2F Tài chính)
            </button>
            <button
              onClick={() => setSelectedChatTarget("hana")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition ${
                selectedChatTarget === "hana" ? "bg-indigo-600 text-white shadow" : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              🎨 Hana (3F Thiết kế)
            </button>
            <button
              onClick={() => setSelectedChatTarget("victor")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition ${
                selectedChatTarget === "victor" ? "bg-indigo-600 text-white shadow" : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              🚀 Victor (4F Họp)
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {chatMessages.map(msg => (
              <div
                key={msg.id}
                className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                {msg.role === "user" ? (
                  <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-xs sm:text-sm shadow">
                    {msg.text}
                  </div>
                ) : (
                  <div className="max-w-[95%] bg-slate-900/95 border border-slate-700/80 rounded-2xl rounded-bl-sm p-3 text-xs space-y-2 shadow-lg">
                    {msg.agent && msg.floorCfg && (
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono font-bold text-[10px]">
                            ⚡ {msg.mode}: {msg.agent.name} • {msg.floorCfg.code}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-300">{msg.agent.role}</span>
                        </div>
                        <button
                          onClick={() => useElevatorToFloor(msg.agent!.floor)}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold shrink-0"
                        >
                          🛗 Tới {msg.floorCfg.code}
                        </button>
                      </div>
                    )}
                    <div className="text-xs sm:text-[13px] leading-relaxed text-slate-100 whitespace-pre-line">
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* In-Flight Typing Bubble */}
            {isAiResponding && currentRouteNotice && (
              <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl rounded-bl-sm p-3 text-xs space-y-2 shadow-lg">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800">
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono font-bold text-[10px]">
                    ⚡ {currentRouteNotice}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-300 py-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  <span>Chuyên gia Chibi đang xử lý câu trả lời...</span>
                </div>
              </div>
            )}
          </div>

          {/* Quick Prompt Chips */}
          <div className="px-3 py-2 bg-slate-950/50 border-t border-slate-800/80 flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => {
                handleChatSubmit(undefined, "Lập bảng dự toán ngân sách Q4 và tính ROI cho dự án AI");
              }}
              className="shrink-0 text-[11px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full transition"
            >
              📊 Tính ngân sách & ROI (2F)
            </button>
            <button
              onClick={() => {
                handleChatSubmit(undefined, "Tối ưu hiệu năng WebGL Three.js đạt 120FPS và sửa lỗi database");
              }}
              className="shrink-0 text-[11px] bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 px-2.5 py-1 rounded-full transition"
            >
              💻 Tối ưu code 120FPS (1F)
            </button>
            <button
              onClick={() => {
                handleChatSubmit(undefined, "Thiết kế bộ nhận diện thương hiệu và giao diện game Chibi ấm cúng");
              }}
              className="shrink-0 text-[11px] bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 border border-pink-500/30 px-2.5 py-1 rounded-full transition"
            >
              🎨 Thiết kế UI/UX (3F)
            </button>
            <button
              onClick={() => {
                handleChatSubmit(undefined, "Chuẩn bị slide thuyết trình gọi vốn vòng Seed trên màn hình phòng họp");
              }}
              className="shrink-0 text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full transition"
            >
              🚀 Họp chiến lược (4F)
            </button>
          </div>

          {/* Input Box */}
          <form
            onSubmit={handleChatSubmit}
            className="p-3 bg-slate-950/95 border-t border-slate-800 flex items-end gap-2"
          >
            <textarea
              value={chatInputText}
              onChange={e => setChatInputText(e.target.value)}
              rows={2}
              placeholder="Nhắn tin với AI... (VD: 'Tính ngân sách Q4', 'Tối ưu code 120FPS', 'Vẽ Chibi 3D')"
              className="flex-1 bg-slate-900 text-white placeholder-slate-500 text-xs sm:text-sm rounded-2xl px-3.5 py-2.5 border border-slate-700/80 focus:outline-none focus:border-indigo-500 resize-none"
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSubmit();
                }
              }}
            />
            <button
              type="submit"
              disabled={isAiResponding || !chatInputText.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold px-4 py-3 rounded-2xl text-xs transition shadow-lg shadow-indigo-600/30 shrink-0"
            >
              Gửi ➤
            </button>
          </form>
        </aside>
      ) : (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed right-4 bottom-4 z-20 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 pointer-events-auto hover:opacity-95 transition"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="text-sm">Mở Chat AI (Auto-Router)</span>
        </button>
      )}
    </div>
  );
}

