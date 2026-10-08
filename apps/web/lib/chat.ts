// Chat state machine (pure reducer) and the streaming transport that feeds it.
// The reducer is exported separately from any React code so tests can drive it
// with synthetic events.

import { API_BASE_URL, ApiError } from "./api";
import { createSseParser } from "./sse";
import type { ChatMode, ChatStreamEvent, Citation, DoneStatus } from "./types";

export type AssistantStatus =
  | "streaming"
  | "complete"
  | "insufficient_evidence"
  | "failed"
  | "cancelled";

export interface ToolActivity {
  round: number;
  tool: string;
  arguments?: Record<string, unknown>;
  resultSummary?: string;
  resultCount?: number;
}

export interface UserChatMessage {
  id: string;
  role: "user";
  text: string;
  mode: ChatMode;
}

export interface AssistantChatMessage {
  id: string;
  role: "assistant";
  text: string;
  status: AssistantStatus;
  citations: Citation[];
  tools: ToolActivity[];
  retrievedCount?: number;
  errorMessage?: string;
}

export type ChatMessage = UserChatMessage | AssistantChatMessage;

export interface ChatState {
  messages: ChatMessage[];
  conversationId: string | null;
  streaming: boolean;
}

export const initialChatState: ChatState = {
  messages: [],
  conversationId: null,
  streaming: false,
};

export type ChatAction =
  | { type: "send"; id: string; text: string; mode: ChatMode }
  | { type: "retry"; id: string }
  | { type: "stream_event"; event: ChatStreamEvent }
  | { type: "transport_error"; message: string }
  | { type: "cancelled" };

function updateCurrentAssistant(
  state: ChatState,
  update: (message: AssistantChatMessage) => AssistantChatMessage
): ChatState {
  const messages = [...state.messages];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant") {
      messages[i] = update(message);
      return { ...state, messages };
    }
  }
  return state;
}

function settle(state: ChatState, status: AssistantStatus, errorMessage?: string): ChatState {
  const settled = updateCurrentAssistant(state, (message) =>
    message.status === "streaming" ? { ...message, status, errorMessage } : message
  );
  return { ...settled, streaming: false };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      const user: UserChatMessage = {
        id: `${action.id}-u`,
        role: "user",
        text: action.text,
        mode: action.mode,
      };
      const assistant: AssistantChatMessage = {
        id: `${action.id}-a`,
        role: "assistant",
        text: "",
        status: "streaming",
        citations: [],
        tools: [],
      };
      return {
        ...state,
        messages: [...state.messages, user, assistant],
        streaming: true,
      };
    }
    case "retry": {
      // Reuse the failed/cancelled assistant slot — the user message is kept,
      // so a retry never duplicates it.
      const messages = state.messages.map((message) =>
        message.id === action.id && message.role === "assistant"
          ? {
              ...message,
              text: "",
              status: "streaming" as const,
              citations: [],
              tools: [],
              errorMessage: undefined,
            }
          : message
      );
      return { ...state, messages, streaming: true };
    }
    case "stream_event": {
      const { event } = action;
      switch (event.type) {
        case "meta":
          return { ...state, conversationId: event.data.conversation_id };
        case "retrieval":
          return updateCurrentAssistant(state, (message) => ({
            ...message,
            retrievedCount: event.data.chunks.length,
          }));
        case "tool_start":
          return updateCurrentAssistant(state, (message) => ({
            ...message,
            tools: [
              ...message.tools,
              { round: event.data.round, tool: event.data.tool, arguments: event.data.arguments },
            ],
          }));
        case "tool_result":
          return updateCurrentAssistant(state, (message) => {
            const tools = [...message.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
              if (tools[i].round === event.data.round && tools[i].tool === event.data.tool) {
                tools[i] = {
                  ...tools[i],
                  resultSummary: event.data.result_summary,
                  resultCount: event.data.count,
                };
                return { ...message, tools };
              }
            }
            tools.push({
              round: event.data.round,
              tool: event.data.tool,
              resultSummary: event.data.result_summary,
              resultCount: event.data.count,
            });
            return { ...message, tools };
          });
        case "delta":
          return updateCurrentAssistant(state, (message) => ({
            ...message,
            text: message.text + event.data.text,
          }));
        case "citations":
          return updateCurrentAssistant(state, (message) => ({
            ...message,
            citations: event.data.citations,
          }));
        case "error":
          return settle(state, "failed", event.data.message);
        case "done": {
          const status: DoneStatus = event.data.status;
          if (status === "failed") {
            return settle(state, "failed", lastError(state) ?? "The response failed.");
          }
          return settle(state, status);
        }
      }
      return state;
    }
    case "transport_error":
      return settle(state, "failed", action.message);
    case "cancelled":
      return settle(state, "cancelled");
    default:
      return state;
  }
}

function lastError(state: ChatState): string | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.role === "assistant" && message.errorMessage) {
      return message.errorMessage;
    }
  }
  return undefined;
}

const EVENT_NAMES = new Set([
  "meta",
  "retrieval",
  "tool_start",
  "tool_result",
  "delta",
  "citations",
  "done",
  "error",
]);

export interface StreamChatOptions {
  token: string;
  message: string;
  mode: ChatMode;
  conversationId: string | null;
  signal: AbortSignal;
  onEvent(event: ChatStreamEvent): void;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

// Opens the stream and forwards typed events. Resolves when the stream ends.
// Throws ApiError for non-2xx responses and rethrows AbortError on cancel.
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(`${API_BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify({
      message: options.message,
      mode: options.mode,
      ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      // keep generic message
    }
    throw new ApiError(code, message, res.status);
  }
  if (!res.body) {
    throw new ApiError("INTERNAL_ERROR", "The server returned no stream.", 502);
  }

  const parser = createSseParser((frame) => {
    if (!EVENT_NAMES.has(frame.event)) {
      return; // ignore unknown/keep-alive events
    }
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      return; // malformed frame — skip rather than corrupt state
    }
    options.onEvent({ type: frame.event, data } as ChatStreamEvent);
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    reader.releaseLock();
  }
}
