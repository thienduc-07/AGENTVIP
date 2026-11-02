"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeetingStore } from "@/store/meetingStore";
import { syncManager } from "@/lib/websocket/syncManager";
import { EventEnvelope } from "@/types/events";
import { ApiMeetingParticipant, ApiMeetingMessage, ApiMeetingDecision, ApiMeetingVote, ApiMeetingActionItem } from "@/types/meeting";

export function useMeetingSync(organizationId: string = "org_default_company") {
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const setActiveMeeting = useMeetingStore((s) => s.setActiveMeeting);
  const addOrUpdateParticipant = useMeetingStore((s) => s.addOrUpdateParticipant);
  const removeParticipant = useMeetingStore((s) => s.removeParticipant);
  const addMessage = useMeetingStore((s) => s.addMessage);
  const setCurrentSpeaker = useMeetingStore((s) => s.setCurrentSpeaker);
  const addOrUpdateDecision = useMeetingStore((s) => s.addOrUpdateDecision);
  const recordVote = useMeetingStore((s) => s.recordVote);
  const addActionItem = useMeetingStore((s) => s.addActionItem);
  const refreshMeetingsList = useMeetingStore((s) => s.refreshMeetingsList);
  const loadMeetingDetail = useMeetingStore((s) => s.loadMeetingDetail);

  const activeMeetingIdRef = useRef<string | null>(activeMeeting?.id || null);
  useEffect(() => {
    activeMeetingIdRef.current = activeMeeting?.id || null;
  }, [activeMeeting?.id]);

  // Handle Event Processing with Sequence Deduplication
  const handleMeetingEvent = useCallback((envelope: EventEnvelope) => {
    const { event_type, payload } = envelope;
    if (!event_type) return;

    // Check if event is relevant to meeting subsystem
    const isMeetingEvent = event_type.startsWith("meeting.") || event_type.startsWith("approval.");
    if (!isMeetingEvent) return;

    const currentMeetingId = activeMeetingIdRef.current;
    const eventMeetingId = payload?.meeting_id;

    // 1. Global Meeting Lifecycle
    if (event_type === "meeting.created") {
      refreshMeetingsList(organizationId);
      return;
    }

    // Ignore events intended for a different meeting unless it matches active meeting
    if (eventMeetingId && currentMeetingId && eventMeetingId !== currentMeetingId) {
      return;
    }

    // 2. Lifecycle Status Transitions
    if (event_type === "meeting.started") {
      if (currentMeetingId && eventMeetingId === currentMeetingId) {
        useMeetingStore.setState((state) => {
          if (!state.activeMeeting) return state;
          return {
            activeMeeting: {
              ...state.activeMeeting,
              status: "IN_PROGRESS",
              started_at: payload?.started_at || new Date().toISOString(),
            },
            presentationMode: "DISCUSSION",
          };
        });
      }
    } else if (event_type === "meeting.paused") {
      if (currentMeetingId && eventMeetingId === currentMeetingId) {
        useMeetingStore.setState((state) => {
          if (!state.activeMeeting) return state;
          return {
            activeMeeting: {
              ...state.activeMeeting,
              status: "PAUSED",
            },
          };
        });
      }
    } else if (event_type === "meeting.resumed") {
      if (currentMeetingId && eventMeetingId === currentMeetingId) {
        useMeetingStore.setState((state) => {
          if (!state.activeMeeting) return state;
          return {
            activeMeeting: {
              ...state.activeMeeting,
              status: "IN_PROGRESS",
            },
            presentationMode: "DISCUSSION",
          };
        });
      }
    } else if (event_type === "meeting.completed") {
      if (currentMeetingId && eventMeetingId === currentMeetingId) {
        useMeetingStore.setState((state) => {
          if (!state.activeMeeting) return state;
          return {
            activeMeeting: {
              ...state.activeMeeting,
              status: "COMPLETED",
              ended_at: payload?.ended_at || new Date().toISOString(),
            },
            currentSpeakerId: null,
            presentationMode: "DECISION",
          };
        });
      }
    } else if (event_type === "meeting.cancelled") {
      if (currentMeetingId && eventMeetingId === currentMeetingId) {
        useMeetingStore.setState((state) => {
          if (!state.activeMeeting) return state;
          return {
            activeMeeting: {
              ...state.activeMeeting,
              status: "CANCELLED",
              ended_at: payload?.ended_at || new Date().toISOString(),
            },
            currentSpeakerId: null,
            presentationMode: "STANDBY",
          };
        });
      }
    }

    // 3. Participants
    else if (event_type === "meeting.participant_joined") {
      if (payload?.agent_id && currentMeetingId) {
        const participant: ApiMeetingParticipant = {
          id: payload.participant_id || `part_${payload.agent_id}`,
          meeting_id: currentMeetingId,
          agent_id: payload.agent_id,
          agent_name: payload.agent_name,
          role: payload.role || "SPECIALIST",
          participation_status: "JOINED",
          joined_at: new Date().toISOString(),
          speaking_order: payload.speaking_order ?? 99,
          contribution_count: 0,
        };
        addOrUpdateParticipant(participant);
      }
    } else if (event_type === "meeting.participant_left") {
      if (payload?.agent_id) {
        removeParticipant(payload.agent_id);
      }
    }

    // 4. Speaking Turns
    else if (event_type === "meeting.turn_started" || event_type === "meeting.speaker_changed") {
      if (payload?.agent_id) {
        setCurrentSpeaker(payload.agent_id);
      }
    } else if (event_type === "meeting.turn_completed") {
      setCurrentSpeaker(null);
    }

    // 5. Messages
    else if (event_type === "meeting.message_created") {
      if (payload?.message_id && currentMeetingId) {
        const msg: ApiMeetingMessage = {
          id: payload.message_id,
          meeting_id: currentMeetingId,
          agent_id: payload.agent_id,
          message_type: payload.message_type || "STATEMENT",
          content: payload.content || payload.content_preview || "",
          sequence_number: payload.sequence_number || 1,
          created_at: new Date().toISOString(),
          metadata_json: payload.metadata_json,
        };
        addMessage(msg);
      }
    }

    // 6. Decisions & Voting
    else if (event_type === "meeting.decision_proposed") {
      if (payload?.decision_id && currentMeetingId) {
        const dec: ApiMeetingDecision = {
          id: payload.decision_id,
          meeting_id: currentMeetingId,
          title: payload.title || "Proposed Decision",
          description: payload.description || "",
          decision_type: payload.decision_type || "STRATEGIC",
          status: "PROPOSED",
          proposed_by: payload.proposed_by,
          created_at: new Date().toISOString(),
          metadata_json: { voting_policy: payload.voting_policy },
          votes: [],
        };
        addOrUpdateDecision(dec);
      }
    } else if (event_type === "meeting.vote_submitted") {
      if (payload?.decision_id && payload?.agent_id) {
        const vote: ApiMeetingVote = {
          id: `vote_${payload.decision_id}_${payload.agent_id}`,
          decision_id: payload.decision_id,
          agent_id: payload.agent_id,
          vote: payload.vote,
          reasoning: payload.reasoning,
          created_at: new Date().toISOString(),
        };
        recordVote(vote);
      }
    } else if (event_type === "meeting.decision_resolved" || event_type === "meeting.decision_reached") {
      if (payload?.decision_id) {
        useMeetingStore.setState((state) => {
          const dec = state.decisions[payload.decision_id];
          if (!dec) return state;
          const updated: ApiMeetingDecision = {
            ...dec,
            status: payload.status || "APPROVED",
            resolved_at: new Date().toISOString(),
          };
          return {
            decisions: { ...state.decisions, [dec.id]: updated },
            presentationMode: "DECISION",
          };
        });
      }
    }

    // 7. Action Items
    else if (event_type === "meeting.action_item_created") {
      if (payload?.action_item_id && currentMeetingId) {
        const item: ApiMeetingActionItem = {
          id: payload.action_item_id,
          meeting_id: currentMeetingId,
          title: payload.title || "Action Item",
          description: payload.description || "",
          assigned_agent_id: payload.assigned_agent_id,
          linked_task_id: payload.linked_task_id,
          priority: payload.priority || "normal",
          status: "PENDING",
          created_at: new Date().toISOString(),
        };
        addActionItem(item);
      }
    }

    // 8. Approval Integration
    else if (event_type === "approval.required" || event_type === "approval.created") {
      useMeetingStore.setState((state) => {
        if (!state.activeMeeting) return state;
        return {
          activeMeeting: {
            ...state.activeMeeting,
            status: "WAITING_APPROVAL",
          },
        };
      });
    } else if (event_type === "approval.decided" || event_type === "approval.approved") {
      // Re-hydrate meeting state if active
      if (currentMeetingId) {
        loadMeetingDetail(currentMeetingId, organizationId);
      }
    }
  }, [
    organizationId,
    refreshMeetingsList,
    addOrUpdateParticipant,
    removeParticipant,
    setCurrentSpeaker,
    addMessage,
    addOrUpdateDecision,
    recordVote,
    addActionItem,
    loadMeetingDetail,
  ]);

  // Connect to syncManager
  useEffect(() => {
    // Initial fetch of meetings list
    refreshMeetingsList(organizationId);

    // Subscribe to WebSocket events
    const unsubEvent = syncManager.onEvent(handleMeetingEvent);

    // Reconnect handler: re-hydrate active meeting details
    const unsubState = syncManager.onStateChange((state) => {
      if (state === "CONNECTED" && activeMeetingIdRef.current) {
        loadMeetingDetail(activeMeetingIdRef.current, organizationId);
      }
    });

    return () => {
      unsubEvent();
      unsubState();
    };
  }, [organizationId, handleMeetingEvent, refreshMeetingsList, loadMeetingDetail]);
}

