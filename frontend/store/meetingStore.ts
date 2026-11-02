import { create } from "zustand";
import {
  ApiMeeting,
  ApiMeetingParticipant,
  ApiMeetingMessage,
  ApiMeetingDecision,
  ApiMeetingVote,
  ApiMeetingActionItem,
  ApiMeetingTranscript,
  MeetingPresentationMode,
  MeetingSeatAssignment,
  MeetingStatusType,
} from "@/types/meeting";
import { meetingSeatingManager } from "@/lib/meeting/seatingManager";
import {
  getMeeting,
  getMeetings,
  getMeetingMessages,
  getMeetingParticipants,
  getMeetingActionItems,
} from "@/lib/api/meetings";

interface MeetingStoreState {
  // Active Meeting
  activeMeeting: ApiMeeting | null;
  meetingsList: ApiMeeting[];
  participants: Record<string, ApiMeetingParticipant>;
  seatAssignments: Record<string, MeetingSeatAssignment>;
  messages: ApiMeetingMessage[];
  decisions: Record<string, ApiMeetingDecision>;
  actionItems: ApiMeetingActionItem[];
  transcripts: ApiMeetingTranscript[];

  // Real-time Runtime Dynamics
  currentSpeakerId: string | null;
  activeDecisionId: string | null;
  presentationMode: MeetingPresentationMode;
  deliberationStage: "OPENING" | "PROPOSAL" | "CRITIQUE" | "REBUTTAL" | "SYNTHESIS" | "GENERAL";

  // UI Viewport & Panels
  isMeetingViewActive: boolean;
  isMeetingHUDOpen: boolean;
  isDiscoveryOpen: boolean;
  selectedParticipantId: string | null;
  isLoading: boolean;
  errorMessage: string | null;

  // Actions
  setActiveMeeting: (meeting: ApiMeeting | null) => void;
  setMeetingsList: (meetings: ApiMeeting[]) => void;
  loadMeetingDetail: (meetingId: string, organizationId?: string | null) => Promise<void>;
  refreshMeetingsList: (organizationId?: string | null) => Promise<void>;
  addOrUpdateParticipant: (participant: ApiMeetingParticipant) => void;
  removeParticipant: (agentId: string) => void;
  addMessage: (message: ApiMeetingMessage) => void;
  setCurrentSpeaker: (agentId: string | null) => void;
  addOrUpdateDecision: (decision: ApiMeetingDecision) => void;
  recordVote: (vote: ApiMeetingVote) => void;
  addActionItem: (actionItem: ApiMeetingActionItem) => void;
  setPresentationMode: (mode: MeetingPresentationMode) => void;
  setDeliberationStage: (stage: "OPENING" | "PROPOSAL" | "CRITIQUE" | "REBUTTAL" | "SYNTHESIS" | "GENERAL") => void;
  setMeetingViewActive: (active: boolean) => void;
  setSelectedParticipantId: (id: string | null) => void;
  toggleMeetingHUD: () => void;
  setMeetingHUDOpen: (open: boolean) => void;
  setIsDiscoveryOpen: (open: boolean) => void;
  resetMeetingState: () => void;
}

export const useMeetingStore = create<MeetingStoreState>((set, get) => ({
  activeMeeting: null,
  meetingsList: [],
  participants: {},
  seatAssignments: {},
  messages: [],
  decisions: {},
  actionItems: [],
  transcripts: [],

  currentSpeakerId: null,
  activeDecisionId: null,
  presentationMode: "STANDBY",
  deliberationStage: "GENERAL",

  isMeetingViewActive: false,
  isMeetingHUDOpen: true,
  isDiscoveryOpen: false,
  selectedParticipantId: null,
  isLoading: false,
  errorMessage: null,

  setActiveMeeting: (meeting) => {
    if (!meeting) {
      meetingSeatingManager.clear();
      set({
        activeMeeting: null,
        participants: {},
        seatAssignments: {},
        messages: [],
        decisions: {},
        actionItems: [],
        currentSpeakerId: null,
        activeDecisionId: null,
        presentationMode: "STANDBY",
        deliberationStage: "GENERAL",
      });
      return;
    }

    const participantsMap: Record<string, ApiMeetingParticipant> = {};
    (meeting.participants || []).forEach((p) => {
      participantsMap[p.agent_id] = p;
    });

    const seats = meetingSeatingManager.reconcileParticipants(
      meeting.participants || [],
      meeting.moderator_agent_id
    );

    let stage: "OPENING" | "PROPOSAL" | "CRITIQUE" | "REBUTTAL" | "SYNTHESIS" | "GENERAL" = "GENERAL";
    if (meeting.meeting_type === "STRUCTURED_DEBATE") {
      stage = "OPENING";
    }

    set({
      activeMeeting: meeting,
      participants: participantsMap,
      seatAssignments: seats,
      currentSpeakerId: meeting.moderator_agent_id || null,
      presentationMode: meeting.status === "IN_PROGRESS" ? "DISCUSSION" : "STANDBY",
      deliberationStage: stage,
    });
  },

  setMeetingsList: (meetingsList) => set({ meetingsList }),

  loadMeetingDetail: async (meetingId: string, organizationId?: string | null) => {
    set({ isLoading: true, errorMessage: null });
    try {
      const [meeting, messages, actionItems] = await Promise.all([
        getMeeting(meetingId, { organizationId }),
        getMeetingMessages(meetingId, { limit: 100, organizationId }).catch(() => []),
        getMeetingActionItems(meetingId, { organizationId }).catch(() => []),
      ]);

      const participantsMap: Record<string, ApiMeetingParticipant> = {};
      (meeting.participants || []).forEach((p) => {
        participantsMap[p.agent_id] = p;
      });

      const seats = meetingSeatingManager.reconcileParticipants(
        meeting.participants || [],
        meeting.moderator_agent_id
      );

      // Determine initial presentation mode based on meeting state & messages
      let pMode: MeetingPresentationMode = "STANDBY";
      if (meeting.status === "IN_PROGRESS") {
        pMode = "DISCUSSION";
      }

      set({
        activeMeeting: meeting,
        participants: participantsMap,
        seatAssignments: seats,
        messages: messages || [],
        actionItems: actionItems || [],
        presentationMode: pMode,
        isLoading: false,
      });
    } catch (err: any) {
      set({
        isLoading: false,
        errorMessage: err?.message || "Failed to load meeting details",
      });
    }
  },

  refreshMeetingsList: async (organizationId?: string | null) => {
    try {
      const list = await getMeetings({ organizationId, limit: 50 });
      set({ meetingsList: list });
    } catch (err) {
      // Ignore
    }
  },

  addOrUpdateParticipant: (participant) => {
    const { activeMeeting, participants } = get();
    const nextParticipants = { ...participants, [participant.agent_id]: participant };
    const moderatorId = activeMeeting?.moderator_agent_id;
    const seats = meetingSeatingManager.reconcileParticipants(
      Object.values(nextParticipants),
      moderatorId
    );

    set({
      participants: nextParticipants,
      seatAssignments: seats,
    });
  },

  removeParticipant: (agentId) => {
    const { participants, seatAssignments } = get();
    const nextParticipants = { ...participants };
    if (nextParticipants[agentId]) {
      nextParticipants[agentId] = {
        ...nextParticipants[agentId],
        participation_status: "REMOVED",
      };
    }
    meetingSeatingManager.releaseSeat(agentId);
    const nextSeats = { ...seatAssignments };
    delete nextSeats[agentId];

    set({
      participants: nextParticipants,
      seatAssignments: nextSeats,
    });
  },

  addMessage: (message) => {
    const { messages, deliberationStage } = get();
    const exists = messages.some((m) => m.id === message.id || m.sequence_number === message.sequence_number);
    if (exists) return;

    const nextMessages = [...messages, message].sort((a, b) => a.sequence_number - b.sequence_number);

    // Update presentation mode and deliberation stage according to message type
    let pMode = get().presentationMode;
    let nextStage = deliberationStage;

    if (message.message_type === "PROPOSAL") {
      pMode = "PROPOSAL";
      nextStage = "PROPOSAL";
    } else if (message.message_type === "CRITICISM") {
      pMode = "CRITIQUE";
      nextStage = "CRITIQUE";
    } else if (message.message_type === "REBUTTAL") {
      pMode = "DISCUSSION";
      nextStage = "REBUTTAL";
    } else if (message.message_type === "SUMMARY") {
      pMode = "DECISION";
      nextStage = "SYNTHESIS";
    }

    set({
      messages: nextMessages,
      currentSpeakerId: message.agent_id || null,
      presentationMode: pMode,
      deliberationStage: nextStage,
    });
  },

  setCurrentSpeaker: (agentId) => {
    const { participants } = get();
    const nextParts = { ...participants };

    Object.keys(nextParts).forEach((id) => {
      if (id === agentId) {
        nextParts[id] = { ...nextParts[id], participation_status: "SPEAKING" };
      } else if (nextParts[id].participation_status === "SPEAKING") {
        nextParts[id] = { ...nextParts[id], participation_status: "LISTENING" };
      }
    });

    set({
      currentSpeakerId: agentId,
      participants: nextParts,
      presentationMode: agentId ? "DISCUSSION" : get().presentationMode,
    });
  },

  addOrUpdateDecision: (decision) => {
    const { decisions } = get();
    const nextDecisions = { ...decisions, [decision.id]: decision };

    let pMode = get().presentationMode;
    if (decision.status === "PROPOSED" || decision.status === "VOTING") {
      pMode = "VOTING";
    } else if (
      decision.status === "APPROVED" ||
      decision.status === "EXECUTED" ||
      decision.status === "REJECTED" ||
      decision.status === "REQUIRES_HUMAN_APPROVAL"
    ) {
      pMode = "DECISION";
    }

    set({
      decisions: nextDecisions,
      activeDecisionId: decision.id,
      presentationMode: pMode,
    });
  },

  recordVote: (vote) => {
    const { decisions } = get();
    const dec = decisions[vote.decision_id];
    if (!dec) return;

    const existingVotes = dec.votes || [];
    const idx = existingVotes.findIndex((v) => v.agent_id === vote.agent_id);
    let nextVotes: ApiMeetingVote[];
    if (idx >= 0) {
      nextVotes = [...existingVotes];
      nextVotes[idx] = vote;
    } else {
      nextVotes = [...existingVotes, vote];
    }

    const updatedDec = { ...dec, votes: nextVotes, status: "VOTING" as const };
    set({
      decisions: { ...decisions, [dec.id]: updatedDec },
      presentationMode: "VOTING",
    });
  },

  addActionItem: (actionItem) => {
    const { actionItems } = get();
    if (actionItems.some((a) => a.id === actionItem.id)) return;
    set({ actionItems: [...actionItems, actionItem] });
  },

  setPresentationMode: (mode) => set({ presentationMode: mode }),

  setDeliberationStage: (stage) => set({ deliberationStage: stage }),

  setMeetingViewActive: (active) => set({ isMeetingViewActive: active }),

  setSelectedParticipantId: (id) => set({ selectedParticipantId: id }),

  toggleMeetingHUD: () => set((state) => ({ isMeetingHUDOpen: !state.isMeetingHUDOpen })),

  setMeetingHUDOpen: (open) => set({ isMeetingHUDOpen: open }),

  setIsDiscoveryOpen: (open) => set({ isDiscoveryOpen: open }),

  resetMeetingState: () => {
    meetingSeatingManager.clear();
    set({
      activeMeeting: null,
      participants: {},
      seatAssignments: {},
      messages: [],
      decisions: {},
      actionItems: [],
      transcripts: [],
      currentSpeakerId: null,
      activeDecisionId: null,
      presentationMode: "STANDBY",
      deliberationStage: "GENERAL",
      isMeetingViewActive: false,
      selectedParticipantId: null,
    });
  },
}));
