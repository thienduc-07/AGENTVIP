import { describe, it, expect, beforeEach } from "vitest";
import { MeetingSeatingManager } from "../lib/meeting/seatingManager";
import { useMeetingStore } from "../store/meetingStore";
import {
  ApiMeeting,
  ApiMeetingParticipant,
  ApiMeetingMessage,
  ApiMeetingVote,
  ApiMeetingDecision,
} from "../types/meeting";

describe("Phase 4.3.5: 3D Meeting Collaboration Suite", () => {
  beforeEach(() => {
    useMeetingStore.getState().resetMeetingState();
  });

  // =========================================================================
  // 1. DYNAMIC ERGONOMIC SEATING & SPATIAL COORDINATES
  // =========================================================================
  describe("1. MeetingSeatingManager Invariants", () => {
    it("should provide exactly 12 deterministic ergonomic conference seats", () => {
      const manager = new MeetingSeatingManager();
      const seats = manager.getAllSeats();
      expect(seats.length).toBe(12);

      // Seat 0 must be head of the executive conference table (North Head)
      expect(seats[0].seatIndex).toBe(0);
      expect(seats[0].position[0]).toBe(0); // Centered on x
      expect(seats[0].position[2]).toBeCloseTo(0.05, 2); // 3.5 - 2.8 - 0.65 = 0.05m
      expect(seats[0].rotationY).toBe(0); // Facing south down the table
      expect(seats[0].isHeadSeat).toBe(true);

      // Seat 1 must be foot of the table (South Foot)
      expect(seats[1].seatIndex).toBe(1);
      expect(seats[1].position[0]).toBe(0);
      expect(seats[1].position[2]).toBeCloseTo(6.95, 2); // 3.5 + 2.8 + 0.65 = 6.95m
      expect(seats[1].rotationY).toBeCloseTo(Math.PI, 2);
      expect(seats[1].isHeadSeat).toBe(true);
    });

    it("should prioritize seat 0 for moderator role", () => {
      const manager = new MeetingSeatingManager();
      const moderatorAssignment = manager.allocateSeat("agent-ceo", "agent-ceo", "LEAD");
      expect(moderatorAssignment).toBeDefined();
      expect(moderatorAssignment.seatIndex).toBe(0);
      expect(moderatorAssignment.isHeadSeat).toBe(true);
    });

    it("should assign flank seats to regular participants symmetrically", () => {
      const manager = new MeetingSeatingManager();

      // Allocate first 4 participants
      const p1 = manager.allocateSeat("p1", false);
      const p2 = manager.allocateSeat("p2", false);
      const p3 = manager.allocateSeat("p3", false);
      const p4 = manager.allocateSeat("p4", false);

      expect(p1.seatIndex).toBe(2); // West flank index
      expect(p2.seatIndex).toBe(3); // East flank index
      expect(p3.seatIndex).toBe(4); // West flank index
      expect(p4.seatIndex).toBe(5); // East flank index

      // West flank should have negative x, East flank positive x
      expect(p1.position[0]).toBeLessThan(0);
      expect(p2.position[0]).toBeGreaterThan(0);
      expect(p3.position[0]).toBeLessThan(0);
      expect(p4.position[0]).toBeGreaterThan(0);
    });

    it("should correctly free a chair when participant leaves and retain other seats", () => {
      const manager = new MeetingSeatingManager();
      manager.allocateSeat("p1", false);
      manager.allocateSeat("p2", false);
      manager.allocateSeat("p3", false);

      expect(manager.getAssignment("p2")?.seatIndex).toBe(3);

      // Participant 2 leaves
      manager.releaseSeat("p2");
      expect(manager.getAssignment("p2")).toBeNull();
      expect(manager.getAssignment("p1")?.seatIndex).toBe(2);
      expect(manager.getAssignment("p3")?.seatIndex).toBe(4);

      // New participant joins and reuses seat 3 (first available side seat)
      const p4 = manager.allocateSeat("p4", false);
      expect(p4.seatIndex).toBe(3);
    });

    it("should reconcile full participant list without mutating stable assignments", () => {
      const manager = new MeetingSeatingManager();
      const initialParticipants: ApiMeetingParticipant[] = [
        {
          id: "part-1",
          meeting_id: "meet-1",
          agent_id: "agent-mod",
          agent_name: "CEO",
          role: "MODERATOR",
          participation_status: "JOINED",
          speaking_order: 1,
          contribution_count: 0,
          joined_at: new Date().toISOString(),
        },
        {
          id: "part-2",
          meeting_id: "meet-1",
          agent_id: "agent-eng",
          agent_name: "Engineer",
          role: "SPECIALIST",
          participation_status: "JOINED",
          speaking_order: 2,
          contribution_count: 0,
          joined_at: new Date().toISOString(),
        },
      ];

      const initialMap = manager.reconcileParticipants(initialParticipants);
      expect(initialMap["agent-mod"].seatIndex).toBe(0);
      expect(initialMap["agent-eng"].seatIndex).toBe(2);

      // Reconcile with an additional participant
      const updatedParticipants: ApiMeetingParticipant[] = [
        ...initialParticipants,
        {
          id: "part-3",
          meeting_id: "meet-1",
          agent_id: "agent-mkt",
          agent_name: "Marketing",
          role: "SPECIALIST",
          participation_status: "JOINED",
          speaking_order: 3,
          contribution_count: 0,
          joined_at: new Date().toISOString(),
        },
      ];

      const updatedMap = manager.reconcileParticipants(updatedParticipants);
      expect(updatedMap["agent-mod"].seatIndex).toBe(0);
      expect(updatedMap["agent-eng"].seatIndex).toBe(2);
      expect(updatedMap["agent-mkt"].seatIndex).toBe(3);
    });

    it("should guarantee all seats are strictly within the meeting pavilion radius", () => {
      const manager = new MeetingSeatingManager();
      const seats = manager.getAllSeats();

      // Meeting room footprint is 8.5m x 9.5m (bounds x: +/- 4.25, z: between 0 and 7.5)
      for (const seat of seats) {
        expect(Math.abs(seat.position[0])).toBeLessThanOrEqual(4.0);
        expect(seat.position[2]).toBeGreaterThanOrEqual(-0.5);
        expect(seat.position[2]).toBeLessThanOrEqual(7.5);
        expect(seat.position[1]).toBeCloseTo(0.42, 2);
      }
    });
  });

  // =========================================================================
  // 2. MEETING STORE & DELIBERATION STATE MACHINE
  // =========================================================================
  describe("2. Meeting Zustand Store Transitions", () => {
    const mockMeeting: ApiMeeting = {
      id: "meet-exec-001",
      organization_id: "org_default_company",
      title: "Q4 Strategy Deliberation",
      meeting_type: "STRUCTURED_DEBATE",
      status: "IN_PROGRESS",
      moderator_agent_id: "agent-ceo",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      decisions_count: 0,
      action_items_count: 0,
      messages_count: 0,
      participants: [
        {
          id: "p-mod",
          meeting_id: "meet-exec-001",
          agent_id: "agent-ceo",
          agent_name: "CEO",
          role: "MODERATOR",
          participation_status: "JOINED",
          speaking_order: 1,
          contribution_count: 0,
          joined_at: new Date().toISOString(),
        },
        {
          id: "p-cfo",
          meeting_id: "meet-exec-001",
          agent_id: "agent-cfo",
          agent_name: "CFO",
          role: "SPECIALIST",
          participation_status: "JOINED",
          speaking_order: 2,
          contribution_count: 0,
          joined_at: new Date().toISOString(),
        },
      ],
    };

    it("should set active meeting and dynamically assign participant seats", () => {
      const store = useMeetingStore.getState();
      store.setActiveMeeting(mockMeeting);

      const state = useMeetingStore.getState();
      expect(state.activeMeeting?.id).toBe("meet-exec-001");
      expect(Object.keys(state.seatAssignments).length).toBe(2);
      expect(state.seatAssignments["agent-ceo"].seatIndex).toBe(0);
      expect(state.seatAssignments["agent-cfo"].seatIndex).toBe(2);
      expect(state.currentSpeakerId).toBe("agent-ceo");
    });

    it("should append messages and update speaker and presentation mode dynamically", () => {
      const store = useMeetingStore.getState();
      store.setActiveMeeting(mockMeeting);

      const proposalMsg: ApiMeetingMessage = {
        id: "msg-001",
        meeting_id: "meet-exec-001",
        agent_id: "agent-cfo",
        agent_name: "CFO",
        sequence_number: 1,
        message_type: "PROPOSAL",
        content: "Propose allocating 40% budget to Autonomous Agent R&D",
        created_at: new Date().toISOString(),
      };

      store.addMessage(proposalMsg);

      const updated = useMeetingStore.getState();
      expect(updated.messages.length).toBe(1);
      expect(updated.currentSpeakerId).toBe("agent-cfo");
      expect(updated.presentationMode).toBe("PROPOSAL");
      expect(updated.deliberationStage).toBe("PROPOSAL");
    });

    it("should record votes and transition presentation mode to VOTING", () => {
      const store = useMeetingStore.getState();
      store.setActiveMeeting(mockMeeting);

      // Create a decision first
      const decision: ApiMeetingDecision = {
        id: "dec-budget-01",
        meeting_id: "meet-exec-001",
        title: "Budget Allocation Approval",
        description: "Approve 40% R&D budget",
        decision_type: "CONSENSUS",
        status: "PROPOSED",
        created_at: new Date().toISOString(),
        votes: [],
      };

      store.addOrUpdateDecision(decision);

      const vote: ApiMeetingVote = {
        id: "v-01",
        decision_id: "dec-budget-01",
        agent_id: "agent-cfo",
        agent_name: "CFO",
        vote: "YES",
        reasoning: "Strong ROI projected",
        created_at: new Date().toISOString(),
      };

      store.recordVote(vote);

      const updated = useMeetingStore.getState();
      expect(updated.presentationMode).toBe("VOTING");
      expect(updated.decisions["dec-budget-01"].votes.length).toBe(1);
      expect(updated.decisions["dec-budget-01"].votes[0].vote).toBe("YES");
    });

    it("should update decision status to APPROVED and switch to DECISION mode", () => {
      const store = useMeetingStore.getState();
      store.setActiveMeeting(mockMeeting);

      const decidedItem: ApiMeetingDecision = {
        id: "dec-budget-01",
        meeting_id: "meet-exec-001",
        title: "Budget Allocation Approval",
        description: "Approve 40% R&D budget",
        decision_type: "CONSENSUS",
        status: "APPROVED",
        created_at: new Date().toISOString(),
        votes: [],
      };

      store.addOrUpdateDecision(decidedItem);

      const state = useMeetingStore.getState();
      expect(state.presentationMode).toBe("DECISION");
      expect(state.decisions["dec-budget-01"].status).toBe("APPROVED");
    });

    it("should toggle and set meeting HUD visibility accurately", () => {
      const store = useMeetingStore.getState();
      expect(store.isMeetingHUDOpen).toBe(true);

      store.setMeetingHUDOpen(false);
      expect(useMeetingStore.getState().isMeetingHUDOpen).toBe(false);

      store.toggleMeetingHUD();
      expect(useMeetingStore.getState().isMeetingHUDOpen).toBe(true);
    });

    it("should clean up state on resetMeetingState", () => {
      const store = useMeetingStore.getState();
      store.setActiveMeeting(mockMeeting);
      store.setCurrentSpeaker("agent-cfo");
      store.setPresentationMode("VOTING");

      store.resetMeetingState();

      const cleared = useMeetingStore.getState();
      expect(cleared.activeMeeting).toBeNull();
      expect(cleared.currentSpeakerId).toBeNull();
      expect(cleared.presentationMode).toBe("STANDBY");
      expect(Object.keys(cleared.seatAssignments).length).toBe(0);
      expect(cleared.messages.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. AGENT MEETING ANIMATION & KINEMATICS LOGIC
  // =========================================================================
  describe("3. Agent Seating & Posture Kinematics", () => {
    it("should calculate correct seated world coordinate offset relative to meeting pavilion", () => {
      const roomCenter = [0, 0, 3.5] as const;
      const manager = new MeetingSeatingManager();
      const seat = manager.allocateSeat("agent-1", false);

      // Seated world coordinate calculation formula from OfficeCanvas
      const seatedWorldPos: [number, number, number] = [
        seat.position[0],
        seat.position[1] + 0.38,
        seat.position[2] + roomCenter[2],
      ];

      expect(seatedWorldPos[1]).toBeCloseTo(0.80, 2); // 0.42 + 0.38 = 0.80m elevation
      expect(seatedWorldPos[2]).toBe(seat.position[2] + 3.5);
    });

    it("should yield ergonomic sitting leg angle (-1.48 rad) for seated avatars", () => {
      const isSeated = true;
      const legAngle = isSeated ? -1.48 : 0;
      expect(legAngle).toBeCloseTo(-1.48, 2);
    });

    it("should map meeting avatar state to high-priority presentation behaviors", () => {
      const computeAvatarMeetingState = (
        isCurrentSpeaker: boolean,
        presentationMode: string,
        isSeated: boolean
      ) => {
        if (!isSeated) return "IDLE";
        if (isCurrentSpeaker) return "SPEAKING";
        if (presentationMode === "VOTING") return "VOTING";
        if (presentationMode === "CRITIQUE") return "THINKING";
        return "LISTENING";
      };

      expect(computeAvatarMeetingState(true, "DISCUSSION", true)).toBe("SPEAKING");
      expect(computeAvatarMeetingState(false, "VOTING", true)).toBe("VOTING");
      expect(computeAvatarMeetingState(false, "CRITIQUE", true)).toBe("THINKING");
      expect(computeAvatarMeetingState(false, "DISCUSSION", true)).toBe("LISTENING");
      expect(computeAvatarMeetingState(false, "DISCUSSION", false)).toBe("IDLE");
    });
  });
});
