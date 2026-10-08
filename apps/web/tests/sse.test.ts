import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "@/lib/sse";

function collect() {
  const messages: SseMessage[] = [];
  const parser = createSseParser((m) => messages.push(m));
  return { messages, parser };
}

describe("createSseParser", () => {
  it("parses a complete frame", () => {
    const { messages, parser } = collect();
    parser.push('event: delta\ndata: {"text":"hi"}\n\n');
    expect(messages).toEqual([{ event: "delta", data: '{"text":"hi"}' }]);
  });

  it("buffers frames split across arbitrary chunk boundaries", () => {
    const { messages, parser } = collect();
    const frame = 'event: delta\ndata: {"text":"hello world"}\n\n';
    for (const char of frame) {
      parser.push(char); // worst case: one byte per network chunk
    }
    expect(messages).toEqual([{ event: "delta", data: '{"text":"hello world"}' }]);
  });

  it("handles multiple events arriving in a single chunk", () => {
    const { messages, parser } = collect();
    parser.push(
      'event: sources\ndata: []\n\nevent: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {}\n\n'
    );
    expect(messages.map((m) => m.event)).toEqual(["sources", "delta", "done"]);
  });

  it("handles CRLF line endings, including a CRLF split across chunks", () => {
    const { messages, parser } = collect();
    parser.push("event: delta\r\ndata: {}\r");
    parser.push("\n\r\n");
    expect(messages).toEqual([{ event: "delta", data: "{}" }]);
  });

  it("joins multi-line data with newlines", () => {
    const { messages, parser } = collect();
    parser.push("data: line one\ndata: line two\n\n");
    expect(messages).toEqual([{ event: "message", data: "line one\nline two" }]);
  });

  it("ignores comment lines and unknown fields", () => {
    const { messages, parser } = collect();
    parser.push(": keep-alive\nid: 7\nevent: done\ndata: {}\n\n");
    expect(messages).toEqual([{ event: "done", data: "{}" }]);
  });

  it("defaults the event name to 'message'", () => {
    const { messages, parser } = collect();
    parser.push("data: x\n\n");
    expect(messages[0].event).toBe("message");
  });

  it("flushes an unterminated final frame on end()", () => {
    const { messages, parser } = collect();
    parser.push("event: done\ndata: {}");
    expect(messages).toEqual([]);
    parser.end();
    expect(messages).toEqual([{ event: "done", data: "{}" }]);
  });
});
