"use client";

import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { SourceCards } from "@/components/SourcePanel";
import { ToolTrail } from "@/components/ToolTrail";
import { useAuth } from "@/lib/auth";
import {
  chatReducer,
  initialChatState,
  streamChat,
  type AssistantChatMessage,
} from "@/lib/chat";
import type { ChatMode } from "@/lib/types";

export default function ChatPage() {
  return (
    <RequireAuth>
      <Chat />
    </RequireAuth>
  );
}

function statusAnnouncement(message: AssistantChatMessage | undefined): string {
  if (!message) {
    return "";
  }
  switch (message.status) {
    case "streaming":
      return "Assistant is answering…";
    case "complete":
      return "Answer complete.";
    case "insufficient_evidence":
      return "The assistant could not find enough evidence to answer.";
    case "cancelled":
      return "Response stopped.";
    case "failed":
      return "The response failed.";
  }
}

function Chat() {
  const { token } = useAuth();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("rag");
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state.messages]);

  async function run(message: string, action: { type: "send"; id: string } | { type: "retry"; id: string }) {
    const controller = new AbortController();
    abortRef.current = controller;
    if (action.type === "send") {
      dispatch({ type: "send", id: action.id, text: message, mode });
    } else {
      dispatch({ type: "retry", id: action.id });
    }
    try {
      await streamChat({
        token: token!,
        message,
        mode,
        conversationId: state.conversationId,
        signal: controller.signal,
        onEvent: (event) => dispatch({ type: "stream_event", event }),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        dispatch({ type: "cancelled" });
      } else {
        dispatch({
          type: "transport_error",
          message:
            err instanceof Error && err.name !== "TypeError"
              ? err.message
              : "Could not reach the server. Is the API running?",
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || state.streaming) {
      return;
    }
    setInput("");
    run(text, { type: "send", id: crypto.randomUUID() });
  }

  function onStop() {
    abortRef.current?.abort();
  }

  function retry(assistant: AssistantChatMessage) {
    // Find the user message that produced this assistant slot.
    const index = state.messages.findIndex((m) => m.id === assistant.id);
    const userMessage = state.messages[index - 1];
    if (!userMessage || userMessage.role !== "user") {
      return;
    }
    run(userMessage.text, { type: "retry", id: assistant.id });
  }

  const lastAssistant = [...state.messages]
    .reverse()
    .find((m): m is AssistantChatMessage => m.role === "assistant");

  return (
    <div className="stack">
      <h1>Chat</h1>
      <p className="muted">
        Ask about the movie catalog or your uploaded documents. Answers are grounded in
        retrieved sources; in agent mode the assistant chooses tools itself.
      </p>

      <div className="chat-log" ref={logRef}>
        {state.messages.length === 0 ? (
          <p className="muted">No messages yet — ask your first question below.</p>
        ) : null}
        {state.messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="bubble user">
              {message.text}
            </div>
          ) : (
            <AssistantBubble key={message.id} message={message} onRetry={() => retry(message)} />
          )
        )}
      </div>

      <p aria-live="polite" className="visually-hidden">
        {statusAnnouncement(lastAssistant)}
      </p>

      <form className="chat-form" onSubmit={onSubmit} aria-label="Send a message">
        <div className="mode-toggle" role="group" aria-label="Answer mode">
          <button
            type="button"
            aria-pressed={mode === "rag"}
            onClick={() => setMode("rag")}
            disabled={state.streaming}
          >
            RAG
          </button>
          <button
            type="button"
            aria-pressed={mode === "agent"}
            onClick={() => setMode("agent")}
            disabled={state.streaming}
          >
            Agent
          </button>
        </div>
        <textarea
          aria-label="Your question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={mode === "rag" ? "e.g. What do my notes say about Inception?" : "e.g. Find a 90s sci-fi movie and compare it with my notes"}
        />
        {state.streaming ? (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function AssistantBubble({
  message,
  onRetry,
}: {
  message: AssistantChatMessage;
  onRetry: () => void;
}) {
  const insufficient = message.status === "insufficient_evidence";
  return (
    <div className={`bubble assistant${insufficient ? " insufficient" : ""}`}>
      {message.text ||
        (message.status === "streaming" ? <span className="muted">Thinking…</span> : null)}
      {message.status === "failed" ? (
        <p role="alert" className="error-text">
          {message.errorMessage || "The response failed."}{" "}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
      {message.status === "cancelled" ? (
        <p className="muted">
          Stopped.{" "}
          <button type="button" onClick={onRetry}>
            Regenerate
          </button>
        </p>
      ) : null}
      <ToolTrail tools={message.tools} />
      <SourceCards citations={message.citations} />
      <div className="status-line">
        {typeof message.retrievedCount === "number" ? (
          <span>{message.retrievedCount} sources retrieved</span>
        ) : null}
        {insufficient ? <span>Not enough evidence in your documents to answer.</span> : null}
        {message.status === "streaming" ? <span>streaming…</span> : null}
      </div>
    </div>
  );
}
