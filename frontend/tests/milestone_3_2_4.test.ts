import { describe, it, expect, vi } from "vitest";
import { mapWorkstationsToScene } from "@/lib/spatial/workstationMapper";
import { ZoneConfig, WorkstationAllocation } from "@/lib/api/workstations";

// Authoritative ground truth matching backend ZONE_CONFIGS
const MOCK_ZONES: ZoneConfig[] = [
  {
    department: "Engineering",
    zone: "engineering_bay",
    base_x: -14.0,
    base_y: 1.0,
    base_z: -4.0,
    max_physical_desks: 12,
    desk_spacing_x: 2.2,
    desk_spacing_z: 2.0,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 12,
    virtual_count: 0,
  },
  {
    department: "AI Research",
    zone: "research_lab",
    base_x: 14.0,
    base_y: 1.0,
    base_z: -4.0,
    max_physical_desks: 10,
    desk_spacing_x: 2.2,
    desk_spacing_z: 2.0,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 10,
    virtual_count: 0,
  },
  {
    department: "Marketing",
    zone: "marketing_studio",
    base_x: -14.0,
    base_y: 1.0,
    base_z: 10.0,
    max_physical_desks: 8,
    desk_spacing_x: 2.2,
    desk_spacing_z: 2.0,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 8,
    virtual_count: 0,
  },
  {
    department: "Sales",
    zone: "sales_wing",
    base_x: 14.0,
    base_y: 1.0,
    base_z: 10.0,
    max_physical_desks: 8,
    desk_spacing_x: 2.2,
    desk_spacing_z: 2.0,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 8,
    virtual_count: 0,
  },
  {
    department: "Operations",
    zone: "operations_hub",
    base_x: -6.0,
    base_y: 1.0,
    base_z: 20.0,
    max_physical_desks: 6,
    desk_spacing_x: 2.2,
    desk_spacing_z: 2.0,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 6,
    virtual_count: 0,
  },
  {
    department: "Finance",
    zone: "finance_office",
    base_x: 6.0,
    base_y: 1.0,
    base_z: 20.0,
    max_physical_desks: 6,
    desk_spacing_x: 2.2,
    desk_spacing_z: 2.0,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 6,
    virtual_count: 0,
  },
  {
    department: "Customer Success",
    zone: "support_lounge",
    base_x: 0.0,
    base_y: 1.0,
    base_z: 11.0,
    max_physical_desks: 6,
    desk_spacing_x: 2.0,
    desk_spacing_z: 1.8,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 6,
    virtual_count: 0,
  },
  {
    department: "Executive",
    zone: "executive_suite",
    base_x: 0.0,
    base_y: 1.0,
    base_z: -12.0,
    max_physical_desks: 4,
    desk_spacing_x: 3.0,
    desk_spacing_z: 2.5,
    allocated_count: 0,
    physical_occupied_count: 0,
    available_physical_count: 4,
    virtual_count: 0,
  },
];

describe("Milestone 3.2.4: Data-Driven Workstation Allocation & Telemetry", () => {
  describe("A. Ground Truth Zone Capacities", () => {
    it("should verify 8 zones and exactly 60 total physical workstation slots", () => {
      expect(MOCK_ZONES.length).toBe(8);

      const totalSlots = MOCK_ZONES.reduce((acc, z) => acc + z.max_physical_desks, 0);
      expect(totalSlots).toBe(60);

      const mapped = mapWorkstationsToScene(MOCK_ZONES, []);
      expect(mapped.totalPhysicalSlots).toBe(60);
      expect(Object.keys(mapped.transforms).length).toBe(60);
    });

    it("should produce unique workstation IDs for all 60 physical desks", () => {
      const mapped = mapWorkstationsToScene(MOCK_ZONES, []);
      const workstationIds = Object.keys(mapped.transforms);
      const uniqueIds = new Set(workstationIds);

      expect(workstationIds.length).toBe(60);
      expect(uniqueIds.size).toBe(60);
    });

    it("should produce deterministic coordinates for workstation placement", () => {
      const mapped1 = mapWorkstationsToScene(MOCK_ZONES, []);
      const mapped2 = mapWorkstationsToScene(MOCK_ZONES, []);

      expect(mapped1.transforms["engineering_bay_desk_1"].position).toEqual(
        mapped2.transforms["engineering_bay_desk_1"].position
      );
      expect(mapped1.transforms["executive_suite_desk_4"].position).toEqual(
        mapped2.transforms["executive_suite_desk_4"].position
      );
    });
  });

  describe("B. Physical Allocation & Occupancy Segregation", () => {
    it("should map an active agent to an occupied physical desk without double-booking", () => {
      const mockAllocations: WorkstationAllocation[] = [
        {
          id: "alloc_1",
          organization_id: "org_alpha",
          agent_id: "agent_david",
          department: "Engineering",
          logical_workstation_id: "engineering_bay_desk_1",
          office_zone: "engineering_bay",
          desk_number: 1,
          pos_x: -15.1,
          pos_y: 1.0,
          pos_z: -4.0,
          allocation_status: "ASSIGNED",
          is_virtual: false,
          agent_name: "David Chen",
          agent_role: "Engineering Lead",
          agent_status: "working",
        },
      ];

      const result = mapWorkstationsToScene(MOCK_ZONES, mockAllocations);

      const desk1 = result.transforms["engineering_bay_desk_1"];
      expect(desk1.isOccupied).toBe(true);
      expect(desk1.occupantAgentId).toBe("agent_david");

      // An unallocated desk must remain unoccupied!
      const desk2 = result.transforms["engineering_bay_desk_2"];
      expect(desk2.isOccupied).toBe(false);
      expect(desk2.occupantAgentId).toBeNull();

      expect(result.telemetry.total_physical_occupied).toBe(1);
      expect(result.telemetry.total_physical_available).toBe(59);
    });

    it("should reject double-booked workstation attempts", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const duplicateAllocations: WorkstationAllocation[] = [
        {
          id: "alloc_1",
          organization_id: "org_alpha",
          agent_id: "agent_first",
          department: "Engineering",
          logical_workstation_id: "engineering_bay_desk_1",
          office_zone: "engineering_bay",
          desk_number: 1,
          pos_x: 0,
          pos_y: 0,
          pos_z: 0,
          allocation_status: "ASSIGNED",
          is_virtual: false,
          agent_status: "working",
        },
        {
          id: "alloc_2",
          organization_id: "org_alpha",
          agent_id: "agent_impostor",
          department: "Engineering",
          logical_workstation_id: "engineering_bay_desk_1",
          office_zone: "engineering_bay",
          desk_number: 1, // Attempting to steal desk 1
          pos_x: 0,
          pos_y: 0,
          pos_z: 0,
          allocation_status: "ASSIGNED",
          is_virtual: false,
          agent_status: "working",
        },
      ];

      const result = mapWorkstationsToScene(MOCK_ZONES, duplicateAllocations);

      // Desk 1 must be occupied by the first legitimate agent, impostor rejected
      expect(result.transforms["engineering_bay_desk_1"].occupantAgentId).toBe("agent_first");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("DOUBLE-BOOKING DETECTED")
      );
    });

    it("should never mark an offline agent as actively occupying a desk", () => {
      const offlineAllocation: WorkstationAllocation[] = [
        {
          id: "alloc_off",
          organization_id: "org_alpha",
          agent_id: "agent_offline_1",
          department: "Executive",
          logical_workstation_id: "executive_suite_desk_1",
          office_zone: "executive_suite",
          desk_number: 1,
          pos_x: 0,
          pos_y: 0,
          pos_z: 0,
          allocation_status: "ASSIGNED",
          is_virtual: false,
          agent_status: "offline",
        },
      ];

      const result = mapWorkstationsToScene(MOCK_ZONES, offlineAllocation);

      const desk = result.transforms["executive_suite_desk_1"];
      expect(desk.isOccupied).toBe(false); // Offline agent is NOT actively occupying desk
      expect(result.telemetry.total_physical_occupied).toBe(0);
    });
  });

  describe("C. Virtual Workforce Segregation", () => {
    it("should isolate virtual workforce and prevent them from occupying physical desks", () => {
      const virtualFleetAllocations: WorkstationAllocation[] = [
        {
          id: "alloc_virt_1",
          organization_id: "org_alpha",
          agent_id: "agent_cloud_worker",
          department: "Engineering",
          logical_workstation_id: "virtual_worker_1",
          office_zone: "engineering_bay",
          desk_number: null,
          pos_x: 0,
          pos_y: 0,
          pos_z: 0,
          allocation_status: "VIRTUAL",
          is_virtual: true,
          agent_name: "Cloud Worker",
          agent_status: "working",
        },
      ];

      const result = mapWorkstationsToScene(MOCK_ZONES, virtualFleetAllocations);

      // Virtual fleet must be recorded in virtualFleet array and telemetry
      expect(result.virtualFleet.length).toBe(1);
      expect(result.virtualFleet[0].agent_id).toBe("agent_cloud_worker");
      expect(result.telemetry.total_virtual_workforce).toBe(1);
      expect(result.telemetry.total_allocated).toBe(0); // 0 physical desks allocated!
      expect(result.telemetry.total_allocated + result.telemetry.total_physical_available).toBe(60);

      // Virtual fleet must NEVER occupy a physical desk
      expect(result.telemetry.total_physical_occupied).toBe(0);
      expect(result.telemetry.total_physical_available).toBe(60);


      // Verify that all 60 physical desks remain unoccupied
      const occupiedDesks = Object.values(result.transforms).filter((t) => t.isOccupied);
      expect(occupiedDesks.length).toBe(0);
    });
  });
});
