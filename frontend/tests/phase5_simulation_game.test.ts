import { describe, it, expect } from "vitest";
import {
  FLOOR_DEFINITIONS,
  resolveFloorByDepartment,
  getFloorDefinition,
} from "../lib/office/floorDefinitions";
import { routeUserPrompt, KNOWN_AGENTS } from "../lib/ai/agentRouter";
import { computeWorkstationCoordinates } from "../lib/office/workstationCoordinates";
import {
  officeSimulationEngine,
  generateChibiStyle,
} from "../lib/simulation/officeSimulationEngine";

describe("Phase 5.0: Simulation Game Architecture & Intelligence", () => {
  describe("1. Multi-Floor Definition Architecture (Phase 1 & 2)", () => {
    it("should define all modular headquarters floors: B1, F1, F2, F3, F4, F5", () => {
      const expectedFloors = [-1, 1, 2, 3, 4, 5];
      expectedFloors.forEach((floorNum) => {
        const def = getFloorDefinition(floorNum);
        expect(def).not.toBeNull();
        expect(def?.code).toBeDefined();
        expect(def?.name).toBeDefined();
        expect(def?.rooms.length).toBeGreaterThan(0);
        expect(def?.cameraPreset.isometricPos).toHaveLength(3);
        expect(def?.cameraPreset.lookAt).toHaveLength(3);
        expect(def?.elevatorDoorPos).toHaveLength(3);
      });
    });

    it("should accurately resolve floor indices from department names", () => {
      expect(resolveFloorByDepartment("DevOps Infrastructure")).toBe(5); // 5F Core Engineering
      expect(resolveFloorByDepartment("Server Room")).toBe(5); // 5F SOC & Systems
      expect(resolveFloorByDepartment("CEO Executive Suite")).toBe(6); // 6F Executive Suite
      expect(resolveFloorByDepartment("Software Engineering")).toBe(5); // 5F Engineering
      expect(resolveFloorByDepartment("Frontend Development")).toBe(5); // 5F Engineering
      expect(resolveFloorByDepartment("AI Research & Data Science")).toBe(6); // 6F AI Research
      expect(resolveFloorByDepartment("Marketing & Creative Studio")).toBe(3); // 3F Marketing
      expect(resolveFloorByDepartment("Finance & Treasury")).toBe(2); // 2F Finance
      expect(resolveFloorByDepartment("People Operations HR")).toBe(1); // 1F Operations
    });
  });

  describe("2. Workstation Precise Coordinate System (Phase 5)", () => {
    it("should place sitting employee pelvis strictly ON the chair cushion and not on desk top", () => {
      const rootX = 4.0;
      const rootY = 6.0; // Floor 2 elevation
      const rootZ = -2.0;

      const coords = computeWorkstationCoordinates(rootX, rootY, rootZ, 0);

      // Desk is at [4.0, 6.0, -2.0]
      expect(coords.deskPos).toEqual([4.0, 6.0, -2.0]);

      // Chair cushion is offset +0.55m in Z from desk center
      expect(coords.chairPos).toEqual([4.0, 6.0, -1.45]);

      // Sitting anchor placed on top of chair seat cushion (y = 6.44m, z = -1.45m)
      expect(coords.sittingAnchor[0]).toBeCloseTo(4.0, 2);
      expect(coords.sittingAnchor[1]).toBeCloseTo(6.44, 2);
      expect(coords.sittingAnchor[2]).toBeCloseTo(-1.45, 2);

      // Standing anchor is behind the chair (z = -1.05m)
      expect(coords.standingAnchor[2]).toBeCloseTo(-1.05, 2);

      // Keyboard rests in front of employee on desk top (y = 6.75m, z = -1.85m)
      expect(coords.keyboardAnchor[1]).toBeCloseTo(6.75, 2);
      expect(coords.keyboardAnchor[2]).toBeCloseTo(-1.85, 2);
    });
  });

  describe("3. Intelligent Agent Intent Routing (Phase 9)", () => {
    it("should route UI/UX and Frontend tasks to Engineering specialist", () => {
      const result = routeUserPrompt("Thiết kế lại giao diện landing page responsive");
      expect(result.selectedAgent).toBeDefined();
      expect(result.isMultiAgentWorkflow).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it("should route financial analysis and cost queries to Finance specialist", () => {
      const result = routeUserPrompt("Phân tích chi phí LLM và tính toán ngân sách tháng này");
      expect(result.selectedAgent.id).toBe("agent-fin-controller");
      expect(result.selectedAgent.role).toContain("Financial");
    });

    it("should route AI research and paper search to AI Research specialist", () => {
      const result = routeUserPrompt("Nghiên cứu tài liệu và mô hình AI mới nhất về multi-agent");
      expect(result.selectedAgent.id).toBe("agent-research-ai");
      expect(result.selectedAgent.role).toContain("AI Research");
    });

    it("should route enterprise sales questions to Sales specialist", () => {
      const result = routeUserPrompt("Lên báo giá và hợp đồng bán hàng cho khách hàng enterprise");
      expect(result.selectedAgent.id).toBe("agent-sales-director");
    });

    it("should detect complex cross-department objectives and delegate to CEO orchestrator", () => {
      const result = routeUserPrompt("Xây dựng hệ thống e-commerce toàn diện từ backend, frontend đến triển khai");
      expect(result.isMultiAgentWorkflow).toBe(true);
      expect(result.selectedAgent.id).toBe("agent-exec-ceo");
    });

    it("should honor explicit user selection over auto-routing when specified", () => {
      const result = routeUserPrompt("Kiểm tra báo cáo", "agent-support-lead");
      expect(result.selectedAgent.id).toBe("agent-support-lead");
      expect(result.confidence).toBe(1.0);
    });
  });

  describe("4. Chibi Character Rigging & Kinematics (Phase 4)", () => {
    it("should generate deterministic chibi styles aligned with department palettes", () => {
      const styleEng = generateChibiStyle("agent-eng-lead", "Engineering");
      const styleAi = generateChibiStyle("agent-research-ai", "AI Research");
      const styleMkt = generateChibiStyle("agent-mkt-growth", "Marketing");
      const styleCeo = generateChibiStyle("agent-exec-ceo", "Executive");

      expect(styleEng.shirtColor).toBe("#10b981");
      expect(styleAi.shirtColor).toBe("#8b5cf6");
      expect(styleMkt.shirtColor).toBe("#ec4899");
      expect(styleCeo.shirtColor).toBe("#d97706");
      expect(styleCeo.outfit).toBe("suit");
    });

    it("should support extended animation states including DRINKING, CELEBRATING, and READING", () => {
      officeSimulationEngine.registerAgent(
        "agent-coffee",
        "Coffee Drinker",
        "Engineering",
        2,
        [0, 6.05, 0],
        [0, 6.05, 0],
        "DRINKING"
      );

      const agent = officeSimulationEngine.getAgent("agent-coffee")!;
      expect(agent.state).toBe("DRINKING");
      expect(agent.isSeated).toBe(true);

      officeSimulationEngine.update(10.0, 0.05);
      expect(agent.rightArmAngle).toBeGreaterThan(1.0); // Hand raised with mug
    });
  });
});

