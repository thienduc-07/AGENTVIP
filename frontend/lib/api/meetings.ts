import { apiClient } from "./client";
import {
  ApiMeeting,
  ApiMeetingParticipant,
  ApiMeetingMessage,
  ApiMeetingDecision,
  ApiMeetingVote,
  ApiMeetingActionItem,
  ApiMeetingTranscript,
  ApiMeetingSummary,
  MeetingStatusType,
  ParticipantRoleType,
  VoteType,
} from "@/types/meeting";

export interface GetMeetingsParams {
  organizationId?: string | null;
  status?: MeetingStatusType | string;
  meeting_type?: string;
  limit?: number;
  offset?: number;
}

export interface CreateMeetingPayload {
  title: string;
  description?: string;
  meeting_type?: string;
  objective?: string;
  moderator_agent_id?: string;
  participant_agent_ids?: string[];
  metadata_json?: Record<string, any>;
}

export interface PostMessagePayload {
  content: string;
  agent_id?: string;
  message_type?: string;
  reply_to_message_id?: string;
  metadata_json?: Record<string, any>;
}

export interface ProposeDecisionPayload {
  title: string;
  description: string;
  decision_type?: string;
  proposed_by?: string;
  voting_policy?: string;
  metadata_json?: Record<string, any>;
}

export interface CastVotePayload {
  agent_id: string;
  vote: VoteType;
  reasoning?: string;
}

export interface CreateActionItemPayload {
  title: string;
  description: string;
  assigned_agent_id: string;
  decision_id?: string;
  priority?: string;
  due_at?: string;
  create_linked_task?: boolean;
}

export async function getMeetings(params: GetMeetingsParams = {}): Promise<ApiMeeting[]> {
  const { organizationId, status, meeting_type, limit = 50, offset = 0 } = params;
  return apiClient<ApiMeeting[]>("/api/v1/meetings", {
    params: { status, meeting_type, limit, offset },
    organizationId,
  });
}

export async function getMeeting(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}`, {
    organizationId: options.organizationId,
  });
}

export async function createMeeting(
  data: CreateMeetingPayload,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>("/api/v1/meetings", {
    method: "POST",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function updateMeeting(
  meetingId: string,
  data: Partial<CreateMeetingPayload> & { status?: MeetingStatusType },
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function startMeeting(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}/start`, {
    method: "POST",
    organizationId: options.organizationId,
  });
}

export async function pauseMeeting(
  meetingId: string,
  reason?: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}/pause`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    organizationId: options.organizationId,
  });
}

export async function resumeMeeting(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}/resume`, {
    method: "POST",
    organizationId: options.organizationId,
  });
}

export async function cancelMeeting(
  meetingId: string,
  reason?: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    organizationId: options.organizationId,
  });
}

export async function completeMeeting(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeeting> {
  return apiClient<ApiMeeting>(`/api/v1/meetings/${meetingId}/complete`, {
    method: "POST",
    organizationId: options.organizationId,
  });
}

export async function getMeetingParticipants(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingParticipant[]> {
  return apiClient<ApiMeetingParticipant[]>(`/api/v1/meetings/${meetingId}/participants`, {
    organizationId: options.organizationId,
  });
}

export async function addMeetingParticipant(
  meetingId: string,
  data: { agent_id: string; role?: ParticipantRoleType; speaking_order?: number },
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingParticipant> {
  return apiClient<ApiMeetingParticipant>(`/api/v1/meetings/${meetingId}/participants`, {
    method: "POST",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function removeMeetingParticipant(
  meetingId: string,
  agentId: string,
  options: { organizationId?: string | null } = {}
): Promise<{ status: string; agent_id: string; meeting_id: string }> {
  return apiClient<{ status: string; agent_id: string; meeting_id: string }>(
    `/api/v1/meetings/${meetingId}/participants/${agentId}`,
    {
      method: "DELETE",
      organizationId: options.organizationId,
    }
  );
}

export async function getMeetingMessages(
  meetingId: string,
  params: { limit?: number; offset?: number; organizationId?: string | null } = {}
): Promise<ApiMeetingMessage[]> {
  const { limit = 100, offset = 0, organizationId } = params;
  return apiClient<ApiMeetingMessage[]>(`/api/v1/meetings/${meetingId}/messages`, {
    params: { limit, offset },
    organizationId,
  });
}

export async function postMeetingMessage(
  meetingId: string,
  data: PostMessagePayload,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingMessage> {
  return apiClient<ApiMeetingMessage>(`/api/v1/meetings/${meetingId}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function proposeMeetingDecision(
  meetingId: string,
  data: ProposeDecisionPayload,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingDecision> {
  return apiClient<ApiMeetingDecision>(`/api/v1/meetings/${meetingId}/decisions`, {
    method: "POST",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function castMeetingVote(
  meetingId: string,
  decisionId: string,
  data: CastVotePayload,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingVote> {
  return apiClient<ApiMeetingVote>(`/api/v1/meetings/${meetingId}/decisions/${decisionId}/vote`, {
    method: "POST",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function resolveMeetingDecision(
  meetingId: string,
  decisionId: string,
  override?: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingDecision> {
  return apiClient<ApiMeetingDecision>(`/api/v1/meetings/${meetingId}/decisions/${decisionId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution_override: override }),
    organizationId: options.organizationId,
  });
}

export async function createMeetingActionItem(
  meetingId: string,
  data: CreateActionItemPayload,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingActionItem> {
  return apiClient<ApiMeetingActionItem>(`/api/v1/meetings/${meetingId}/action-items`, {
    method: "POST",
    body: JSON.stringify(data),
    organizationId: options.organizationId,
  });
}

export async function getMeetingActionItems(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingActionItem[]> {
  return apiClient<ApiMeetingActionItem[]>(`/api/v1/meetings/${meetingId}/action-items`, {
    organizationId: options.organizationId,
  });
}

export async function generateMeetingTranscript(
  meetingId: string,
  summary?: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingTranscript> {
  return apiClient<ApiMeetingTranscript>(`/api/v1/meetings/${meetingId}/transcripts/generate`, {
    method: "POST",
    body: JSON.stringify({ summary }),
    organizationId: options.organizationId,
  });
}

export async function getMeetingSummary(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<ApiMeetingSummary> {
  return apiClient<ApiMeetingSummary>(`/api/v1/meetings/${meetingId}/summary`, {
    organizationId: options.organizationId,
  });
}

export async function executeMeetingTurn(
  meetingId: string,
  options: { organizationId?: string | null } = {}
): Promise<Record<string, any>> {
  return apiClient<Record<string, any>>(`/api/v1/meetings/${meetingId}/execute-turn`, {
    method: "POST",
    organizationId: options.organizationId,
  });
}

