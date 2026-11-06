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
  Layers,
  UserPlus,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Bot,
  FileText,
  CheckCircle2,
  Clock,
  ArrowRight,
  Shield,
  Code,
  DollarSign,
  Palette,
  TrendingUp,
  Camera,
  Search,
  SlidersHorizontal,
  Monitor,
  Users,
  Cpu,
  Laptop,
  Terminal,
  ExternalLink,
  Settings,
  History,
  Check,
  X,
  CreditCard,
} from "lucide-react";
import { ensureAuthenticatedSession, getAuthToken } from "@/lib/api/client";
import { useWorldStore } from "@/store/worldStore";
import { DIVISION_FLOOR_MAPPING, DIVISION_POD_CENTERS, POD_SEAT_OFFSETS, getFloorForDivision, getDivisionWorkstation, resolveDivisionKey } from "@/lib/office/departmentFloorMapping";
import { getAgents } from "@/lib/api/agents";
import { FormattedChatMessage } from "../chat/FormattedChatMessage";
import { stripMarkdownForSpeechBubble } from "@/lib/formatters/cleanChatText";
import { ExecutiveTreasuryModal } from "../monetization/ExecutiveTreasuryModal";
import {
  BUILDING_DIMENSIONS,
  CENTRAL_BUILDING_FLOORS,
  VERTICAL_CORE,
  MASTER_CORRIDOR_NAV_NODES,
  getOfficeRoomsForFloor,
  FLOOR_G_ROOMS,
  FLOOR_7_ROOMS,
  BuildingFloorConfig,
  ArchitecturalRoom,
} from "@/lib/office/buildingArchitecture";

export const DIVISION_THEME_COLORS: Record<string, number> = {
  operations: 0x0284c7, support: 0x0ea5e9, healthcare: 0x10b981,
  finance: 0x34d399, specialized: 0x059669,
  marketing: 0xf472b6, "paid-media": 0xec4899, sales: 0xfb7185,
  design: 0xa855f7, product: 0x8b5cf6, "project-management": 0xa78bfa,
  "game-development": 0xd946ef, "spatial-computing": 0xc084fc,
  engineering: 0x0369a1, security: 0xef4444, testing: 0xf59e0b, gis: 0x06b6d4,
  executive: 0xd97706, research: 0x7c3aed, academic: 0xd97706,
};

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  division: string;
  floor: number;
  badgeColor: string;
  shirtColor: number;
  hairColor: number;
  skinColor: number;
  accessory: "headphones" | "glasses" | "beret" | "crown" | "badge";
  deskPos: { x: number; z: number };
  chairPos: { x: number; z: number; rotY: number };
  loungePos: { x: number; z: number; rotY: number };
  coffeePos: { x: number; z: number; rotY: number };
  keywords: string[];
  persona: string;
}

export type FloorConfig = BuildingFloorConfig;

// CENTRAL BUILDING DIMENSIONS (W = 54m, D = 38m, H = 8.5m per level)
const FLOOR_HEIGHT = BUILDING_DIMENSIONS.floorHeight;
const ROOM_W = BUILDING_DIMENSIONS.width;
const ROOM_D = BUILDING_DIMENSIONS.depth;

// --- CENTRALIZED ENVIRONMENT-INTERACTION REGISTRY & AABB COLLISION SYSTEM ---
export interface InteractionPoint {
  id: string;
  floor: number;
  type: "coffee" | "water" | "billiards" | "gaming" | "snack" | "chatting" | "restroom" | "bookshelf" | "lounge" | "reception" | "bowling" | "swimming" | "arcade" | "focus";
  spot: { x: number; z: number; rotY: number };
  approachPos: { x: number; z: number };
  label: string;
  activeMsg: string;
  propType?: "cup" | "cue" | "none";
}

export interface ObstacleAABB {
  id: string;
  floor: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  label?: string;
}

export class FloorEnvironmentRegistry {
  private interactions: Map<number, InteractionPoint[]> = new Map();

  registerInteraction(point: InteractionPoint) {
    const list = this.interactions.get(point.floor) || [];
    const filtered = list.filter(p => p.id !== point.id);
    filtered.push(point);
    this.interactions.set(point.floor, filtered);
  }

  removeInteraction(floor: number, pointId: string) {
    const list = this.interactions.get(floor) || [];
    this.interactions.set(floor, list.filter(p => p.id !== pointId));
  }

  clearFloor(floor: number) {
    this.interactions.set(floor, []);
  }

  getInteractions(floor: number): InteractionPoint[] {
    return this.interactions.get(floor) || [];
  }

  isActivityAvailable(floor: number, activityType: string): boolean {
    const list = this.getInteractions(floor);
    return list.some(p => p.type === activityType);
  }

  getRandomAvailable(floor: number): InteractionPoint | null {
    const list = this.getInteractions(floor);
    if (list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  getPointForActivity(floor: number, activityType: string): InteractionPoint | null {
    const list = this.getInteractions(floor);
    const matches = list.filter(p => p.type === activityType);
    if (matches.length === 0) return null;
    return matches[Math.floor(Math.random() * matches.length)];
  }
}

export class AABBCollisionSystem {
  private obstacles: Map<number, ObstacleAABB[]> = new Map();

  registerObstacle(obstacle: ObstacleAABB) {
    const list = this.obstacles.get(obstacle.floor) || [];
    const filtered = list.filter(o => o.id !== obstacle.id);
    filtered.push(obstacle);
    this.obstacles.set(obstacle.floor, filtered);
  }

  clearFloor(floor: number) {
    this.obstacles.set(floor, []);
  }

  getObstacles(floor: number): ObstacleAABB[] {
    return this.obstacles.get(floor) || [];
  }

  isPointBlocked(floor: number, x: number, z: number, padding: number = 0.3): boolean {
    const list = this.obstacles.get(floor) || [];
    for (let i = 0; i < list.length; i++) {
      const ob = list[i];
      if (
        x >= ob.minX - padding &&
        x <= ob.maxX + padding &&
        z >= ob.minZ - padding &&
        z <= ob.maxZ + padding
      ) {
        return true;
      }
    }
    return false;
  }

  isSegmentBlocked(floor: number, p1: { x: number; z: number }, p2: { x: number; z: number }, padding: number = 0.25): boolean {
    const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    if (dist < 0.1) return this.isPointBlocked(floor, p1.x, p1.z, padding);
    const steps = Math.ceil(dist / 0.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = p1.x + (p2.x - p1.x) * t;
      const z = p1.z + (p2.z - p1.z) * t;
      if (this.isPointBlocked(floor, x, z, padding)) {
        return true;
      }
    }
    return false;
  }
}

export interface CorridorNode {
  id: string;
  x: number;
  z: number;
  neighbors: string[];
}

export const CORRIDOR_NAV_NODES = MASTER_CORRIDOR_NAV_NODES;

export function generateWalkablePath(
  floor: number,
  start: { x: number; z: number },
  target: { x: number; z: number },
  startChairPos?: { x: number; z: number; rotY: number },
  collisionSys?: AABBCollisionSystem
): Array<{ x: number; z: number }> {
  const result: Array<{ x: number; z: number }> = [];

  // 1. Initial Step: If starting seated at a chair, step out into the unobstructed aisle
  let currentPos = { ...start };
  if (startChairPos) {
    const chairAisleZ = startChairPos.z > 0 ? startChairPos.z + 1.15 : startChairPos.z - 1.15;
    const stepOut = { x: startChairPos.x, z: chairAisleZ };
    result.push(stepOut);
    currentPos = stepOut;
  }

  // 2. Direct Line-of-Sight Check: If short distance and completely unblocked, go direct
  const directDist = Math.hypot(target.x - currentPos.x, target.z - currentPos.z);
  if (directDist < 3.0 && collisionSys && !collisionSys.isSegmentBlocked(floor, currentPos, target)) {
    result.push({ x: target.x, z: target.z });
    return result;
  }

  // 3. Find closest navigation nodes in CORRIDOR_NAV_NODES
  const nodeMap = new Map<string, CorridorNode>();
  for (const n of CORRIDOR_NAV_NODES) {
    nodeMap.set(n.id, n);
  }

  let startNode: CorridorNode | null = null;
  let startDist = Infinity;
  let targetNode: CorridorNode | null = null;
  let targetDist = Infinity;

  for (const n of CORRIDOR_NAV_NODES) {
    const dS = Math.hypot(n.x - currentPos.x, n.z - currentPos.z);
    if (dS < startDist) {
      startDist = dS;
      startNode = n;
    }
    const dT = Math.hypot(n.x - target.x, n.z - target.z);
    if (dT < targetDist) {
      targetDist = dT;
      targetNode = n;
    }
  }

  if (!startNode || !targetNode) {
    result.push({ x: target.x, z: target.z });
    return result;
  }

  const sNode: CorridorNode = startNode;
  const tNode: CorridorNode = targetNode;

  // 4. BFS Shortest Path on Nav Graph
  if (sNode.id === tNode.id) {
    result.push({ x: sNode.x, z: sNode.z });
  } else {
    const queue: string[] = [sNode.id];
    const visited = new Set<string>([sNode.id]);
    const parent = new Map<string, string>();

    let found = false;
    while (queue.length > 0) {
      const curId = queue.shift()!;
      if (curId === tNode.id) {
        found = true;
        break;
      }
      const cur = nodeMap.get(curId);
      if (!cur) continue;
      for (const nbrId of cur.neighbors) {
        if (!visited.has(nbrId)) {
          visited.add(nbrId);
          parent.set(nbrId, curId);
          queue.push(nbrId);
        }
      }
    }

    if (found) {
      const path: CorridorNode[] = [];
      let trace: string | undefined = tNode.id;
      while (trace) {
        const n = nodeMap.get(trace);
        if (n) path.unshift(n);
        trace = parent.get(trace);
      }
      path.forEach(n => result.push({ x: n.x, z: n.z }));
    } else {
      result.push({ x: sNode.x, z: sNode.z });
      result.push({ x: tNode.x, z: tNode.z });
    }
  }

  // 5. Final Step: Destination approach position
  result.push({ x: target.x, z: target.z });

  // 6. Collinear Simplification
  const simplified: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < result.length; i++) {
    const p = result[i];
    if (simplified.length >= 2) {
      const pPrev = simplified[simplified.length - 1];
      const pPrev2 = simplified[simplified.length - 2];
      // Check if collinear along X or Z
      if (
        (Math.abs(p.x - pPrev.x) < 0.05 && Math.abs(pPrev.x - pPrev2.x) < 0.05) ||
        (Math.abs(p.z - pPrev.z) < 0.05 && Math.abs(pPrev.z - pPrev2.z) < 0.05)
      ) {
        simplified[simplified.length - 1] = p; // replace intermediate
        continue;
      }
    }
    simplified.push(p);
  }

  return simplified;
}

export const FLOORS: Record<number, FloorConfig> = CENTRAL_BUILDING_FLOORS;

export const CANONICAL_AGENTS: Record<string, AgentConfig> = {
  // 1F
  "agent-ops-recruiter": {
    id: "agent-ops-recruiter",
    name: "Amara",
    role: "Head of Operations & Recruiting",
    division: "operations",
    floor: 1,
    badgeColor: "sky",
    shirtColor: 0x0284c7,
    hairColor: 0x1e293b,
    skinColor: 0xffedd5,
    accessory: "badge",
    deskPos: { x: -14.9, z: -6.6 },
    chairPos: { x: -14.9, z: -7.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["tuyển", "recruit", "nhân sự", "onboard", "vận hành", "bàn", "chỗ ngồi", "hồ sơ"],
    persona: "Bạn là Amara (Trưởng Ban Vận Hành & Tuyển Dụng Tầng 1F). Trả lời nhiệt tình, chuyên nghiệp về quy trình nhân sự và phân bổ vị trí."
  },
  "agent-support-lead": {
    id: "agent-support-lead",
    name: "Liam",
    role: "Customer Success & Support Lead",
    division: "support",
    floor: 1,
    badgeColor: "sky",
    shirtColor: 0x0ea5e9,
    hairColor: 0x334155,
    skinColor: 0xffe4e6,
    accessory: "headphones",
    deskPos: { x: -6.9, z: -6.6 },
    chairPos: { x: -6.9, z: -7.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["support", "hỗ trợ", "ticket", "khách hàng", "khiếu nại", "giải đáp", "faq"],
    persona: "Bạn là Liam (Trưởng bộ phận Chăm sóc Khách hàng Tầng 1F). Trả lời chu đáo, kiên nhẫn và tận tâm."
  },

  // 2F
  "agent-fin-controller": {
    id: "agent-fin-controller",
    name: "Julian",
    role: "Financial Controller & Treasury",
    division: "finance",
    floor: 2,
    badgeColor: "emerald",
    shirtColor: 0x059669,
    hairColor: 0x451a03,
    skinColor: 0xffedd5,
    accessory: "glasses",
    deskPos: { x: -14.9, z: -6.6 },
    chairPos: { x: -14.9, z: -7.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["tài chính", "tiền", "lương", "ngân sách", "budget", "roi", "kpi", "doanh thu", "chi phí", "thuế", "kế toán"],
    persona: "Bạn là Julian (Giám đốc Kiểm soát Tài chính Tầng 2F). Trả lời sắc bén với số liệu tài chính, ngân sách và ROI."
  },

  // 3F
  "agent-mkt-growth": {
    id: "agent-mkt-growth",
    name: "Sophia",
    role: "Head of Marketing & Growth",
    division: "marketing",
    floor: 3,
    badgeColor: "pink",
    shirtColor: 0xdb2777,
    hairColor: 0xca8a04,
    skinColor: 0xffedd5,
    accessory: "beret",
    deskPos: { x: -16.9, z: -7.6 },
    chairPos: { x: -16.9, z: -8.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["marketing", "tiếp thị", "growth", "seo", "quảng cáo", "traffic", "nội dung", "campaign", "social"],
    persona: "Bạn là Sophia (Trưởng Ban Marketing & Tăng Trưởng Tầng 3F). Trả lời năng động, truyền cảm hứng về chiến lược thu hút người dùng."
  },
  "agent-sales-director": {
    id: "agent-sales-director",
    name: "Marcus",
    role: "Director of Enterprise Sales",
    division: "sales",
    floor: 3,
    badgeColor: "pink",
    shirtColor: 0xbe185d,
    hairColor: 0x1e293b,
    skinColor: 0xfde68a,
    accessory: "glasses",
    deskPos: { x: -10.9, z: -7.6 },
    chairPos: { x: -10.9, z: -8.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["sales", "bán hàng", "hợp đồng", "deal", "khách hàng lớn", "doanh thu", "đối tác", "crm"],
    persona: "Bạn là Marcus (Giám đốc Kinh Doanh Doanh Nghiệp Tầng 3F). Trả lời quyết đoán, tập trung chốt hợp đồng và mở rộng doanh thu."
  },

  // 4F
  "agent-design-lead": {
    id: "agent-design-lead",
    name: "Hana",
    role: "Creative & UI/UX Art Director",
    division: "design",
    floor: 4,
    badgeColor: "purple",
    shirtColor: 0x9333ea,
    hairColor: 0xfbbf24,
    skinColor: 0xffedd5,
    accessory: "beret",
    deskPos: { x: -16.9, z: -8.6 },
    chairPos: { x: -16.9, z: -9.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["thiết kế", "design", "ui", "ux", "giao diện", "màu", "vẽ", "chibi", "3d", "art", "game", "spatial", "vr"],
    persona: "Bạn là Hana (Giám đốc Sáng tạo & Thiết kế Tầng 4F). Trả lời giàu thẩm mỹ về UI/UX, màu sắc, phong cách game và không gian 3D."
  },

  // 5F
  "agent-eng-lead": {
    id: "agent-eng-lead",
    name: "David Chen",
    role: "Principal Systems Architect & Eng Lead",
    division: "engineering",
    floor: 5,
    badgeColor: "sky",
    shirtColor: 0x0369a1,
    hairColor: 0x1e293b,
    skinColor: 0xffedd5,
    accessory: "headphones",
    deskPos: { x: -20.9, z: -11.6 },
    chairPos: { x: -20.9, z: -12.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["code", "bug", "lỗi", "lag", "fps", "three", "react", "api", "server", "database", "sql", "kỹ thuật", "microservice", "rest", "graphql", "docker", "bảo mật", "soc", "security"],
    persona: "Bạn là David Chen (Kỹ sư trưởng Hệ thống & Kiến trúc phần mềm Tầng 5F). Trả lời chuyên sâu, chuẩn xác về lập trình, sửa bug và tối ưu hiệu năng."
  },

  // 6F
  "agent-exec-ceo": {
    id: "agent-exec-ceo",
    name: "Victoria Vance",
    role: "Chief Executive Officer",
    division: "executive",
    floor: 6,
    badgeColor: "amber",
    shirtColor: 0xd97706,
    hairColor: 0x334155,
    skinColor: 0xfde68a,
    accessory: "crown",
    deskPos: { x: -14.0, z: 0.0 },
    chairPos: { x: -14.0, z: 1.5, rotY: Math.PI },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["chiến lược", "ceo", "lãnh đạo", "tầm nhìn", "ban giám đốc", "hội đồng", "toàn thể", "mục tiêu", "roadmap", "họp"],
    persona: "Bạn là Victoria Vance (Tổng Giám Đốc Điều Hành Tầng 6F). Trả lời đĩnh đạc, tầm nhìn chiến lược vĩ mô và chỉ đạo rõ ràng."
  },
  "agent-research-ai": {
    id: "agent-research-ai",
    name: "Dr. Elena Rostova",
    role: "AI Research Scientist",
    division: "research",
    floor: 6,
    badgeColor: "purple",
    shirtColor: 0x7c3aed,
    hairColor: 0x64748b,
    skinColor: 0xffedd5,
    accessory: "glasses",
    deskPos: { x: -4.9, z: -6.6 },
    chairPos: { x: -4.9, z: -7.25, rotY: 0 },
    loungePos: { x: 0.0, z: -1.2, rotY: 0 },
    coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
    keywords: ["ai", "mô hình", "llm", "rag", "transformer", "neural", "deep learning", "nghiên cứu", "học máy"],
    persona: "Bạn là Tiến sĩ Elena Rostova (Nhà Khoa Học Nghiên Cứu AI Tầng 6F). Trả lời học thuật, uyên bác về các mô hình ngôn ngữ lớn và trí tuệ nhân tạo."
  }
};

export type GhostMode = "DARKENED_GHOST" | "NORMAL" | "ISOLATED";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  thought?: string;
  taskId?: string;
  taskStatus?: string;
  agentName?: string;
  agentRole?: string;
  division?: string;
  agentId?: string;
  floorCfg?: FloorConfig;
  mode?: string;
  timestamp: string;
}

interface MyOfficeDioramaProps {
  onSubmitTask?: (agentId: string, promptText: string) => Promise<any>;
  apiKey?: string;
  backendStatus?: string;
}

export default function MyOfficeDiorama({
  onSubmitTask,
  apiKey = "",
  backendStatus = "connected"
}: MyOfficeDioramaProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Application State
  const [currentFloor, setCurrentFloor] = useState<number>(5); // Default to Engineering F5
  const [ghostMode, setGhostMode] = useState<GhostMode>("DARKENED_GHOST");
  const [chatExecutionMode, setChatExecutionMode] = useState<"conversation" | "task">("conversation");
  const [isElevatorRemoteOpen, setIsElevatorRemoteOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(true);
  const [selectedChatTarget, setSelectedChatTarget] = useState<string>("auto");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);

  // Claude Code "My Office" UI State (Matching Reference Design)
  const [isLeftSessionsOpen, setIsLeftSessionsOpen] = useState<boolean>(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(false);
  const [rightPanelTab, setRightPanelTab] = useState<"timeline" | "chat" | "collab">("chat");
  const [isTreasuryOpen, setIsTreasuryOpen] = useState<boolean>(false);
  const [collabMessages, setCollabMessages] = useState<Array<{
    id: string;
    sender: string;
    senderRole: string;
    recipient: string;
    recipientRole: string;
    topic: string;
    dialogueA: string;
    dialogueB: string;
    time: string;
    floorCode: string;
    deliverableStatus: string;
  }>>([
    {
      id: "collab-1",
      sender: "David Chen",
      senderRole: "Principal Systems Architect",
      recipient: "Sophia Martinez",
      recipientRole: "Cloud Security Engineer",
      topic: "Tối ưu hóa Microservices & Zero-Trust",
      dialogueA: "Đã tối ưu hóa API Gateway và nén payload, độ trễ hiện tại chỉ 24ms.",
      dialogueB: "Tuyệt vời, tôi đã kiểm tra chính sách bảo mật Zero-Trust và xác thực JWT hợp lệ.",
      time: "10:42",
      floorCode: "5F",
      deliverableStatus: "✓ Đã thông qua kiểm thử bảo mật & tải cao"
    },
    {
      id: "collab-2",
      sender: "Elena Rostova",
      senderRole: "Chief AI Scientist",
      recipient: "Marcus Vance",
      recipientRole: "Database & Storage Architect",
      topic: "Bộ Nhớ Ngữ Cảnh & SQLite WAL Mode",
      dialogueA: "Cơ chế hybrid cache hoạt động rất mượt mà trên bộ dữ liệu kiểm thử.",
      dialogueB: "SQLite WAL mode đang duy trì độ trễ đọc 1.2ms, không phát hiện xung đột khóa ghi.",
      time: "10:45",
      floorCode: "4F",
      deliverableStatus: "✓ Hiệu năng lưu trữ đạt chuẩn SLA"
    },
    {
      id: "collab-3",
      sender: "Liam Nguyen",
      senderRole: "Lead UI/UX Designer",
      recipient: "Chloe Kim",
      recipientRole: "Product Strategy Lead",
      topic: "Thiết Kế Obsidian & Vàng Champagne",
      dialogueA: "Bản mock-up Obsidian Glass kết hợp vàng Champagne đã sẵn sàng cho bản phát hành.",
      dialogueB: "Phong cách này rất sang trọng và đúng định vị cao cấp, hãy hoàn tất tài liệu bàn giao.",
      time: "10:48",
      floorCode: "3F",
      deliverableStatus: "✓ Thiết kế UI đã được phê duyệt"
    }
  ]);
  const [sessionFilter, setSessionFilter] = useState<"all" | "working" | "pending" | "resting">("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "attention" | "command" | "edit" | "read" | "web">("all");
  const [searchSessionQuery, setSearchSessionQuery] = useState<string>("");
  const [activePresetView, setActivePresetView] = useState<"overview" | "desks" | "boardroom" | "servers" | "avatar">("overview");
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // Active Work Sessions (Claude Code Live Sessions)
  const [sessions, setSessions] = useState([
    {
      id: "shop-api",
      name: "shop-api",
      status: "pending" as const,
      time: "chờ 1 phút",
      title: "Chờ duyệt: Chạy terraform apply",
      agentId: "agent-eng-lead",
      floor: 5,
      tag: "⚠️ Cần duyệt"
    },
    {
      id: "infra",
      name: "infra",
      status: "pending" as const,
      time: "chờ 1 phút",
      title: "Chờ duyệt: Cài thư viện zod",
      agentId: "Software Architect",
      floor: 5,
      tag: "⚠️ Cần duyệt"
    },
    {
      id: "landing-page",
      name: "landing-page",
      status: "working" as const,
      time: "0:19",
      title: "Build thử Next.js",
      agentId: "agent-design-lead",
      floor: 4,
      tag: "🛠️ Đang làm"
    },
    {
      id: "data-pipeline",
      name: "data-pipeline",
      status: "working" as const,
      time: "0:19",
      title: "Tra web 'pandas drop_duplicates subset'",
      agentId: "GIS 3D Scene Developer",
      floor: 5,
      tag: "🔍 Đang làm"
    },
    {
      id: "mobile-app",
      name: "mobile-app",
      status: "working" as const,
      time: "0:06",
      title: "Nhận việc: 'Sửa lỗi bàn phím che ô nhập'",
      agentId: "Mobile App Builder",
      floor: 5,
      tag: "⚙️ Đang làm"
    },
    {
      id: "docs-site",
      name: "docs-site",
      status: "resting" as const,
      time: "1 phút",
      title: "Vừa xong việc, đi pha cà phê",
      agentId: "agent-support-lead",
      floor: 1,
      tag: "☕ Đang nghỉ"
    }
  ]);

  // Real-Time Live Activity Stream
  const [activityStream] = useState([
    { id: "act-1", session: "landing-page", status: "working", time: "23:45", type: "command", text: "Build thử Next.js", icon: "🛠️" },
    { id: "act-2", session: "mobile-app", status: "working", time: "23:45", type: "command", text: "Nhận việc: 'Sửa lỗi bàn phím che ô nhập'", icon: "⚙️" },
    { id: "act-3", session: "data-pipeline", status: "working", time: "23:45", type: "web", text: "Tra web 'pandas drop_duplicates subset'", icon: "🔍" },
    { id: "act-4", session: "landing-page", status: "working", time: "23:45", type: "edit", text: "Ghi file components/Hero.tsx", icon: "📄" },
    { id: "act-5", session: "docs-site", status: "resting", time: "23:45", type: "read", text: "Xong việc, đi pha cà phê", icon: "☕" },
    { id: "act-6", session: "data-pipeline", status: "working", time: "23:45", type: "command", text: "Chạy pytest", icon: "🧪" },
    { id: "act-7", session: "landing-page", status: "working", time: "23:45", type: "command", text: "Deploy docs", icon: "🚀" },
    { id: "act-8", session: "data-pipeline", status: "working", time: "23:45", type: "edit", text: "Sửa etl/orders.py", icon: "✏️" },
  ]);

  const [screenBadges, setScreenBadges] = useState<Array<{
    id: string;
    label: string;
    status: string;
    task: string;
    sx: number;
    sy: number;
    visible: boolean;
    color: string;
    agentId: string;
  }>>([]);

  // Character Tracking Camera Mode
  const [trackingAgentId, setTrackingAgentId] = useState<string | null>(null);
  const [trackingActionLabel, setTrackingActionLabel] = useState<string>("");
  const hoveredAgentIdRef = useRef<string | null>(null);
  const builtPodsRef = useRef<Set<string>>(new Set());

  const [chatMessages, setChatMessages] = useState<ChatItem[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Xin chào! Đây là không gian làm việc AI 3D Diorama PROVIPAGENT Corporation với 6 tầng nghiệp vụ (18 phân ban doanh nghiệp và 268 chuyên gia).\n\n• Bố Cục Đảo Bàn 4 Người (4-Person Pods): Bàn làm việc phân cụm ngăn nắp, vách ngăn chống ồn và bồn cây xanh.\n• Khu Thư Giãn (Chill Zone): Bàn bida, quầy pha cà phê espresso, quầy ăn nhẹ và bình nước.\n• Theo Dõi Nhân Vật: Bấm vào bất kỳ chuyên gia nào để phóng to camera và theo dõi hoạt động thời gian thực.\n• Trò Chuyện & Điều Phối: Nhập câu hỏi để nhận ngay lời giải đáp chuyên môn chính xác.",
      timestamp: "Hệ thống sẵn sàng"
    }
  ]);
  const [isAiResponding, setIsAiResponding] = useState<boolean>(false);
  const [currentRouteNotice, setCurrentRouteNotice] = useState<string | null>(null);
  const [chatInputText, setChatInputText] = useState<string>("");
  const [fpsValue, setFpsValue] = useState<number>(60);
  const [elevatorStatusText, setElevatorStatusText] = useState<string>("Cửa đang mở • Sẵn sàng");
  const [elevatorDirArrow, setElevatorDirArrow] = useState<string>("●");
  const [workforceList, setWorkforceList] = useState<AgentConfig[]>(Object.values(CANONICAL_AGENTS));
  const [sidebarTab, setSidebarTab] = useState<"floor" | "leadership">("floor");

  // Keep latest floor and ghost mode in refs for event listeners and animation loop
  const currentFloorRef = useRef<number>(currentFloor);
  currentFloorRef.current = currentFloor;

  const ghostModeRef = useRef<GhostMode>(ghostMode);
  ghostModeRef.current = ghostMode;

  // Three.js References
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const floorGroupsRef = useRef<Record<number, THREE.Group>>({});
  const floorMaterialsRef = useRef<Record<number, Array<{ mat: THREE.Material; baseOpacity: number; wasTransparent: boolean; originalColorHex?: number }>>>({});
  const floorMaterialCache = useRef<Record<number, Map<THREE.Material, THREE.Material>>>({});
  const elevatorDoorsRef = useRef<Record<number, { left: THREE.Mesh; right: THREE.Mesh; closedLeftX: number; closedRightX: number; openOffset: number; isOpen: boolean }>>({});
  const slidingDoorsRef = useRef<{
    left: THREE.Mesh;
    right: THREE.Mesh;
    closedLeftX: number;
    closedRightX: number;
    openOffset: number;
    currentOffset: number;
  } | null>(null);
  const wallScreensRef = useRef<Record<number, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; data: any }>>({});
  const agentControllersRef = useRef<Record<string, any>>({});
  const clickableMeshesRef = useRef<THREE.Mesh[]>([]);
  const envRegistryRef = useRef<FloorEnvironmentRegistry>(new FloorEnvironmentRegistry());
  const collisionRegistryRef = useRef<AABBCollisionSystem>(new AABBCollisionSystem());

  // Zero-Lag Direct 1:1 Camera State (Framed identically to Scandinavian Reference Image 2)
  const camStateRef = useRef({
    theta: Math.PI / 4,
    phi: Math.PI / 3.25,
    radius: 52,
    targetX: 0,
    targetY: 5 * FLOOR_HEIGHT + 2.5,
    targetZ: 0.5,
    goalFloorY: 5 * FLOOR_HEIGHT + 2.5,
    destX: 0,
    destY: 5 * FLOOR_HEIGHT + 2.5,
    destZ: 0.5,
    destRadius: 52,
    destTheta: Math.PI / 4,
    destPhi: Math.PI / 3.25,
    isCinematicMoving: false,
    isDraggingLeft: false,
    isDraggingRight: false,
    prevX: 0,
    prevY: 0,
    downX: 0,
    downY: 0,
    trackingAgentId: null as string | null,
  });

  const geoRef = useRef<any>(null);
  const matRef = useRef<any>(null);

  // Sync camera position immediately without lag
  const syncCameraPositionImmediate = useCallback(() => {
    const s = camStateRef.current;
    const cam = cameraRef.current;
    if (!cam) return;

    const sinPhi = Math.sin(s.phi);
    const cosPhi = Math.cos(s.phi);
    const sinTheta = Math.sin(s.theta);
    const cosTheta = Math.cos(s.theta);

    cam.position.x = s.targetX + s.radius * sinPhi * sinTheta;
    cam.position.y = s.targetY + s.radius * cosPhi;
    cam.position.z = s.targetZ + s.radius * sinPhi * cosTheta;
    cam.lookAt(s.targetX, s.targetY, s.targetZ);
  }, []);

  const stopTrackingCamera = useCallback(() => {
    setTrackingAgentId(null);
    camStateRef.current.trackingAgentId = null;
    setTrackingActionLabel("");
    const s = camStateRef.current;
    s.radius = 52;
    s.targetX = 0;
    s.targetZ = 0.5;
    s.phi = Math.PI / 3.25;
    syncCameraPositionImmediate();
  }, [syncCameraPositionImmediate]);

  // Material Tracker with Original Diffuse Preservation for Solid Ghosting
  const registerFloorMaterial = useCallback(<T extends THREE.Material>(floor: number, mat: T): T => {
    if (!floorMaterialsRef.current[floor]) floorMaterialsRef.current[floor] = [];
    const colorHex = (mat as any).color ? (mat as any).color.getHex() : undefined;
    floorMaterialsRef.current[floor].push({
      mat,
      baseOpacity: mat.opacity,
      wasTransparent: mat.transparent,
      originalColorHex: colorHex,
    });
    return mat;
  }, []);

  const createMesh = useCallback((
    floor: number,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    sx = 1, sy = 1, sz = 1,
    px = 0, py = 0, pz = 0,
    castShadow = true,
    receiveShadow = true
  ) => {
    // Isolate materials per-floor so ghosting/darkening floor N never alters floor M!
    if (!floorMaterialCache.current[floor]) {
      floorMaterialCache.current[floor] = new Map();
    }
    let floorMat = floorMaterialCache.current[floor].get(mat);
    if (!floorMat) {
      floorMat = (mat as any).clone ? (mat as any).clone() : mat;
      floorMaterialCache.current[floor].set(mat, floorMat!);
      registerFloorMaterial(floor, floorMat!);
    }
    const mesh = new THREE.Mesh(geo, floorMat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(px, py, pz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    return mesh;
  }, [registerFloorMaterial]);

  // Wall Screen Painter
  const drawWallScreenContent = useCallback((floorId: number, data: { title: string; line1: string; line2: string; line3: string; accent: string }) => {
    const scr = wallScreensRef.current[floorId];
    if (!scr) return;
    const { ctx, canvas, tex } = scr;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, w, h);

    // Glowing border
    ctx.lineWidth = 10;
    ctx.strokeStyle = data.accent || "#38bdf8";
    ctx.strokeRect(5, 5, w - 10, h - 10);

    // Header bar
    ctx.fillStyle = data.accent || "#38bdf8";
    ctx.fillRect(10, 10, w - 20, 54);
    ctx.fillStyle = "#030712";
    ctx.font = "900 26px 'JetBrains Mono', monospace";
    ctx.fillText("● " + data.title.toUpperCase(), 30, 47);

    // Body content lines
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 24px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(data.line1, 35, 120);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 21px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(data.line2, 35, 175);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "700 20px 'JetBrains Mono', monospace";
    ctx.fillText(data.line3, 35, 230);

    // Telemetry mini-footer
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(20, 275, w - 40, 85);
    ctx.fillStyle = "#34d399";
    ctx.font = "700 18px 'JetBrains Mono', monospace";
    ctx.fillText("STATUS: ACTIVE  •  STREAM: REALTIME  •  120 FPS HIGH FIDELITY", 35, 325);

    tex.needsUpdate = true;
  }, []);

  // Elevator Door Animation Trigger
  const triggerElevatorDoors = useCallback((open: boolean, floorId: number) => {
    const d = elevatorDoorsRef.current[floorId];
    if (d) {
      d.isOpen = open;
    }
    setElevatorStatusText(open ? `Tầng ${FLOORS[floorId]?.code || floorId} • Cửa đang mở` : `Tầng ${FLOORS[floorId]?.code || floorId} • Cửa đã đóng`);
  }, []);

  // Physically Solid Darkened Ghost Floor System (Phase 7)
  const updateFloorVisibility = useCallback((targetFloor: number, mode: GhostMode) => {
    for (let f = 0; f <= 7; f++) {
      const isCurrent = f === targetFloor;
      const group = floorGroupsRef.current[f];
      const mats = floorMaterialsRef.current[f] || [];
      if (!group) continue;

      if (mode === "NORMAL") {
        group.visible = true;
        mats.forEach(item => {
          (item.mat as any).transparent = item.wasTransparent;
          (item.mat as any).opacity = item.baseOpacity;
          (item.mat as any).depthWrite = true;
          if ((item.mat as any).color && item.originalColorHex !== undefined) {
            (item.mat as any).color.setHex(item.originalColorHex);
          }
        });
      } else if (mode === "ISOLATED") {
        group.visible = isCurrent;
        if (isCurrent) {
          mats.forEach(item => {
            (item.mat as any).transparent = item.wasTransparent;
            (item.mat as any).opacity = item.baseOpacity;
            (item.mat as any).depthWrite = true;
            if ((item.mat as any).color && item.originalColorHex !== undefined) {
              (item.mat as any).color.setHex(item.originalColorHex);
            }
          });
        }
      } else { // DARKENED_GHOST (Default: Solid, Depth-Written, Physically Darkened Pedestal)
        if (f > targetFloor) {
          // Floors above the active floor are hidden so the user looks down into the room
          group.visible = false;
        } else if (isCurrent) {
          // Active floor: full vivid brightness and color
          group.visible = true;
          mats.forEach(item => {
            (item.mat as any).transparent = item.wasTransparent;
            (item.mat as any).opacity = item.baseOpacity;
            (item.mat as any).depthWrite = true;
            if ((item.mat as any).color && item.originalColorHex !== undefined) {
              (item.mat as any).color.setHex(item.originalColorHex);
            }
          });
        } else {
          // Floors below the active floor: physically solid pedestal, darkened/desaturated diffuse color with depthWrite active!
          group.visible = true;
          mats.forEach(item => {
            (item.mat as any).transparent = false; // Solid! Zero sorting bugs!
            (item.mat as any).opacity = 1.0;
            (item.mat as any).depthWrite = true;
            if ((item.mat as any).color && item.originalColorHex !== undefined) {
              const orig = new THREE.Color(item.originalColorHex);
              const hsl = { h: 0, s: 0, l: 0 };
              orig.getHSL(hsl);
              orig.setHSL(hsl.h, hsl.s * 0.55, hsl.l * 0.30);
              (item.mat as any).color.copy(orig);
            }
          });
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
    setElevatorStatusText(`Đang di chuyển tới tầng ${FLOORS[targetFloor]?.code || targetFloor}...`);

    triggerElevatorDoors(false, currentFloor);

    setTimeout(() => {
      setCurrentFloor(targetFloor);
      camStateRef.current.goalFloorY = targetFloor * FLOOR_HEIGHT + 2.5;
      updateFloorVisibility(targetFloor, ghostMode);

      setTimeout(() => {
        setElevatorDirArrow("●");
        triggerElevatorDoors(true, targetFloor);
      }, 350);
    }, 240);
  }, [currentFloor, ghostMode, triggerElevatorDoors, updateFloorVisibility]);

  // Three.js Scene Setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f3f5); // Clean light neutral Scandinavian studio backdrop (matching Image 2)
    scene.fog = new THREE.FogExp2(0xf1f3f5, 0.0012);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(34, container.clientWidth / container.clientHeight, 0.5, 300);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;
    if (typeof window !== "undefined") {
      (window as any).__MY_OFFICE_SCENE__ = scene;
      (window as any).__MY_OFFICE_RENDERER__ = renderer;
      (window as any).__MY_OFFICE_CHIBIS__ = agentControllersRef.current;
      (window as any).__MY_OFFICE_ENV_REGISTRY__ = envRegistryRef.current;
      (window as any).__MY_OFFICE_COLLISION_REGISTRY__ = collisionRegistryRef.current;
      (window as any).__MY_OFFICE_TRACK_AGENT__ = (id: string) => {
        setTrackingAgentId(id);
        camStateRef.current.trackingAgentId = id;
        const agCtrl = agentControllersRef.current[id];
        if (agCtrl) setTrackingActionLabel(agCtrl.currentActionLabel);
      };
      (window as any).__MY_OFFICE_STOP_TRACKING__ = stopTrackingCamera;
    }
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Balanced Studio & Sunlight Illumination (Matching Scandinavian Reference Render)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb0bec5, 0.55);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    // Key Directional Sun streaming through the Northwest perimeter windows
    const sunLight = new THREE.DirectionalLight(0xfffaed, 1.35);
    sunLight.position.set(-35, 52, -35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 120;
    const shadowD = 32;
    sunLight.shadow.camera.left = -shadowD;
    sunLight.shadow.camera.right = shadowD;
    sunLight.shadow.camera.top = shadowD;
    sunLight.shadow.camera.bottom = -shadowD;
    sunLight.shadow.bias = -0.0004;
    scene.add(sunLight);

    // Soft South-East Fill Light
    const fillLight = new THREE.DirectionalLight(0xf1f5f9, 0.55);
    fillLight.position.set(30, 40, 30);
    scene.add(fillLight);

    // Shared Geometries & Materials
    const GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
      sphere: new THREE.SphereGeometry(1, 20, 20),
    };
    geoRef.current = GEO;

    const MAT = {
      // Modern Architectural Materials (Matching Scandinavian/Silicon Valley reference)
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 }),
      blackMetal: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.35, metalness: 0.7 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.85 }),
      whitePlastic: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }),
      whiteWall: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 }),
      skirtingDark: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 }),
      glassClear: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.22 }),
      glassFrosted: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, transparent: true, opacity: 0.55 }),
      glassWindow: new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.1, transparent: true, opacity: 0.35 }),
      oakBlonde: new THREE.MeshStandardMaterial({ color: 0xd8c29d, roughness: 0.55 }),
      oakFluted: new THREE.MeshStandardMaterial({ color: 0xcbb289, roughness: 0.6 }),
      marbleWhite: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.2, metalness: 0.05 }),
      woodWarm: new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.65 }),
      woodLight: new THREE.MeshStandardMaterial({ color: 0xd8c29d, roughness: 0.55 }), // Blonde oak for desk tops
      plantGreen: new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 }),
      potWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 }),
      potTerracotta: new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.8 }),
      screenBlack: new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.2 }),
      sofaGrey: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8 }),
      sofaCognac: new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.75 }),
      rugCream: new THREE.MeshStandardMaterial({ color: 0xedebe6, roughness: 0.95 }),
      beanbagCyan: new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.85 }),
      beanbagOlive: new THREE.MeshStandardMaterial({ color: 0x84cc16, roughness: 0.85 })
    };
    matRef.current = MAT;

    // Procedural Botanical Plant Generator (Matching Scandinavian Image 2 Foliage)
    const buildArchitecturalPlant = (
      floorId: number,
      group: THREE.Group,
      type: "fiddle_leaf" | "snake_plant" | "monstera" | "palm",
      potStyle: "white_cyl" | "terracotta" | "wood_box",
      x: number,
      y: number,
      z: number,
      scale = 1.0
    ) => {
      const pGroup = new THREE.Group();
      pGroup.position.set(x, y, z);
      pGroup.scale.set(scale, scale, scale);

      // 1. Ceramic / Terracotta / Oak Planter Pot
      const potMat = potStyle === "terracotta" ? MAT.potTerracotta : potStyle === "wood_box" ? MAT.oakBlonde : MAT.potWhite;
      if (potStyle === "wood_box") {
        pGroup.add(createMesh(floorId, GEO.box, potMat, 0.65, 0.45, 0.65, 0, 0.22, 0, true, true));
      } else {
        const pot = createMesh(floorId, GEO.cyl, potMat, 0.38, 0.68, 0.32, 0, 0.34, 0, true, true);
        pGroup.add(pot);
      }
      // Rich dark potting soil surface
      const soilMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.9 }));
      pGroup.add(createMesh(floorId, GEO.cyl, soilMat, 0.35, 0.04, 0.35, 0, 0.68, 0, false, false));

      const darkGreen = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.6 }));
      const medGreen = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.55 }));
      const brightGreen = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6 }));
      const trunkMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.8 }));

      if (type === "fiddle_leaf") {
        // Natural woody trunk
        const trunk = createMesh(floorId, GEO.cyl, trunkMat, 0.05, 1.3, 0.06, 0, 1.35, 0, true, false);
        trunk.rotation.z = 0.04;
        pGroup.add(trunk);

        // 12 Layered broad fiddle leaves spiraling upwards
        for (let i = 0; i < 12; i++) {
          const angle = i * 1.8;
          const leafY = 1.0 + i * 0.11;
          const dist = 0.32 + (i % 3) * 0.08;
          const lx = Math.cos(angle) * dist;
          const lz = Math.sin(angle) * dist;

          const leafMesh = createMesh(floorId, GEO.box, i % 2 === 0 ? darkGreen : medGreen, 0.38, 0.02, 0.26, lx, leafY, lz, true, false);
          leafMesh.rotation.y = angle;
          leafMesh.rotation.x = 0.25;
          leafMesh.rotation.z = Math.sin(angle) * 0.2;
          pGroup.add(leafMesh);
        }
      } else if (type === "snake_plant") {
        // 12 Upright sword leaves in tight rosette with sharp tips
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const radius = 0.05 + (i % 3) * 0.05;
          const lx = Math.cos(angle) * radius;
          const lz = Math.sin(angle) * radius;
          const leafH = 0.65 + (i % 4) * 0.16;

          const blade = createMesh(floorId, GEO.box, i % 3 === 0 ? brightGreen : darkGreen, 0.08, leafH, 0.016, lx, 0.70 + leafH / 2, lz, true, false);
          blade.rotation.y = angle;
          blade.rotation.x = (Math.sin(angle) * 0.1);
          blade.rotation.z = (Math.cos(angle) * 0.1);
          pGroup.add(blade);
        }
      } else if (type === "monstera") {
        // Arching stems with broad split leaves
        for (let i = 0; i < 7; i++) {
          const angle = (i / 7) * Math.PI * 2;
          const dist = 0.42;
          const lx = Math.cos(angle) * dist;
          const lz = Math.sin(angle) * dist;
          const stem = createMesh(floorId, GEO.cyl, trunkMat, 0.025, 0.75, 0.025, lx * 0.5, 1.05, lz * 0.5, false, false);
          stem.rotation.y = angle;
          stem.rotation.z = 0.45;
          pGroup.add(stem);

          const leaf = createMesh(floorId, GEO.box, medGreen, 0.44, 0.015, 0.38, lx, 1.30, lz, true, false);
          leaf.rotation.y = angle;
          leaf.rotation.x = 0.35;
          pGroup.add(leaf);
        }
      } else {
        // Cascading Areca Palm fronds
        for (let i = 0; i < 9; i++) {
          const angle = (i / 9) * Math.PI * 2;
          const dist = 0.48;
          const lx = Math.cos(angle) * dist;
          const lz = Math.sin(angle) * dist;
          const frond = createMesh(floorId, GEO.box, brightGreen, 0.16, 0.015, 0.58, lx, 1.10, lz, true, false);
          frond.rotation.y = angle;
          frond.rotation.x = 0.4;
          pGroup.add(frond);
        }
      }

      group.add(pGroup);
      return pGroup;
    };

    // Dedicated Unique Physical Slot Allocator for Office Floors (Zero Overlapping Avatars!)
    const getFloorSlotLocations = (floorId: number) => {
      // 1. Workstation Pods (5 pods x 4 seats = 20 desk seats)
      const deskSlots: Array<{ deskPos: { x: number; z: number }; chairPos: { x: number; z: number; rotY: number }; roleType: string }> = [];
      const standardPods = [
        { x: -8.5, z: 11.5 },
        { x: 0.0, z: 11.5 },
        { x: 8.5, z: 11.5 },
        { x: 12.5, z: -1.5 },
        { x: 12.5, z: -8.0 },
      ];
      standardPods.forEach((p) => {
        POD_SEAT_OFFSETS.forEach((s) => {
          deskSlots.push({
            deskPos: { x: p.x + s.dx, z: p.z + s.dz },
            chairPos: { x: p.x + s.dx, z: p.z + s.chairDz, rotY: s.rotY },
            roleType: "workstation"
          });
        });
      });

      // 2. Grand Boardroom Conference Seats (West Room 1: cx = -20.0, cz = 8.5)
      const boardroomSlots = [
        { chairPos: { x: -22.0, z: 7.05, rotY: 0 }, deskPos: { x: -22.0, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -20.7, z: 7.05, rotY: 0 }, deskPos: { x: -20.7, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -19.3, z: 7.05, rotY: 0 }, deskPos: { x: -19.3, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -18.0, z: 7.05, rotY: 0 }, deskPos: { x: -18.0, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -22.0, z: 9.95, rotY: Math.PI }, deskPos: { x: -22.0, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -20.7, z: 9.95, rotY: Math.PI }, deskPos: { x: -20.7, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -19.3, z: 9.95, rotY: Math.PI }, deskPos: { x: -19.3, z: 8.5 }, roleType: "boardroom" },
        { chairPos: { x: -18.0, z: 9.95, rotY: Math.PI }, deskPos: { x: -18.0, z: 8.5 }, roleType: "boardroom" },
      ];

      // 3. Focus / Meeting Room Seats (West Room 2: cx = -20.0, cz = -3.0)
      const focusSlots = [
        { chairPos: { x: -21.2, z: -4.25, rotY: 0 }, deskPos: { x: -21.2, z: -3.0 }, roleType: "focus" },
        { chairPos: { x: -18.8, z: -4.25, rotY: 0 }, deskPos: { x: -18.8, z: -3.0 }, roleType: "focus" },
        { chairPos: { x: -21.2, z: -1.75, rotY: Math.PI }, deskPos: { x: -21.2, z: -3.0 }, roleType: "focus" },
        { chairPos: { x: -18.8, z: -1.75, rotY: Math.PI }, deskPos: { x: -18.8, z: -3.0 }, roleType: "focus" },
      ];

      // 4. Central Lounge Sofas (lx = 0.0, lz = 0.3)
      const loungeSlots = [
        { chairPos: { x: -1.2, z: -1.1, rotY: 0 }, deskPos: { x: -1.2, z: 0.3 }, roleType: "lounge" },
        { chairPos: { x: 1.2, z: -1.1, rotY: 0 }, deskPos: { x: 1.2, z: 0.3 }, roleType: "lounge" },
        { chairPos: { x: -0.8, z: 1.9, rotY: Math.PI }, deskPos: { x: -0.8, z: 0.3 }, roleType: "lounge" },
        { chairPos: { x: 0.8, z: 1.9, rotY: Math.PI }, deskPos: { x: 0.8, z: 0.3 }, roleType: "lounge" },
      ];

      // 5. Pantry High Bar Window Stools (barX = 3.0, barZ = -17.0)
      const barSlots = [
        { chairPos: { x: 0.75, z: -16.2, rotY: Math.PI }, deskPos: { x: 0.75, z: -17.0 }, roleType: "bar" },
        { chairPos: { x: 2.25, z: -16.2, rotY: Math.PI }, deskPos: { x: 2.25, z: -17.0 }, roleType: "bar" },
        { chairPos: { x: 3.75, z: -16.2, rotY: Math.PI }, deskPos: { x: 3.75, z: -17.0 }, roleType: "bar" },
        { chairPos: { x: 5.25, z: -16.2, rotY: Math.PI }, deskPos: { x: 5.25, z: -17.0 }, roleType: "bar" },
      ];

      // 6. Floor Reception Desk (rx = 21.6, rz = 9.0, facing West into entrance corridor)
      const receptionSlot = [
        { chairPos: { x: 22.4, z: 9.0, rotY: -Math.PI * 0.5 }, deskPos: { x: 21.6, z: 9.0 }, roleType: "reception" },
      ];

      // 7. Standing Discussion Colleague (Matching Image 2 standing person at Pod 1)
      const standingSlot = [
        { chairPos: { x: -6.6, z: 10.2, rotY: -Math.PI * 0.25 }, deskPos: { x: -7.45, z: 10.15 }, roleType: "standing_discuss" },
      ];

      // 8. Circulation Corridor Patrol Spots
      const walkSlots = [
        { chairPos: { x: -9.0, z: 5.0, rotY: 0 }, deskPos: { x: -9.0, z: 5.0 }, roleType: "corridor_patrol" },
        { chairPos: { x: 5.0, z: 5.0, rotY: Math.PI * 0.5 }, deskPos: { x: 5.0, z: 5.0 }, roleType: "corridor_patrol" },
      ];

      return [...deskSlots, ...boardroomSlots, ...focusSlots, ...loungeSlots, ...barSlots, ...receptionSlot, ...standingSlot, ...walkSlots];
    };

    // Helper functions for building diorama
    const buildFloorSign = (floorId: number, cfg: FloorConfig) => {
      const canvas = document.createElement("canvas");
      canvas.width = 860;
      canvas.height = 180;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = cfg.themeColor;
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);

      ctx.fillStyle = cfg.themeColor;
      ctx.fillRect(24, 26, 140, 128);
      ctx.fillStyle = "#0f172a";
      ctx.font = "900 68px 'JetBrains Mono', monospace";
      ctx.fillText(cfg.code, 44, 116);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 38px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(cfg.name, 190, 85);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 24px 'JetBrains Mono', monospace";
      ctx.fillText(cfg.enName, 190, 134);

      const tex = new THREE.CanvasTexture(canvas);
      const plaqueMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({
        map: tex,
        depthTest: true,
        depthWrite: true
      }));
      const plaqueMesh = new THREE.Mesh(GEO.plane, plaqueMat);
      plaqueMesh.scale.set(6.2, 1.3, 1);
      plaqueMesh.position.set(1.5, 5.2, -ROOM_D / 2 + 0.28);
      return plaqueMesh;
    };

    const buildModernArchitecturalStaircase = (floorId: number, group: THREE.Group) => {
      const stairX = VERTICAL_CORE.staircase.cx; // 23.0
      const stairZ = VERTICAL_CORE.staircase.cz; // -6.0
      const rimMat = MAT.darkMetal;

      // 1. Sleek Well Rim around Floor Slab Cutout (Depth 7.2m, Z: [-9.6, -2.4])
      group.add(createMesh(floorId, GEO.box, rimMat, 0.16, 0.28, 7.2, stairX - 1.45, 0.14, stairZ, true, true));
      group.add(createMesh(floorId, GEO.box, rimMat, 3.1, 0.28, 0.16, stairX + 0.1, 0.14, stairZ + 3.6, true, true));

      // 2. Dual Inclined Structural Steel Stringers (Matte Black Powder Coated)
      const stringerMat = MAT.blackMetal;
      [-1.35, 1.35].forEach(sxOff => {
        const str = createMesh(floorId, GEO.box, stringerMat, 0.14, 0.45, 7.8, stairX + sxOff, -1.35, stairZ, true, true);
        str.rotation.x = -0.54; // 31 degree incline connecting floor to level below
        group.add(str);
      });

      // 3. Monolithic Smooth Angled Underside Soffit (Matching Floor Slab Material)
      const soffitMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.8
      }));
      const soffit = createMesh(floorId, GEO.box, soffitMat, 2.7, 0.22, 7.6, stairX, -1.55, stairZ, true, true);
      soffit.rotation.x = -0.54;
      group.add(soffit);

      // 4. 12 Floating Cantilevered Blonde Oak Steps with Integrated Warm Under-Tread LED Lighting
      const treadMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0xd8c29d,
        roughness: 0.5
      }));
      const ledStairMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ color: 0xfef08a }));
      for (let s = 0; s < 12; s++) {
        const stepZ = -9.2 + s * 0.56;
        const stepY = -2.7 + s * 0.24;
        group.add(createMesh(floorId, GEO.box, treadMat, 2.6, 0.08, 0.52, stairX, stepY, stepZ, true, true));
        group.add(createMesh(floorId, GEO.box, ledStairMat, 2.5, 0.025, 0.04, stairX, stepY - 0.03, stepZ + 0.24, false, false));
      }

      // 5. Floor-to-Ceiling Architectural Black Steel Slat Screen (Modern Minimalist Balustrade)
      const slatMat = MAT.blackMetal;
      for (let s = 0; s < 22; s++) {
        const slatZ = -9.4 + s * 0.32;
        group.add(createMesh(floorId, GEO.box, slatMat, 0.04, 3.8, 0.04, stairX - 1.45, 1.9, slatZ, false, false));
      }
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.08, 0.08, 7.0, stairX - 1.45, 3.8, stairZ, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.08, 0.08, 7.0, stairX - 1.45, 0.04, stairZ, false, false));

      // 6. Brushed Chrome Ergonomic Handrail mounted at 1.05m height
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.05, 6.9, 0.05, stairX - 1.35, 1.05, stairZ, false, false));
      [-9.0, -6.0, -3.0].forEach(pz => {
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.12, 0.04, 0.04, stairX - 1.40, 1.05, pz, false, false));
      });

      // 7. Mid-Flight Structural Steel Landing Column
      group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.14, 5.0, 0.14, stairX, -2.5, stairZ, true, true));

      // 8. Illuminated Architectural Exit & Stairwell Plaque
      const stairSignCanvas = document.createElement("canvas");
      stairSignCanvas.width = 240;
      stairSignCanvas.height = 80;
      const stCtx = stairSignCanvas.getContext("2d")!;
      stCtx.fillStyle = "#022c22";
      stCtx.fillRect(0, 0, 240, 80);
      stCtx.strokeStyle = "#10b981";
      stCtx.lineWidth = 5;
      stCtx.strokeRect(3, 3, 234, 74);
      stCtx.fillStyle = "#34d399";
      stCtx.font = "800 24px 'Plus Jakarta Sans', sans-serif";
      stCtx.textAlign = "center";
      stCtx.fillText("EXIT / THANG BỘ", 120, 48);
      const stTex = new THREE.CanvasTexture(stairSignCanvas);
      const stMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: stTex, depthTest: true, depthWrite: true }));
      const stPlane = new THREE.Mesh(GEO.plane, stMat);
      stPlane.scale.set(1.6, 0.55, 1);
      stPlane.position.set(stairX, 3.2, -9.6);
      group.add(stPlane);

      // Register Staircase Collision Bounding Box (VERTICAL_CORE.staircase.bounds)
      collisionRegistryRef.current.registerObstacle({
        id: `stairwell-${floorId}`,
        floor: floorId,
        minX: VERTICAL_CORE.staircase.bounds.minX,
        maxX: VERTICAL_CORE.staircase.bounds.maxX,
        minZ: VERTICAL_CORE.staircase.bounds.minZ,
        maxZ: VERTICAL_CORE.staircase.bounds.maxZ,
        label: "Modern Architectural Stairwell"
      });
    };

    const buildElevatorAndStairs = (floorId: number, group: THREE.Group) => {
      // Modern South-East Corporate Elevator Pavilion (Matching Image 2 Entrance at X = 17.5, Z = 9.2)
      const shaftX = 17.5;
      const shaftZ = 9.2;
      const shaftW = 3.6;
      const shaftD = 3.4;
      const shaftH = 5.4;

      // Elevator Shaft Housing (Matte white architectural gypsum with crisp black frame)
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, shaftW, shaftH, shaftD, shaftX, shaftH / 2, shaftZ, true, true));
      // Black steel corner frame posts
      [-shaftW / 2, shaftW / 2].forEach(fx => {
        [-shaftD / 2, shaftD / 2].forEach(fz => {
          group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.12, shaftH, 0.12, shaftX + fx, shaftH / 2, shaftZ + fz, false, false));
        });
      });
      // Top roof trim cap
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, shaftW + 0.1, 0.18, shaftD + 0.1, shaftX, shaftH + 0.09, shaftZ, false, false));

      // Warm lit interior cabin panel
      const cabinMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
      group.add(createMesh(floorId, GEO.plane, cabinMat, 2.5, 4.4, 1, shaftX, 2.2, shaftZ + 0.4, false, false));

      // Stainless Steel Double Sliding Elevator Doors (Facing North towards corridor at doorZ)
      const doorZ = shaftZ - shaftD / 2 + 0.08;
      const doorL = createMesh(floorId, GEO.box, MAT.chrome, 1.25, 4.4, 0.10, shaftX - 0.65, 2.2, doorZ, true, true);
      const doorR = createMesh(floorId, GEO.box, MAT.chrome, 1.25, 4.4, 0.10, shaftX + 0.65, 2.2, doorZ, true, true);
      doorL.userData = { type: "elevator", floor: floorId };
      doorR.userData = { type: "elevator", floor: floorId };
      clickableMeshesRef.current.push(doorL, doorR);
      group.add(doorL, doorR);

      elevatorDoorsRef.current[floorId] = {
        left: doorL,
        right: doorR,
        closedLeftX: shaftX - 0.65,
        closedRightX: shaftX + 0.65,
        openOffset: 1.0,
        isOpen: floorId === 5
      };
      if (floorId === 5) {
        doorL.position.x -= 1.0;
        doorR.position.x += 1.0;
      }

      // Overhead Elevator LED Header Panel
      const headerCanvas = document.createElement("canvas");
      headerCanvas.width = 300;
      headerCanvas.height = 90;
      const hCtx = headerCanvas.getContext("2d")!;
      hCtx.fillStyle = "#050811";
      hCtx.fillRect(0, 0, 300, 90);
      hCtx.strokeStyle = "#475569";
      hCtx.lineWidth = 4;
      hCtx.strokeRect(2, 2, 296, 86);
      hCtx.fillStyle = "#f59e0b";
      hCtx.font = "800 44px 'JetBrains Mono', monospace";
      hCtx.fillText("🛗 " + (FLOORS[floorId]?.code || floorId), 55, 60);
      const hTex = new THREE.CanvasTexture(headerCanvas);
      const hMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: hTex, depthTest: true, depthWrite: true }));
      const hPlane = new THREE.Mesh(GEO.plane, hMat);
      hPlane.scale.set(2.0, 0.60, 1);
      hPlane.position.set(shaftX, 4.8, doorZ - 0.04);
      hPlane.userData = { type: "elevator", floor: floorId };
      clickableMeshesRef.current.push(hPlane);
      group.add(hPlane);

      // Amber LED Call Button Panel
      const callBtn = createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: 0xf59e0b }), 0.22, 0.45, 0.10, shaftX + 1.55, 2.2, doorZ - 0.02, false, false);
      callBtn.userData = { type: "elevator", floor: floorId };
      clickableMeshesRef.current.push(callBtn);
      group.add(callBtn);

      // Register Elevator Shaft Collision Bounding Box
      collisionRegistryRef.current.registerObstacle({
        id: `elevator-shaft-${floorId}`,
        floor: floorId,
        minX: shaftX - shaftW / 2 - 0.2,
        maxX: shaftX + shaftW / 2 + 0.2,
        minZ: shaftZ - shaftD / 2 - 0.2,
        maxZ: shaftZ + shaftD / 2 + 0.2,
        label: "Elevator Shaft Core"
      });

      // Build modern redesigned corporate staircase
      buildModernArchitecturalStaircase(floorId, group);
    };

    // Realistic Modern Enclosed Restroom Suite (VERTICAL_CORE.restroom)
    const buildRealisticRestroom = (floorId: number, group: THREE.Group) => {
      const rx = VERTICAL_CORE.restroom.cx; // 22.65
      const rz = VERTICAL_CORE.restroom.cz; // 12.0
      const rw = VERTICAL_CORE.restroom.width; // 6.3
      const rd = VERTICAL_CORE.restroom.depth; // 7.0
      const wallH = 5.2;

      const halfW = rw / 2; // 3.15 -> minX = 19.5, maxX = 25.8
      const halfD = rd / 2; // 3.5 -> minZ = 8.5, maxZ = 15.5

      // 1. Restroom Enclosing Walls
      const restWallMat = MAT.whiteWall;
      const tileMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.35
      }));
      group.add(createMesh(floorId, GEO.box, tileMat, rw, 0.06, rd, rx, 0.03, rz, false, true));

      // North Wall (Z = 8.5)
      group.add(createMesh(floorId, GEO.box, restWallMat, rw, wallH, 0.22, rx, wallH / 2, rz - halfD, true, true));
      // South Wall (Z = 15.5)
      group.add(createMesh(floorId, GEO.box, restWallMat, rw, wallH, 0.22, rx, wallH / 2, rz + halfD, true, true));
      // East Wall (X = 25.8)
      group.add(createMesh(floorId, GEO.box, restWallMat, 0.22, wallH, rd, rx + halfW, wallH / 2, rz, true, true));

      // West Wall (X = 19.5) with 1.5m Doorway Opening at Z = 12.0
      const doorW = VERTICAL_CORE.restroom.door.width; // 1.5
      const sidePanelD = (rd - doorW) / 2; // 2.75
      group.add(createMesh(floorId, GEO.box, restWallMat, 0.22, wallH, sidePanelD, rx - halfW, wallH / 2, rz - halfD + sidePanelD / 2, true, true));
      group.add(createMesh(floorId, GEO.box, restWallMat, 0.22, wallH, sidePanelD, rx - halfW, wallH / 2, rz + halfD - sidePanelD / 2, true, true));
      group.add(createMesh(floorId, GEO.box, restWallMat, 0.22, wallH - 3.2, doorW, rx - halfW, 3.2 + (wallH - 3.2) / 2, rz, true, true));

      // Frosted Glass Privacy Door
      const doorMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.45,
        roughness: 0.3
      }));
      group.add(createMesh(floorId, GEO.box, doorMat, 0.08, 3.0, doorW - 0.08, rx - halfW, 1.5, rz, false, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.03, 0.8, 0.03, rx - halfW - 0.06, 1.45, rz + 0.4, false, false));

      // Backlit RESTROOM / WC Signboard
      const wcSignCanvas = document.createElement("canvas");
      wcSignCanvas.width = 200;
      wcSignCanvas.height = 80;
      const wcCtx = wcSignCanvas.getContext("2d")!;
      wcCtx.fillStyle = "#0f172a";
      wcCtx.fillRect(0, 0, 200, 80);
      wcCtx.strokeStyle = "#38bdf8";
      wcCtx.lineWidth = 4;
      wcCtx.strokeRect(2, 2, 196, 76);
      wcCtx.fillStyle = "#38bdf8";
      wcCtx.font = "800 24px 'Plus Jakarta Sans', sans-serif";
      wcCtx.textAlign = "center";
      wcCtx.fillText("🚻 RESTROOM", 100, 48);
      const wcTex = new THREE.CanvasTexture(wcSignCanvas);
      const wcMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: wcTex, depthTest: true, depthWrite: true }));
      const wcPlane = new THREE.Mesh(GEO.plane, wcMat);
      wcPlane.scale.set(1.1, 0.45, 1);
      wcPlane.rotation.y = -Math.PI / 2;
      wcPlane.position.set(rx - halfW - 0.12, 2.3, rz - 1.2);
      group.add(wcPlane);

      // 2. Interior Double Vanity Counter with Porcelain Basins & Chrome Faucets
      const vanityX = rx + 0.8;
      const vanityZ = rz - halfD + 0.7;
      const vanityMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.2 }));
      group.add(createMesh(floorId, GEO.box, vanityMat, 3.2, 0.95, 0.9, vanityX, 0.48, vanityZ, true, true));

      [-0.8, 0.8].forEach(vx => {
        group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.75, 0.22, 0.65, vanityX + vx, 0.95, vanityZ, true, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.035, 0.28, 0.035, vanityX + vx, 1.15, vanityZ - 0.25, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.03, 0.03, 0.18, vanityX + vx, 1.28, vanityZ - 0.16, false, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.06, 0.18, 0.06, vanityX + vx + 0.45, 1.05, vanityZ - 0.2, false, false));
      });

      // Large Backlit LED Mirror on North Wall
      const mirrorMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.05, metalness: 0.95 }));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 3.3, 1.6, 0.06, vanityX, 2.2, rz - halfD + 0.14, false, false));
      group.add(createMesh(floorId, GEO.plane, mirrorMat, 3.2, 1.5, 1, vanityX, 2.2, rz - halfD + 0.18, false, false));
      group.add(createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: 0xfef08a }), 3.34, 1.64, 0.02, vanityX, 2.2, rz - halfD + 0.12, false, false));

      // 3. Dual Enclosed Toilet Cubicles
      const stallZ = rz + halfD - 1.2;
      const stallDividerMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 }));
      group.add(createMesh(floorId, GEO.box, stallDividerMat, 2.8, 2.6, 0.06, vanityX, 1.3, stallZ, true, true));
      [-0.8, 0.8].forEach(sx => {
        group.add(createMesh(floorId, GEO.box, stallDividerMat, 0.8, 2.4, 0.05, vanityX + sx, 1.2, stallZ - 1.2, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.48, 0.55, 0.68, vanityX + sx, 0.35, stallZ + 0.7, true, true));
        group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.48, 0.62, 0.24, vanityX + sx, 0.75, stallZ + 1.05, true, true));
        group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.04, 0.08, 0.04, vanityX + sx + 0.18, 0.95, stallZ + 1.05, false, false));
      });

      // 4. Electric Hand Dryer & Towel Dispenser
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.32, 0.42, 0.18, rx - halfW + 0.2, 1.6, rz - 1.6, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.35, 0.55, 0.15, rx - halfW + 0.2, 1.6, rz + 1.6, false, false));

      // Automatically Register Restroom Collision Bounding Boxes
      collisionRegistryRef.current.registerObstacle({
        id: `restroom-north-${floorId}`,
        floor: floorId,
        minX: rx - halfW,
        maxX: rx + halfW,
        minZ: rz - halfD - 0.2,
        maxZ: rz - halfD + 0.2,
        label: "Restroom North Wall"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `restroom-south-${floorId}`,
        floor: floorId,
        minX: rx - halfW,
        maxX: rx + halfW,
        minZ: rz + halfD - 0.2,
        maxZ: rz + halfD + 0.2,
        label: "Restroom South Wall"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `restroom-east-${floorId}`,
        floor: floorId,
        minX: rx + halfW - 0.2,
        maxX: rx + halfW + 0.2,
        minZ: rz - halfD,
        maxZ: rz + halfD,
        label: "Restroom East Wall"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `restroom-west-panel1-${floorId}`,
        floor: floorId,
        minX: rx - halfW - 0.2,
        maxX: rx - halfW + 0.2,
        minZ: rz - halfD,
        maxZ: rz - doorW / 2,
        label: "Restroom West Wall N"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `restroom-west-panel2-${floorId}`,
        floor: floorId,
        minX: rx - halfW - 0.2,
        maxX: rx - halfW + 0.2,
        minZ: rz + doorW / 2,
        maxZ: rz + halfD,
        label: "Restroom West Wall S"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `restroom-vanity-${floorId}`,
        floor: floorId,
        minX: vanityX - 1.6,
        maxX: vanityX + 1.6,
        minZ: vanityZ - 0.5,
        maxZ: vanityZ + 0.5,
        label: "Restroom Double Vanity"
      });

      // Register Restroom Interaction Point in Environment Registry
      envRegistryRef.current.registerInteraction({
        id: `restroom-sink-${floorId}`,
        floor: floorId,
        type: "restroom",
        spot: { x: vanityX, z: vanityZ + 0.8, rotY: Math.PI },
        approachPos: VERTICAL_CORE.restroom.approachPos, // { x: 18.0, z: 12.0 }
        label: "🚻 Đi vệ sinh & rửa tay",
        activeMsg: "🧼 Đang rửa tay tại bồn",
        propType: "none"
      });
    };

    const buildWallScreenMesh = (floorId: number, group: THREE.Group, sx: number, sy: number, sz: number, w: number, h: number, initialData: any) => {
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, w + 0.3, h + 0.3, 0.14, sx, sy, sz, true, false));

      const scrCanvas = document.createElement("canvas");
      scrCanvas.width = 860;
      scrCanvas.height = 430;
      const sCtx = scrCanvas.getContext("2d")!;
      const sTex = new THREE.CanvasTexture(scrCanvas);

      const sMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: sTex, depthTest: true, depthWrite: true }));
      const sPlane = new THREE.Mesh(GEO.plane, sMat);
      sPlane.scale.set(w, h, 1);
      sPlane.position.set(sx, sy, sz + 0.09);
      group.add(sPlane);

      wallScreensRef.current[floorId] = { canvas: scrCanvas, ctx: sCtx, tex: sTex, data: initialData };
      drawWallScreenContent(floorId, initialData);
    };

    // 4-Person Connected Pod Builder with Apple iMac 24", Magic Keyboard, Magic Mouse & Credenza Dividers
    const buildFourPersonPod = (floorId: number, group: THREE.Group, cx: number, cz: number, themeColor: number, podId: string) => {
      // 1. Desk top (4 desks connected in a 2x2 pod island with generous 4.2m width x 2.6m depth)
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 4.2, 0.12, 2.6, cx, 1.44, cz, true, true));

      // Matte dark metal frame & chamfered legs
      const legMat = MAT.darkMetal;
      [-1.95, 1.95].forEach(lx => {
        [-1.15, 1.15].forEach(lz => {
          group.add(createMesh(floorId, GEO.box, legMat, 0.09, 1.44, 0.09, cx + lx, 0.72, cz + lz, true, true));
        });
      });
      group.add(createMesh(floorId, GEO.box, legMat, 0.09, 1.44, 0.09, cx, 0.72, cz, false, false));

      // 2. Center acoustic privacy divider screen between North and South seats (along X)
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 4.2, 0.58, 0.08, cx, 1.76, cz, true, true));
      const screenClothMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: themeColor,
        roughness: 0.75
      }));
      group.add(createMesh(floorId, GEO.box, screenClothMat, 4.12, 0.50, 0.09, cx, 1.76, cz, false, false));

      // Center cross modesty divider (along Z)
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.06, 0.35, 2.5, cx, 1.64, cz, false, false));

      // 3. Low wooden credenza / storage cabinet with potted plant & books acting as space divider between pods
      const credenzaX = cx - 2.55;
      const credMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.55 }));
      group.add(createMesh(floorId, GEO.box, credMat, 0.65, 0.95, 2.4, credenzaX, 0.48, cz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.70, 0.06, 2.45, credenzaX, 0.98, cz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.02, 0.80, 2.3, credenzaX + 0.34, 0.48, cz, false, false));
      // Architectural potted snake plant on credenza
      buildArchitecturalPlant(floorId, group, "snake_plant", "terracotta", credenzaX, 0.98, cz - 0.65, 0.55);
      // Books & folders on credenza
      group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0x38bdf8 }), 0.28, 0.14, 0.38, credenzaX, 1.07, cz + 0.55, false, false));
      group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0xf472b6 }), 0.26, 0.12, 0.36, credenzaX, 1.20, cz + 0.55, false, false));

      // Register Pod Desk & Credenza Obstacles in Collision System
      collisionRegistryRef.current.registerObstacle({
        id: `pod-desk-${floorId}-${podId}`,
        floor: floorId,
        minX: cx - 2.15,
        maxX: cx + 2.15,
        minZ: cz - 1.35,
        maxZ: cz + 1.35,
        label: `Pod Desk ${podId}`
      });
      collisionRegistryRef.current.registerObstacle({
        id: `pod-cred-${floorId}-${podId}`,
        floor: floorId,
        minX: credenzaX - 0.38,
        maxX: credenzaX + 0.38,
        minZ: cz - 1.25,
        maxZ: cz + 1.25,
        label: `Pod Credenza ${podId}`
      });

      // 4. Four Workstations: Apple iMac 24", Apple Magic Keyboard, Apple Magic Mouse, Desk Mat, Ceramic Mug & Chair
      const seatConfigs = [
        { dx: -1.05, chairZ: cz - 1.35, rotY: 0, monZ: cz - 0.42, userFacing: 1 },         // NW
        { dx: 1.05, chairZ: cz - 1.35, rotY: 0, monZ: cz - 0.42, userFacing: 1 },          // NE
        { dx: -1.05, chairZ: cz + 1.35, rotY: Math.PI, monZ: cz + 0.42, userFacing: -1 },   // SW
        { dx: 1.05, chairZ: cz + 1.35, rotY: Math.PI, monZ: cz + 0.42, userFacing: -1 },    // SE
      ];

      const chairMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 }));
      const imacBackMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.25 }));
      const deskMatColor = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }));

      seatConfigs.forEach((sc) => {
        const sx = cx + sc.dx;

        // --- APPLE iMAC 24" WORKSTATION ---
        // 1. Solid Aluminum Foot Plate
        group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.36, 0.015, 0.26, sx, 1.51, sc.monZ, false, false));
        // 2. Angled Aluminum Stand Neck
        const neck = createMesh(floorId, GEO.box, MAT.chrome, 0.12, 0.38, 0.025, sx, 1.68, sc.monZ, false, false);
        neck.rotation.x = sc.userFacing > 0 ? 0.18 : -0.18;
        group.add(neck);

        // 3. Apple iMac 24" Unibody Housing (1.25m x 0.74m x 0.028m)
        const imacBody = createMesh(floorId, GEO.box, imacBackMat, 1.25, 0.74, 0.028, sx, 2.02, sc.monZ, true, false);
        imacBody.rotation.x = sc.userFacing > 0 ? -0.08 : 0.08; // 5 deg backward tilt
        group.add(imacBody);

        // 4. Metallic lower chin
        const chinZ = sc.monZ + (sc.userFacing > 0 ? -0.016 : 0.016);
        const chin = createMesh(floorId, GEO.box, MAT.chrome, 1.25, 0.14, 0.01, sx, 1.72, chinZ, false, false);
        chin.rotation.x = imacBody.rotation.x;
        group.add(chin);

        // 5. Black glass front bezel border
        const bezelZ = sc.monZ + (sc.userFacing > 0 ? -0.016 : 0.016);
        const bezel = createMesh(floorId, GEO.box, MAT.screenBlack, 1.23, 0.58, 0.008, sx, 2.09, bezelZ, false, false);
        bezel.rotation.x = imacBody.rotation.x;
        group.add(bezel);

        // 6. Sleek Dark Retina Display with Subtle Department Accent Top Bar (Matching Image 2)
        // Screen normal faces directly towards the seated employee
        const screenMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.35,
          metalness: 0.1
        }));
        const glowScreen = createMesh(floorId, GEO.plane, screenMat, 1.18, 0.54, 1, sx, 2.09, sc.monZ + (sc.userFacing > 0 ? -0.022 : 0.022), false, false);
        glowScreen.rotation.x = imacBody.rotation.x;
        if (sc.userFacing > 0) {
          glowScreen.rotation.y = Math.PI; // Faces -Z towards North employee at cz - 1.35
        } else {
          glowScreen.rotation.y = 0;       // Faces +Z towards South employee at cz + 1.35
        }
        group.add(glowScreen);

        // Thin accent header bar indicating department activity
        const barMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ color: themeColor }));
        const topBar = createMesh(floorId, GEO.plane, barMat, 1.14, 0.035, 1, sx, 2.32, sc.monZ + (sc.userFacing > 0 ? -0.023 : 0.023), false, false);
        topBar.rotation.x = imacBody.rotation.x;
        if (sc.userFacing > 0) topBar.rotation.y = Math.PI;
        group.add(topBar);

        // --- EXECUTIVE DESK MAT ---
        const matZ = sc.monZ + (sc.userFacing > 0 ? -0.52 : 0.52);
        group.add(createMesh(floorId, GEO.box, deskMatColor, 0.88, 0.012, 0.38, sx, 1.51, matZ, false, false));

        // --- APPLE MAGIC KEYBOARD ---
        const kbdZ = matZ + (sc.userFacing > 0 ? -0.04 : 0.04);
        const kbd = createMesh(floorId, GEO.box, MAT.chrome, 0.44, 0.016, 0.16, sx - 0.12, 1.52, kbdZ, false, false);
        kbd.rotation.y = sc.userFacing > 0 ? Math.PI : 0;
        group.add(kbd);
        const keyPlate = createMesh(floorId, GEO.box, MAT.whitePlastic, 0.42, 0.008, 0.14, sx - 0.12, 1.53, kbdZ, false, false);
        keyPlate.rotation.y = kbd.rotation.y;
        group.add(keyPlate);

        // --- APPLE MAGIC MOUSE ---
        const mouseX = sx + (sc.userFacing > 0 ? -0.26 : 0.26);
        const mouse = createMesh(floorId, GEO.box, MAT.whitePlastic, 0.10, 0.022, 0.16, mouseX, 1.52, kbdZ, false, false);
        mouse.rotation.y = kbd.rotation.y;
        group.add(mouse);

        // --- CERAMIC COFFEE MUG ---
        const mugX = sx + (sc.userFacing > 0 ? 0.34 : -0.34);
        group.add(createMesh(floorId, GEO.cyl, MAT.whitePlastic, 0.09, 0.12, 0.09, mugX, 1.56, matZ, false, false));
        group.add(createMesh(floorId, GEO.cyl, new THREE.MeshBasicMaterial({ color: 0x451a03 }), 0.075, 0.01, 0.075, mugX, 1.61, matZ, false, false));

        // --- ERGONOMIC EXECUTIVE SWIVEL CHAIR ---
        const czPos = sc.chairZ;
        group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.42, 0.08, 0.42, sx, 0.08, czPos, false, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.08, 0.72, 0.08, sx, 0.44, czPos, false, false));
        group.add(createMesh(floorId, GEO.box, chairMat, 0.90, 0.14, 0.90, sx, 0.82, czPos, true, true));
        const backrestZ = czPos + (sc.userFacing > 0 ? -0.42 : 0.42);
        group.add(createMesh(floorId, GEO.box, chairMat, 0.86, 1.05, 0.12, sx, 1.40, backrestZ, true, true));
        [-0.45, 0.45].forEach(ax => {
          group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.08, 0.36, 0.44, sx + ax, 1.05, czPos, false, false));
        });
      });
    };

    // Private Glass-Enclosed Suites along North-West Wall (Matching Architectural Reference Diomara)
    // Three contiguous glass rooms with matte dark metal mullions:
    // 1. Grand Boardroom (cx = -19.5, cz = -12.0, w = 11.0, d = 10.0) with 10-Seat Table & 3 Pendant Lamps
    // 2. Focus Meeting Room (cx = -8.5, cz = -12.0, w = 9.0, d = 10.0) with 6-Seat Table & 2 Pendant Lamps
    // 3. Executive Director Suite (cx = 1.5, cz = -12.0, w = 9.0, d = 10.0) with Executive Oak Desk, iMac & Chairs
    const buildPrivateExecutiveSuites = (floorId: number, group: THREE.Group) => {
      const SUITE_CONFIGS: Record<number, Array<{
        cx: number;
        cz: number;
        w: number;
        d: number;
        title: string;
        headName: string;
        themeColor: number;
        isBoardroom?: boolean;
        isFocusRoom?: boolean;
      }>> = {
        1: [
          { cx: -20.0, cz: 8.5, w: 12.0, d: 13.0, title: "PHÒNG HỌP BAN ĐIỀU HÀNH & TÁC CHIẾN", headName: "Executive Boardroom", themeColor: 0x38bdf8, isBoardroom: true },
          { cx: -20.0, cz: -3.0, w: 12.0, d: 8.0, title: "PHÒNG ĐIỀU HÀNH DỊCH VỤ KHÁCH HÀNG", headName: "Liam (Support Lead)", themeColor: 0x0284c7, isFocusRoom: true },
          { cx: -20.0, cz: -12.5, w: 12.0, d: 9.0, title: "VĂN PHÒNG GIÁM ĐỐC VẬN HÀNH & NHÂN SỰ", headName: "Amara (COO)", themeColor: 0x38bdf8 },
        ],
        2: [
          { cx: -20.0, cz: 8.5, w: 12.0, d: 13.0, title: "HỘI ĐỒNG THẨM ĐỊNH TÀI CHÍNH & ĐẦU TƯ", headName: "Financial Boardroom", themeColor: 0x34d399, isBoardroom: true },
          { cx: -20.0, cz: -3.0, w: 12.0, d: 8.0, title: "PHÒNG THẨM ĐỊNH PHÁP LÝ & CỐ VẤN THUẾ", headName: "Legal & Audit Chamber", themeColor: 0x059669, isFocusRoom: true },
          { cx: -20.0, cz: -12.5, w: 12.0, d: 9.0, title: "VĂN PHÒNG GIÁM ĐỐC TÀI CHÍNH (CFO)", headName: "Julian (CFO)", themeColor: 0x34d399 },
        ],
        3: [
          { cx: -20.0, cz: 8.5, w: 12.0, d: 13.0, title: "STUDIO CHIẾN LƯỢC MARKETING TOÀN CẦU", headName: "Marketing Boardroom", themeColor: 0xf472b6, isBoardroom: true },
          { cx: -20.0, cz: -3.0, w: 12.0, d: 8.0, title: "PHÒNG ĐÀM PHÁN THƯƠNG MẠI & ENTERPRISE", headName: "Marcus (VP Sales)", themeColor: 0xfb7185, isFocusRoom: true },
          { cx: -20.0, cz: -12.5, w: 12.0, d: 9.0, title: "VĂN PHÒNG GIÁM ĐỐC TĂNG TRƯỞNG (CMO)", headName: "Sophia (CMO)", themeColor: 0xf472b6 },
        ],
        4: [
          { cx: -20.0, cz: 8.5, w: 12.0, d: 13.0, title: "XƯỞNG THIẾT KẾ & SÁNG TẠO NGHỆ THUẬT", headName: "Creative Design Lab", themeColor: 0xa855f7, isBoardroom: true },
          { cx: -20.0, cz: -3.0, w: 12.0, d: 8.0, title: "LAB KIỂM THỬ TRẢI NGHIỆM AR/VR", headName: "Spatial UX Chamber", themeColor: 0xc084fc, isFocusRoom: true },
          { cx: -20.0, cz: -12.5, w: 12.0, d: 9.0, title: "VĂN PHÒNG GIÁM ĐỐC THIẾT KẾ UI/UX", headName: "Hana (Design Director)", themeColor: 0xa855f7 },
        ],
        5: [
          { cx: -20.0, cz: 8.5, w: 12.0, d: 13.0, title: "TRUNG TÂM TÁC CHIẾN AN NINH MẠNG SOC", headName: "Cybersecurity SOC War Room", themeColor: 0xef4444, isBoardroom: true },
          { cx: -20.0, cz: -3.0, w: 12.0, d: 8.0, title: "PHÒNG CHIẾN LƯỢC HẠ TẦNG & CLOUD", headName: "Systems Strategy Room", themeColor: 0x38bdf8, isFocusRoom: true },
          { cx: -20.0, cz: -12.5, w: 12.0, d: 9.0, title: "VĂN PHÒNG TỔNG KIẾN TRÚC SƯ HỆ THỐNG", headName: "David Chen (Architect)", themeColor: 0x38bdf8 },
        ],
        6: [
          { cx: -20.0, cz: 8.5, w: 12.0, d: 13.0, title: "PHÒNG HỌP HỘI ĐỒNG QUẢN TRỊ (BOARDROOM)", headName: "Supreme Executive Boardroom", themeColor: 0xd97706, isBoardroom: true },
          { cx: -20.0, cz: -3.0, w: 12.0, d: 8.0, title: "VIỆN NGHIÊN CỨU MÔ HÌNH AI TIÊN TIẾN", headName: "Dr. Elena Rostova (AI Lab)", themeColor: 0x8b5cf6, isFocusRoom: true },
          { cx: -20.0, cz: -12.5, w: 12.0, d: 9.0, title: "VĂN PHÒNG TỔNG GIÁM ĐỐC (CEO SUITE)", headName: "Victoria Vance (CEO)", themeColor: 0xfbbf24 },
        ]
      };

      const suites = SUITE_CONFIGS[floorId] || [];
      const glassMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        transparent: true,
        opacity: 0.28,
        roughness: 0.08,
        metalness: 0.2
      }));
      const darkFrameMat = MAT.darkMetal;

      suites.forEach(suite => {
        const wallH = 5.4;
        const halfW = suite.w / 2;
        const halfD = suite.d / 2;
        const frontX = -14.0; // East-facing glass facade into the main corridor

        // 1. East Glass Facade Wall along X = -14.0 with doorway opening
        const doorOpeningD = 2.2;
        const sidePanelD = (suite.d - doorOpeningD) / 2;
        // North side of East glass facade
        group.add(createMesh(floorId, GEO.box, glassMat, 0.08, wallH, sidePanelD, frontX, wallH / 2, suite.cz - halfD + sidePanelD / 2, false, false));
        // South side of East glass facade
        group.add(createMesh(floorId, GEO.box, glassMat, 0.08, wallH, sidePanelD, frontX, wallH / 2, suite.cz + halfD - sidePanelD / 2, false, false));

        // Black steel frame posts and top lintel along East facade
        group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.12, wallH, 0.12, frontX, wallH / 2, suite.cz - halfD, false, false));
        group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.12, wallH, 0.12, frontX, wallH / 2, suite.cz + halfD, false, false));
        group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.12, wallH, 0.12, frontX, wallH / 2, suite.cz - doorOpeningD / 2, false, false));
        group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.12, wallH, 0.12, frontX, wallH / 2, suite.cz + doorOpeningD / 2, false, false));
        group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.12, 0.14, suite.d, frontX, wallH, suite.cz, false, false));

        // Crittall Black Steel Vertical Mullions dividing East facade into balanced glass panels (Matching Image 2)
        [-sidePanelD / 4, sidePanelD / 4].forEach(off => {
          group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.06, wallH, 0.06, frontX, wallH / 2, suite.cz - halfD + sidePanelD / 2 + off, false, false));
          group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.06, wallH, 0.06, frontX, wallH / 2, suite.cz + halfD - sidePanelD / 2 + off, false, false));
        });

        // Clean White Architectural Ceiling Soffit & Recessed Downlights (Matching Image 2 Room Roofs)
        group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, suite.w, 0.22, suite.d, suite.cx, wallH + 0.11, suite.cz, false, true));
        const downlightMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ color: 0xfef9c3 }));
        [-suite.w * 0.25, suite.w * 0.25].forEach(dx => {
          [-suite.d * 0.25, suite.d * 0.25].forEach(dz => {
            group.add(createMesh(floorId, GEO.cyl, downlightMat, 0.22, 0.04, 0.22, suite.cx + dx, wallH - 0.02, suite.cz + dz, false, false));
          });
        });

        // 2. North Dividing Glass Partition (running East-West between rooms)
        group.add(createMesh(floorId, GEO.box, glassMat, suite.w, wallH, 0.08, suite.cx, wallH / 2, suite.cz - halfD, false, false));
        group.add(createMesh(floorId, GEO.box, darkFrameMat, suite.w, 0.14, 0.12, suite.cx, wallH, suite.cz - halfD, false, false));
        group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.12, wallH, 0.12, suite.cx - halfW, wallH / 2, suite.cz - halfD, false, false));

        // Register Suite Partition & Desk Obstacles in Collision System
        collisionRegistryRef.current.registerObstacle({
          id: `suite-front-wall-${floorId}-${suite.headName}`,
          floor: floorId,
          minX: frontX - 0.25,
          maxX: frontX + 0.25,
          minZ: suite.cz - halfD,
          maxZ: suite.cz + halfD,
          label: `${suite.title} Glass Partition Wall`
        });
        collisionRegistryRef.current.registerObstacle({
          id: `suite-desk-${floorId}-${suite.headName}`,
          floor: floorId,
          minX: suite.cx - 3.2,
          maxX: suite.cx + 3.2,
          minZ: suite.cz - 2.0,
          maxZ: suite.cz + 2.0,
          label: `${suite.title} Table`
        });

        // 3. Illuminated Architectural Nameplate Plaque beside doorway
        const plaqueCanvas = document.createElement("canvas");
        plaqueCanvas.width = 340;
        plaqueCanvas.height = 100;
        const pCtx = plaqueCanvas.getContext("2d")!;
        pCtx.fillStyle = "#090d16";
        pCtx.fillRect(0, 0, 340, 100);
        pCtx.fillStyle = "#" + suite.themeColor.toString(16).padStart(6, "0");
        pCtx.fillRect(0, 0, 10, 100);
        pCtx.fillStyle = "#ffffff";
        pCtx.font = "800 24px 'Plus Jakarta Sans', sans-serif";
        pCtx.fillText(suite.headName, 24, 42);
        pCtx.fillStyle = "#94a3b8";
        pCtx.font = "600 16px 'Plus Jakarta Sans', sans-serif";
        pCtx.fillText(suite.title.substring(0, 30), 24, 74);
        const pTex = new THREE.CanvasTexture(plaqueCanvas);
        const pMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: pTex, depthTest: true, depthWrite: true }));
        const pPlane = new THREE.Mesh(GEO.plane, pMat);
        pPlane.scale.set(1.4, 0.42, 1);
        pPlane.rotation.y = Math.PI / 2; // Faces East into the corridor
        pPlane.position.set(frontX + 0.08, 2.4, suite.cz + doorOpeningD / 2 + 0.85);
        group.add(pPlane);

        if (suite.isBoardroom) {
          // --- GRAND EXECUTIVE BOARDROOM (Matching Image 2 Room 1) ---
          // 1. Large 10-Seat Blonde Oak Conference Table (6.0m x 2.2m)
          const confTableMat = MAT.woodLight;
          group.add(createMesh(floorId, GEO.box, confTableMat, 6.0, 0.14, 2.2, suite.cx, 1.44, suite.cz, true, true));
          [-2.4, 2.4].forEach(bx => {
            group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.25, 1.44, 1.6, suite.cx + bx, 0.72, suite.cz, true, true));
          });
          // 10 Ergonomic Mesh Conference Chairs
          const confChairMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 }));
          [-2.0, -0.7, 0.7, 2.0].forEach(cxOffset => {
            // North seats (facing South)
            group.add(createMesh(floorId, GEO.box, confChairMat, 0.8, 0.12, 0.8, suite.cx + cxOffset, 0.82, suite.cz - 1.45, true, true));
            group.add(createMesh(floorId, GEO.box, confChairMat, 0.76, 0.95, 0.1, suite.cx + cxOffset, 1.35, suite.cz - 1.85, true, true));
            // South seats (facing North)
            group.add(createMesh(floorId, GEO.box, confChairMat, 0.8, 0.12, 0.8, suite.cx + cxOffset, 0.82, suite.cz + 1.45, true, true));
            group.add(createMesh(floorId, GEO.box, confChairMat, 0.76, 0.95, 0.1, suite.cx + cxOffset, 1.35, suite.cz + 1.85, true, true));
          });
          // Head seats (West and East)
          group.add(createMesh(floorId, GEO.box, confChairMat, 0.8, 0.12, 0.8, suite.cx - 3.4, 0.82, suite.cz, true, true));
          group.add(createMesh(floorId, GEO.box, confChairMat, 0.1, 0.95, 0.76, suite.cx - 3.8, 1.35, suite.cz, true, true));
          group.add(createMesh(floorId, GEO.box, confChairMat, 0.8, 0.12, 0.8, suite.cx + 3.4, 0.82, suite.cz, true, true));
          group.add(createMesh(floorId, GEO.box, confChairMat, 0.1, 0.95, 0.76, suite.cx + 3.8, 1.35, suite.cz, true, true));

          // 85" Ultra-Thin Executive OLED Presentation Display on North Wall (Matching Image 2)
          group.add(createMesh(floorId, GEO.box, MAT.blackMetal, 4.4, 2.6, 0.08, suite.cx, 3.4, suite.cz - halfD + 0.12, true, false));
          const oledCanvas = document.createElement("canvas");
          oledCanvas.width = 840;
          oledCanvas.height = 480;
          const oCtx = oledCanvas.getContext("2d")!;
          oCtx.fillStyle = "#090d16";
          oCtx.fillRect(0, 0, 840, 480);
          oCtx.fillStyle = "#1e293b";
          oCtx.fillRect(0, 0, 840, 56);
          oCtx.fillStyle = "#38bdf8";
          oCtx.fillRect(28, 22, 12, 12);
          oCtx.fillStyle = "#f8fafc";
          oCtx.font = "700 22px 'Plus Jakarta Sans', sans-serif";
          oCtx.fillText("PROVIPAGENT • EXECUTIVE BOARDROOM", 52, 34);
          oCtx.fillStyle = "#0f172a";
          oCtx.fillRect(36, 80, 360, 360);
          oCtx.fillRect(430, 80, 374, 360);
          oCtx.fillStyle = "#38bdf8";
          oCtx.font = "800 52px 'Plus Jakarta Sans', sans-serif";
          oCtx.fillText("276", 64, 160);
          oCtx.fillStyle = "#94a3b8";
          oCtx.font = "600 18px 'Plus Jakarta Sans', sans-serif";
          oCtx.fillText("Active AI Specialists Online", 64, 195);
          oCtx.fillStyle = "#34d399";
          oCtx.font = "800 52px 'Plus Jakarta Sans', sans-serif";
          oCtx.fillText("100%", 64, 280);
          oCtx.fillStyle = "#94a3b8";
          oCtx.font = "600 18px 'Plus Jakarta Sans', sans-serif";
          oCtx.fillText("Automated Workforce Operations", 64, 315);
          oCtx.fillStyle = "#f8fafc";
          oCtx.font = "700 20px 'Plus Jakarta Sans', sans-serif";
          oCtx.fillText("Strategy & Growth Velocity Index", 456, 120);
          oCtx.strokeStyle = "#38bdf8";
          oCtx.lineWidth = 4;
          oCtx.beginPath();
          oCtx.moveTo(460, 380);
          oCtx.lineTo(540, 300);
          oCtx.lineTo(620, 330);
          oCtx.lineTo(700, 220);
          oCtx.lineTo(780, 160);
          oCtx.stroke();
          [[460, 380], [540, 300], [620, 330], [700, 220], [780, 160]].forEach(([gx, gy]) => {
            oCtx.fillStyle = "#38bdf8";
            oCtx.beginPath();
            oCtx.arc(gx, gy, 6, 0, Math.PI * 2);
            oCtx.fill();
          });
          const oledTex = new THREE.CanvasTexture(oledCanvas);
          const oledMat = registerFloorMaterial(floorId, new THREE.MeshBasicMaterial({ map: oledTex }));
          group.add(createMesh(floorId, GEO.plane, oledMat, 4.24, 2.44, 1, suite.cx, 3.4, suite.cz - halfD + 0.17, false, false));

          // 3 Modern Brass & Black Cone Drop Pendant Lamps (Matching Image 2)
          [-2.0, 0.0, 2.0].forEach(lx => {
            group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.02, 1.8, 0.02, suite.cx + lx, 4.5, suite.cz, false, false));
            group.add(createMesh(floorId, GEO.cyl, MAT.blackMetal, 0.48, 0.28, 0.48, suite.cx + lx, 3.5, suite.cz, false, false));
            group.add(createMesh(floorId, GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xffedd5 }), 0.18, 0.18, 0.18, suite.cx + lx, 3.38, suite.cz, false, false));
          });

          // Warm architectural pool light over conference table
          const boardLight = new THREE.PointLight(0xffedd5, 1.25, 12);
          boardLight.position.set(suite.cx, 3.2, suite.cz);
          group.add(boardLight);

          // South Glass Wall facing camera with black steel frame and vertical mullions
          const southZ = suite.cz + halfD;
          group.add(createMesh(floorId, GEO.box, glassMat, suite.w, wallH, 0.08, suite.cx, wallH / 2, southZ, false, false));
          group.add(createMesh(floorId, GEO.box, darkFrameMat, suite.w, 0.14, 0.12, suite.cx, wallH, southZ, false, false));
          group.add(createMesh(floorId, GEO.box, darkFrameMat, suite.w, 0.14, 0.12, suite.cx, 0.07, southZ, false, false));
          for (let m = -halfW + 2.0; m < halfW; m += 2.0) {
            group.add(createMesh(floorId, GEO.box, darkFrameMat, 0.08, wallH, 0.08, suite.cx + m, wallH / 2, southZ, false, false));
          }
          group.add(createMesh(floorId, GEO.box, darkFrameMat, suite.w, 0.08, 0.08, suite.cx, 2.2, southZ, false, false));

          // Potted Ficus Tree in Corner
          buildArchitecturalPlant(floorId, group, "fiddle_leaf", "white_cyl", suite.cx - halfW + 1.2, 0, suite.cz - halfD + 1.2, 1.25);
        } else if (suite.isFocusRoom) {
          // --- FOCUS / MEETING ROOM (Matching Image 2 Room 2) ---
          // 1. 6-Seat Blonde Oak Meeting Table (4.2m x 1.8m)
          group.add(createMesh(floorId, GEO.box, MAT.woodLight, 4.2, 0.14, 1.8, suite.cx, 1.44, suite.cz, true, true));
          [-1.6, 1.6].forEach(bx => {
            group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.2, 1.44, 1.3, suite.cx + bx, 0.72, suite.cz, true, true));
          });
          // 6 Mesh Meeting Chairs
          const mChairMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55 }));
          [-1.2, 0.0, 1.2].forEach(cxOffset => {
            // North seats
            group.add(createMesh(floorId, GEO.box, mChairMat, 0.75, 0.12, 0.75, suite.cx + cxOffset, 0.82, suite.cz - 1.25, true, true));
            group.add(createMesh(floorId, GEO.box, mChairMat, 0.72, 0.85, 0.1, suite.cx + cxOffset, 1.30, suite.cz - 1.65, true, true));
            // South seats
            group.add(createMesh(floorId, GEO.box, mChairMat, 0.75, 0.12, 0.75, suite.cx + cxOffset, 0.82, suite.cz + 1.25, true, true));
            group.add(createMesh(floorId, GEO.box, mChairMat, 0.72, 0.85, 0.1, suite.cx + cxOffset, 1.30, suite.cz + 1.65, true, true));
          });

          // 2 Modern Ceiling Drop Pendant Lights with warm pool light
          [-1.0, 1.0].forEach(lx => {
            group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.025, 2.0, 0.025, suite.cx + lx, 4.4, suite.cz, false, false));
            group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.45, 0.25, 0.45, suite.cx + lx, 3.4, suite.cz, false, false));
            group.add(createMesh(floorId, GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xfef08a }), 0.20, 0.20, 0.20, suite.cx + lx, 3.25, suite.cz, false, false));
          });
          const focusLight = new THREE.PointLight(0xffedd5, 0.95, 9);
          focusLight.position.set(suite.cx, 3.2, suite.cz);
          group.add(focusLight);

          // Whiteboard on North Wall
          group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 3.4, 2.0, 0.04, suite.cx, 3.2, suite.cz - halfD + 0.14, false, false));
          group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 3.5, 2.1, 0.02, suite.cx, 3.2, suite.cz - halfD + 0.12, false, false));
        } else {
          // --- PRIVATE EXECUTIVE / DIRECTOR SUITE (Matching Image 2 Room 3) ---
          // 1. Executive Solid Blonde Oak Desk (3.0m x 1.4m)
          const execDeskMat = MAT.woodLight;
          const deskZ = suite.cz - 0.5;
          group.add(createMesh(floorId, GEO.box, execDeskMat, 3.0, 0.14, 1.4, suite.cx, 1.44, deskZ, true, true));
          [-1.35, 1.35].forEach(lx => {
            group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.12, 1.44, 1.2, suite.cx + lx, 0.72, deskZ, true, true));
          });

          // 2. Apple iMac 24" Executive Workstation
          const imacZ = deskZ - 0.28;
          group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.38, 0.015, 0.28, suite.cx, 1.51, imacZ, false, false));
          const execNeck = createMesh(floorId, GEO.box, MAT.chrome, 0.12, 0.38, 0.025, suite.cx, 1.68, imacZ, false, false);
          execNeck.rotation.x = 0.18;
          group.add(execNeck);
          const execBody = createMesh(floorId, GEO.box, MAT.chrome, 1.3, 0.76, 0.028, suite.cx, 2.02, imacZ, true, false);
          execBody.rotation.x = -0.08;
          group.add(execBody);
          const execGlow = createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: suite.themeColor }), 1.22, 0.56, 1, suite.cx, 2.10, imacZ + 0.022, false, false);
          execGlow.rotation.x = -0.08;
          group.add(execGlow);

          // Apple Magic Keyboard & Mouse
          const execMatZ = deskZ + 0.25;
          group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.8 }), 0.95, 0.012, 0.42, suite.cx, 1.51, execMatZ, false, false));
          group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.44, 0.016, 0.16, suite.cx - 0.12, 1.52, execMatZ, false, false));
          group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.42, 0.008, 0.14, suite.cx - 0.12, 1.53, execMatZ, false, false));
          group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.10, 0.022, 0.16, suite.cx + 0.26, 1.52, execMatZ, false, false));

          // 3. Executive High-Back Leather Swivel Chair (Seat for Director / CEO)
          const execChairMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
            color: floorId === 6 ? 0xb45309 : 0x1e293b,
            roughness: 0.5
          }));
          const chairZ = deskZ + 1.1;
          group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.45, 0.08, 0.45, suite.cx, 0.08, chairZ, false, false));
          group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.09, 0.72, 0.09, suite.cx, 0.44, chairZ, false, false));
          group.add(createMesh(floorId, GEO.box, execChairMat, 0.95, 0.15, 0.95, suite.cx, 0.82, chairZ, true, true));
          group.add(createMesh(floorId, GEO.box, execChairMat, 0.90, 1.25, 0.14, suite.cx, 1.50, chairZ + 0.45, true, true));

          // 4. Two Guest Visitor Armchairs facing the desk
          const guestChairMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 }));
          [-0.85, 0.85].forEach(gx => {
            const gz = deskZ - 1.25;
            group.add(createMesh(floorId, GEO.box, guestChairMat, 0.75, 0.12, 0.75, suite.cx + gx, 0.75, gz, true, true));
            group.add(createMesh(floorId, GEO.box, guestChairMat, 0.72, 0.85, 0.10, suite.cx + gx, 1.22, gz - 0.36, true, true));
          });

          // 5. Executive Low Credenza along North Wall
          const credZ = suite.cz - halfD + 0.6;
          group.add(createMesh(floorId, GEO.box, execDeskMat, 3.2, 0.95, 0.6, suite.cx, 0.48, credZ, true, true));
          group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 3.3, 0.06, 0.65, suite.cx, 0.98, credZ, true, true));

          // Potted Monstera Plant
          buildArchitecturalPlant(floorId, group, "monstera", "white_cyl", suite.cx + halfW - 1.1, 0, suite.cz + halfD - 1.1, 1.1);

          // Ceiling Drop Pendant Light
          group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.025, 2.0, 0.025, suite.cx, 4.4, deskZ, false, false));
          group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.45, 0.25, 0.45, suite.cx, 3.4, deskZ, false, false));
          group.add(createMesh(floorId, GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xfef08a }), 0.20, 0.20, 0.20, suite.cx, 3.25, deskZ, false, false));
        }
      });
    };

    // Modern Open Architectural Pantry, Breakfast High Bar & Chill Nook (Matching Image 2 Top-Right)
    // Located along North wall: X in [-11.0, 15.0], Z in [-17.8, -9.5]
    const buildFloorPantryAndLounge = (floorId: number, group: THREE.Group) => {
      // 1. Kitchenette Upper & Lower Cabinetry along North Wall (Z = -17.8, X in [-11.0, -4.0])
      const kx = -7.5, kz = -17.8;
      // Lower oak cabinets & black quartz countertop
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 6.8, 1.1, 1.2, kx, 0.55, kz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 6.9, 0.12, 1.3, kx, 1.16, kz, true, true));
      // Upper oak cabinets mounted on wall
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 6.8, 1.3, 0.75, kx, 4.0, kz - 0.2, true, true));

      // Undermount Stainless Steel Sink & Chrome Gooseneck Faucet
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 1.1, 0.04, 0.7, kx - 1.8, 1.23, kz, false, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.03, 0.45, 0.03, kx - 1.8, 1.45, kz - 0.25, false, false));

      // Commercial Espresso Machine & Microwave
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.85, 0.75, 0.85, kx + 0.8, 1.58, kz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.9, 0.55, 0.65, kx + 2.2, 1.48, kz, true, true));

      // Beverage Glass Cooler Refrigerator (X = -3.5, Z = -16.8)
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 1.2, 3.4, 1.4, -3.5, 1.7, -16.8, true, true));
      const coolerGlassMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
        roughness: 0.1
      }));
      group.add(createMesh(floorId, GEO.plane, coolerGlassMat, 1.1, 3.0, 1, -3.5 - 0.62, 1.7, -16.8, false, false));

      // 5-Gallon Blue Water Cooler (X = -2.0, Z = -16.8)
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.55, 1.25, 0.55, -2.0, 0.62, -16.8, true, true));
      const waterBottleMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x0284c7, transparent: true, opacity: 0.75 }));
      group.add(createMesh(floorId, GEO.cyl, waterBottleMat, 0.35, 0.75, 0.35, -2.0, 1.65, -16.8, true, false));

      // 2. High Breakfast Bar Counter facing North Window with Stools (Matching Image 2)
      // Placed directly in front of the grand center panoramic window bay!
      const barX = 1.8, barZ = -15.2;
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 6.2, 0.12, 1.0, barX, 1.35, barZ, true, true));
      [-2.8, 2.8].forEach(lx => {
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.1, 1.35, 0.8, barX + lx, 0.67, barZ, true, true));
      });
      // 4 Modern Bar Stools (Facing North towards the window view)
      [-2.1, -0.7, 0.7, 2.1].forEach(ox => {
        group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.28, 0.05, 0.28, barX + ox, 0.05, barZ + 0.8, false, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.05, 0.85, 0.05, barX + ox, 0.48, barZ + 0.8, false, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.woodLight, 0.38, 0.10, 0.38, barX + ox, 0.95, barZ + 0.8, true, true));
      });

      // 3. Chill Relaxation Beanbag Nook (Matching Image 2)
      const beanbagMatCyan = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.85 }));
      const beanbagMatOlive = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x84cc16, roughness: 0.85 }));
      const beanbagMatNavy = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.85 }));
      group.add(createMesh(floorId, GEO.sphere, beanbagMatCyan, 0.9, 0.6, 0.9, 8.5, 0.38, -14.0, true, true));
      group.add(createMesh(floorId, GEO.sphere, beanbagMatOlive, 0.9, 0.6, 0.9, 12.0, 0.38, -14.5, true, true));
      group.add(createMesh(floorId, GEO.sphere, beanbagMatNavy, 0.85, 0.55, 0.85, 10.5, 0.35, -11.0, true, true));
      // Low round wooden coffee table
      group.add(createMesh(floorId, GEO.cyl, MAT.woodLight, 0.8, 0.35, 0.8, 10.5, 0.2, -13.0, true, true));
      // Potted palm plant in beanbag corner
      buildArchitecturalPlant(floorId, group, "palm", "terracotta", 14.0, 0, -15.0, 1.15);

      // Register Pantry Interactions & Collisions
      envRegistryRef.current.registerInteraction({
        id: `coffee-${floorId}`,
        floor: floorId,
        type: "coffee",
        spot: { x: kx, z: kz + 1.2, rotY: 0 },
        approachPos: { x: kx, z: -13.0 },
        label: "☕ Đi pha cà phê",
        activeMsg: "☕ Đang uống cà phê",
        propType: "cup"
      });
      envRegistryRef.current.registerInteraction({
        id: `water-${floorId}`,
        floor: floorId,
        type: "water",
        spot: { x: 4.2, z: -15.0, rotY: Math.PI * 0.5 },
        approachPos: { x: 4.2, z: -13.0 },
        label: "💧 Đi lấy nước lọc",
        activeMsg: "💧 Đang uống nước",
        propType: "cup"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `pantry-counter-${floorId}`,
        floor: floorId,
        minX: kx - 5.8,
        maxX: kx + 5.8,
        minZ: kz - 0.8,
        maxZ: kz + 0.8,
        label: "Pantry Kitchenette Counter"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `pantry-bar-${floorId}`,
        floor: floorId,
        minX: barX - 3.8,
        maxX: barX + 3.8,
        minZ: barZ - 0.6,
        maxZ: barZ + 0.6,
        label: "Pantry High Bar Counter"
      });
    };

    // Central Collaboration Lounge (Matching Image 2 Centerpiece)
    // Located at X in [-6.5, 6.5], Z in [-3.5, 4.0]
    const buildCentralCollaborationLounge = (floorId: number, group: THREE.Group) => {
      const lx = 0.0, lz = 0.3;

      // 1. Designer Low-Pile Cream/Beige Area Rug (11.0m x 7.2m)
      const rugMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xedebe6, roughness: 0.95 }));
      group.add(createMesh(floorId, GEO.box, rugMat, 11.0, 0.02, 7.2, lx, 0.01, lz, false, true));

      // 2. Contemporary 3-Seater Light Grey Fabric Sofa (Facing South, towards Pods)
      const sofaGreyMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 }));
      const sNorthZ = lz - 1.6;
      group.add(createMesh(floorId, GEO.box, sofaGreyMat, 4.4, 0.75, 1.4, lx, 0.55, sNorthZ, true, true));
      group.add(createMesh(floorId, GEO.box, sofaGreyMat, 4.2, 0.95, 0.35, lx, 1.05, sNorthZ - 0.6, true, true));
      [-2.1, 2.1].forEach(ax => {
        group.add(createMesh(floorId, GEO.box, sofaGreyMat, 0.35, 0.85, 1.35, lx + ax, 0.70, sNorthZ, true, true));
      });

      // 3. Contemporary 2-Seater Cognac Leather Sofa (Facing North, towards Grey Sofa)
      const sofaCognacMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.75 }));
      const sSouthZ = lz + 1.8;
      group.add(createMesh(floorId, GEO.box, sofaCognacMat, 3.2, 0.75, 1.3, lx, 0.55, sSouthZ, true, true));
      group.add(createMesh(floorId, GEO.box, sofaCognacMat, 3.0, 0.95, 0.35, lx, 1.05, sSouthZ + 0.55, true, true));
      [-1.5, 1.5].forEach(ax => {
        group.add(createMesh(floorId, GEO.box, sofaCognacMat, 0.35, 0.85, 1.25, lx + ax, 0.70, sSouthZ, true, true));
      });

      // 4. Modern Rectangular Blonde Oak Coffee Table
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 2.6, 0.12, 1.2, lx, 0.42, lz, true, true));
      [-1.15, 1.15].forEach(bx => {
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.08, 0.42, 1.0, lx + bx, 0.21, lz, false, false));
      });
      // Ceramic mugs and books on coffee table
      group.add(createMesh(floorId, GEO.cyl, MAT.whitePlastic, 0.1, 0.14, 0.1, lx - 0.4, 0.55, lz + 0.2, false, false));
      group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0x38bdf8 }), 0.35, 0.05, 0.45, lx + 0.4, 0.50, lz - 0.1, false, false));

      // 5. Low Wooden Credenzas Framing the Sides of the Lounge
      const credMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xd8c29d, roughness: 0.55 }));
      // West Credenza
      group.add(createMesh(floorId, GEO.box, credMat, 0.65, 0.95, 3.6, lx - 5.2, 0.48, lz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.70, 0.06, 3.65, lx - 5.2, 0.98, lz, true, true));
      // East Credenza
      group.add(createMesh(floorId, GEO.box, credMat, 0.65, 0.95, 3.6, lx + 5.2, 0.48, lz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.70, 0.06, 3.65, lx + 5.2, 0.98, lz, true, true));

      // Potted Architectural Plants on Credenzas
      buildArchitecturalPlant(floorId, group, "snake_plant", "white_cyl", lx - 5.2, 0.98, lz - 0.9, 0.6);
      buildArchitecturalPlant(floorId, group, "snake_plant", "white_cyl", lx + 5.2, 0.98, lz + 0.9, 0.6);

      // South Credenzas Framing Lounge from Workstation Pods (Matching Image 2)
      group.add(createMesh(floorId, GEO.box, credMat, 3.6, 0.95, 0.65, lx - 2.4, 0.48, 4.8, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 3.65, 0.06, 0.70, lx - 2.4, 0.98, 4.8, true, true));
      buildArchitecturalPlant(floorId, group, "snake_plant", "white_cyl", lx - 2.4, 0.98, 4.8, 0.6);

      group.add(createMesh(floorId, GEO.box, credMat, 3.6, 0.95, 0.65, lx + 2.4, 0.48, 4.8, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 3.65, 0.06, 0.70, lx + 2.4, 0.98, 4.8, true, true));
      buildArchitecturalPlant(floorId, group, "snake_plant", "white_cyl", lx + 2.4, 0.98, 4.8, 0.6);

      // Register Central Lounge Collision & Interaction
      collisionRegistryRef.current.registerObstacle({
        id: `central-lounge-${floorId}`,
        floor: floorId,
        minX: lx - 5.5,
        maxX: lx + 5.5,
        minZ: lz - 2.8,
        maxZ: lz + 2.8,
        label: "Central Collaboration Lounge"
      });
      envRegistryRef.current.registerInteraction({
        id: `lounge-${floorId}`,
        floor: floorId,
        type: "lounge",
        spot: { x: lx, z: sNorthZ + 0.5, rotY: 0 },
        approachPos: { x: lx, z: lz },
        label: "🛋️ Ngồi nghỉ tại Sofa Lounge",
        activeMsg: "🛋️ Đang nghỉ ngơi trao đổi",
        propType: "none"
      });
    };

    // Modern Floor Reception Counter & Slat Acoustic Screen (Matching Image 2 Entrance beside Elevator)
    // Located at X = 21.6, Z = 9.0
    const buildFloorReceptionDesk = (floorId: number, group: THREE.Group) => {
      const rx = 21.6, rz = 9.0;

      // 1. Fluted Blonde Oak Desk with White Marble Countertop
      group.add(createMesh(floorId, GEO.box, MAT.oakFluted, 1.2, 1.15, 3.8, rx, 0.58, rz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.marbleWhite, 1.35, 0.12, 4.0, rx, 1.18, rz, true, true));

      // 2. Company Brand Plaque on Reception Front (Facing West into the corridor)
      const logoCanvas = document.createElement("canvas");
      logoCanvas.width = 420;
      logoCanvas.height = 100;
      const lctx = logoCanvas.getContext("2d")!;
      lctx.fillStyle = "#0f172a";
      lctx.fillRect(0, 0, 420, 100);
      lctx.fillStyle = "#ffffff";
      lctx.font = "800 24px 'Plus Jakarta Sans', sans-serif";
      lctx.fillText("PROVIPAGENT HQ", 50, 42);
      lctx.font = "600 14px 'JetBrains Mono', monospace";
      lctx.fillStyle = "#38bdf8";
      lctx.fillText(`LEVEL 0${floorId} • OPERATIONS`, 50, 72);
      const logoTex = new THREE.CanvasTexture(logoCanvas);
      const logoMesh = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ map: logoTex }));
      logoMesh.scale.set(2.0, 0.48, 1);
      logoMesh.position.set(rx - 0.68, 0.65, rz);
      logoMesh.rotation.y = -Math.PI / 2;
      group.add(logoMesh);

      // 3. Receptionist Workstation (Apple iMac 24", Magic Keyboard, Magic Mouse)
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.36, 0.015, 0.26, rx - 0.1, 1.25, rz, false, false));
      const imacBody = createMesh(floorId, GEO.box, MAT.chrome, 0.028, 0.74, 1.25, rx - 0.1, 1.76, rz, true, false);
      imacBody.rotation.z = 0.08;
      group.add(imacBody);
      const recScreen = createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), 1.18, 0.54, 1, rx - 0.12, 1.83, rz, false, false);
      recScreen.rotation.y = -Math.PI / 2;
      group.add(recScreen);

      // 4. Vertical Oak Slat Acoustic Partition Screen behind Reception
      const slatMat = MAT.oakFluted;
      for (let i = 0; i < 16; i++) {
        const sz = rz - 1.8 + i * 0.24;
        group.add(createMesh(floorId, GEO.box, slatMat, 0.06, 5.2, 0.06, rx + 1.2, 2.6, sz, true, false));
      }

      // 5. Potted Ficus Tree in White Planter beside Reception
      buildArchitecturalPlant(floorId, group, "fiddle_leaf", "white_cyl", rx - 1.2, 0, rz - 2.4, 1.25);

      collisionRegistryRef.current.registerObstacle({
        id: `floor-reception-${floorId}`,
        floor: floorId,
        minX: rx - 1.8,
        maxX: rx + 1.6,
        minZ: rz - 2.4,
        maxZ: rz + 2.4,
        label: "Floor Reception Desk"
      });
    };

    // FLOOR G: Premier Corporate Lobby, Automatic Sliding Glass Doors & Grand Reception
    const buildFloorGMainLobby = (floorId: number, group: THREE.Group) => {
      // 1. Double Automatic Sliding Glass Doors at South Wall Entrance (Z = 17.5, X = 0.0)
      const doorZ = 17.5;
      const doorFrameMat = MAT.chrome;
      const doorGlassMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0x93c5fd,
        transparent: true,
        opacity: 0.45,
        roughness: 0.15
      }));

      // Outer entrance portal frame
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 5.2, 5.4, 0.35, 0.0, 2.7, doorZ, true, true));
      // Top header canopy & sensor bar
      group.add(createMesh(floorId, GEO.box, MAT.blackMetal, 5.4, 0.4, 1.2, 0.0, 5.2, doorZ, false, false));
      const sensorLed = createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: 0x34d399 }), 1.2, 0.06, 0.06, 0.0, 5.0, doorZ + 0.58, false, false);
      group.add(sensorLed);

      // Left and right sliding glass door panels
      const doorW = 1.8;
      const doorH = 4.8;
      const doorL = createMesh(floorId, GEO.box, doorGlassMat, doorW, doorH, 0.08, -0.9, 2.4, doorZ, true, true);
      const doorR = createMesh(floorId, GEO.box, doorGlassMat, doorW, doorH, 0.08, 0.9, 2.4, doorZ, true, true);
      doorL.add(createMesh(floorId, GEO.box, doorFrameMat, doorW, 0.08, 0.1, 0, -doorH / 2 + 0.04, 0, false, false));
      doorL.add(createMesh(floorId, GEO.box, doorFrameMat, doorW, 0.08, 0.1, 0, doorH / 2 - 0.04, 0, false, false));
      doorR.add(createMesh(floorId, GEO.box, doorFrameMat, doorW, 0.08, 0.1, 0, -doorH / 2 + 0.04, 0, false, false));
      doorR.add(createMesh(floorId, GEO.box, doorFrameMat, doorW, 0.08, 0.1, 0, doorH / 2 - 0.04, 0, false, false));
      group.add(doorL, doorR);

      slidingDoorsRef.current = {
        left: doorL,
        right: doorR,
        closedLeftX: -0.9,
        closedRightX: 0.9,
        openOffset: 1.4,
        currentOffset: 0,
      };

      // 2. Grand Luxury Reception Counter (X = 3.5, Z = 8.0)
      const rx = 3.5, rz = 8.0;
      group.add(createMesh(floorId, GEO.box, MAT.oakFluted, 5.6, 1.15, 1.4, rx, 0.58, rz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.marbleWhite, 5.8, 0.12, 1.6, rx, 1.18, rz, true, true));

      // Company 3D Plaque
      const logoCanvas = document.createElement("canvas");
      logoCanvas.width = 512;
      logoCanvas.height = 128;
      const lctx = logoCanvas.getContext("2d")!;
      lctx.fillStyle = "#0f172a";
      lctx.fillRect(0, 0, 512, 128);
      lctx.fillStyle = "#ffffff";
      lctx.font = "800 32px 'Plus Jakarta Sans', sans-serif";
      lctx.fillText("PROVIPAGENT CORP", 88, 52);
      lctx.font = "600 18px 'JetBrains Mono', monospace";
      lctx.fillStyle = "#38bdf8";
      lctx.fillText("GLOBAL AI HEADQUARTERS • FLOOR G", 88, 92);
      lctx.strokeStyle = "#38bdf8";
      lctx.lineWidth = 6;
      lctx.beginPath();
      lctx.arc(46, 64, 26, 0, Math.PI * 2);
      lctx.stroke();

      const logoTex = new THREE.CanvasTexture(logoCanvas);
      const logoMesh = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ map: logoTex }));
      logoMesh.scale.set(2.6, 0.65, 1);
      logoMesh.position.set(rx, 0.65, rz + 0.72);
      group.add(logoMesh);

      // Receptionist Workstation (Apple iMac 24", Magic Keyboard, Magic Mouse)
      const imacZ = rz - 0.25;
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.36, 0.015, 0.26, rx, 1.25, imacZ, false, false));
      const standNeck = createMesh(floorId, GEO.box, MAT.chrome, 0.12, 0.38, 0.025, rx, 1.42, imacZ, false, false);
      standNeck.rotation.x = 0.18;
      group.add(standNeck);
      const imacBody = createMesh(floorId, GEO.box, MAT.chrome, 1.25, 0.74, 0.028, rx, 1.76, imacZ, true, false);
      imacBody.rotation.x = -0.08;
      group.add(imacBody);
      const recScreen = createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), 1.18, 0.54, 1, rx, 1.83, imacZ - 0.02, false, false);
      recScreen.rotation.y = Math.PI;
      group.add(recScreen);

      // Receptionist Chair
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.4, 0.08, 0.4, rx, 0.08, rz - 1.2, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.85, 0.12, 0.85, rx, 0.78, rz - 1.2, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.82, 0.95, 0.1, rx, 1.30, rz - 1.6, true, true));

      // 3. VIP Executive Waiting Lounge (X = -12.0, Z = 0.0)
      const lx = -12.0, lz = 0.0;
      // Designer area rug
      group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 }), 7.5, 0.04, 6.5, lx, 0.02, lz, false, true));
      // 3-Seater grey sofa
      const sofaGreyMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 }));
      group.add(createMesh(floorId, GEO.box, sofaGreyMat, 4.2, 0.75, 1.5, lx, 0.55, lz - 2.2, true, true));
      group.add(createMesh(floorId, GEO.box, sofaGreyMat, 4.0, 0.95, 0.35, lx, 1.05, lz - 2.8, true, true));
      // Cognac leather armchairs
      const sofaLeatherMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.65 }));
      group.add(createMesh(floorId, GEO.box, sofaLeatherMat, 1.5, 0.75, 1.5, lx - 2.8, 0.55, lz + 0.8, true, true));
      group.add(createMesh(floorId, GEO.box, sofaLeatherMat, 0.35, 0.95, 1.3, lx - 3.4, 1.05, lz + 0.8, true, true));
      group.add(createMesh(floorId, GEO.box, sofaLeatherMat, 1.5, 0.75, 1.5, lx + 2.8, 0.55, lz + 0.8, true, true));
      group.add(createMesh(floorId, GEO.box, sofaLeatherMat, 0.35, 0.95, 1.3, lx + 3.4, 1.05, lz + 0.8, true, true));
      // Round marble coffee table
      group.add(createMesh(floorId, GEO.cyl, MAT.marbleWhite, 1.6, 0.40, 1.6, lx, 0.36, lz, true, true));

      // 4. Potted Ficus Trees & Planters
      group.add(createMesh(floorId, GEO.cyl, MAT.potWhite, 0.5, 0.9, 0.5, rx + 3.8, 0.45, rz, true, true));
      group.add(createMesh(floorId, GEO.sphere, MAT.plantGreen, 1.0, 1.4, 1.0, rx + 3.8, 1.6, rz, true, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.potWhite, 0.5, 0.9, 0.5, lx - 4.2, 0.45, lz - 2.2, true, true));
      group.add(createMesh(floorId, GEO.sphere, MAT.plantGreen, 1.0, 1.4, 1.0, lx - 4.2, 1.6, lz - 2.2, true, false));

      // 5. 85" Digital Telemetry Video Wall on West Wall
      buildWallScreenMesh(floorId, group, -26.7, 4.2, 0.0, 5.8, 3.2, {
        title: "PROVIPAGENT CORP • LOBBY TELEMETRY",
        line1: "Global AI Workforce: 276 Active Specialist Agents",
        line2: "Operating Status: Zero latency inference active",
        line3: "Visitor Access: Biometric check-in enabled",
        accent: "#38bdf8"
      });

      // Register Floor G Interactions & Collisions
      envRegistryRef.current.registerInteraction({
        id: `lobby-reception-${floorId}`,
        floor: floorId,
        type: "reception",
        spot: { x: rx, z: rz - 1.2, rotY: 0 },
        approachPos: { x: rx, z: rz + 1.5 },
        label: "🛎️ Quầy lễ tân đón khách",
        activeMsg: "🛎️ Đang hướng dẫn khách VIP",
        propType: "none"
      });
      envRegistryRef.current.registerInteraction({
        id: `lobby-lounge-${floorId}`,
        floor: floorId,
        type: "chatting",
        spot: { x: lx, z: lz - 1.0, rotY: 0 },
        approachPos: { x: lx, z: lz + 1.8 },
        label: "🛋️ Sảnh tiếp khách VIP",
        activeMsg: "💬 Đang tiếp đón đối tác",
        propType: "none"
      });

      collisionRegistryRef.current.registerObstacle({
        id: `lobby-reception-desk-${floorId}`,
        floor: floorId,
        minX: rx - 3.0,
        maxX: rx + 3.0,
        minZ: rz - 1.8,
        maxZ: rz + 1.0,
        label: "Grand Reception Desk"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `lobby-vip-lounge-${floorId}`,
        floor: floorId,
        minX: lx - 3.8,
        maxX: lx + 3.8,
        minZ: lz - 3.2,
        maxZ: lz + 1.8,
        label: "VIP Lounge Suite"
      });
    };

    // FLOOR 1: Operations, Support & Healthcare Service Hub
    const buildFloor1OperationsAndSupport = (floorId: number, group: THREE.Group) => {
      // Build Standard Central Pantry & Coffee
      buildFloorPantryAndLounge(floorId, group);

      // Support & Operations Service Telemetry Wall Screen
      buildWallScreenMesh(floorId, group, -9.0, 4.2, -ROOM_D / 2 + 0.28, 3.8, 2.2, {
        title: "OPERATIONS & SERVICE TELEMETRY (1F)",
        line1: "Workforce Architecture: 4-Person Pod Island System",
        line2: "Support Response Rate: 99.4% SLA Adhered",
        line3: "Suites: Amara (COO) & Liam (Support Lead)",
        accent: "#38bdf8"
      });
    };

    // FLOOR 2: Financial Treasury, Capital Markets & Secure Vault
    const buildFloor2FinancialTreasury = (floorId: number, group: THREE.Group) => {
      // 1. High-Security Steel Records Archive & Vault in East Utility Wing (X = 22.0, Z = -11.0)
      const vx = 22.0, vz = -11.0;
      const vaultMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 }));
      group.add(createMesh(floorId, GEO.box, vaultMat, 3.8, 4.4, 3.2, vx, 2.2, vz, true, true));
      // Heavy Vault Reinforced Door Frame & Round Wheel
      group.add(createMesh(floorId, GEO.box, MAT.blackMetal, 1.8, 3.6, 0.25, vx - 1.95, 2.0, vz, true, true));
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.45, 0.08, 0.45, vx - 2.1, 2.0, vz, false, false));

      // Build Standard Pantry & Coffee
      buildFloorPantryAndLounge(floorId, group);

      // Register Vault Collision Obstacle
      collisionRegistryRef.current.registerObstacle({
        id: `vault-archive-${floorId}`,
        floor: floorId,
        minX: vx - 2.2,
        maxX: vx + 2.2,
        minZ: vz - 1.8,
        maxZ: vz + 1.8,
        label: "Secure Records Archive Vault"
      });
    };

    // FLOOR 3: Growth Marketing, Presentation Amphitheater & Podcast Booth
    const buildFloor3MarketingAndMedia = (floorId: number, group: THREE.Group) => {
      // 1. Soundproof Podcast & Audio Recording Booth in East Utility Wing (X = 22.0, Z = -11.0)
      const px = 22.0, pz = -11.0;
      const boothMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 }));
      group.add(createMesh(floorId, GEO.box, boothMat, 3.8, 4.4, 3.2, px, 2.2, pz, true, true));
      // Illuminated "ON AIR" Sign
      const onAirCanvas = document.createElement("canvas");
      onAirCanvas.width = 160;
      onAirCanvas.height = 60;
      const oaCtx = onAirCanvas.getContext("2d")!;
      oaCtx.fillStyle = "#ef4444";
      oaCtx.fillRect(0, 0, 160, 60);
      oaCtx.fillStyle = "#ffffff";
      oaCtx.font = "900 24px 'Plus Jakarta Sans', sans-serif";
      oaCtx.textAlign = "center";
      oaCtx.fillText("🔴 ON AIR", 80, 40);
      const oaTex = new THREE.CanvasTexture(onAirCanvas);
      const oaPlane = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ map: oaTex }));
      oaPlane.scale.set(1.2, 0.45, 1);
      oaPlane.rotation.y = -Math.PI / 2;
      oaPlane.position.set(px - 1.95, 3.2, pz);
      group.add(oaPlane);

      // Build Standard Pantry & Coffee
      buildFloorPantryAndLounge(floorId, group);

      // Register Podcast Booth Collisions
      collisionRegistryRef.current.registerObstacle({
        id: `podcast-booth-${floorId}`,
        floor: floorId,
        minX: px - 2.2,
        maxX: px + 2.2,
        minZ: pz - 1.8,
        maxZ: pz + 1.8,
        label: "Podcast Soundproof Booth"
      });
    };

    // FLOOR 4: Creative UI/UX Design Studios & Spatial AR/VR Labs
    const buildFloor4DesignAndSpatialLabs = (floorId: number, group: THREE.Group) => {
      // 1. Hardware Prototyping Workshop Benches in East Utility Wing (X = 22.0, Z = -11.0)
      const wx = 22.0, wz = -11.0;
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 3.8, 1.1, 2.4, wx, 0.55, wz, true, true));
      // 3D Printer Props on Workbench
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 1.1, 1.2, 0.9, wx - 0.8, 1.7, wz, true, true));
      group.add(createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), 0.65, 0.45, 0.05, wx - 0.8, 1.6, wz + 0.46, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 1.1, 1.2, 0.9, wx + 0.8, 1.7, wz, true, true));

      // Build Standard Pantry & Coffee
      buildFloorPantryAndLounge(floorId, group);

      // Register Collisions
      collisionRegistryRef.current.registerObstacle({
        id: `workshop-bench-${floorId}`,
        floor: floorId,
        minX: wx - 2.2,
        maxX: wx + 2.2,
        minZ: wz - 1.4,
        maxZ: wz + 1.4,
        label: "Hardware Prototyping Workshop Bench"
      });
    };

    // FLOOR 5: Core Engineering, Cybersecurity SOC (Airy Scandinavian Layout Matching Image 2)
    const buildFloor5CoreEngineeringAndSOC = (floorId: number, group: THREE.Group) => {
      // 1. Agile Sprint Scrum Whiteboard Wall on Solid North Column (X = 5.0, Z = -18.7)
      const sbx = 5.0, sbz = -18.7;
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 3.8, 2.8, 0.14, sbx, 3.2, sbz, true, false));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 3.6, 2.6, 0.05, sbx, 3.2, sbz + 0.08, false, false));
      // Sticky Notes
      const noteCols = [0xfef08a, 0x86efac, 0x93c5fd, 0xfca5a5];
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
          group.add(createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: noteCols[(c + r) % 4] }), 0.28, 0.28, 1, sbx - 1.2 + c * 1.2, 3.8 - r * 0.55, sbz + 0.12, false, false));
        }
      }

      // 2. High-End Scandinavian Storage Credenza with Tech Artifacts & Potted Snake Plants (X = 18.0, Z = -7.5)
      const credX = 18.0, credZ = -7.5;
      const credMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xd8c29d, roughness: 0.55 }));
      group.add(createMesh(floorId, GEO.box, credMat, 0.65, 1.05, 3.6, credX, 0.53, credZ, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.70, 0.06, 3.65, credX, 1.08, credZ, true, true));
      buildArchitecturalPlant(floorId, group, "snake_plant", "white_cyl", credX, 1.08, credZ - 1.0, 0.6);
      buildArchitecturalPlant(floorId, group, "monstera", "white_cyl", credX, 1.08, credZ + 1.0, 0.65);
      // Modern Server / Tech Book Stack
      group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0x0284c7 }), 0.32, 0.16, 0.42, credX, 1.18, credZ, false, false));

      // Build Standard Pantry & Coffee
      buildFloorPantryAndLounge(floorId, group);

      collisionRegistryRef.current.registerObstacle({
        id: `engineering-cred-${floorId}`,
        floor: floorId,
        minX: credX - 0.5,
        maxX: credX + 0.5,
        minZ: credZ - 2.0,
        maxZ: credZ + 2.0,
        label: "Engineering Architectural Storage Credenza"
      });
    };

    // FLOOR 6: Executive Boardroom, Leadership & AI Research Institute
    const buildFloor6ExecutiveAndBoardroom = (floorId: number, group: THREE.Group) => {
      // Build Standard Central Pantry & Coffee
      buildFloorPantryAndLounge(floorId, group);

      // Telemetry Screen for Executive AI Fellowship mounted on solid North column
      buildWallScreenMesh(floorId, group, -9.0, 4.2, -ROOM_D / 2 + 0.28, 3.8, 2.2, {
        title: "EXECUTIVE BOARDROOM & RESEARCH (6F)",
        line1: "CEO Suite: Victoria Vance • Grand 10-Person Executive Boardroom",
        line2: "AI Research: 276 Specialist Collective Intelligence Syndicate",
        line3: "Autonomous Multi-Turn AI Command Center",
        accent: "#d97706"
      });
    };

    // FLOOR 7: Sky Recreation & Entertainment Complex (Billiards, Gaming, Bowling, Swimming Pool, Arcade, Beanbags, Ramen Bar)
    const buildFloor7RecreationCenter = (floorId: number, group: THREE.Group) => {
      // Zone A: Esport Gaming Lounge (X in [-25.5, -11.5], Z in [-16.5, -4.5])
      const gx = -18.5, gz = -10.5;
      [-2.2, -0.7, 0.7, 2.2].forEach((offset, idx) => {
        const xPos = gx + offset;
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 1.3, 0.1, 0.8, xPos, 1.4, gz, true, true));
        group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.25, 0.02, 0.2, xPos, 1.46, gz - 0.25, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.08, 0.35, 0.04, xPos, 1.65, gz - 0.25, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.screenBlack, 1.1, 0.62, 0.04, xPos, 1.95, gz - 0.25, true, false));
        const rgbCol = [0xec4899, 0x8b5cf6, 0x06b6d4, 0x10b981][idx];
        group.add(createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: rgbCol }), 1.05, 0.58, 1, xPos, 1.95, gz - 0.22, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.28, 0.58, 0.55, xPos + 0.5, 0.4, gz, true, true));
        group.add(createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: rgbCol }), 0.02, 0.5, 0.45, xPos + 0.35, 0.4, gz, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.65, 0.12, 0.65, xPos, 0.78, gz + 0.65, true, true));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.6, 0.85, 0.12, xPos, 1.25, gz + 0.95, true, true));
      });
      buildWallScreenMesh(floorId, group, gx, 4.2, -ROOM_D / 2 + 0.28, 5.2, 2.6, {
        title: "PROVIP ESPORT ARENA • CHAMPIONSHIP",
        line1: "Leaderboard: Team Alpha 12 - Team Beta 9",
        line2: "Active Match: 5v5 AI Autonomous League",
        line3: "Tournament FPS: 240Hz Locked",
        accent: "#ec4899"
      });

      // Zone B: Championship 9ft Billiards Lounge (X in [-9.5, 6.5], Z in [-16.5, -4.5])
      const bx = -1.5, bz = -10.5;
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 4.0, 0.75, 2.2, bx, 0.5, bz, true, true));
      [-1.8, 1.8].forEach(lx => {
        [-0.9, 0.9].forEach(lz => {
          group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.16, 0.75, 0.16, bx + lx, 0.4, bz + lz, true, true));
        });
      });
      const feltMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.85 }));
      group.add(createMesh(floorId, GEO.box, feltMat, 3.6, 0.08, 1.8, bx, 0.92, bz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 3.8, 0.16, 0.22, bx, 1.0, bz - 0.95, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 3.8, 0.16, 0.22, bx, 1.0, bz + 0.95, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 0.22, 0.16, 2.0, bx - 1.85, 1.0, bz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 0.22, 0.16, 2.0, bx + 1.85, 1.0, bz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 3.2, 0.06, 0.06, bx, 4.2, bz, false, false));
      [-1.1, 0, 1.1].forEach(lx => {
        group.add(createMesh(floorId, GEO.cyl, MAT.plantGreen, 0.42, 0.32, 0.18, bx + lx, 3.8, bz, false, false));
        group.add(createMesh(floorId, GEO.cyl, new THREE.MeshBasicMaterial({ color: 0xfef08a }), 0.28, 0.04, 0.28, bx + lx, 3.66, bz, false, false));
      });

      // Zone C: 2-Lane Bowling Alley (X in [-25.5, -5.0], Z in [3.5, 16.5])
      const bowX = -15.0;
      [-2.0, 2.0].forEach(laneOffset => {
        const lx = bowX + laneOffset;
        group.add(createMesh(floorId, GEO.box, MAT.woodLight, 1.6, 0.15, 12.0, lx, 0.1, 10.0, true, true));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.35, 0.1, 12.0, lx - 0.95, 0.06, 10.0, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.35, 0.1, 12.0, lx + 0.95, 0.06, 10.0, false, false));
        const pinMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
        for (let r = 0; r < 4; r++) {
          for (let p = 0; p <= r; p++) {
            const px = lx + (p - r / 2) * 0.22;
            const pz = 14.6 + r * 0.24;
            group.add(createMesh(floorId, GEO.cyl, pinMat, 0.06, 0.36, 0.06, px, 0.32, pz, false, false));
          }
        }
      });
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.4, 0.7, 10.0, bowX, 0.35, 9.0, true, true));
      [0x3b82f6, 0xef4444, 0x10b981].forEach((col, i) => {
        group.add(createMesh(floorId, GEO.sphere, new THREE.MeshBasicMaterial({ color: col }), 0.18, 0.18, 0.18, bowX, 0.8, 5.0 + i * 0.4, false, false));
      });

      // Zone D: Resort Swimming Pool & Deck (X in [8.5, 25.5], Z in [-16.5, 2.5])
      const poolX = 16.5, poolZ = -7.0;
      group.add(createMesh(floorId, GEO.box, MAT.marbleWhite, 8.8, 0.2, 7.8, poolX, 0.1, poolZ, true, true));
      const waterMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.75,
        roughness: 0.1,
        metalness: 0.1
      }));
      group.add(createMesh(floorId, GEO.box, waterMat, 8.0, 0.18, 7.0, poolX, 0.08, poolZ, false, true));
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.04, 1.2, 0.04, poolX - 3.8, 0.6, poolZ - 3.2, false, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.04, 1.2, 0.04, poolX - 3.4, 0.6, poolZ - 3.2, false, false));
      [-2.2, 0.0, 2.2].forEach(lz => {
        const lx = poolX - 5.5;
        group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 1.8, 0.25, 0.8, lx, 0.15, poolZ + lz, true, true));
        group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 1.7, 0.1, 0.75, lx, 0.32, poolZ + lz, true, true));
      });

      // Zone E: Beanbag Chill & Meditation Lounge (X in [6.5, 18.0], Z in [4.5, 16.5])
      const bbx = 12.0, bbz = 10.5;
      const beanCols = [0x10b981, 0xf97316, 0x64748b, 0xfacc15];
      [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].forEach(([ox, oz], i) => {
        const bbMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: beanCols[i], roughness: 0.85 }));
        const bb = createMesh(floorId, GEO.sphere, bbMat, 0.85, 0.55, 0.85, bbx + ox, 0.35, bbz + oz, true, true);
        group.add(bb);
      });
      group.add(createMesh(floorId, GEO.cyl, MAT.woodWarm, 1.2, 0.35, 1.2, bbx, 0.2, bbz, true, true));

      // Zone F: Retro Arcade Arena (X in [-25.5, -13.5], Z in [-3.5, 2.5])
      const arcX = -18.5, arcZ = -0.5;
      [-1.8, 0.0, 1.8].forEach((ox, i) => {
        const cabColor = [0x1e3a8a, 0x581c87, 0x065f46][i];
        const screenColor = [0x38bdf8, 0xf472b6, 0x34d399][i];
        group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: cabColor, roughness: 0.4 }), 1.3, 3.4, 1.3, arcX + ox, 1.7, arcZ - 1.2, true, true));
        group.add(createMesh(floorId, GEO.box, new THREE.MeshBasicMaterial({ color: screenColor }), 1.1, 0.85, 0.08, arcX + ox, 2.2, arcZ - 0.55, false, false));
        group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 1.2, 0.15, 0.6, arcX + ox, 1.45, arcZ - 0.3, true, true));
      });

      // Zone G: Ramen & Cocktail Social Bar (X in [-2.0, 7.0], Z in [-2.0, 2.5])
      const barX = 2.5, barZ = 0.0;
      group.add(createMesh(floorId, GEO.box, MAT.woodWarm, 4.6, 1.1, 1.2, barX, 0.55, barZ, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 4.8, 0.12, 1.35, barX, 1.12, barZ, true, true));
      [-1.6, -0.5, 0.5, 1.6].forEach(ox => {
        group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.32, 0.06, 0.32, barX + ox, 0.06, barZ + 1.2, false, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.06, 0.78, 0.06, barX + ox, 0.45, barZ + 1.2, false, false));
        group.add(createMesh(floorId, GEO.cyl, MAT.woodWarm, 0.36, 0.12, 0.36, barX + ox, 0.86, barZ + 1.2, true, true));
      });

      // Register Floor 7 Recreation Interactions
      envRegistryRef.current.registerInteraction({
        id: `billiards-${floorId}`,
        floor: floorId,
        type: "billiards",
        spot: { x: bx - 1.5, z: bz, rotY: Math.PI * 0.5 },
        approachPos: { x: bx, z: bz + 1.8 },
        label: "🎱 Đi chơi bida",
        activeMsg: "🎱 Đang chơi bida",
        propType: "cue"
      });
      envRegistryRef.current.registerInteraction({
        id: `gaming-${floorId}`,
        floor: floorId,
        type: "gaming",
        spot: { x: gx, z: gz + 0.65, rotY: 0 },
        approachPos: { x: gx, z: gz + 1.5 },
        label: "🎮 Đi đấu Game RGB",
        activeMsg: "🎮 Đang chơi game Esport",
        propType: "none"
      });
      envRegistryRef.current.registerInteraction({
        id: `snack-${floorId}`,
        floor: floorId,
        type: "snack",
        spot: { x: barX, z: barZ + 1.2, rotY: 0 },
        approachPos: { x: barX, z: barZ + 2.0 },
        label: "🍜 Đi ăn mì Ramen & Bar",
        activeMsg: "🍜 Đang thưởng thức mì Ramen",
        propType: "none"
      });

      // Register Floor 7 Collisions
      collisionRegistryRef.current.registerObstacle({
        id: `rec-billiards-${floorId}`,
        floor: floorId,
        minX: bx - 2.2,
        maxX: bx + 2.2,
        minZ: bz - 1.3,
        maxZ: bz + 1.3,
        label: "Championship Billiards Table"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `rec-bowling-${floorId}`,
        floor: floorId,
        minX: bowX - 3.8,
        maxX: bowX + 3.8,
        minZ: 3.5,
        maxZ: 16.5,
        label: "Bowling Alley Lanes"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `rec-pool-${floorId}`,
        floor: floorId,
        minX: poolX - 4.6,
        maxX: poolX + 4.6,
        minZ: poolZ - 4.1,
        maxZ: poolZ + 4.1,
        label: "Resort Swimming Pool"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `rec-bar-${floorId}`,
        floor: floorId,
        minX: barX - 2.5,
        maxX: barX + 2.5,
        minZ: barZ - 0.8,
        maxZ: barZ + 0.8,
        label: "Ramen & Cocktail Social Bar"
      });
    };

    // Build 8 Structured Corporate Floors (G to 7F) with ROOM_W = 54, ROOM_D = 38, H = 8.5
    for (let f = 0; f <= 7; f++) {
      const cfg = FLOORS[f];
      const group = new THREE.Group();
      group.position.y = f * FLOOR_HEIGHT;
      scene.add(group);
      floorGroupsRef.current[f] = group;

      const floorMat = registerFloorMaterial(f, new THREE.MeshStandardMaterial({
        color: cfg.floorColor,
        roughness: 0.38,
        metalness: 0.05
      }));
      const wallMat = registerFloorMaterial(f, new THREE.MeshStandardMaterial({
        color: cfg.wallColor,
        roughness: 0.65
      }));
      const trimMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });

      // Slab & Baseboard
      group.add(createMesh(f, GEO.box, floorMat, ROOM_W, 0.6, ROOM_D, 0, -0.3, 0, false, true));
      group.add(createMesh(f, GEO.box, MAT.darkMetal, ROOM_W + 0.4, 0.2, ROOM_D + 0.4, 0, -0.5, 0, false, false));

      // Clean Architectural Model Cutaway Fascia & Black Capping Trim (Matching Image 2 Isometric Perimeter)
      group.add(createMesh(f, GEO.box, MAT.whitePlastic, ROOM_W, 0.58, 0.16, 0, -0.29, ROOM_D / 2 + 0.08, false, true));
      group.add(createMesh(f, GEO.box, MAT.darkMetal, ROOM_W, 0.06, 0.22, 0, 0.03, ROOM_D / 2 + 0.08, false, false));
      group.add(createMesh(f, GEO.box, MAT.whitePlastic, 0.16, 0.58, ROOM_D, ROOM_W / 2 + 0.08, -0.29, 0, false, true));
      group.add(createMesh(f, GEO.box, MAT.darkMetal, 0.22, 0.06, ROOM_D, ROOM_W / 2 + 0.08, 0.03, 0, false, false));

      // Cutaway Walls with Architectural Window Bays (North & West Exterior Walls)
      const wallH = 6.8;

      // 1. NORTH WALL (Z = -ROOM_D / 2 = -19.0) with 3 Large Floor-to-Ceiling Panoramic Window Bays
      const nwZ = -ROOM_D / 2;
      // Solid structural columns (NW corner, center-left, center-right, East utility)
      group.add(createMesh(f, GEO.box, wallMat, 6.0, wallH, 0.5, -24.0, wallH / 2, nwZ, true, true)); // NW corner [ -27, -21 ]
      group.add(createMesh(f, GEO.box, wallMat, 4.0, wallH, 0.5, -9.0, wallH / 2, nwZ, true, true));  // Column 1 [ -11, -7 ]
      group.add(createMesh(f, GEO.box, wallMat, 4.0, wallH, 0.5, 7.0, wallH / 2, nwZ, true, true));   // Column 2 [ 5, 9 ]
      group.add(createMesh(f, GEO.box, wallMat, 10.0, wallH, 0.5, 22.0, wallH / 2, nwZ, true, true)); // East utility [ 17, 27 ]
      // Top header trim along entire North wall
      group.add(createMesh(f, GEO.box, trimMat, ROOM_W + 0.5, 0.2, 0.6, 0, wallH + 0.06, nwZ, false, false));

      // 3 Panoramic Window Openings on North Wall:
      // Bay 1: X in [-21, -11] (10m wide)
      // Bay 2: X in [-7, 5] (12m wide - directly behind the high bar counter!)
      // Bay 3: X in [9, 17] (8m wide - directly behind the beanbag nook!)
      const northWindowBays = [
        { cx: -16.0, w: 10.0 },
        { cx: -1.0, w: 12.0 },
        { cx: 13.0, w: 8.0 },
      ];

      northWindowBays.forEach(bay => {
        // Lower sill apron (spandrel)
        group.add(createMesh(f, GEO.box, wallMat, bay.w, 0.8, 0.5, bay.cx, 0.4, nwZ, true, true));
        // Upper header beam
        group.add(createMesh(f, GEO.box, wallMat, bay.w, 0.8, 0.5, bay.cx, wallH - 0.4, nwZ, true, true));
        // Slim dark window casing around the opening borders (open window!)
        const caseThick = 0.12;
        const caseDepth = 0.16;
        const bayOpenH = wallH - 1.6;
        const bayMidY = wallH / 2;
        // Left jamb
        group.add(createMesh(f, GEO.box, MAT.blackMetal, caseThick, bayOpenH, caseDepth, bay.cx - bay.w / 2 + caseThick / 2, bayMidY, nwZ + 0.22, false, false));
        // Right jamb
        group.add(createMesh(f, GEO.box, MAT.blackMetal, caseThick, bayOpenH, caseDepth, bay.cx + bay.w / 2 - caseThick / 2, bayMidY, nwZ + 0.22, false, false));
        // Top header trim
        group.add(createMesh(f, GEO.box, MAT.blackMetal, bay.w, caseThick, caseDepth, bay.cx, wallH - 0.8 - caseThick / 2, nwZ + 0.22, false, false));
        // Bottom sill trim
        group.add(createMesh(f, GEO.box, MAT.blackMetal, bay.w, caseThick, caseDepth, bay.cx, 0.8 + caseThick / 2, nwZ + 0.22, false, false));

        // Clear sky-tinted panoramic glass
        const winGlassMat = registerFloorMaterial(f, new THREE.MeshStandardMaterial({
          color: 0xe0f2fe,
          roughness: 0.05,
          transparent: true,
          opacity: 0.16,
          depthWrite: false
        }));
        group.add(createMesh(f, GEO.plane, winGlassMat, bay.w - 0.24, bayOpenH - 0.2, 1, bay.cx, bayMidY, nwZ + 0.24, false, false));
        // Vertical mullions dividing each bay into 3-4 glass panes
        const mullionStep = bay.w / 4;
        for (let m = 1; m < 4; m++) {
          group.add(createMesh(f, GEO.box, MAT.blackMetal, 0.08, bayOpenH, 0.08, bay.cx - bay.w / 2 + m * mullionStep, bayMidY, nwZ + 0.26, false, false));
        }
        // Horizontal transom bar at eye level
        group.add(createMesh(f, GEO.box, MAT.blackMetal, bay.w, 0.08, 0.08, bay.cx, 4.0, nwZ + 0.26, false, false));
      });

      // 2. WEST WALL (X = -ROOM_W / 2 = -27.0) with 2 Large Floor-to-Ceiling Panoramic Window Bays
      const wwX = -ROOM_W / 2;
      // Solid structural columns (NW corner, center dividing column, SW corner)
      group.add(createMesh(f, GEO.box, wallMat, 0.5, wallH, 4.0, wwX, wallH / 2, -17.0, true, true)); // NW [ -19, -15 ]
      group.add(createMesh(f, GEO.box, wallMat, 0.5, wallH, 4.0, wwX, wallH / 2, -1.0, true, true));  // Center [ -3, 1 ]
      group.add(createMesh(f, GEO.box, wallMat, 0.5, wallH, 6.0, wwX, wallH / 2, 16.0, true, true));  // SW [ 13, 19 ]
      // Top header trim along entire West wall
      group.add(createMesh(f, GEO.box, trimMat, 0.6, 0.2, ROOM_D + 0.5, wwX, wallH + 0.06, 0, false, false));

      // 2 Panoramic Window Openings on West Wall:
      // Bay 1: Z in [-15, -3] (12m wide - in Focus Room & Executive Suite)
      // Bay 2: Z in [1, 13] (12m wide - in Grand Boardroom!)
      const westWindowBays = [
        { cz: -9.0, d: 12.0 },
        { cz: 7.0, d: 12.0 },
      ];

      westWindowBays.forEach(bay => {
        // Lower sill apron
        group.add(createMesh(f, GEO.box, wallMat, 0.5, 0.8, bay.d, wwX, 0.4, bay.cz, true, true));
        // Upper header beam
        group.add(createMesh(f, GEO.box, wallMat, 0.5, 0.8, bay.d, wwX, wallH - 0.4, bay.cz, true, true));
        // Slim dark window casing around opening borders (open window!)
        const caseThick = 0.12;
        const caseDepth = 0.16;
        const bayOpenH = wallH - 1.6;
        const bayMidY = wallH / 2;
        // North jamb
        group.add(createMesh(f, GEO.box, MAT.blackMetal, caseDepth, bayOpenH, caseThick, wwX + 0.22, bayMidY, bay.cz - bay.d / 2 + caseThick / 2, false, false));
        // South jamb
        group.add(createMesh(f, GEO.box, MAT.blackMetal, caseDepth, bayOpenH, caseThick, wwX + 0.22, bayMidY, bay.cz + bay.d / 2 - caseThick / 2, false, false));
        // Top header trim
        group.add(createMesh(f, GEO.box, MAT.blackMetal, caseDepth, caseThick, bay.d, wwX + 0.22, wallH - 0.8 - caseThick / 2, bay.cz, false, false));
        // Bottom sill trim
        group.add(createMesh(f, GEO.box, MAT.blackMetal, caseDepth, caseThick, bay.d, wwX + 0.22, 0.8 + caseThick / 2, bay.cz, false, false));

        // Clear sky-tinted panoramic glass
        const winGlassMat = registerFloorMaterial(f, new THREE.MeshStandardMaterial({
          color: 0xe0f2fe,
          roughness: 0.05,
          transparent: true,
          opacity: 0.16,
          depthWrite: false
        }));
        const wGlass = createMesh(f, GEO.plane, winGlassMat, bay.d - 0.24, bayOpenH - 0.2, 1, wwX + 0.24, bayMidY, bay.cz, false, false);
        wGlass.rotation.y = Math.PI / 2;
        group.add(wGlass);
        // Vertical mullions
        const mullionStep = bay.d / 4;
        for (let m = 1; m < 4; m++) {
          group.add(createMesh(f, GEO.box, MAT.blackMetal, 0.08, bayOpenH, 0.08, wwX + 0.26, bayMidY, bay.cz - bay.d / 2 + m * mullionStep, false, false));
        }
        // Horizontal transom bar
        group.add(createMesh(f, GEO.box, MAT.blackMetal, 0.08, 0.08, bay.d, wwX + 0.26, 4.0, bay.cz, false, false));
      });

      // 3. EXTERIOR 3D CITY SKYLINE (Visible through North & West windows)
      const skyTowerConfigs = [
        // North Skyline (Z in [-32, -22], X in [-24, 20])
        { x: -22.0, z: -25.0, w: 7.5, h: 22.0, d: 6.5, col: 0x94a3b8 },
        { x: -14.0, z: -28.0, w: 6.0, h: 28.0, d: 5.5, col: 0x64748b },
        { x: -5.0,  z: -24.0, w: 8.0, h: 18.0, d: 7.0, col: 0xcbd5e1 },
        { x: 3.0,   z: -27.0, w: 5.5, h: 32.0, d: 6.0, col: 0x475569 },
        { x: 12.0,  z: -25.0, w: 7.0, h: 24.0, d: 6.0, col: 0x94a3b8 },
        { x: 20.0,  z: -28.0, w: 8.5, h: 19.0, d: 7.0, col: 0x64748b },

        // West Skyline (X in [-38, -30], Z in [-16, 16])
        { x: -33.0, z: -14.0, w: 6.5, h: 26.0, d: 6.0, col: 0x64748b },
        { x: -35.0, z: -6.0,  w: 7.0, h: 30.0, d: 6.5, col: 0x334155 },
        { x: -32.0, z: 2.0,   w: 6.0, h: 20.0, d: 7.0, col: 0x94a3b8 },
        { x: -36.0, z: 10.0,  w: 7.5, h: 25.0, d: 6.0, col: 0x475569 },
        { x: -33.0, z: 16.0,  w: 6.0, h: 17.0, d: 5.5, col: 0xcbd5e1 },
      ];

      skyTowerConfigs.forEach(st => {
        // Skyscraper body in soft atmospheric mist
        const towerMat = new THREE.MeshStandardMaterial({ color: st.col, roughness: 0.6, metalness: 0.1 });
        group.add(createMesh(f, GEO.box, towerMat, st.w, st.h, st.d, st.x, st.h / 2, st.z, false, false));
        // Rooftop mechanical penthouse
        group.add(createMesh(f, GEO.box, MAT.darkMetal, st.w * 0.5, 2.5, st.d * 0.5, st.x, st.h + 1.25, st.z, false, false));
        // Soft daylight reflective glass facade strips (matching Image 2)
        const facadeMat = new THREE.MeshBasicMaterial({ color: 0xbfdbfe });
        group.add(createMesh(f, GEO.box, facadeMat, st.w * 0.85, st.h * 0.75, 0.05, st.x, st.h * 0.45, st.z + st.d / 2 + 0.03, false, false));
      });

      // Dark Skirting Baseboard along solid perimeter columns
      group.add(createMesh(f, GEO.box, MAT.skirtingDark, ROOM_W + 0.1, 0.22, 0.55, 0, 0.11, nwZ, true, true));

      // Interior Wall Plaque (Mounted on Solid North Pillar at X = 7.0)
      const signMesh = buildFloorSign(f, cfg);
      signMesh.position.set(7.0, 5.2, nwZ + 0.28);
      group.add(signMesh);

      // Register Room Perimeter Wall Obstacles in Collision System
      collisionRegistryRef.current.registerObstacle({
        id: `wall-north-${f}`,
        floor: f,
        minX: -ROOM_W / 2 - 1,
        maxX: ROOM_W / 2 + 1,
        minZ: -ROOM_D / 2 - 1,
        maxZ: -ROOM_D / 2 + 0.5,
        label: "North Perimeter Wall"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `wall-west-${f}`,
        floor: f,
        minX: -ROOM_W / 2 - 1,
        maxX: -ROOM_W / 2 + 0.5,
        minZ: -ROOM_D / 2 - 1,
        maxZ: ROOM_D / 2 + 1,
        label: "West Perimeter Wall"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `wall-south-${f}`,
        floor: f,
        minX: -ROOM_W / 2 - 1,
        maxX: ROOM_W / 2 + 1,
        minZ: ROOM_D / 2 - 0.5,
        maxZ: ROOM_D / 2 + 1,
        label: "South Perimeter Boundary"
      });
      collisionRegistryRef.current.registerObstacle({
        id: `wall-east-${f}`,
        floor: f,
        minX: ROOM_W / 2 - 0.5,
        maxX: ROOM_W / 2 + 1,
        minZ: -ROOM_D / 2 - 1,
        maxZ: ROOM_D / 2 + 1,
        label: "East Perimeter Boundary"
      });

      // Vertical Circulation Core: Elevator & Modern Staircase (Zero Overlap!)
      buildElevatorAndStairs(f, group);

      // Permanently Aligned Restroom Core with 6m Westward Aisle (Zero Obstruction!)
      buildRealisticRestroom(f, group);

      // Floor Programming Routing
      if (f === 0) {
        // Floor G: Luxury Reception & Automatic Sliding Glass Doors (Strictly NO departmental workstations)
        buildFloorGMainLobby(f, group);
      } else if (f >= 1 && f <= 6) {
        // Office Floors: Private Executive Suites, Pantry & Bar, Central Lounge, Floor Reception, and 4-Person Island Pods (Matching Image 2)
        buildPrivateExecutiveSuites(f, group);
        buildFloorPantryAndLounge(f, group);
        buildCentralCollaborationLounge(f, group);
        buildFloorReceptionDesk(f, group);

        if (f === 1) {
          buildFloor1OperationsAndSupport(f, group);
        } else if (f === 2) {
          buildFloor2FinancialTreasury(f, group);
          buildWallScreenMesh(f, group, -9.0, 4.2, -ROOM_D / 2 + 0.28, 3.8, 2.2, {
            title: "FINANCIAL CONTROLLER & TREASURY (2F)",
            line1: "Token Budget Efficiency: 92% Zero-Cost Policy",
            line2: "Capital Reserves: $2.4M Solid Runway",
            line3: "Executive Suite: Julian (CFO) & Audit Chamber",
            accent: "#34d399"
          });
        } else if (f === 3) {
          buildFloor3MarketingAndMedia(f, group);
          buildWallScreenMesh(f, group, -9.0, 4.2, -ROOM_D / 2 + 0.28, 3.8, 2.2, {
            title: "GROWTH MARKETING & ENTERPRISE SALES (3F)",
            line1: "Lead Velocity: +38% MoM Acceleration",
            line2: "Omnichannel Ads: ROAS 4.8x Achieved",
            line3: "Executive Suites: Sophia (CMO) & Marcus (VP Sales)",
            accent: "#f472b6"
          });
        } else if (f === 4) {
          buildFloor4DesignAndSpatialLabs(f, group);
          buildWallScreenMesh(f, group, -9.0, 4.2, -ROOM_D / 2 + 0.28, 3.8, 2.2, {
            title: "CREATIVE STUDIO & SPATIAL COMPUTING (4F)",
            line1: "Apple iMac 24\" + Magic Keyboard & Mouse Setup",
            line2: "Smooth Dynamic Behaviors: Anti-Clipping, Drinking Props",
            line3: "Executive Suites: Hana (Design) & Spatial Lab",
            accent: "#c084fc"
          });
        } else if (f === 5) {
          buildFloor5CoreEngineeringAndSOC(f, group);
          buildWallScreenMesh(f, group, -9.0, 4.2, -ROOM_D / 2 + 0.28, 3.8, 2.2, {
            title: "CORE ENGINEERING & CYBERSECURITY SOC (5F)",
            line1: "Workforce: 101 Specialists in 4-Person Pods",
            line2: "Zero-Lag Direct Tracking: Click to Follow Specialist",
            line3: "Executive Suite: David Chen (Systems Architect) & SOC",
            accent: "#0284c7"
          });
        } else if (f === 6) {
          buildFloor6ExecutiveAndBoardroom(f, group);
        }

        // Pre-build all 4-Person Pod Islands for Floor f
        Object.entries(DIVISION_FLOOR_MAPPING).forEach(([divKey, divInfo]) => {
          if (divInfo.floor === f) {
            const podCenters = DIVISION_POD_CENTERS[divKey] || [];
            const divCol = DIVISION_THEME_COLORS[divKey] || 0x3b82f6;
            podCenters.forEach((center, podIdx) => {
              const podId = `pod-${divKey}-${podIdx}`;
              builtPodsRef.current.add(`${f}-${podId}`);
              buildFourPersonPod(f, group, center.x, center.z, divCol, podId);
            });
          }
        });

        // Mid-East Blonde Oak Storage Cabinet between Pod 3 and Pod 4 (Matching Image 2)
        const cabX = 12.5, cabZ = -4.5;
        group.add(createMesh(f, GEO.box, MAT.woodLight, 2.8, 1.35, 0.65, cabX, 0.68, cabZ, true, true));
        group.add(createMesh(f, GEO.box, MAT.whitePlastic, 2.85, 0.06, 0.70, cabX, 1.38, cabZ, true, true));
        buildArchitecturalPlant(f, group, "snake_plant", "white_cyl", cabX - 0.8, 1.38, cabZ, 0.55);
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x38bdf8 }), 0.26, 0.28, 0.38, cabX + 0.6, 1.54, cabZ, false, false));
        group.add(createMesh(f, GEO.box, new THREE.MeshStandardMaterial({ color: 0x64748b }), 0.26, 0.28, 0.38, cabX + 0.9, 1.54, cabZ, false, false));

        // Architectural Potted Plants along perimeter
        buildArchitecturalPlant(f, group, "fiddle_leaf", "terracotta", -ROOM_W / 2 + 2.5, 0, ROOM_D / 2 - 2.5, 1.3);
        buildArchitecturalPlant(f, group, "monstera", "white_cyl", ROOM_W / 2 - 2.5, 0, ROOM_D / 2 - 2.5, 1.2);
      } else if (f === 7) {
        // Floor 7: Sky Recreation & Entertainment Complex (Strictly NO departmental workstations)
        buildFloor7RecreationCenter(f, group);
      }
    }

    // Build Chibi Characters with Props & Anti-Clipping Physics
    class Chibi {
      cfg: AgentConfig;
      floor: number;
      state: "sitting" | "walking" | "standing" | "coffee" | "water" | "billiards" | "gaming" | "snack" | "chatting" | "restroom" | "bookshelf" | "lounge" | "reception" | "bowling" | "swimming" | "arcade";
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
      cupMesh: THREE.Mesh;
      cueMesh: THREE.Mesh;
      signCanvas: HTMLCanvasElement;
      signCtx: CanvasRenderingContext2D;
      signTex: THREE.CanvasTexture;
      signMesh: THREE.Mesh;
      isHovered: boolean = false;
      isSelected: boolean = false;
      hasActiveSpeech: boolean = false;
      speechTimeout: any = null;
      currentActionLabel: string = "Đang gõ code tại bàn";
      breakTimeout: any = null;
      assignedChairPos: { x: number; z: number; rotY: number };
      assignedDeskPos: { x: number; z: number };

      constructor(cfg: AgentConfig) {
        this.cfg = cfg;
        this.floor = cfg.floor;
        this.state = "sitting";
        this.walkPhase = 0;
        this.waypoints = [];
        this.onArrivalCallback = null;
        this.assignedChairPos = { ...cfg.chairPos };
        this.assignedDeskPos = { ...cfg.deskPos };

        const parentFloor = floorGroupsRef.current[this.floor] || scene;
        this.root = new THREE.Group();
        parentFloor.add(this.root);

        this.bodyGroup = new THREE.Group();
        this.root.add(this.bodyGroup);

        const shirtMat = registerFloorMaterial(this.floor, new THREE.MeshStandardMaterial({
          color: this.cfg.shirtColor,
          roughness: 0.55
        }));
        const pantsMat = registerFloorMaterial(this.floor, new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.7
        }));
        const skinMat = registerFloorMaterial(this.floor, new THREE.MeshStandardMaterial({
          color: this.cfg.skinColor,
          roughness: 0.5
        }));
        const hairMat = registerFloorMaterial(this.floor, new THREE.MeshStandardMaterial({
          color: this.cfg.hairColor,
          roughness: 0.65
        }));
        const blushMat = registerFloorMaterial(this.floor, new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
        const eyeMat = registerFloorMaterial(this.floor, new THREE.MeshBasicMaterial({ color: 0x090d16 }));

        // Slender Architectural Torso (Smart Office Blazer / Shirt)
        this.torso = new THREE.Mesh(GEO.cyl, shirtMat);
        this.torso.scale.set(0.32, 0.54, 0.22);
        this.torso.position.y = 0.88;
        this.torso.castShadow = true;
        this.bodyGroup.add(this.torso);

        // Stylish Architectural Head (Human-Proportioned)
        this.headGroup = new THREE.Group();
        this.headGroup.position.set(0, 1.38, 0);
        this.bodyGroup.add(this.headGroup);

        const headMesh = new THREE.Mesh(GEO.sphere, skinMat);
        headMesh.scale.set(0.24, 0.26, 0.24);
        headMesh.castShadow = true;
        this.headGroup.add(headMesh);

        // Styled Hair Cut
        const hairMesh = new THREE.Mesh(GEO.sphere, hairMat);
        hairMesh.scale.set(0.26, 0.24, 0.26);
        hairMesh.position.set(0, 0.08, -0.02);
        hairMesh.castShadow = true;
        this.headGroup.add(hairMesh);

        // Face Features
        const leftEye = new THREE.Mesh(GEO.sphere, eyeMat);
        leftEye.scale.set(0.035, 0.045, 0.02);
        leftEye.position.set(-0.08, 0.01, 0.22);
        const rightEye = leftEye.clone();
        rightEye.position.x = 0.08;

        const leftBlush = new THREE.Mesh(GEO.sphere, blushMat);
        leftBlush.scale.set(0.035, 0.02, 0.02);
        leftBlush.position.set(-0.12, -0.04, 0.21);
        const rightBlush = leftBlush.clone();
        rightBlush.position.x = 0.12;
        this.headGroup.add(leftEye, rightEye, leftBlush, rightBlush);

        // Accessories
        if (this.cfg.accessory === "headphones") {
          const band = new THREE.Mesh(GEO.box, MAT.chrome);
          band.scale.set(0.55, 0.06, 0.10);
          band.position.set(0, 0.24, 0);
          const earL = new THREE.Mesh(GEO.cyl, shirtMat);
          earL.rotation.z = Math.PI / 2;
          earL.scale.set(0.09, 0.06, 0.09);
          earL.position.set(-0.25, 0.03, 0);
          const earR = earL.clone();
          earR.position.x = 0.25;
          this.headGroup.add(band, earL, earR);
        } else if (this.cfg.accessory === "glasses") {
          const rimL = new THREE.Mesh(GEO.box, MAT.chrome);
          rimL.scale.set(0.09, 0.06, 0.025);
          rimL.position.set(-0.08, 0.01, 0.23);
          const rimR = rimL.clone();
          rimR.position.x = 0.08;
          this.headGroup.add(rimL, rimR);
        } else if (this.cfg.accessory === "beret") {
          const beret = new THREE.Mesh(GEO.cyl, shirtMat);
          beret.scale.set(0.28, 0.08, 0.28);
          beret.position.set(0.04, 0.24, 0);
          beret.rotation.z = -0.2;
          this.headGroup.add(beret);
        } else if (this.cfg.accessory === "crown") {
          const crown = new THREE.Mesh(GEO.cyl, new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.8, roughness: 0.3 }));
          crown.scale.set(0.18, 0.12, 0.18);
          crown.position.set(0, 0.28, 0);
          this.headGroup.add(crown);
        }

        // Slender Shoulder-Pivoted Arms
        this.leftArmPivot = new THREE.Group();
        this.leftArmPivot.position.set(-0.24, 1.05, 0);
        const leftArmMesh = new THREE.Mesh(GEO.cyl, shirtMat);
        leftArmMesh.scale.set(0.08, 0.44, 0.08);
        leftArmMesh.position.y = -0.20;
        this.leftArmPivot.add(leftArmMesh);

        this.rightArmPivot = new THREE.Group();
        this.rightArmPivot.position.set(0.24, 1.05, 0);
        const rightArmMesh = leftArmMesh.clone();
        this.rightArmPivot.add(rightArmMesh);

        // Procedural Prop Attachments: Ceramic Mug & Cue Stick
        this.cupMesh = new THREE.Mesh(GEO.cyl, MAT.whitePlastic);
        this.cupMesh.scale.set(0.07, 0.11, 0.07);
        this.cupMesh.position.set(0, -0.28, 0.12);
        const liquid = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color: 0x451a03 }));
        liquid.scale.set(0.06, 0.02, 0.06);
        liquid.position.y = 0.055;
        this.cupMesh.add(liquid);
        this.cupMesh.visible = false;
        this.rightArmPivot.add(this.cupMesh);

        this.cueMesh = new THREE.Mesh(GEO.cyl, MAT.woodLight);
        this.cueMesh.scale.set(0.022, 1.4, 0.022);
        this.cueMesh.position.set(0, -0.30, 0.48);
        this.cueMesh.rotation.x = Math.PI / 2.3;
        this.cueMesh.visible = false;
        this.rightArmPivot.add(this.cueMesh);

        this.bodyGroup.add(this.leftArmPivot, this.rightArmPivot);

        // Slender Hip-Pivoted Legs
        this.leftHipPivot = new THREE.Group();
        this.leftHipPivot.position.set(-0.11, 0.48, 0);
        const leftLegMesh = new THREE.Mesh(GEO.cyl, pantsMat);
        leftLegMesh.scale.set(0.09, 0.48, 0.09);
        leftLegMesh.position.y = -0.24;
        this.leftHipPivot.add(leftLegMesh);

        this.rightHipPivot = new THREE.Group();
        this.rightHipPivot.position.set(0.11, 0.48, 0);
        const rightLegMesh = leftLegMesh.clone();
        this.rightHipPivot.add(rightLegMesh);

        this.bodyGroup.add(this.leftHipPivot, this.rightHipPivot);

        headMesh.userData = { type: "agent", agentId: this.cfg.id };
        this.torso.userData = { type: "agent", agentId: this.cfg.id };
        clickableMeshesRef.current.push(headMesh, this.torso);

        // Status Signboard
        this.signCanvas = document.createElement("canvas");
        this.signCanvas.width = 420;
        this.signCanvas.height = 100;
        this.signCtx = this.signCanvas.getContext("2d")!;
        this.signTex = new THREE.CanvasTexture(this.signCanvas);

        const sMat = registerFloorMaterial(this.floor, new THREE.MeshBasicMaterial({
          map: this.signTex,
          transparent: true,
          depthTest: true,
          depthWrite: false
        }));
        this.signMesh = new THREE.Mesh(GEO.plane, sMat);
        this.signMesh.scale.set(2.4, 0.62, 1);
        this.signMesh.position.y = 2.65;
        this.signMesh.visible = false;
        this.root.add(this.signMesh);

        this.updateStatusText(`${this.cfg.name} • Đang trực`, "#38bdf8");
        this.sitAtWorkstationImmediate();
      }

      updateStatusText(text: string, borderColor = "#38bdf8") {
        const ctx = this.signCtx;
        ctx.clearRect(0, 0, 420, 100);
        ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
        ctx.beginPath();
        ctx.roundRect(8, 10, 404, 80, 24);
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 24px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, 210, 58);
        this.signTex.needsUpdate = true;
      }

      showSpeechBubble(text: string, durationSeconds = 5) {
        const clean = stripMarkdownForSpeechBubble(text).slice(0, 32);
        this.updateStatusText(clean, "#fbbf24");
        if (this.signMesh) this.signMesh.visible = true;
        this.hasActiveSpeech = true;
        if (this.speechTimeout) clearTimeout(this.speechTimeout);
        this.speechTimeout = setTimeout(() => {
          this.hasActiveSpeech = false;
          this.speechTimeout = null;
          this.updateStatusText(`${this.cfg.name} • Đang trực`, "#38bdf8");
        }, durationSeconds * 1000);
      }

      sitAtWorkstationImmediate() {
        this.state = "sitting";
        this.waypoints = [];
        const chair = this.assignedChairPos || this.cfg.chairPos;
        this.root.position.set(chair.x, 0, chair.z);
        this.root.rotation.y = chair.rotY;

        this.bodyGroup.position.y = 0.36;
        this.leftHipPivot.rotation.x = -Math.PI / 2;
        this.rightHipPivot.rotation.x = -Math.PI / 2;
        this.leftArmPivot.rotation.x = -0.65;
        this.rightArmPivot.rotation.x = -0.65;
        this.cupMesh.visible = false;
        this.cueMesh.visible = false;
        this.torso.rotation.x = 0;
        this.headGroup.rotation.x = 0;
        this.currentActionLabel = "Đang gõ code tại bàn làm việc";
      }

      validateStateOnFloor() {
        if (this.state !== "sitting" && this.state !== "walking" && this.state !== "standing") {
          const pt = envRegistryRef.current.getPointForActivity(this.floor, this.state as any);
          if (!pt) {
            if (this.breakTimeout) {
              clearTimeout(this.breakTimeout);
              this.breakTimeout = null;
            }
            this.sitAtWorkstationImmediate();
          }
        }
      }

      walkToChairAndWork(statusMsg?: string) {
        const chair = this.assignedChairPos || this.cfg.chairPos;
        const dist = Math.hypot(this.root.position.x - chair.x, this.root.position.z - chair.z);
        if (dist < 0.25) {
          this.sitAtWorkstationImmediate();
          if (statusMsg) this.updateStatusText(statusMsg, "#34d399");
          return;
        }
        this.state = "walking";
        this.cupMesh.visible = false;
        this.cueMesh.visible = false;
        this.bodyGroup.position.y = 0;
        this.currentActionLabel = "🚶 Đang đi về chỗ ngồi";
        const startPos = { x: this.root.position.x, z: this.root.position.z };
        this.waypoints = generateWalkablePath(this.floor, startPos, { x: chair.x, z: chair.z }, undefined, collisionRegistryRef.current);
        this.onArrivalCallback = () => {
          this.sitAtWorkstationImmediate();
          if (statusMsg) this.updateStatusText(statusMsg, "#34d399");
        };
      }

      takeBreak(activity: "coffee" | "water" | "billiards" | "gaming" | "snack" | "chatting" | "restroom" | "bookshelf" | "lounge" | "reception" | "bowling" | "swimming" | "arcade", duration = 18) {
        if (this.state !== "sitting") return;

        // Verify environmental availability on THIS floor
        let point = envRegistryRef.current.getPointForActivity(this.floor, activity);
        if (!point) {
          point = envRegistryRef.current.getRandomAvailable(this.floor);
        }
        if (!point) return;

        this.state = "walking";
        this.bodyGroup.position.y = 0;
        this.leftHipPivot.rotation.x = 0;
        this.rightHipPivot.rotation.x = 0;
        this.leftArmPivot.rotation.x = 0;
        this.rightArmPivot.rotation.x = 0;
        this.cupMesh.visible = false;
        this.cueMesh.visible = false;

        this.currentActionLabel = point.label;
        this.updateStatusText(point.label, "#fbbf24");

        const startPos = { x: this.root.position.x, z: this.root.position.z };
        this.waypoints = generateWalkablePath(this.floor, startPos, point.approachPos, this.assignedChairPos, collisionRegistryRef.current);

        const targetPoint = point;
        this.onArrivalCallback = () => {
          this.state = targetPoint.type as any;
          this.root.rotation.y = targetPoint.spot.rotY;
          this.currentActionLabel = targetPoint.activeMsg;
          this.updateStatusText(targetPoint.activeMsg, "#34d399");

          if (targetPoint.propType === "cup") {
            this.cupMesh.visible = true;
          } else if (targetPoint.propType === "cue") {
            this.cueMesh.visible = true;
          }

          if (targetPoint.type === "snack" || targetPoint.type === "lounge") {
            this.bodyGroup.position.y = 0.35;
            this.leftHipPivot.rotation.x = -Math.PI / 2;
            this.rightHipPivot.rotation.x = -Math.PI / 2;
          }

          if (this.breakTimeout) clearTimeout(this.breakTimeout);
          this.breakTimeout = setTimeout(() => {
            this.returnToWorkstation();
          }, duration * 1000);
        };
      }

      returnToWorkstation() {
        this.state = "walking";
        this.cupMesh.visible = false;
        this.cueMesh.visible = false;
        this.bodyGroup.position.y = 0;
        this.leftHipPivot.rotation.x = 0;
        this.rightHipPivot.rotation.x = 0;
        this.torso.rotation.x = 0;
        this.headGroup.rotation.x = 0;
        this.currentActionLabel = "🚶 Đang về bàn làm việc";
        this.updateStatusText("🚶 Về bàn làm việc", "#38bdf8");

        const chair = this.assignedChairPos || this.cfg.chairPos;
        const startPos = { x: this.root.position.x, z: this.root.position.z };
        this.waypoints = generateWalkablePath(this.floor, startPos, { x: chair.x, z: chair.z }, undefined, collisionRegistryRef.current);
        this.onArrivalCallback = () => {
          this.sitAtWorkstationImmediate();
          this.currentActionLabel = "💻 Đang gõ code tại bàn";
          this.updateStatusText(`${this.cfg.name} • Đang trực`, "#38bdf8");
        };
      }

      walkToSpot(targetSpot: { x: number; z: number; rotY?: number }, labelText: string, onDone?: () => void) {
        this.state = "walking";
        this.cupMesh.visible = false;
        this.cueMesh.visible = false;
        this.bodyGroup.position.y = 0;
        this.currentActionLabel = labelText;
        this.updateStatusText(labelText, "#fbbf24");
        const startPos = { x: this.root.position.x, z: this.root.position.z };
        this.waypoints = generateWalkablePath(this.floor, startPos, { x: targetSpot.x, z: targetSpot.z }, undefined, collisionRegistryRef.current);
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

      update(dt: number, elapsed: number, camPos: THREE.Vector3, activeControllers?: any[]) {
        const isVisible = Boolean(this.isHovered || this.isSelected || (this.cfg.id === camStateRef.current.trackingAgentId) || this.hasActiveSpeech);
        if (this.signMesh) {
          this.signMesh.visible = isVisible;
          if (isVisible) {
            this.signMesh.lookAt(camPos.x, this.signMesh.getWorldPosition(new THREE.Vector3()).y, camPos.z);
          }
        }

        if (this.state === "walking" && this.waypoints.length > 0) {
          // --- ANTI-CLIPPING / SOCIAL AVOIDANCE PHYSICS ---
          // Prevent walking through other characters: apply gentle repulsion buffer
          if (activeControllers && activeControllers.length > 1) {
            for (let i = 0; i < activeControllers.length; i++) {
              const other = activeControllers[i];
              if (other === this) continue;
              const ox = this.root.position.x - other.root.position.x;
              const oz = this.root.position.z - other.root.position.z;
              const dSq = ox * ox + oz * oz;
              const minDist = 1.15;
              if (dSq > 0.0001 && dSq < minDist * minDist) {
                const dist = Math.sqrt(dSq);
                const push = (minDist - dist) * 1.6 * dt;
                this.root.position.x += (ox / dist) * push;
                this.root.position.z += (oz / dist) * push;
              }
            }
          }

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
            this.headGroup.position.y = 1.38 + Math.abs(Math.cos(this.walkPhase)) * 0.04;
          }
        } else if (this.state === "sitting") {
          const typeWave = Math.sin(elapsed * 8 + this.floor) * 0.12;
          this.leftArmPivot.rotation.x = -0.65 + typeWave;
          this.rightArmPivot.rotation.x = -0.65 - typeWave;
          this.headGroup.rotation.y = Math.sin(elapsed * 1.5) * 0.08;
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          this.torso.rotation.x = 0;
          this.headGroup.rotation.x = 0;
        } else if (this.state === "coffee" || this.state === "water") {
          this.cupMesh.visible = true;
          this.cueMesh.visible = false;
          const sipWave = Math.sin(elapsed * 2.8);
          this.rightArmPivot.rotation.x = -1.25 + sipWave * 0.35;
          this.leftArmPivot.rotation.x = -0.15;
          this.headGroup.rotation.x = sipWave > 0.35 ? -0.22 : 0;
        } else if (this.state === "billiards") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = true;
          const cueWave = Math.sin(elapsed * 4.5);
          this.leftArmPivot.rotation.x = -0.4;
          this.rightArmPivot.rotation.x = -0.55 + cueWave * 0.35;
          this.torso.rotation.x = 0.22;
          this.headGroup.rotation.x = 0;
        } else if (this.state === "gaming") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          const tapWave = Math.sin(elapsed * 14);
          this.leftArmPivot.rotation.x = -0.65 + tapWave * 0.2;
          this.rightArmPivot.rotation.x = -0.65 - tapWave * 0.2;
          this.headGroup.position.y = 1.38 + Math.abs(tapWave) * 0.03;
        } else if (this.state === "snack") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          const eatWave = Math.sin(elapsed * 3);
          this.rightArmPivot.rotation.x = -1.0 + eatWave * 0.3;
          this.leftArmPivot.rotation.x = -0.5;
        } else if (this.state === "chatting") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          const talkWave = Math.sin(elapsed * 4);
          this.leftArmPivot.rotation.x = -0.3 + talkWave * 0.25;
          this.rightArmPivot.rotation.x = -0.3 - talkWave * 0.25;
          this.headGroup.rotation.y = Math.sin(elapsed * 2) * 0.2;
        } else if (this.state === "restroom") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          const washWave = Math.sin(elapsed * 6);
          this.leftArmPivot.rotation.x = -0.7 + washWave * 0.15;
          this.rightArmPivot.rotation.x = -0.7 - washWave * 0.15;
          this.torso.rotation.x = 0.12;
        } else if (this.state === "lounge") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          this.leftArmPivot.rotation.x = -0.2;
          this.rightArmPivot.rotation.x = -0.2;
        } else if (this.state === "bowling") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          const swingWave = Math.sin(elapsed * 3);
          this.rightArmPivot.rotation.x = -1.2 + swingWave * 0.8;
          this.leftArmPivot.rotation.x = 0.2;
          this.torso.rotation.x = 0.25;
          this.headGroup.rotation.x = -0.15;
        } else if (this.state === "swimming") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          this.leftArmPivot.rotation.x = -Math.PI / 2 + Math.cos(elapsed * 5) * 0.6;
          this.rightArmPivot.rotation.x = -Math.PI / 2 - Math.cos(elapsed * 5) * 0.6;
          this.torso.rotation.x = 0.8;
          this.bodyGroup.position.y = -0.2;
        } else if (this.state === "arcade") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          const smashWave = Math.sin(elapsed * 12);
          this.leftArmPivot.rotation.x = -0.7 + smashWave * 0.3;
          this.rightArmPivot.rotation.x = -0.7 - smashWave * 0.3;
          this.headGroup.position.y = 1.62 + Math.abs(smashWave) * 0.04;
        } else if (this.state === "standing" || this.state === "bookshelf" || this.state === "reception") {
          this.cupMesh.visible = false;
          this.cueMesh.visible = false;
          this.headGroup.position.y = 1.62 + Math.sin(elapsed * 3) * 0.02;
        }
      }
    }

    // Helper to build a desk and chair for any specialist workstation with Apple iMac 24"
    const buildSpecialistWorkstation = (floorId: number, group: THREE.Group, dx: number, dz: number, glowHex: number) => {
      // Desk Top
      group.add(createMesh(floorId, GEO.box, MAT.woodLight, 2.0, 0.12, 1.2, dx, 1.44, dz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.09, 1.44, 1.0, dx - 0.95, 0.72, dz, true, true));
      group.add(createMesh(floorId, GEO.box, MAT.darkMetal, 0.09, 1.44, 1.0, dx + 0.95, 0.72, dz, true, true));

      // Apple iMac 24"
      const monZ = dz - 0.28;
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.36, 0.015, 0.26, dx, 1.51, monZ, false, false));
      const standNeck = createMesh(floorId, GEO.box, MAT.chrome, 0.12, 0.38, 0.025, dx, 1.68, monZ, false, false);
      standNeck.rotation.x = 0.18;
      group.add(standNeck);
      const imac = createMesh(floorId, GEO.box, MAT.chrome, 1.25, 0.74, 0.028, dx, 2.02, monZ, true, false);
      imac.rotation.x = -0.08;
      group.add(imac);
      const chin = createMesh(floorId, GEO.box, MAT.chrome, 1.25, 0.14, 0.01, dx, 1.72, monZ + 0.016, false, false);
      chin.rotation.x = -0.08;
      group.add(chin);
      const bezel = createMesh(floorId, GEO.box, MAT.screenBlack, 1.23, 0.58, 0.008, dx, 2.09, monZ + 0.016, false, false);
      bezel.rotation.x = -0.08;
      group.add(bezel);
      const glowScreen = createMesh(floorId, GEO.plane, new THREE.MeshBasicMaterial({ color: glowHex }), 1.18, 0.54, 1, dx, 2.09, monZ + 0.022, false, false);
      glowScreen.rotation.x = -0.08;
      glowScreen.rotation.y = 0; // Screen faces +Z towards sitting specialist
      group.add(glowScreen);

      // Apple Magic Keyboard & Magic Mouse on Desk Mat
      const kMatZ = dz + 0.18;
      group.add(createMesh(floorId, GEO.box, new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.8 }), 0.88, 0.012, 0.38, dx, 1.51, kMatZ, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.chrome, 0.44, 0.016, 0.16, dx - 0.12, 1.52, kMatZ, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.42, 0.008, 0.14, dx - 0.12, 1.53, kMatZ, false, false));
      group.add(createMesh(floorId, GEO.box, MAT.whitePlastic, 0.10, 0.022, 0.16, dx + 0.26, 1.52, kMatZ, false, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.whitePlastic, 0.09, 0.12, 0.09, dx + 0.38, 1.56, kMatZ, false, false));

      // Ergonomic Swivel Chair
      const chairZ = dz + 0.95;
      const chairMat = registerFloorMaterial(floorId, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
      group.add(createMesh(floorId, GEO.cyl, MAT.chrome, 0.42, 0.08, 0.42, dx, 0.08, chairZ, false, false));
      group.add(createMesh(floorId, GEO.cyl, MAT.darkMetal, 0.08, 0.72, 0.08, dx, 0.44, chairZ, false, false));
      group.add(createMesh(floorId, GEO.box, chairMat, 0.85, 0.12, 0.85, dx, 0.82, chairZ, true, true));
      group.add(createMesh(floorId, GEO.box, chairMat, 0.82, 0.95, 0.12, dx, 1.34, chairZ + 0.38, true, true));
    };

    // Initialize Canonical Leadership Chibi Agents in their dedicated Private Glass Suites
    const canonicalDivMapping: Record<string, string> = {
      "agent-ops-recruiter": "operations",
      "agent-support-lead": "support",
      "agent-fin-controller": "finance",
      "agent-mkt-growth": "marketing",
      "agent-sales-director": "sales",
      "agent-design-lead": "design",
      "agent-eng-lead": "engineering",
      "agent-exec-ceo": "executive",
      "agent-research-ai": "research",
    };

    const leadershipSuiteMapping: Record<string, { deskPos: { x: number; z: number }; chairPos: { x: number; z: number; rotY: number }; floor: number }> = {
      "agent-exec-ceo": { deskPos: { x: -20.0, z: -12.5 }, chairPos: { x: -20.0, z: -11.4, rotY: 0 }, floor: 6 },
      "agent-ops-recruiter": { deskPos: { x: -20.0, z: -12.5 }, chairPos: { x: -20.0, z: -11.4, rotY: 0 }, floor: 1 },
      "agent-support-lead": { deskPos: { x: -20.0, z: -3.0 }, chairPos: { x: -20.0, z: -1.8, rotY: 0 }, floor: 1 },
      "agent-fin-controller": { deskPos: { x: -20.0, z: -12.5 }, chairPos: { x: -20.0, z: -11.4, rotY: 0 }, floor: 2 },
      "agent-mkt-growth": { deskPos: { x: -20.0, z: -12.5 }, chairPos: { x: -20.0, z: -11.4, rotY: 0 }, floor: 3 },
      "agent-sales-director": { deskPos: { x: -20.0, z: -3.0 }, chairPos: { x: -20.0, z: -1.8, rotY: 0 }, floor: 3 },
      "agent-design-lead": { deskPos: { x: -20.0, z: -12.5 }, chairPos: { x: -20.0, z: -11.4, rotY: 0 }, floor: 4 },
      "agent-eng-lead": { deskPos: { x: -20.0, z: -12.5 }, chairPos: { x: -20.0, z: -11.4, rotY: 0 }, floor: 5 },
      "agent-research-ai": { deskPos: { x: -20.0, z: -3.0 }, chairPos: { x: -20.0, z: -1.8, rotY: 0 }, floor: 6 },
    };

    Object.values(CANONICAL_AGENTS).forEach(ag => {
      const suite = leadershipSuiteMapping[ag.id];
      if (suite) {
        ag.deskPos = suite.deskPos;
        ag.chairPos = suite.chairPos;
        ag.floor = suite.floor;
      } else {
        const cDiv = canonicalDivMapping[ag.id] || ag.division;
        const ws = getDivisionWorkstation(cDiv, 0);
        ag.deskPos = ws.deskPos;
        ag.chairPos = ws.chairPos;
        ag.floor = getFloorForDivision(cDiv);
      }
      agentControllersRef.current[ag.id] = new Chibi(ag);
    });

    // Asynchronously fetch and populate the complete backend workforce (276 total)
    const loadAndPopulateWorkforce = async () => {
      console.log('[loadWorkforce] STARTING...');
      try {
        await ensureAuthenticatedSession();
        const backendAgents = await getAgents({ limit: 350 });
        console.log('[loadWorkforce] Fetched backend agents:', backendAgents?.length);
        if (backendAgents && backendAgents.length > 0) {
          const configList: AgentConfig[] = [];
          const hairPalettes = [0x1e293b, 0x334155, 0x475569, 0x78350f, 0xb45309, 0xd97706, 0x451a03];
          const deskIndexMap: Record<string, number> = {};

          // Reserve seat 0 for divisions that have a canonical leadership agent
          Object.values(canonicalDivMapping).forEach(cDiv => {
            if (cDiv !== "executive") {
              deskIndexMap[cDiv] = 1;
            }
          });

          // Filter strictly active company workforce (8 leadership + 268 specialists)
          const activeAgents = backendAgents.filter(
            ag => (CANONICAL_AGENTS[ag.id] || ag.id.startsWith("agent-spec-")) && ag.status !== "offline"
          );

          // Group agents by floor
          const agentsByFloor: Record<number, any[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
          activeAgents.forEach(ag => {
            if (CANONICAL_AGENTS[ag.id]) {
              const fl = CANONICAL_AGENTS[ag.id].floor;
              agentsByFloor[fl].push({ ...ag, isCanonical: true });
            } else {
              const divKey = resolveDivisionKey(ag.station || "engineering");
              const fl = getFloorForDivision(divKey);
              agentsByFloor[fl].push({ ...ag, divKey, floor: fl });
            }
          });

          // For each floor, map active agents into guaranteed unique physical slots (Matching Image 2)
          for (let f = 0; f <= 7; f++) {
            const floorAgents = agentsByFloor[f] || [];
            const slots = getFloorSlotLocations(f);
            let slotIndex = 0;

            floorAgents.forEach((ag, fIdx) => {
              if (CANONICAL_AGENTS[ag.id]) {
                configList.push(CANONICAL_AGENTS[ag.id]);
                return;
              }

              if (agentControllersRef.current[ag.id]) {
                configList.push(agentControllersRef.current[ag.id].cfg);
                return;
              }

              const divKey = ag.divKey || (CANONICAL_AGENTS[ag.id]?.division) || "engineering";
              const divCol = DIVISION_THEME_COLORS[divKey] || 0x3b82f6;
              const hash = ag.id.split("").reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
              const hairCol = hairPalettes[hash % hairPalettes.length];

              // Pick slot for this agent
              const slot = slots[slotIndex % slots.length];
              const deskPos = slot.deskPos;
              const chairPos = slot.chairPos;

              const cfg: AgentConfig = {
                id: ag.id,
                name: ag.name,
                role: ag.role,
                division: divKey,
                floor: f,
                badgeColor: "sky",
                shirtColor: ag.color ? (parseInt(ag.color.replace("#", "0x")) || divCol) : divCol,
                hairColor: hairCol,
                skinColor: 0xffedd5,
                accessory: fIdx % 3 === 0 ? "glasses" : fIdx % 3 === 1 ? "headphones" : "badge",
                deskPos: deskPos,
                chairPos: chairPos,
                loungePos: { x: 0.0, z: -1.2, rotY: 0 },
                coffeePos: { x: 13.0, z: -16.8, rotY: 0 },
                keywords: [ag.name.toLowerCase(), ag.role.toLowerCase(), divKey],
                persona: `Bạn là ${ag.name} (${ag.role} thuộc phân ban ${divKey} Tầng ${f}F).`
              };

              // Instantiate 3D Chibi for the active on-duty characters on this floor
              // Up to slots.length distinct slots per floor = ZERO overlap, zero stacking!
              if (slotIndex < slots.length) {
                const chibi = new Chibi(cfg);
                chibi.assignedChairPos = { ...chairPos };
                chibi.assignedDeskPos = { ...deskPos };

                if (slot.roleType === "boardroom") {
                  chibi.state = "sitting";
                  chibi.currentActionLabel = "📊 Họp chiến lược tại Boardroom";
                } else if (slot.roleType === "focus") {
                  chibi.state = "sitting";
                  chibi.currentActionLabel = "💡 Thảo luận nhóm kỹ thuật";
                } else if (slot.roleType === "lounge") {
                  chibi.state = "lounge";
                  chibi.currentActionLabel = "🛋️ Trao đổi tại Sofa Lounge";
                  chibi.root.position.y = 0.22;
                  chibi.cupMesh.visible = true;
                } else if (slot.roleType === "bar") {
                  chibi.state = "sitting";
                  chibi.currentActionLabel = "☕ Ngắm view thành phố & làm việc";
                  chibi.root.position.y = 0.55;
                  chibi.cupMesh.visible = true;
                } else if (slot.roleType === "reception") {
                  chibi.state = "reception";
                  chibi.currentActionLabel = "📋 Hỗ trợ lễ tân & đón khách";
                } else if (slot.roleType === "standing_discuss") {
                  chibi.state = "standing";
                  chibi.currentActionLabel = "💬 Đang thảo luận công việc";
                  chibi.bodyGroup.position.y = 0;
                  chibi.leftHipPivot.rotation.x = 0;
                  chibi.rightHipPivot.rotation.x = 0;
                  chibi.cupMesh.visible = true;
                } else if (slot.roleType === "corridor_patrol") {
                  chibi.state = "walking";
                  chibi.currentActionLabel = "🚶 Đi kiểm tra tiến độ dự án";
                  chibi.bodyGroup.position.y = 0;
                  chibi.leftHipPivot.rotation.x = 0;
                  chibi.rightHipPivot.rotation.x = 0;
                  chibi.waypoints = [
                    { x: 5.0, z: 5.0 },
                    { x: -9.0, z: 5.0 },
                    { x: -9.0, z: -5.0 },
                    { x: 5.0, z: -5.0 },
                  ];
                } else {
                  chibi.state = "sitting";
                  chibi.currentActionLabel = "💻 Đang gõ code tại bàn";
                }

                agentControllersRef.current[ag.id] = chibi;
                slotIndex++;
              }

              configList.push(cfg);
            });
          }

          setWorkforceList(configList);
        }
      } catch (err) {
        console.warn("Could not load backend workforce, using canonical roster:", err);
      }
    };
    loadAndPopulateWorkforce();

    // Pointer Event Listeners for 1:1 Zero-Lag Direct Camera Orbit
    const domEl = renderer.domElement;

    const handlePointerDown = (e: PointerEvent) => {
      const s = camStateRef.current;
      s.prevX = e.clientX;
      s.prevY = e.clientY;
      s.downX = e.clientX;
      s.downY = e.clientY;

      if (e.button === 0) s.isDraggingLeft = true;
      if (e.button === 2) s.isDraggingRight = true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const s = camStateRef.current;
      const dx = e.clientX - s.prevX;
      const dy = e.clientY - s.prevY;
      s.prevX = e.clientX;
      s.prevY = e.clientY;

      if (s.isDraggingLeft) {
        // Direct 1:1 camera orbit rotation
        s.theta -= dx * 0.0075;
        s.phi -= dy * 0.0075;
        s.phi = Math.max(0.15, Math.min(Math.PI / 2.05, s.phi));
        syncCameraPositionImmediate();
      }

      if (s.isDraggingRight) {
        // Direct pan
        const sinT = Math.sin(s.theta);
        const cosT = Math.cos(s.theta);
        const panSpeed = 0.035;
        s.targetX -= (cosT * dx - sinT * dy) * panSpeed;
        s.targetZ -= (sinT * dx + cosT * dy) * panSpeed;
        syncCameraPositionImmediate();
      }

      // Hover raycasting for Chibi character inspection & tooltip highlighting
      if (!s.isDraggingLeft && !s.isDraggingRight && cameraRef.current) {
        const rect = domEl.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, cameraRef.current);
        const intersects = raycaster.intersectObjects(clickableMeshesRef.current, false);

        if (intersects.length > 0) {
          const hit = intersects[0].object;
          if (hit.userData?.type === "agent") {
            const agId = hit.userData.agentId;
            if (hoveredAgentIdRef.current !== agId) {
              if (hoveredAgentIdRef.current && agentControllersRef.current[hoveredAgentIdRef.current]) {
                agentControllersRef.current[hoveredAgentIdRef.current].isHovered = false;
              }
              hoveredAgentIdRef.current = agId;
              if (agentControllersRef.current[agId]) {
                agentControllersRef.current[agId].isHovered = true;
              }
            }
            domEl.style.cursor = "pointer";
            return;
          } else if (hit.userData?.type === "elevator") {
            domEl.style.cursor = "pointer";
            return;
          }
        }

        if (hoveredAgentIdRef.current) {
          if (agentControllersRef.current[hoveredAgentIdRef.current]) {
            agentControllersRef.current[hoveredAgentIdRef.current].isHovered = false;
          }
          hoveredAgentIdRef.current = null;
        }
        domEl.style.cursor = "default";
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const s = camStateRef.current;
      const dist = Math.hypot(e.clientX - s.downX, e.clientY - s.downY);

      if (dist < 5 && e.button === 0 && cameraRef.current) {
        // Click raycasting
        const rect = domEl.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, cameraRef.current);
        const intersects = raycaster.intersectObjects(clickableMeshesRef.current, false);

        if (intersects.length > 0) {
          const hit = intersects[0].object;
          if (hit.userData?.type === "elevator") {
            setIsElevatorRemoteOpen(true);
          } else if (hit.userData?.type === "agent") {
            const agId = hit.userData.agentId;
            setSelectedChatTarget(agId);
            // ENTER CLOSE-UP TRACKING MODE
            setTrackingAgentId(agId);
            s.trackingAgentId = agId;
            const agCtrl = agentControllersRef.current[agId];
            if (agCtrl) {
              setTrackingActionLabel(agCtrl.currentActionLabel);
              if (agCtrl.floor !== currentFloorRef.current) {
                useElevatorToFloor(agCtrl.floor);
              }
            }
          }
        } else {
          // Clicked empty office floor: exit tracking mode
          if (s.trackingAgentId) {
            stopTrackingCamera();
          }
        }
      }

      if (e.button === 0) s.isDraggingLeft = false;
      if (e.button === 2) s.isDraggingRight = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = camStateRef.current;
      s.radius += e.deltaY * 0.025;
      s.radius = Math.max(8, Math.min(65, s.radius));
      syncCameraPositionImmediate();
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (camStateRef.current.trackingAgentId) {
          stopTrackingCamera();
        } else if (isElevatorRemoteOpen) {
          setIsElevatorRemoteOpen(false);
        }
      }
    };

    domEl.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    domEl.addEventListener("wheel", handleWheel, { passive: false });
    domEl.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    // Initial camera sync
    syncCameraPositionImmediate();
    updateFloorVisibility(currentFloorRef.current, ghostModeRef.current);

    // 120 FPS High-Performance Simulation Render Loop
    let lastTime = performance.now();
    let frameCounter = 0;
    let fpsTimer = performance.now();

    const animate = (time: number) => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      const elapsed = time / 1000;

      // FPS calculation
      frameCounter++;
      if (time - fpsTimer >= 1000) {
        setFpsValue(frameCounter);
        frameCounter = 0;
        fpsTimer = time;
      }

      // Smooth elevator vertical transit interpolation or Camera Tracking Lerp
      const s = camStateRef.current;
      if (s.trackingAgentId) {
        const trackedCtrl = agentControllersRef.current[s.trackingAgentId];
        if (trackedCtrl && trackedCtrl.root) {
          const targetWorldX = trackedCtrl.root.position.x;
          const targetWorldZ = trackedCtrl.root.position.z;
          const targetWorldY = trackedCtrl.floor * FLOOR_HEIGHT + 1.2;

          s.targetX += (targetWorldX - s.targetX) * Math.min(1, dt * 6);
          s.targetZ += (targetWorldZ - s.targetZ) * Math.min(1, dt * 6);
          s.targetY += (targetWorldY - s.targetY) * Math.min(1, dt * 6);
          s.radius += (11.0 - s.radius) * Math.min(1, dt * 4);
          s.phi += (Math.PI / 3.4 - s.phi) * Math.min(1, dt * 4);

          syncCameraPositionImmediate();

          if (trackedCtrl.currentActionLabel && trackedCtrl.currentActionLabel !== trackingActionLabel) {
            setTrackingActionLabel(trackedCtrl.currentActionLabel);
          }
        }
      } else if (s.isCinematicMoving) {
        // Smooth Preset View Glide
        s.targetX += (s.destX - s.targetX) * Math.min(1, dt * 6.0);
        s.targetY += (s.destY - s.targetY) * Math.min(1, dt * 6.0);
        s.targetZ += (s.destZ - s.targetZ) * Math.min(1, dt * 6.0);
        s.radius += (s.destRadius - s.radius) * Math.min(1, dt * 6.0);
        s.theta += (s.destTheta - s.theta) * Math.min(1, dt * 6.0);
        s.phi += (s.destPhi - s.phi) * Math.min(1, dt * 6.0);
        syncCameraPositionImmediate();

        if (
          Math.abs(s.targetX - s.destX) < 0.05 &&
          Math.abs(s.targetZ - s.destZ) < 0.05 &&
          Math.abs(s.radius - s.destRadius) < 0.1
        ) {
          s.isCinematicMoving = false;
        }
      } else if (Math.abs(s.targetY - s.goalFloorY) > 0.01) {
        s.targetY += (s.goalFloorY - s.targetY) * Math.min(1, dt * 8);
        syncCameraPositionImmediate();
      }

      // Elevator Doors Spring Animation (Floors 0 to 7)
      for (let f = 0; f <= 7; f++) {
        const d = elevatorDoorsRef.current[f];
        if (!d) continue;
        const targetL = d.isOpen ? d.closedLeftX - d.openOffset : d.closedLeftX;
        const targetR = d.isOpen ? d.closedRightX + d.openOffset : d.closedRightX;
        d.left.position.x += (targetL - d.left.position.x) * Math.min(1, dt * 12);
        d.right.position.x += (targetR - d.right.position.x) * Math.min(1, dt * 12);
      }

      // Automatic Sliding Doors on Floor G (Lobby Front Entrance at Z = 17.5, X = 0.0)
      if (slidingDoorsRef.current && currentFloorRef.current === 0) {
        const sd = slidingDoorsRef.current;
        let isNear = false;
        const distCam = Math.hypot(s.targetX - 0, s.targetZ - 17.5);
        if (distCam < 6.5) {
          isNear = true;
        } else {
          const activeControllers = Object.values(agentControllersRef.current).filter(
            ctrl => ctrl.floor === 0
          );
          for (let i = 0; i < activeControllers.length; i++) {
            const ctrl = activeControllers[i];
            if (ctrl.root) {
              const d = Math.hypot(ctrl.root.position.x - 0, ctrl.root.position.z - 17.5);
              if (d < 5.0) {
                isNear = true;
                break;
              }
            }
          }
        }
        const targetOffset = isNear ? sd.openOffset : 0;
        sd.currentOffset += (targetOffset - sd.currentOffset) * Math.min(1, dt * 8);
        sd.left.position.x = sd.closedLeftX - sd.currentOffset;
        sd.right.position.x = sd.closedRightX + sd.currentOffset;
      }

      // Update Chibi Agents (Floor-based animation culling: only tick characters on active floor)
      const isAnimDisabled = typeof window !== "undefined" && (window as any).__MY_OFFICE_ANIMATION_DISABLED__ === true;
      if (cameraRef.current && !isAnimDisabled) {
        const activeControllers = Object.values(agentControllersRef.current).filter(
          ctrl => ctrl.floor === currentFloorRef.current
        );
        activeControllers.forEach(ctrl => {
          ctrl.update(dt, elapsed, cameraRef.current!.position, activeControllers);
        });
      }

      // Update In-World 3D Floating Badges every few frames
      if (frameCounter % 3 === 0 && cameraRef.current && containerRef.current) {
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;
        if (cw > 0 && ch > 0) {
          const badges: any[] = [];
          const projVec = new THREE.Vector3();
          sessions.forEach(sess => {
            const ctrl = agentControllersRef.current[sess.agentId];
            if (ctrl && ctrl.floor === currentFloorRef.current && ctrl.root) {
              ctrl.root.getWorldPosition(projVec);
              projVec.y += 2.3;
              projVec.project(cameraRef.current!);
              if (projVec.z < 1.0) {
                const sx = (projVec.x * 0.5 + 0.5) * cw;
                const sy = (-(projVec.y * 0.5) + 0.5) * ch;
                if (sx > 30 && sx < cw - 30 && sy > 30 && sy < ch - 30) {
                  badges.push({
                    id: sess.id,
                    label: sess.name,
                    status: sess.status === "pending" ? "chờ duyệt" : sess.status === "working" ? "đang làm" : "đang nghỉ",
                    task: sess.title,
                    sx,
                    sy,
                    visible: true,
                    color: sess.status === "pending" ? "#f59e0b" : sess.status === "working" ? "#10b981" : "#38bdf8",
                    agentId: sess.agentId
                  });
                }
              }
            }
          });
          setScreenBadges(badges);
        }
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
      window.removeEventListener("keydown", handleKeyDown);
      renderer.dispose();
    };
  }, []);

  // Autonomous 3D Physical Collaboration Engine (Task 4)
  const triggerAgentCollaboration = useCallback(() => {
    const activeCtrls = Object.values(agentControllersRef.current).filter(
      (ctrl: any) => ctrl.floor === currentFloorRef.current && ctrl.state === "sitting"
    );
    if (activeCtrls.length < 2) return;

    // Pick 2 agents on floor
    const ctrlA = activeCtrls[0];
    const ctrlB = activeCtrls[1];

    const dialogPairs = [
      {
        topic: "Tối ưu hóa Microservices & Kiến trúc",
        a: "Đã tối ưu hóa API và kiểm thử tải thành công!",
        b: "Rất tốt, tôi sẽ merge PR vào nhánh release.",
        status: "✓ Đã đồng bộ mã nguồn"
      },
      {
        topic: "Bảo mật Zero-Trust & Phân quyền",
        a: "Đã cập nhật token xác thực và quét mã độc hệ thống.",
        b: "Đồng ý, tôi ghi nhận vào nhật ký bảo mật trung tâm.",
        status: "✓ Kiểm toán bảo mật đạt chuẩn"
      },
      {
        topic: "Đồng bộ Sổ Cái & VietQR Napas247",
        a: "Giao dịch thanh toán VietQR vừa hoàn tất xác thực.",
        b: "Đã ghi nhận doanh thu vào ngân khố doanh nghiệp.",
        status: "✓ Sổ cái khớp dữ liệu ngân hàng"
      },
      {
        topic: "Trải nghiệm Người Dùng & UI Obsidian Glass",
        a: "Giao diện Obsidian Glass mới hiển thị rất sắc nét.",
        b: "Tuyệt vời, tôi sẽ hoàn tất tài liệu bàn giao sản phẩm.",
        status: "✓ Đã duyệt thiết kế giao diện"
      }
    ];

    const chosen = dialogPairs[Math.floor(Math.random() * dialogPairs.length)];
    const bChair = ctrlB.assignedChairPos || ctrlB.cfg.chairPos;
    const approachSpot = {
      x: bChair.x + (bChair.x > 0 ? -0.85 : 0.85),
      z: bChair.z + 0.45,
      rotY: 0
    };

    ctrlA.walkToSpot(approachSpot, `Trao đổi với ${ctrlB.cfg.name}`, () => {
      // Face each other
      const dx = bChair.x - ctrlA.root.position.x;
      const dz = bChair.z - ctrlA.root.position.z;
      ctrlA.root.rotation.y = Math.atan2(dx, dz);
      ctrlB.root.rotation.y = Math.atan2(-dx, -dz);
      ctrlA.state = "chatting";
      ctrlB.state = "chatting";

      // A speaks
      ctrlA.showSpeechBubble(chosen.a, 5);

      // B speaks after 2.8s
      setTimeout(() => {
        ctrlB.showSpeechBubble(chosen.b, 4.5);
      }, 2800);

      // Add to internal collaboration feed
      setCollabMessages(prev => [
        {
          id: "collab-" + Date.now(),
          sender: ctrlA.cfg.name,
          senderRole: ctrlA.cfg.role,
          recipient: ctrlB.cfg.name,
          recipientRole: ctrlB.cfg.role,
          topic: chosen.topic,
          dialogueA: chosen.a,
          dialogueB: chosen.b,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          floorCode: FLOORS[currentFloorRef.current]?.code || "5F",
          deliverableStatus: chosen.status,
        },
        ...prev
      ]);

      // Return to desks after dialogue completes
      setTimeout(() => {
        ctrlA.returnToWorkstation();
        ctrlB.sitAtWorkstationImmediate();
      }, 7500);
    });
  }, []);

  // Autonomous Routine Simulation: Dispatches breaks and collaboration
  useEffect(() => {
    const isAnimDisabled = typeof window !== "undefined" && (window as any).__MY_OFFICE_ANIMATION_DISABLED__ === true;
    if (isAnimDisabled) return;

    // Purge any stale states across all agents on floor transition
    Object.values(agentControllersRef.current).forEach((ctrl: any) => {
      if (ctrl && typeof ctrl.validateStateOnFloor === "function") {
        ctrl.validateStateOnFloor();
      }
    });

    const routineInterval = setInterval(() => {
      const activeCtrls = Object.values(agentControllersRef.current).filter(
        (ctrl: any) => ctrl.floor === currentFloor && ctrl.state === "sitting"
      );

      if (activeCtrls.length > 0) {
        // Pick 1 or 2 random sitting agents
        const count = Math.min(activeCtrls.length, Math.floor(Math.random() * 2) + 1);
        for (let i = 0; i < count; i++) {
          const randIdx = Math.floor(Math.random() * activeCtrls.length);
          const chosenCtrl = activeCtrls[randIdx];
          const point = envRegistryRef.current.getRandomAvailable(currentFloor);
          if (point) {
            const dur = 14 + Math.floor(Math.random() * 10);
            chosenCtrl.takeBreak(point.type, dur);
          }
        }
      }
    }, 12000);

    const collabInterval = setInterval(() => {
      triggerAgentCollaboration();
    }, 28000);

    return () => {
      clearInterval(routineInterval);
      clearInterval(collabInterval);
    };
  }, [currentFloor, triggerAgentCollaboration]);

  // Update visibility on floor change or ghost mode toggle
  useEffect(() => {
    updateFloorVisibility(currentFloor, ghostMode);
  }, [currentFloor, ghostMode, updateFloorVisibility]);

  // Real Multi-Turn AI Chat & Task Dispatching
  const handleChatSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = chatInputText.trim();
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

    try {
      // 1. Ensure authenticated session with backend
      await ensureAuthenticatedSession();
      const token = getAuthToken();

      // 2. Call backend conversation endpoint
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${API_BASE_URL}/api/v1/conversations/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          prompt: text,
          conversation_id: activeConversationIdRef.current || null,
          agent_id: selectedChatTarget === "auto" ? null : selectedChatTarget,
          mode: chatExecutionMode
        })
      });

      if (!res.ok) {
        throw new Error(`Mã lỗi phản hồi từ máy chủ: ${res.status}`);
      }

      const data = await res.json();
      if (data.conversation_id) {
        activeConversationIdRef.current = data.conversation_id;
        setActiveConversationId(data.conversation_id);
      }

      // 3. Resolve target floor
      const division = (data.routing?.division || "engineering").toLowerCase();
      const targetFloor = getFloorForDivision(division);
      setCurrentRouteNotice(`${data.routing?.mode || 'Auto-Routed'} → ${data.agent_name} (${FLOORS[targetFloor]?.code || '5F'})`);

      if (currentFloor !== targetFloor) {
        useElevatorToFloor(targetFloor);
      }

      // 4. Trigger Chibi movement & speech
      const ctrl = agentControllersRef.current[data.agent_id] || Object.values(agentControllersRef.current)[0];
      if (ctrl) {
        if (data.mode === "task") {
          ctrl.walkToChairAndWork(`${data.agent_name} • Nhận lệnh nhiệm vụ ✓`);
        } else {
          ctrl.walkToChairAndWork(`${data.agent_name} • Đang trao đổi AI...`);
        }
      }

      // 5. Update Wall Screen
      drawWallScreenContent(targetFloor, {
        title: `${data.agent_name.toUpperCase()} (${FLOORS[targetFloor]?.code || '5F'}) • ${data.mode.toUpperCase()}`,
        line1: data.content.slice(0, 48),
        line2: (data.routing?.reason || "Đã thẩm định năng lực chuyên môn").slice(0, 48),
        line3: data.mode === "task" ? `Mã nhiệm vụ: ${data.task_id}` : `Mô hình: ${data.routing?.model || 'Specialist Engine'}`,
        accent: FLOORS[targetFloor]?.themeColor || "#38bdf8"
      });

      // 6. Append assistant message with thought & routing metadata
      const assistantMsg: ChatItem = {
        id: data.message_id || ("a-" + Date.now()),
        role: "assistant",
        text: data.content,
        thought: data.thought,
        taskId: data.task_id,
        taskStatus: data.task_status,
        agentName: data.agent_name,
        agentRole: data.role,
        division: data.routing?.division,
        agentId: data.agent_id,
        floorCfg: FLOORS[targetFloor],
        mode: data.mode,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      setChatMessages(prev => [...prev, assistantMsg]);

      // Call external prop if present
      if (onSubmitTask && data.task_id) {
        onSubmitTask(data.agent_id, text).catch(() => { });
      }

    } catch (err: any) {
      console.error("Chat error:", err);
      setChatMessages(prev => [
        ...prev,
        {
          id: "err-" + Date.now(),
          role: "assistant",
          text: `⚠️ **Không thể kết nối với Conversation Service của Backend**\n\nChi tiết: ${err.message || err}\n\nHãy đảm bảo server FastAPI đang chạy tại http://127.0.0.1:8000.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setIsAiResponding(false);
      setCurrentRouteNotice(null);
    }
  };

  // Camera View Presets & Direct Agent Focus
  const focusAndTrackAgent = useCallback((agentId: string) => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
    const agent = chibis[agentId] || Object.values(chibis).find((c: any) => c.agentId === agentId || c.name === agentId);
    if (agent && agent.floor !== currentFloorRef.current) {
      useElevatorToFloor(agent.floor);
    }
    const resolvedId = agent ? agent.agentId : agentId;
    setTrackingAgentId(resolvedId);
    camStateRef.current.trackingAgentId = resolvedId;
    const ctrl = agentControllersRef.current[resolvedId];
    if (ctrl) setTrackingActionLabel(ctrl.currentActionLabel);
  }, []);

  const applyCameraPreset = useCallback((preset: "overview" | "desks" | "boardroom" | "servers" | "avatar") => {
    setActivePresetView(preset);
    const s = camStateRef.current;
    const baseY = currentFloorRef.current * FLOOR_HEIGHT + 2.5;

    if (preset === "overview") {
      stopTrackingCamera();
      s.destX = 0;
      s.destY = baseY;
      s.destZ = 0.5;
      s.destRadius = 52;
      s.destTheta = Math.PI / 4;
      s.destPhi = Math.PI / 3.25;
      s.isCinematicMoving = true;
      setZoomLevel(100);
    } else if (preset === "desks") {
      stopTrackingCamera();
      s.destX = 0;
      s.destY = baseY;
      s.destZ = 11.5;
      s.destRadius = 26;
      s.destTheta = Math.PI / 4;
      s.destPhi = Math.PI / 3.3;
      s.isCinematicMoving = true;
      setZoomLevel(175);
    } else if (preset === "boardroom") {
      stopTrackingCamera();
      s.destX = -20.0;
      s.destY = baseY;
      s.destZ = 8.5;
      s.destRadius = 20;
      s.destTheta = 0.65;
      s.destPhi = Math.PI / 3.6;
      s.isCinematicMoving = true;
      setZoomLevel(230);
    } else if (preset === "servers") {
      stopTrackingCamera();
      s.destX = 0;
      s.destY = baseY;
      s.destZ = 0.3;
      s.destRadius = 24;
      s.destTheta = Math.PI / 4;
      s.destPhi = Math.PI / 3.2;
      s.isCinematicMoving = true;
      setZoomLevel(210);
    } else if (preset === "avatar") {
      const chibis = Object.values(agentControllersRef.current);
      const candidate = chibis.find((c: any) => c.floor === currentFloorRef.current) || chibis[0];
      if (candidate) {
        focusAndTrackAgent(candidate.agentId);
      }
    }
  }, [stopTrackingCamera, focusAndTrackAgent]);

  const handleZoomStep = useCallback((step: number) => {
    const s = camStateRef.current;
    const factor = step > 0 ? 0.82 : 1.22;
    const newRadius = Math.max(12, Math.min(80, s.radius * factor));
    s.destRadius = newRadius;
    s.destX = s.targetX;
    s.destY = s.targetY;
    s.destZ = s.targetZ;
    s.destTheta = s.theta;
    s.destPhi = s.phi;
    s.isCinematicMoving = true;
    setZoomLevel(Math.round((46 / newRadius) * 100));
  }, []);

  const handleTakeScreenshot = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `my_office_diorama_${FLOORS[currentFloor]?.code || "3d"}.png`;
    link.href = dataUrl;
    link.click();
  }, [currentFloor]);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  }, []);

  const resetCameraView = () => {
    applyCameraPreset("overview");
  };

  // Filtered Sessions & Activities
  const filteredSessions = sessions.filter(s => {
    if (sessionFilter === "working" && s.status !== "working") return false;
    if (sessionFilter === "pending" && s.status !== "pending") return false;
    if (sessionFilter === "resting" && s.status !== "resting") return false;
    if (searchSessionQuery.trim()) {
      const q = searchSessionQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.title.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredActivities = activityStream.filter(act => {
    if (activityFilter === "attention" && act.status !== "pending") return false;
    if (activityFilter === "command" && act.type !== "command") return false;
    if (activityFilter === "edit" && act.type !== "edit") return false;
    if (activityFilter === "read" && act.type !== "read") return false;
    if (activityFilter === "web" && act.type !== "web") return false;
    return true;
  });

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-[#090d16]">
      {/* 3D Canvas Diorama Container */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* IN-WORLD 3D FLOATING STATUS BADGES OVER AGENTS (Matching Reference Image 1) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {screenBadges.map(b => (
          <div
            key={b.id}
            style={{
              transform: `translate3d(${b.sx}px, ${b.sy}px, 0)`,
              left: 0,
              top: 0
            }}
            className="absolute -translate-x-1/2 -translate-y-full pointer-events-auto cursor-pointer transition-all duration-75 hover:scale-110"
            onClick={() => focusAndTrackAgent(b.agentId)}
          >
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/90 backdrop-blur-md border text-[11px] font-bold text-white shadow-xl shadow-black/50 border-slate-700/80 hover:border-amber-400 group">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="text-amber-300 font-mono">{b.label}</span>
              <span className="text-slate-300 font-medium text-[10px] bg-slate-800/80 px-1.5 py-0.5 rounded-full">
                {b.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* TOP HEADER NAVIGATION BAR (Exact replica of Claude Code My Office) */}
      <header className="fixed top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Branding & Status */}
        <div className="glass-panel bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-2xl px-3.5 py-2 flex items-center gap-3 pointer-events-auto shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏢</span>
            <span className="font-extrabold text-sm text-white tracking-tight">My Office</span>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
              10:48
            </span>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 rounded-full">
              {backendStatus === "connected" ? "LIVE BACKEND" : "DEMO - dữ liệu trực tiếp"}
            </span>
          </div>

          <div className="h-5 w-[1px] bg-slate-700/80"></div>

          {/* Quick Floor Selector (G to 7F) */}
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(f => {
              const cfg = FLOORS[f];
              if (!cfg) return null;
              const isCurrent = f === currentFloor;
              return (
                <button
                  key={f}
                  onClick={() => useElevatorToFloor(f)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${isCurrent
                      ? "bg-amber-500 text-slate-950 shadow"
                      : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                    }`}
                  title={`${cfg.code} - ${cfg.name}`}
                >
                  {cfg.code}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center / Right: System Status & Quick Actions */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Mac RAM Resource Indicator */}
          <div className="glass-panel bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-2xl px-3.5 py-2 flex items-center gap-2 text-xs font-medium text-slate-300 shadow-xl hidden md:flex">
            <Laptop className="w-3.5 h-3.5 text-amber-400" />
            <span>Máy Mac</span>
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="text-amber-400 font-bold">RAM 79%</span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">3.1 GB</span>
            </div>
            <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden ml-1 border border-slate-700/60">
              <div className="w-[79%] h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"></div>
            </div>
          </div>

          {/* Ghost Mode Cycle */}
          <button
            onClick={() => {
              const nextMode: GhostMode =
                ghostMode === "DARKENED_GHOST" ? "ISOLATED" : ghostMode === "ISOLATED" ? "NORMAL" : "DARKENED_GHOST";
              setGhostMode(nextMode);
            }}
            className="bg-slate-900/90 hover:bg-slate-800 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition shadow-lg border border-slate-700/80 backdrop-blur-md text-slate-200"
            title="Chuyển chế độ hiển thị tầng"
          >
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden xl:inline text-xs">
              {ghostMode === "DARKENED_GHOST" ? "Mờ vật lý" : ghostMode === "ISOLATED" ? "Ẩn tầng khác" : "Hiện tất cả"}
            </span>
          </button>

          {/* Elevator Remote Trigger */}
          <button
            onClick={() => setIsElevatorRemoteOpen(prev => !prev)}
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xl shadow-orange-500/20 transition transform active:scale-95"
          >
            <span>🛗</span>
            <span>Thang Máy</span>
            <span className="font-mono bg-slate-950 text-amber-400 px-1 py-0.2 rounded text-[11px]">
              {FLOORS[currentFloor]?.code}
            </span>
          </button>

          {/* Executive Treasury & VietQR Bank Payout */}
          <button
            onClick={() => setIsTreasuryOpen(true)}
            className="bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-extrabold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xl shadow-amber-500/25 transition transform active:scale-95"
            title="Sổ Cái Ngân Khố & Cổng Thanh Toán Napas247 VietQR"
          >
            <CreditCard className="w-3.5 h-3.5 text-slate-950" />
            <span className="hidden sm:inline">Kho Bạc & VietQR</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          </button>

          {/* Reset Camera */}
          <button
            onClick={resetCameraView}
            className="bg-slate-900/90 hover:bg-slate-800 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition shadow-lg border border-slate-700/80 backdrop-blur-md text-slate-200"
            title="Góc nhìn chuẩn"
          >
            <Compass className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline text-xs">Góc chuẩn</span>
          </button>
        </div>
      </header>

      {/* LEFT SIDEBAR: "Phiên làm việc" (Active Work Sessions - Claude Code) */}
      <aside
        className={`fixed left-3 top-16 bottom-16 z-20 w-[330px] flex flex-col bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden pointer-events-auto transition-transform duration-300 ${isLeftSessionsOpen ? "translate-x-0" : "-translate-x-[345px]"
          }`}
      >
        {/* Panel Header */}
        <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-sm text-white">Phiên làm việc</h2>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                {sessions.length} phiên
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>đang nhận dữ liệu trực tiếp</span>
            </p>
          </div>
          <button
            onClick={() => setIsLeftSessionsOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-xs"
            title="Thu gọn"
          >
            ◀
          </button>
        </div>

        {/* Quick Status Filter Pills */}
        <div className="px-3 py-2 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-1.5 text-[11px] overflow-x-auto">
          <button
            onClick={() => setSessionFilter("all")}
            className={`px-2 py-1 rounded-lg font-bold transition shrink-0 ${sessionFilter === "all" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
              }`}
          >
            Tất cả
          </button>
          <button
            onClick={() => setSessionFilter("working")}
            className={`px-2 py-1 rounded-lg font-bold transition shrink-0 flex items-center gap-1 ${sessionFilter === "working" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-slate-400 hover:text-white"
              }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>3 đang làm</span>
          </button>
          <button
            onClick={() => setSessionFilter("pending")}
            className={`px-2 py-1 rounded-lg font-bold transition shrink-0 flex items-center gap-1 ${sessionFilter === "pending" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "text-slate-400 hover:text-white"
              }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            <span>2 chờ duyệt</span>
          </button>
          <button
            onClick={() => setSessionFilter("resting")}
            className={`px-2 py-1 rounded-lg font-bold transition shrink-0 flex items-center gap-1 ${sessionFilter === "resting" ? "bg-sky-500/20 text-sky-300 border border-sky-500/40" : "text-slate-400 hover:text-white"
              }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
            <span>1 đang nghỉ</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="p-2.5 bg-slate-950/40 border-b border-slate-800/80">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchSessionQuery}
              onChange={e => setSearchSessionQuery(e.target.value)}
              placeholder="Tìm theo tên hoặc thư mục..."
              className="w-full bg-slate-900 text-xs text-white placeholder-slate-500 pl-8 pr-3 py-1.5 rounded-xl border border-slate-800 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* SECTION: CẦN BẠN DUYỆT */}
          {filteredSessions.some(s => s.status === "pending") && (
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400/90 mb-1.5 flex items-center gap-1">
                <span>⚠️ CẦN BẠN DUYỆT</span>
                <span className="bg-amber-500/20 px-1.5 rounded-full text-amber-300">
                  {filteredSessions.filter(s => s.status === "pending").length}
                </span>
              </div>
              <div className="space-y-1.5">
                {filteredSessions.filter(s => s.status === "pending").map(sess => (
                  <div
                    key={sess.id}
                    onClick={() => focusAndTrackAgent(sess.agentId)}
                    className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 hover:border-amber-400 cursor-pointer transition shadow-md group"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                      <span className="font-mono">{sess.name}</span>
                      <span className="text-[10px] text-amber-400/70 font-normal">{sess.time}</span>
                    </div>
                    <div className="text-[11px] text-slate-200 mt-1">{sess.title}</div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          alert(`Đã duyệt hành động cho ${sess.name}`);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        <span>Duyệt</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          alert(`Đã từ chối hành động cho ${sess.name}`);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        Từ chối
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION: ĐANG LÀM */}
          {filteredSessions.some(s => s.status === "working") && (
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400/90 mb-1.5 flex items-center gap-1">
                <span>⚡ ĐANG LÀM</span>
                <span className="bg-emerald-500/20 px-1.5 rounded-full text-emerald-300">
                  {filteredSessions.filter(s => s.status === "working").length}
                </span>
              </div>
              <div className="space-y-1.5">
                {filteredSessions.filter(s => s.status === "working").map(sess => (
                  <div
                    key={sess.id}
                    onClick={() => focusAndTrackAgent(sess.agentId)}
                    className="p-2.5 rounded-2xl bg-slate-800/80 border border-slate-700/80 hover:border-emerald-400 cursor-pointer transition shadow group"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-white">
                      <span className="font-mono group-hover:text-emerald-300 transition">{sess.name}</span>
                      <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        {sess.time}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1 truncate">{sess.title}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION: ĐANG NGHỈ */}
          {filteredSessions.some(s => s.status === "resting") && (
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-sky-400/90 mb-1.5 flex items-center gap-1">
                <span>☕ ĐANG NGHỈ</span>
                <span className="bg-sky-500/20 px-1.5 rounded-full text-sky-300">
                  {filteredSessions.filter(s => s.status === "resting").length}
                </span>
              </div>
              <div className="space-y-1.5">
                {filteredSessions.filter(s => s.status === "resting").map(sess => (
                  <div
                    key={sess.id}
                    onClick={() => focusAndTrackAgent(sess.agentId)}
                    className="p-2.5 rounded-2xl bg-slate-850/60 border border-slate-800 hover:border-sky-400 cursor-pointer transition group"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="font-mono">{sess.name}</span>
                      <span className="text-[10px] text-slate-500">{sess.time}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">{sess.title}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION: 276 AGENTS ROSTER (Collapsible) */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
                <button
                  onClick={() => setSidebarTab("floor")}
                  className={`px-2 py-0.5 rounded font-bold transition ${sidebarTab === "floor" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
                    }`}
                >
                  Tầng {currentFloor}F ({workforceList.filter(a => a.floor === currentFloor).length})
                </button>
                <button
                  onClick={() => setSidebarTab("leadership")}
                  className={`px-2 py-0.5 rounded font-bold transition ${sidebarTab === "leadership" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
                    }`}
                >
                  Lãnh Đạo (8)
                </button>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono font-bold">
                ● 276 Nhân sự
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 max-h-[140px] overflow-y-auto pr-1">
              {(sidebarTab === "floor"
                ? workforceList.filter(a => a.floor === currentFloor)
                : Object.values(CANONICAL_AGENTS)
              ).slice(0, 30).map(ag => (
                <button
                  key={ag.id}
                  onClick={() => focusAndTrackAgent(ag.id)}
                  className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-left transition truncate"
                >
                  <div className="text-[11px] font-bold text-white truncate">{ag.name}</div>
                  <div className="text-[9px] text-slate-400 truncate">{ag.role.split("&")[0]}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* LEFT DRAWER TOGGLE PILL (when collapsed) */}
      {!isLeftSessionsOpen && (
        <button
          onClick={() => setIsLeftSessionsOpen(true)}
          className="fixed left-3 top-20 z-20 bg-slate-900/90 hover:bg-slate-800 text-white font-bold text-xs px-3 py-2 rounded-xl border border-slate-700/80 shadow-2xl flex items-center gap-1.5 transition pointer-events-auto"
        >
          <span>▶</span>
          <span>Phiên làm việc (6)</span>
        </button>
      )}

      {/* RIGHT SIDEBAR: "Hoạt động" (Live Timeline Feed) & AI Chat */}
      <aside
        className={`fixed right-3 top-16 bottom-3 z-30 w-[420px] max-w-[calc(100vw-24px)] flex flex-col bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden pointer-events-auto transition-transform duration-300 ${isRightPanelOpen ? "translate-x-0" : "translate-x-[440px]"
          }`}
      >
        {/* Panel Header */}
        <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-extrabold text-sm text-white">Hoạt động</h2>
            <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              trực tiếp
            </span>
          </div>

          {/* Tab Selector: Timeline vs AI Chat vs Collab */}
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-xl border border-slate-800">
            <button
              onClick={() => setRightPanelTab("timeline")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${rightPanelTab === "timeline" ? "bg-amber-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                }`}
            >
              Dòng thời gian
            </button>
            <button
              onClick={() => setRightPanelTab("chat")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${rightPanelTab === "chat" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                }`}
            >
              Trò chuyện AI
            </button>
            <button
              onClick={() => setRightPanelTab("collab")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${rightPanelTab === "collab" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                }`}
            >
              Hợp tác Nội bộ
            </button>
          </div>

          <button
            onClick={() => setIsRightPanelOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-xs ml-1"
            title="Thu gọn"
          >
            ▶
          </button>
        </div>

        {rightPanelTab === "timeline" ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 5 Metric Summary Cards (Việc, Đọc, Sửa, Lệnh, Giá API) */}
            <div className="p-3 bg-slate-950/50 border-b border-slate-800/80 grid grid-cols-5 gap-1.5 text-center">
              <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-xl">
                <div className="text-sm font-extrabold text-white">7</div>
                <div className="text-[9px] text-slate-400">Việc</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-xl">
                <div className="text-sm font-extrabold text-sky-400">12</div>
                <div className="text-[9px] text-slate-400">Đọc</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-xl">
                <div className="text-sm font-extrabold text-amber-400">6</div>
                <div className="text-[9px] text-slate-400">Sửa</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-xl">
                <div className="text-sm font-extrabold text-emerald-400">4</div>
                <div className="text-[9px] text-slate-400">Lệnh</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-xl">
                <div className="text-xs font-extrabold text-indigo-300 font-mono">$17.53</div>
                <div className="text-[9px] text-slate-400 truncate">Giá API</div>
              </div>
            </div>

            {/* Filter Chips */}
            <div className="px-3 py-2 bg-slate-950/30 border-b border-slate-800/80 flex items-center gap-1 overflow-x-auto text-[11px]">
              <button
                onClick={() => setActivityFilter("all")}
                className={`px-2 py-0.5 rounded-lg font-bold shrink-0 transition ${activityFilter === "all" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                  }`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setActivityFilter("command")}
                className={`px-2 py-0.5 rounded-lg font-semibold shrink-0 transition ${activityFilter === "command" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-white"
                  }`}
              >
                Lệnh
              </button>
              <button
                onClick={() => setActivityFilter("edit")}
                className={`px-2 py-0.5 rounded-lg font-semibold shrink-0 transition ${activityFilter === "edit" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-white"
                  }`}
              >
                Sửa file
              </button>
              <button
                onClick={() => setActivityFilter("read")}
                className={`px-2 py-0.5 rounded-lg font-semibold shrink-0 transition ${activityFilter === "read" ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-white"
                  }`}
              >
                Đọc
              </button>
              <button
                onClick={() => setActivityFilter("web")}
                className={`px-2 py-0.5 rounded-lg font-semibold shrink-0 transition ${activityFilter === "web" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-white"
                  }`}
              >
                Web
              </button>
            </div>

            {/* Activity Events Stream */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredActivities.map(act => (
                <div
                  key={act.id}
                  className="p-2.5 rounded-2xl bg-slate-800/70 border border-slate-700/60 flex items-start gap-2.5 text-xs hover:border-slate-500 transition"
                >
                  <span className="text-base shrink-0">{act.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-amber-300">{act.session}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{act.time}</span>
                    </div>
                    <div className="text-[11px] text-slate-200 mt-0.5 truncate">{act.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : rightPanelTab === "chat" ? (
          /* TAB 2: AI CHAT (Fast mathematical auto-router engine) */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {chatMessages.map(msg => (
                <div
                  key={msg.id}
                  className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  {msg.role === "user" ? (
                    <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-xs sm:text-sm shadow">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="max-w-[95%] bg-slate-900/95 border border-slate-700/80 rounded-2xl rounded-bl-sm p-3 text-xs space-y-1.5 shadow-lg">
                      <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-800">
                        <div className="flex items-center gap-1.5">
                          <Bot className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-[11px] font-bold text-indigo-300">AI Assistant</span>
                        </div>
                        {msg.floorCfg && (
                          <button
                            onClick={() => useElevatorToFloor(msg.floorCfg!.id)}
                            className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold shrink-0"
                          >
                            🛗 Tới {msg.floorCfg.code}
                          </button>
                        )}
                      </div>
                      {msg.thought && (
                        <details className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2 text-[11px] text-slate-400">
                          <summary className="font-semibold text-amber-300/90 cursor-pointer flex items-center gap-1">
                            <span>💭 Suy nghĩ chuyên sâu</span>
                          </summary>
                          <div className="mt-1 pt-1 border-t border-slate-800/80 whitespace-pre-line text-slate-300">
                            {msg.thought}
                          </div>
                        </details>
                      )}
                      <div className="text-xs sm:text-[13px] leading-relaxed text-slate-100">
                        <FormattedChatMessage content={msg.text} />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {isAiResponding && (
                <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl rounded-bl-sm p-3 text-xs space-y-1.5 shadow-lg">
                  <div className="flex items-center gap-2 text-slate-300 py-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                    <span>Chuyên gia đang xử lý nghiệp vụ...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Prompts */}
            <div className="px-3 py-1.5 bg-slate-950/50 border-t border-slate-800/80 flex items-center gap-1 overflow-x-auto">
              <button
                onClick={() => setChatInputText("1+1")}
                className="shrink-0 text-[10px] bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full"
              >
                ⚡ 1+1
              </button>
              <button
                onClick={() => setChatInputText("GraphQL khác REST API như thế nào?")}
                className="shrink-0 text-[10px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full"
              >
                💻 GraphQL vs REST (5F)
              </button>
              <button
                onClick={() => setChatInputText("Dự toán ngân sách Q4")}
                className="shrink-0 text-[10px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full"
              >
                📊 Ngân sách (2F)
              </button>
            </div>

            {/* Chat Input */}
            <form
              onSubmit={handleChatSubmit}
              className="p-3 bg-slate-950/95 border-t border-slate-800 flex items-end gap-2 shrink-0 relative z-30"
            >
              <textarea
                value={chatInputText}
                onChange={e => setChatInputText(e.target.value)}
                rows={2}
                placeholder="Nhắn câu hỏi AI... (Tự động nhận diện 18 phân ban)"
                className="flex-1 bg-slate-900 text-white placeholder-slate-500 text-xs rounded-2xl px-3 py-2 border border-slate-700 focus:outline-none focus:border-indigo-500 resize-none"
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
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold px-3.5 py-2.5 rounded-2xl text-xs transition shadow-lg shrink-0"
              >
                Gửi ➤
              </button>
            </form>
          </div>
        ) : (
          /* TAB 3: HỢP TÁC NỘI BỘ (Autonomous Agent-to-Agent Multi-Agent Comms) */
          <div className="flex-1 flex flex-col min-h-0 bg-[#070b14]/90 text-slate-100 p-3.5 space-y-3 overflow-y-auto">
            {/* Header Action Banner */}
            <div className="p-3 rounded-2xl bg-gradient-to-r from-amber-500/15 via-[#0d1527] to-[#070b14] border border-amber-500/30 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-amber-400" />
                  <span>Kênh Hợp Tác Liên Phòng Ban</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Tự động điều phối 3D: Nhân sự di chuyển & đối thoại
                </div>
              </div>
              <button
                onClick={() => triggerAgentCollaboration()}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-extrabold text-[11px] shadow-lg shadow-amber-500/20 flex items-center gap-1.5 transition active:scale-95 shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Kích hoạt 3D</span>
              </button>
            </div>

            {/* List of collaboration dialogues */}
            <div className="space-y-3">
              {collabMessages.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-amber-500/30 transition shadow-lg space-y-2.5"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-amber-300 font-mono flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      {item.topic}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{item.floorCode} • {item.time}</span>
                  </div>

                  {/* Initiator bubble */}
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                      A
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-sky-300">{item.sender} <span className="text-slate-500 font-normal">({item.senderRole})</span></div>
                      <div className="text-xs text-slate-200 mt-0.5">{item.dialogueA}</div>
                    </div>
                  </div>

                  {/* Partner bubble */}
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                      B
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-amber-300">{item.recipient} <span className="text-slate-500 font-normal">({item.recipientRole})</span></div>
                      <div className="text-xs text-slate-200 mt-0.5">{item.dialogueB}</div>
                    </div>
                  </div>

                  {/* Deliverable tag */}
                  <div className="text-[10px] text-emerald-400 font-mono font-medium flex items-center gap-1 pt-0.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>{item.deliverableStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* RIGHT DRAWER TOGGLE PILL (when collapsed) */}
      {!isRightPanelOpen && (
        <button
          onClick={() => setIsRightPanelOpen(true)}
          className="fixed right-3 top-20 z-20 bg-slate-900/90 hover:bg-slate-800 text-white font-bold text-xs px-3 py-2 rounded-xl border border-slate-700/80 shadow-2xl flex items-center gap-1.5 transition pointer-events-auto"
        >
          <span>◀</span>
          <span>Hoạt động & Chat</span>
        </button>
      )}

      {/* BOTTOM CONTROL DOCK & CAMERA PRESETS (Positioned responsive to avoid chat overlap) */}
      <div
        className={`fixed bottom-3 z-20 pointer-events-auto flex flex-col items-center gap-1.5 transition-all duration-300 ${isRightPanelOpen
            ? "left-3 sm:left-[376px] right-[440px] max-w-fit mx-auto"
            : "left-1/2 -translate-x-1/2"
          }`}
      >
        <div className="glass-panel bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl px-3 py-2 flex items-center gap-2.5 shadow-2xl">
          {/* View Presets Group */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => applyCameraPreset("overview")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activePresetView === "overview"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                }`}
            >
              <span>🏛️</span>
              <span>Toàn cảnh</span>
            </button>
            <button
              onClick={() => applyCameraPreset("desks")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activePresetView === "desks"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                }`}
            >
              <span>🪑</span>
              <span>Bàn làm việc</span>
            </button>
            <button
              onClick={() => applyCameraPreset("boardroom")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activePresetView === "boardroom"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                }`}
            >
              <span>👥</span>
              <span>Phòng họp</span>
            </button>
            <button
              onClick={() => applyCameraPreset("servers")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activePresetView === "servers"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                }`}
            >
              <span>🛋️</span>
              <span>Lounge trung tâm</span>
            </button>
          </div>

          <div className="h-5 w-[1px] bg-slate-700/80"></div>

          {/* Zoom Slider Group */}
          <div className="flex items-center gap-1.5 bg-slate-850 px-2 py-1 rounded-xl border border-slate-800">
            <button
              onClick={() => handleZoomStep(-1)}
              className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center transition"
              title="Thu nhỏ"
            >
              —
            </button>
            <span className="text-xs font-mono font-bold text-amber-300 w-12 text-center">
              {zoomLevel}%
            </span>
            <button
              onClick={() => handleZoomStep(1)}
              className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center transition"
              title="Phóng to"
            >
              +
            </button>
          </div>

          <div className="h-5 w-[1px] bg-slate-700/80"></div>

          {/* Utility Tools: Fullscreen, Screenshot, Settings, Avatar */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleFullscreen}
              className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
              title="Toàn màn hình"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleTakeScreenshot}
              className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
              title="Chụp ảnh 3D Diorama"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsElevatorRemoteOpen(true)}
              className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
              title="Cài đặt / Điều khiển"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => applyCameraPreset("avatar")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${trackingAgentId
                  ? "bg-purple-600 text-white shadow"
                  : "bg-slate-800/80 text-purple-300 hover:bg-slate-700"
                }`}
              title="Hoá thân / Theo dõi nhân vật gần nhất"
            >
              <span>✨</span>
              <span>Hoá thân</span>
            </button>
          </div>
        </div>
      </div>

      {/* FLOATING CHARACTER TRACKING & INSPECTION HUD */}
      {trackingAgentId && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
          <div className="bg-slate-900/95 backdrop-blur-xl border-2 border-indigo-500/60 shadow-2xl shadow-indigo-500/20 rounded-2xl p-3 sm:p-4 flex items-center gap-4 text-white min-w-[320px] max-w-[500px] animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-xl shrink-0 shadow-inner">
              👤
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base truncate">
                  {workforceList.find(a => a.id === trackingAgentId)?.name || CANONICAL_AGENTS[trackingAgentId]?.name || "Chuyên Gia"}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 font-mono font-bold shrink-0">
                  {FLOORS[agentControllersRef.current[trackingAgentId]?.floor || currentFloor]?.code}
                </span>
              </div>
              <div className="text-xs text-slate-400 truncate">
                {workforceList.find(a => a.id === trackingAgentId)?.role || CANONICAL_AGENTS[trackingAgentId]?.role}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs font-semibold text-amber-300">
                  {trackingActionLabel || agentControllersRef.current[trackingAgentId]?.currentActionLabel || "Đang làm việc"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => {
                  setSelectedChatTarget(trackingAgentId);
                  setRightPanelTab("chat");
                  setIsRightPanelOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow transition flex items-center justify-center gap-1"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Nhắn AI</span>
              </button>
              <button
                onClick={stopTrackingCamera}
                className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs border border-slate-700 transition flex items-center justify-center gap-1"
              >
                <span>✕ Thoát (Esc)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ELEVATOR REMOTE KEYPAD MODAL (ALL 6 FLOORS) */}
      {isElevatorRemoteOpen && (
        <div className="fixed left-4 top-20 z-30 pointer-events-auto transition-all duration-200">
          <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-2 border-slate-600/60 rounded-3xl p-4 w-72 text-slate-100 shadow-2xl backdrop-blur-xl">
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

            {/* Floor Selection Buttons (7F to G) */}
            <div className="space-y-1.5 mb-3.5 max-h-[280px] overflow-y-auto pr-1">
              {[7, 6, 5, 4, 3, 2, 1, 0].map(f => {
                const cfg = FLOORS[f];
                if (!cfg) return null;
                const isSelected = f === currentFloor;
                return (
                  <button
                    key={f}
                    onClick={() => useElevatorToFloor(f)}
                    className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-600/60 transition group"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className={`w-7 h-7 rounded-full bg-slate-900 border-2 flex items-center justify-center font-mono font-extrabold text-xs shrink-0 ${isSelected ? "border-amber-400 text-amber-400" : "border-slate-500 text-white group-hover:border-amber-400"
                        }`}>
                        {cfg.code}
                      </span>
                      <div className="text-left truncate">
                        <div className="text-xs font-bold text-white truncate">{cfg.name}</div>
                        <div className="text-[9px] text-slate-400 truncate">{cfg.code} • {cfg.enName.split("—")[1]?.trim() || cfg.enName}</div>
                      </div>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isSelected ? "bg-amber-400 shadow-[0_0_8px_#fbbf24]" : "bg-slate-600"}`}></span>
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

      {/* EXECUTIVE TREASURY & VIETQR PAYMENT MODAL */}
      <ExecutiveTreasuryModal
        isOpen={isTreasuryOpen}
        onClose={() => setIsTreasuryOpen(false)}
      />
    </div>
  );
}
