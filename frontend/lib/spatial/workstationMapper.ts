import { ZoneConfig, WorkstationAllocation, WorkstationTelemetrySummary } from "@/lib/api/workstations";
import { WorkstationTransform } from "@/store/sceneStore";

export interface MappedWorkstationSceneData {
  transforms: Record<string, WorkstationTransform>;
  virtualFleet: WorkstationAllocation[];
  telemetry: WorkstationTelemetrySummary;
  totalPhysicalSlots: number;
}

/**
 * Deterministically maps authoritative backend zone configurations and allocations
 * to 3D workstation transforms without inventing employees or fake occupancy.
 */
export function mapWorkstationsToScene(
  zones: ZoneConfig[],
  allocations: WorkstationAllocation[]
): MappedWorkstationSceneData {
  const transforms: Record<string, WorkstationTransform> = {};
  const virtualFleet: WorkstationAllocation[] = [];
  const bookedDeskTracker = new Map<string, string>(); // `${department}_${deskNumber}` -> agent_id

  // 1. Segregate virtual workforce from physical allocations
  const physicalAllocations: WorkstationAllocation[] = [];
  allocations.forEach((alloc) => {
    if (alloc.is_virtual || alloc.allocation_status === "VIRTUAL") {
      virtualFleet.push(alloc);
    } else if (alloc.allocation_status === "ASSIGNED" && alloc.desk_number !== null) {
      physicalAllocations.push(alloc);
    }
  });

  // Index physical allocations by `${department}_${desk_number}`
  const physicalMap = new Map<string, WorkstationAllocation>();
  physicalAllocations.forEach((alloc) => {
    const key = `${alloc.department}_${alloc.desk_number}`;
    if (bookedDeskTracker.has(key)) {
      console.error(
        `[workstationMapper] DOUBLE-BOOKING DETECTED! Desk ${alloc.desk_number} in ${alloc.department} is already booked by ${bookedDeskTracker.get(key)}, rejecting second allocation for ${alloc.agent_id}.`
      );
      return; // Reject double-booking
    }
    bookedDeskTracker.set(key, alloc.agent_id);
    physicalMap.set(key, alloc);
  });

  let totalPhysicalSlots = 0;
  let totalPhysicalOccupied = 0;

  // 2. Generate deterministic spatial transforms for every physical desk slot across all 8 zones
  zones.forEach((zone) => {
    const maxDesks = zone.max_physical_desks;
    totalPhysicalSlots += maxDesks;

    for (let deskNum = 1; deskNum <= maxDesks; deskNum++) {
      const deskKey = `${zone.department}_${deskNum}`;
      const workstationId = `${zone.zone}_desk_${deskNum}`;

      // Deterministic layout grid (2 desks per row)
      const deskIndex = deskNum - 1;
      const row = Math.floor(deskIndex / 2);
      const col = deskIndex % 2;

      const posX = Number((zone.base_x + (col === 0 ? -1 : 1) * (zone.desk_spacing_x / 2)).toFixed(2));
      const posY = zone.base_y;
      const posZ = Number((zone.base_z + row * zone.desk_spacing_z).toFixed(2));

      const matchingAllocation = physicalMap.get(deskKey);
      const isOccupied =
        !!matchingAllocation &&
        matchingAllocation.agent_status !== "offline";

      if (isOccupied) {
        totalPhysicalOccupied++;
      }

      transforms[workstationId] = {
        workstationId,
        department: zone.department,
        zone: zone.zone,
        deskNumber: deskNum,
        position: [posX, posY, posZ],
        rotationY: col === 0 ? Math.PI / 2 : -Math.PI / 2,
        isOccupied,
        occupantAgentId: matchingAllocation ? matchingAllocation.agent_id : null,
      };
    }
  });

  const totalAllocated = physicalAllocations.length;
  const totalPhysicalAvailable = Math.max(0, totalPhysicalSlots - physicalAllocations.length);
  const totalReservedUnoccupied = Math.max(0, physicalAllocations.length - totalPhysicalOccupied);

  const telemetry: WorkstationTelemetrySummary = {
    total_desk_capacity: totalPhysicalSlots,
    total_allocated: totalAllocated,
    total_physical_occupied: totalPhysicalOccupied,
    total_reserved_unoccupied: totalReservedUnoccupied,
    total_physical_available: totalPhysicalAvailable,
    total_virtual_workforce: virtualFleet.length,
  };

  return {
    transforms,
    virtualFleet,
    telemetry,
    totalPhysicalSlots,
  };
}
