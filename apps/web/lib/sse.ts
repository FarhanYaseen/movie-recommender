// Incremental Server-Sent Events parser.
//
// Network chunks carry no frame alignment guarantees: one chunk may hold half
// an event or three events, and a CRLF pair may be split across two chunks.
// This parser buffers raw text, emits one SseMessage per blank-line-terminated
// frame, and is pure (no fetch, no DOM) so it can be unit-tested directly.

export interface SseMessage {
  event: string;
  data: string;
}

export interface SseParser {
  push(chunk: string): void;
  /** Flush a final frame that was not terminated by a blank line. */
  end(): void;
}

export function createSseParser(onMessage: (message: SseMessage) => void): SseParser {
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  function dispatch() {
    if (eventName === "" && dataLines.length === 0) {
      return;
    }
    onMessage({ event: eventName || "message", data: dataLines.join("\n") });
    eventName = "";
    dataLines = [];
  }

  function processLine(line: string) {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) {
      return; // comment / keep-alive
    }
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
    }
    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
    // id/retry fields are not used by this application.
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        processLine(line);
        newline = buffer.indexOf("\n");
      }
      // Anything left in `buffer` is an incomplete line (possibly ending in a
      // bare "\r" whose "\n" arrives in the next chunk) — keep it buffered.
    },
    end() {
      if (buffer !== "") {
        let line = buffer;
        buffer = "";
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        processLine(line);
      }
      dispatch();
    },
  };
}
