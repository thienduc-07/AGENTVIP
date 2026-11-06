import { describe, it, expect } from "vitest";
import { spatialValidationEngine } from "../lib/office/spatialValidationEngine";
import { VERTICAL_CORE, MASTER_CORRIDOR_NAV_NODES } from "../lib/office/buildingArchitecture";

describe("Spatial Validation Engine (Part 2: Physical Consistency & Architecture Audit)", () => {
  it("should validate vertical circulation core separation without overlap", () => {
    const elev = VERTICAL_CORE.elevator.bounds;
    const stair = VERTICAL_CORE.staircase.bounds;
    const restroom = VERTICAL_CORE.restroom.bounds;

    // Elevator to Staircase
    expect(stair.minZ).toBeGreaterThanOrEqual(elev.maxZ + 2.0); // 3.4m clear landing

    // Staircase to Restroom
    expect(restroom.minZ).toBeGreaterThanOrEqual(stair.maxZ + 5.0); // 10.7m clear corridor
  });

  it("should ensure restroom westward corridor has at least 4.0m clear aisle", () => {
    const restroomX = VERTICAL_CORE.restroom.door.x;
    const nearestDeskMaxX = 12.65;
    const aisleWidth = restroomX - nearestDeskMaxX;
    expect(aisleWidth).toBeGreaterThanOrEqual(4.0); // Exactly 6.85m clear!
  });

  it("should confirm master corridor nav graph is 100% connected", () => {
    const report = spatialValidationEngine.runFullBuildingAudit();
    console.log("Global checks:", report.globalChecks);
    expect(report.globalChecks.navGraphFullyConnected).toBe(true);
    expect(report.totalNavNodes).toBe(MASTER_CORRIDOR_NAV_NODES.length);
  });

  it("should audit all 8 floors (G to 7F) with zero fatal collisions or doorway blockages", () => {
    const report = spatialValidationEngine.runFullBuildingAudit();
    for (let f = 0; f <= 7; f++) {
      const fl = report.floorAudits[f];
      if (fl.overlaps.length > 0 || !fl.doorwayClear || fl.boundsViolations.length > 0) {
        console.log(`Floor ${f} issues:`, {
          overlaps: fl.overlaps,
          doorwayIssues: fl.doorwayIssues,
          boundsViolations: fl.boundsViolations
        });
      }
    }
    expect(report.totalFloors).toBe(8);
    expect(report.overallPassed).toBe(true);

    for (let f = 0; f <= 7; f++) {
      const fl = report.floorAudits[f];
      expect(fl.doorwayClear).toBe(true);
      expect(fl.overlaps.length).toBe(0);
      expect(fl.boundsViolations.length).toBe(0);
    }
  });
});
