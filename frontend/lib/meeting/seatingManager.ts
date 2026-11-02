import { ApiMeetingParticipant, MeetingSeatAssignment } from "@/types/meeting";

export interface SeatingLayoutConfig {
  roomCenterX: number;
  roomCenterY: number;
  roomCenterZ: number;
  tableLength: number; // Z-axis span
  tableWidth: number;  // X-axis span
  chairOffset: number; // Distance from table edge
  maxCapacity: number;
}

export const DEFAULT_MEETING_SEATING_CONFIG: SeatingLayoutConfig = {
  roomCenterX: 0,
  roomCenterY: 0,
  roomCenterZ: 3.5,
  tableLength: 5.6,
  tableWidth: 2.4,
  chairOffset: 0.65,
  maxCapacity: 12,
};

export class MeetingSeatingManager {
  private config: SeatingLayoutConfig;
  private assignments: Map<string, MeetingSeatAssignment> = new Map(); // agentId -> Assignment
  private seatOccupancy: Map<number, string> = new Map(); // seatIndex -> agentId

  constructor(config: Partial<SeatingLayoutConfig> = {}) {
    this.config = { ...DEFAULT_MEETING_SEATING_CONFIG, ...config };
  }

  /**
   * Calculates deterministic seat coordinates and viewing angles for all seat indices.
   */
  public calculateSeatingLayout(): Array<{
    seatIndex: number;
    chairId: string;
    position: [number, number, number];
    rotationY: number;
    isHeadSeat: boolean;
  }> {
    const { roomCenterX, roomCenterY, roomCenterZ, tableLength, tableWidth, chairOffset } = this.config;
    const seats = [];

    // Seat 0: North Head of Table (Moderator / Executive chair)
    // Faces South (rotationY = 0) towards the presentation screen & attendees
    const headZ = roomCenterZ - tableLength / 2 - chairOffset;
    seats.push({
      seatIndex: 0,
      chairId: "seat_head_north",
      position: [roomCenterX, roomCenterY + 0.42, headZ] as [number, number, number],
      rotationY: 0,
      isHeadSeat: true,
    });

    // Seat 1: South Foot of Table (Presenter / Keynote chair)
    // Faces North (rotationY = Math.PI) towards the presentation screen
    const footZ = roomCenterZ + tableLength / 2 + chairOffset;
    seats.push({
      seatIndex: 1,
      chairId: "seat_foot_south",
      position: [roomCenterX, roomCenterY + 0.42, footZ] as [number, number, number],
      rotationY: Math.PI,
      isHeadSeat: true,
    });

    // Side chairs alternating symmetrically along West and East sides
    const sideChairsPerSide = Math.max(1, Math.floor((this.config.maxCapacity - 2) / 2));
    const zStep = (tableLength * 0.8) / (sideChairsPerSide - 1 || 1);
    const startZ = roomCenterZ - (tableLength * 0.8) / 2;

    const westX = roomCenterX - tableWidth / 2 - chairOffset;
    const eastX = roomCenterX + tableWidth / 2 + chairOffset;

    let currentIndex = 2;
    for (let i = 0; i < sideChairsPerSide; i++) {
      const z = sideChairsPerSide === 1 ? roomCenterZ : startZ + i * zStep;
      // West Chair (even index from 2)
      seats.push({
        seatIndex: currentIndex,
        chairId: `seat_west_${i}`,
        position: [westX, roomCenterY + 0.42, z] as [number, number, number],
        rotationY: Math.PI / 2,
        isHeadSeat: false,
      });
      currentIndex++;

      // East Chair (odd index from 3)
      seats.push({
        seatIndex: currentIndex,
        chairId: `seat_east_${i}`,
        position: [eastX, roomCenterY + 0.42, z] as [number, number, number],
        rotationY: -Math.PI / 2,
        isHeadSeat: false,
      });
      currentIndex++;
    }

    return seats;
  }

  /**
   * Alias for calculateSeatingLayout()
   */
  public getAllSeats(): Array<{
    seatIndex: number;
    chairId: string;
    position: [number, number, number];
    rotationY: number;
    isHeadSeat: boolean;
  }> {
    return this.calculateSeatingLayout();
  }

  /**
   * Returns precalculated chair metadata for a specific seat index.
   */
  public getSeatCoordinates(seatIndex: number): {
    position: [number, number, number];
    rotationY: number;
    chairId: string;
  } {
    const layout = this.calculateSeatingLayout();
    const seat = layout.find((s) => s.seatIndex === seatIndex) || layout[0];
    return {
      position: seat.position,
      rotationY: seat.rotationY,
      chairId: seat.chairId,
    };
  }

  /**
   * Allocates an available seat for an agent.
   * Prioritizes moderator role to Seat 0 (Head of Table).
   */
  public allocateSeat(
    agentId: string,
    isModerator: boolean | string = false,
    _roleHint?: string
  ): MeetingSeatAssignment {
    const isMod =
      isModerator === true ||
      isModerator === "LEAD" ||
      isModerator === "MODERATOR" ||
      _roleHint === "LEAD" ||
      _roleHint === "MODERATOR";

    // If agent already assigned, return existing assignment
    if (this.assignments.has(agentId)) {
      return this.assignments.get(agentId)!;
    }

    const layout = this.calculateSeatingLayout();

    // Prefer seat 0 if moderator
    let chosenSeatIndex: number | null = null;
    if (isMod && !this.seatOccupancy.has(0)) {
      chosenSeatIndex = 0;
    } else {
      // Find first available seat index
      for (const seat of layout) {
        if (!this.seatOccupancy.has(seat.seatIndex)) {
          if (!isMod && (seat.seatIndex === 0 || seat.seatIndex === 1)) {
            // Reserve head (0) and foot (1) seats for moderator / keynote if possible
            continue;
          }
          chosenSeatIndex = seat.seatIndex;
          break;
        }
      }

      // If all regular side seats occupied and head/foot are free, use seat 1 then seat 0
      if (chosenSeatIndex === null) {
        if (!this.seatOccupancy.has(1)) {
          chosenSeatIndex = 1;
        } else if (!this.seatOccupancy.has(0)) {
          chosenSeatIndex = 0;
        }
      }
    }

    // Fallback if full: modulo wrap around
    if (chosenSeatIndex === null) {
      chosenSeatIndex = this.assignments.size % layout.length;
    }

    const coords = this.getSeatCoordinates(chosenSeatIndex);
    const assignment: MeetingSeatAssignment = {
      seatIndex: chosenSeatIndex,
      agentId,
      position: coords.position,
      rotationY: coords.rotationY,
      chairId: coords.chairId,
      isHeadSeat: chosenSeatIndex === 0 || chosenSeatIndex === 1,
    };

    this.seatOccupancy.set(chosenSeatIndex, agentId);
    this.assignments.set(agentId, assignment);
    return assignment;
  }

  /**
   * Releases an agent's assigned seat when leaving the meeting.
   */
  public releaseSeat(agentId: string): boolean {
    const assignment = this.assignments.get(agentId);
    if (!assignment) return false;

    this.seatOccupancy.delete(assignment.seatIndex);
    this.assignments.delete(agentId);
    return true;
  }

  /**
   * Retrieves an agent's current seat assignment.
   */
  public getSeatAssignment(agentId: string): MeetingSeatAssignment | null {
    return this.assignments.get(agentId) || null;
  }

  /**
   * Alias for getSeatAssignment
   */
  public getAssignment(agentId: string): MeetingSeatAssignment | null {
    return this.getSeatAssignment(agentId);
  }

  /**
   * Reconciles seating allocations against authoritative backend participants roster.
   */
  public reconcileParticipants(
    participants: ApiMeetingParticipant[],
    moderatorAgentId?: string | null
  ): Record<string, MeetingSeatAssignment> {
    const activeAgentIds = new Set(
      participants
        .filter((p) => p.participation_status !== "REMOVED" && p.participation_status !== "FINISHED")
        .map((p) => p.agent_id)
    );

    // 1. Release seats for participants who left
    for (const [agentId] of Array.from(this.assignments.entries())) {
      if (!activeAgentIds.has(agentId)) {
        this.releaseSeat(agentId);
      }
    }

    // 2. Sort participants deterministically (moderator first, then by speaking_order, then by agent_id)
    const sorted = [...participants]
      .filter((p) => activeAgentIds.has(p.agent_id))
      .sort((a, b) => {
        const aIsMod = a.agent_id === moderatorAgentId || a.role === "MODERATOR";
        const bIsMod = b.agent_id === moderatorAgentId || b.role === "MODERATOR";
        if (aIsMod && !bIsMod) return -1;
        if (!aIsMod && bIsMod) return 1;
        if (a.speaking_order !== b.speaking_order) return a.speaking_order - b.speaking_order;
        return a.agent_id.localeCompare(b.agent_id);
      });

    // 3. Allocate seats
    for (const part of sorted) {
      const isMod = part.agent_id === moderatorAgentId || part.role === "MODERATOR";
      this.allocateSeat(part.agent_id, isMod);
    }

    const result: Record<string, MeetingSeatAssignment> = {};
    for (const [id, assignment] of this.assignments.entries()) {
      result[id] = assignment;
    }
    return result;
  }

  /**
   * Clears all seat allocations.
   */
  public clear(): void {
    this.assignments.clear();
    this.seatOccupancy.clear();
  }
}

export const meetingSeatingManager = new MeetingSeatingManager();
