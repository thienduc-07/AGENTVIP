export type MeetingStatusType =
  | "DRAFT"
  | "SCHEDULED"
  | "INITIALIZING"
  | "IN_PROGRESS"
  | "PAUSED"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type ParticipantRoleType =
  | "MODERATOR"
  | "PRESENTER"
  | "RESEARCHER"
  | "ANALYST"
  | "CRITIC"
  | "SPECIALIST"
  | "OBSERVER"
  | "DECISION_MAKER";

export type ParticipantStatusType =
  | "INVITED"
  | "JOINED"
  | "SPEAKING"
  | "LISTENING"
  | "THINKING"
  | "FINISHED"
  | "REMOVED"
  | "FAILED";

export type MeetingMessageType =
  | "OPENING"
  | "STATEMENT"
  | "QUESTION"
  | "ANSWER"
  | "PROPOSAL"
  | "CRITICISM"
  | "REBUTTAL"
  | "VOTE"
  | "DECISION"
  | "SUMMARY"
  | "SYSTEM_EVENT";

export type DecisionStatusType =
  | "PROPOSED"
  | "VOTING"
  | "APPROVED"
  | "REJECTED"
  | "REQUIRES_HUMAN_APPROVAL"
  | "EXECUTED"
  | "CANCELLED";

export type VoteType = "YES" | "NO" | "ABSTAIN";

export type MeetingPresentationMode =
  | "STANDBY"
  | "DISCUSSION"
  | "PROPOSAL"
  | "CRITIQUE"
  | "VOTING"
  | "DECISION";

export type MeetingAnimationState =
  | "IDLE"
  | "WALKING_TO_MEETING"
  | "ARRIVING"
  | "SITTING"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "PRESENTING"
  | "VOTING"
  | "WAITING"
  | "LEAVING";

export interface ApiMeetingParticipant {
  id: string;
  meeting_id: string;
  agent_id: string;
  agent_name?: string | null;
  role: ParticipantRoleType;
  participation_status: ParticipantStatusType;
  joined_at?: string | null;
  left_at?: string | null;
  speaking_order: number;
  contribution_count: number;
  metadata_json?: Record<string, any> | null;
}

export interface ApiMeetingMessage {
  id: string;
  meeting_id: string;
  participant_id?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  message_type: MeetingMessageType;
  content: string;
  sequence_number: number;
  reply_to_message_id?: string | null;
  created_at: string;
  metadata_json?: Record<string, any> | null;
}

export interface ApiMeetingVote {
  id: string;
  decision_id: string;
  agent_id: string;
  agent_name?: string | null;
  vote: VoteType;
  reasoning?: string | null;
  created_at: string;
}

export interface ApiMeetingDecision {
  id: string;
  meeting_id: string;
  title: string;
  description: string;
  decision_type: string;
  status: DecisionStatusType;
  proposed_by?: string | null;
  approved_by?: string | null;
  created_at: string;
  resolved_at?: string | null;
  metadata_json?: Record<string, any> | null;
  votes: ApiMeetingVote[];
}

export interface ApiMeetingActionItem {
  id: string;
  meeting_id: string;
  decision_id?: string | null;
  title: string;
  description: string;
  assigned_agent_id: string;
  assigned_agent_name?: string | null;
  assigned_by?: string | null;
  linked_task_id?: string | null;
  priority: string;
  status: string;
  due_at?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface ApiMeetingTranscript {
  id: string;
  meeting_id: string;
  transcript_version: number;
  content: string;
  summary?: string | null;
  created_at: string;
}

export interface ApiMeeting {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  meeting_type: string;
  status: MeetingStatusType;
  objective?: string | null;
  created_by?: string | null;
  moderator_agent_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
  metadata_json?: Record<string, any> | null;
  participants: ApiMeetingParticipant[];
  decisions_count: number;
  action_items_count: number;
  messages_count: number;
}

export interface ApiMeetingSummary {
  meeting_id: string;
  title: string;
  status: string;
  objective?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  participants_count: number;
  messages_count: number;
  decisions: ApiMeetingDecision[];
  action_items: ApiMeetingActionItem[];
  summary_text?: string | null;
}

export interface MeetingSeatAssignment {
  seatIndex: number;
  agentId: string;
  position: [number, number, number];
  rotationY: number; // Radian orientation facing center of table
  chairId: string;
  isHeadSeat?: boolean;
}
