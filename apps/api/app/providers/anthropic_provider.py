# app/providers/anthropic_provider.py
# Anthropic adapter. Model from ANTHROPIC_MODEL (default claude-opus-5-5),
# no thinking parameter, no prefill; provider errors are mapped to the
# contract error codes and raw provider bodies never reach the browser.

from collections.abc import Iterator

import anthropic

from ..config import get_settings
from ..errors import NotConfiguredError, UpstreamError
from .base import GenerationProvider, ProviderTurn, ToolUse


def map_provider_error(err: Exception) -> Exception:
    if isinstance(err, anthropic.AuthenticationError):
        return NotConfiguredError("Answer generation is misconfigured")
    if isinstance(err, anthropic.RateLimitError):
        return UpstreamError("Answer generation is rate limited upstream")
    if isinstance(err, anthropic.APIError):
        return UpstreamError("Answer generation failed upstream")
    return err


class AnthropicProvider(GenerationProvider):
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.anthropic_api_key:
            raise NotConfiguredError(
                "Answer generation is not configured (missing ANTHROPIC_API_KEY)"
            )
        self._client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key, timeout=settings.chat_timeout_s
        )
        self._model = settings.anthropic_model
        self._max_tokens = settings.chat_max_output_tokens

    def model_name(self) -> str:
        return self._model

    def stream_text(self, system: str, messages: list[dict]) -> Iterator[str]:
        try:
            with self._client.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system,
                messages=messages,
            ) as stream:
                yield from stream.text_stream
        except anthropic.APIError as err:
            raise map_provider_error(err) from err

    def create_turn(self, system: str, messages: list[dict], tools: list[dict]) -> ProviderTurn:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system,
                messages=messages,
                tools=tools,
            )
        except anthropic.APIError as err:
            raise map_provider_error(err) from err

        text_parts: list[str] = []
        tool_uses: list[ToolUse] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_uses.append(ToolUse(id=block.id, name=block.name, input=dict(block.input)))

        return ProviderTurn(
            text="".join(text_parts),
            tool_uses=tool_uses,
            stop_reason=response.stop_reason or "end_turn",
            raw_content=[block.model_dump() for block in response.content],
        )
