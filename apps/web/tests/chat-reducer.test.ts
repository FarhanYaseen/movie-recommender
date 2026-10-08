import { describe, expect, it } from "vitest";
import {
  chatReducer,
  initialChatState,
  type AssistantChatMessage,
  type ChatState,
} from "@/lib/chat";
import type { ChatStreamEvent } from "@/lib/types";

function started(): ChatState {
  return chatReducer(initialChatState, {
    type: "send",
    id: "m1",
    text: "a dream heist movie",
    mode: "rag",
  });
}

function event(state: ChatState, ev: ChatStreamEvent): ChatState {
  return chatReducer(state, { type: "stream_event", event: ev });
}

function assistant(state: ChatState): AssistantChatMessage {
  const message = state.messages[state.messages.length - 1];
  if (message.role !== "assistant") {
    throw new Error("expected assistant message");
  }
  return message;
}

describe("chatReducer", () => {
  it("send adds a user message and a streaming assistant slot", () => {
    const state = started();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: "user", text: "a dream heist movie" });
    expect(assistant(state).status).toBe("streaming");
    expect(state.streaming).toBe(true);
  });

  it("accumulates delta text in order", () => {
    let state = started();
    state = event(state, { type: "delta", data: { text: "Watch " } });
    state = event(state, { type: "delta", data: { text: "Inception." } });
    expect(assistant(state).text).toBe("Watch Inception.");
  });

  it("records conversation id from meta", () => {
    let state = started();
    state = event(state, {
      type: "meta",
      data: { request_id: "r1", conversation_id: "c1", mode: "rag", model: "m" },
    });
    expect(state.conversationId).toBe("c1");
  });

  it("stores citations and tool activity", () => {
    let state = started();
    state = event(state, {
      type: "tool_start",
      data: { round: 1, tool: "search_catalog", arguments: { query: "sci-fi" } },
    });
    state = event(state, {
      type: "tool_result",
      data: { round: 1, tool: "search_catalog", result_summary: "3 movies", count: 3 },
    });
    state = event(state, {
      type: "citations",
      data: {
        citations: [
          { chunk_id: "ch1", document_id: "d1", document_title: "Notes", ordinal: 0 },
        ],
      },
    });
    const message = assistant(state);
    expect(message.tools).toEqual([
      {
        round: 1,
        tool: "search_catalog",
        arguments: { query: "sci-fi" },
        resultSummary: "3 movies",
        resultCount: 3,
      },
    ]);
    expect(message.citations).toHaveLength(1);
  });

  it("error event settles the message as failed with the safe message", () => {
    let state = started();
    state = event(state, { type: "delta", data: { text: "partial" } });
    state = event(state, {
      type: "error",
      data: { code: "UPSTREAM_ERROR", message: "Generation failed upstream" },
    });
    const message = assistant(state);
    expect(message.status).toBe("failed");
    expect(message.errorMessage).toBe("Generation failed upstream");
    expect(message.text).toBe("partial"); // partial text preserved
    expect(state.streaming).toBe(false);
  });

  it("done with insufficient_evidence settles that distinct state", () => {
    let state = started();
    state = event(state, { type: "done", data: { status: "insufficient_evidence", request_id: "r" } });
    expect(assistant(state).status).toBe("insufficient_evidence");
    expect(state.streaming).toBe(false);
  });

  it("done after error keeps the failed status", () => {
    let state = started();
    state = event(state, { type: "error", data: { code: "X", message: "boom" } });
    state = event(state, { type: "done", data: { status: "failed", request_id: "r" } });
    expect(assistant(state).status).toBe("failed");
  });

  it("cancelled settles a streaming message", () => {
    let state = started();
    state = event(state, { type: "delta", data: { text: "half an ans" } });
    state = chatReducer(state, { type: "cancelled" });
    expect(assistant(state).status).toBe("cancelled");
    expect(state.streaming).toBe(false);
  });

  it("retry reuses the assistant slot without duplicating the user message", () => {
    let state = started();
    state = chatReducer(state, { type: "transport_error", message: "network down" });
    const failedId = assistant(state).id;

    state = chatReducer(state, { type: "retry", id: failedId });
    expect(state.messages).toHaveLength(2); // still one user + one assistant
    const retried = assistant(state);
    expect(retried.id).toBe(failedId);
    expect(retried.status).toBe("streaming");
    expect(retried.text).toBe("");
    expect(retried.errorMessage).toBeUndefined();
  });
});
