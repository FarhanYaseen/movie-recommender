# app/providers/base.py
# Provider-neutral generation interface. Keeps the Anthropic adapter separate
# from retrieval and HTTP handlers; tests substitute a mock implementation.

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ToolUse:
    id: str
    name: str
    input: dict


@dataclass(frozen=True)
class ProviderTurn:
    """One non-streaming model turn (used for agent tool rounds)."""

    text: str
    tool_uses: list[ToolUse] = field(default_factory=list)
    stop_reason: str = "end_turn"
    # Opaque assistant content to echo back on the next request
    raw_content: list = field(default_factory=list)


class GenerationProvider(ABC):
    @abstractmethod
    def model_name(self) -> str: ...

    @abstractmethod
    def stream_text(self, system: str, messages: list[dict]) -> Iterator[str]:
        """Yield text deltas for a final answer. Closing the iterator must
        abort the upstream request."""

    @abstractmethod
    def create_turn(self, system: str, messages: list[dict], tools: list[dict]) -> ProviderTurn:
        """One tool-capable turn for the agent loop."""
