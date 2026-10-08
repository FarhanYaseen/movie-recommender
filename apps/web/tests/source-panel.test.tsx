import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/lib/auth";
import { SourceCards } from "@/components/SourcePanel";
import type { Citation } from "@/lib/types";

const CITATION: Citation = {
  chunk_id: "ch1",
  document_id: "d1",
  document_title: "My Notes",
  ordinal: 0,
};

function renderCards() {
  return render(
    <AuthProvider>
      <SourceCards citations={[CITATION]} />
    </AuthProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SourceCards", () => {
  it("opens the cited chunk text in a dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "ch1",
            document_id: "d1",
            document_title: "My Notes",
            ordinal: 0,
            start_offset: 0,
            end_offset: 20,
            text: "Inception is about dreams.",
          }),
          { status: 200 }
        )
      )
    );

    renderCards();
    await userEvent.click(screen.getByRole("button", { name: /My Notes/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("Inception is about dreams.")).toBeInTheDocument();
  });

  it("shows the safe error message when the chunk fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: "Source not found", request_id: "r" },
          }),
          { status: 404 }
        )
      )
    );

    renderCards();
    await userEvent.click(screen.getByRole("button", { name: /My Notes/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Source not found");
    });
  });

  it("renders nothing when there are no citations", () => {
    const { container } = render(
      <AuthProvider>
        <SourceCards citations={[]} />
      </AuthProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
