"""Subagent scenario template: minimal Python peer for `ops-subagent-python`.

Replace `hello-subagent` with your scenario's kebab-case id and adapt the
`handle_agent_turn` body to call your real domain logic. The wire protocol
lives in `@deepseek-ai/dsh-ops-subagent-python/README.md`.

Run:
    PYTHONPATH=docs/ops/templates/subagent \\
      pnpm dsh --profile headless --patch docs/ops/templates/subagent/cordis.patch.yml "..."
"""

from __future__ import annotations

import json
import sys
import uuid
from typing import Any


def emit(message: dict[str, Any]) -> None:
    """Write one JSON-RPC message to stdout, newline-delimited."""
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_notification(method: str, params: Any) -> None:
    emit({"jsonrpc": "2.0", "method": method, "params": params})


def emit_result(req_id: str, result: Any) -> None:
    emit({"jsonrpc": "2.0", "id": req_id, "result": result})


def emit_error(req_id: str, code: int, message: str) -> None:
    emit({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def handle_initialize(req_id: str, params: dict[str, Any]) -> None:
    """Acknowledge the parent's handshake.

    A real implementation would set up scenario-specific state: load the
    domain models the scenario owns, prepare an outbound LLM client, or
    open the database the scenario reads. The template echoes the ids so
    the parent can confirm the wire works.
    """
    agent_id = params.get("agentId", "<unknown>")
    session_id = params.get("sessionId", "<unknown>")
    emit_result(req_id, {
        "agentId": agent_id,
        "sessionId": session_id,
        "capabilities": {"tools": [], "models": []},
    })
    emit_notification("session.event", {
        "type": "scenario/peer-initialized",
        "data": {"agentId": agent_id, "sessionId": session_id},
    })


def handle_agent_turn(req_id: str, params: dict[str, Any]) -> None:
    """Produce a deterministic stub response.

    Replace this body with the real scenario logic. The stub returns a
    single assistant message that names the agent and echoes the user
    prompt's length, which is enough for the parent harness to verify
    the spawn / handshake / turn / dispose lifecycle end-to-end.
    """
    messages = params.get("messages") or []
    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    prompt_len = len((last_user or {}).get("content") or "")
    emit_notification("session.event", {
        "type": "scenario/turn-started",
        "data": {"messageCount": len(messages), "promptLength": prompt_len},
    })
    emit_result(req_id, {
        "content": (
            f"[hello-subagent stub] received {len(messages)} messages; "
            f"user prompt length={prompt_len}. "
            f"Run id={uuid.uuid4()}"
        ),
        "tool_calls": [],
        "stop_reason": "end_turn",
        "usage": {"input": prompt_len, "output": 0},
    })


def main() -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            emit_error("-1", -32700, f"parse error: {exc}")
            continue
        req_id = message.get("id")
        method = message.get("method") or ""
        params = message.get("params") or {}
        if req_id is None:
            # Notifications carry no id; session.event notifications from
            # parent -> child are reserved for future phases.
            continue
        if method == "initialize":
            handle_initialize(req_id, params)
        elif method == "agent.turn":
            handle_agent_turn(req_id, params)
        else:
            emit_error(req_id, -32601, f"method not found: {method}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
