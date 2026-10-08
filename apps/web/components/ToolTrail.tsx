import type { ToolActivity } from "@/lib/chat";

// Compact agent activity trail: validated tool calls and safe result
// summaries only — never model chain-of-thought.
export function ToolTrail({ tools }: { tools: ToolActivity[] }) {
  if (tools.length === 0) {
    return null;
  }
  return (
    <div className="tool-trail" aria-label="Tool activity">
      {tools.map((tool, i) => (
        <div key={`${tool.round}-${tool.tool}-${i}`}>
          <strong>{tool.tool}</strong>{" "}
          {tool.arguments ? <code>{JSON.stringify(tool.arguments)}</code> : null}
          {tool.resultSummary ? (
            <span className="muted">
              {" "}
              → {tool.resultSummary}
              {typeof tool.resultCount === "number" ? ` (${tool.resultCount})` : ""}
            </span>
          ) : (
            <span className="muted"> → running…</span>
          )}
        </div>
      ))}
    </div>
  );
}
