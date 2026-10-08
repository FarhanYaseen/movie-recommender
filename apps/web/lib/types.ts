// Contract types — mirror docs/contracts/ai-api.md exactly.

export interface ApiErrorShape {
  error: { code: string; message: string; request_id?: string };
}

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: { id: string; email: string };
}

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface DocumentSummary {
  id: string;
  title: string;
  source_name: string;
  status: DocumentStatus;
  chunk_count: number;
  created_at: string;
}

export interface UploadResponse {
  document_id: string;
  job_id: string;
  status: "pending" | "duplicate";
}

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Job {
  id: string;
  document_id: string;
  status: JobStatus;
  completed_chunks: number;
  total_chunks: number | null;
  error: string | null;
}

export interface ChunkDetail {
  id: string;
  document_id: string;
  document_title: string;
  ordinal: number;
  start_offset: number;
  end_offset: number;
  text: string;
}

export interface Citation {
  chunk_id: string;
  document_id: string;
  document_title: string;
  ordinal: number;
}

export type ChatMode = "rag" | "agent";

export type DoneStatus = "complete" | "insufficient_evidence" | "failed";

// SSE event payloads for POST /api/chat/stream
export interface MetaEvent {
  request_id: string;
  conversation_id: string;
  mode: ChatMode;
  model: string;
}

export interface RetrievalEvent {
  chunks: Array<Citation & { score: number }>;
}

export interface ToolStartEvent {
  round: number;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent {
  round: number;
  tool: string;
  result_summary: string;
  count: number;
}

export interface DeltaEvent {
  text: string;
}

export interface CitationsEvent {
  citations: Citation[];
}

export interface DoneEvent {
  status: DoneStatus;
  request_id: string;
}

export interface ErrorEvent {
  code: string;
  message: string;
  request_id?: string;
}

export type ChatStreamEvent =
  | { type: "meta"; data: MetaEvent }
  | { type: "retrieval"; data: RetrievalEvent }
  | { type: "tool_start"; data: ToolStartEvent }
  | { type: "tool_result"; data: ToolResultEvent }
  | { type: "delta"; data: DeltaEvent }
  | { type: "citations"; data: CitationsEvent }
  | { type: "done"; data: DoneEvent }
  | { type: "error"; data: ErrorEvent };
