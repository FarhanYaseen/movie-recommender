import { describe, expect, it, vi } from "vitest";
import { streamChat } from "@/lib/chat";
import { ApiError } from "@/lib/api";
import type { ChatStreamEvent } from "@/lib/types";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("streamChat", () => {
  it("emits typed events parsed across chunk boundaries", async () => {
    const frames =
      'event: meta\ndata: {"request_id":"r1","conversation_id":"c1","mode":"rag","model":"m"}\n\n' +
      'event: delta\ndata: {"text":"Hello"}\n\n' +
      'event: done\ndata: {"status":"complete","request_id":"r1"}\n\n';
    // Split mid-frame to prove buffering works end to end.
    const chunks = [frames.slice(0, 25), frames.slice(25, 90), frames.slice(90)];

    const events: ChatStreamEvent[] = [];
    await streamChat({
      token: "t",
      message: "hi",
      mode: "rag",
      conversationId: null,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      fetchImpl: vi.fn().mockResolvedValue(sseResponse(chunks)),
    });

    expect(events.map((e) => e.type)).toEqual(["meta", "delta", "done"]);
    expect(events[1]).toEqual({ type: "delta", data: { text: "Hello" } });
  });

  it("sends auth header, message, mode, and conversation id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([]));
    await streamChat({
      token: "secret-token",
      message: "q",
      mode: "agent",
      conversationId: "c9",
      signal: new AbortController().signal,
      onEvent: () => {},
      fetchImpl,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/api/chat/stream");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({ message: "q", mode: "agent", conversation_id: "c9" });
  });

  it("throws ApiError with the contract error shape on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "RATE_LIMITED", message: "Daily limit reached", request_id: "r" },
        }),
        { status: 429 }
      )
    );
    await expect(
      streamChat({
        token: "t",
        message: "hi",
        mode: "rag",
        conversationId: null,
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      })
    ).rejects.toMatchObject({
      constructor: ApiError,
      code: "RATE_LIMITED",
      message: "Daily limit reached",
    });
  });

  it("skips malformed frames instead of corrupting state", async () => {
    const events: ChatStreamEvent[] = [];
    await streamChat({
      token: "t",
      message: "hi",
      mode: "rag",
      conversationId: null,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          sseResponse(['event: delta\ndata: {not json}\n\n', 'event: delta\ndata: {"text":"ok"}\n\n'])
        ),
    });
    expect(events).toEqual([{ type: "delta", data: { text: "ok" } }]);
  });
});
