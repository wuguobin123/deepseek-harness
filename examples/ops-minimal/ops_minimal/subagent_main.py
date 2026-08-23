"""Minimal Python peer for the Phase 0 zero-milestone.

The parent dsh harness (TypeScript) spawns this module with `-m` and exchanges
JSON-RPC 2.0 messages over stdin/stdout. The wire protocol is documented in
`packages/ops/ops-subagent-python/README.md`. This script is intentionally
small: it answers every `agent.turn` with a deterministic stub so the harness
can verify the spawn/handshake/turn/dispose lifecycle end-to-end without a
real LLM call.

Phase 1+ replaces this stub with the real ops business runtime when specific
business scenarios are接入ed through the scenario contract.
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
    """Send a JSON-RPC notification (no id, no expected reply)."""
    emit({"jsonrpc": "2.0", "method": method, "params": params})


def emit_result(req_id: str, result: Any) -> None:
    emit({"jsonrpc": "2.0", "id": req_id, "result": result})


def emit_error(req_id: str, code: int, message: str) -> None:
    emit({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def handle_initialize(req_id: str, params: dict[str, Any]) -> None:
    """Acknowledge the parent's handshake.

    A real implementation would set up the ops-domain SQLite connection,
    load the agent preset referenced by `params['agentId']`, and prepare
    any model client. Phase 0 just echoes the ids so the parent can confirm
    the wire works.
    """
    agent_id = params.get("agentId", "<unknown>")
    session_id = params.get("sessionId", "<unknown>")
    emit_result(req_id, {
        "agentId": agent_id,
        "sessionId": session_id,
        "capabilities": {"tools": [], "models": []},
    })
    # Notify the parent session log that we are initialized; persistence will
    # record this fact alongside any assistant message produced by the run.
    emit_notification("session.event", {
        "type": "ops/peer-initialized",
        "data": {"agentId": agent_id, "sessionId": session_id},
    })


def handle_agent_turn(req_id: str, params: dict[str, Any]) -> None:
    """Produce a deterministic stub response.

    The stub always returns a single assistant message that names the agent
    and echoes the user prompt's length. A real implementation would route
    through the ops-domain registry + ops-skill catalogue + ops-runtime
    orchestrator and stream assistant deltas as notifications.
    """
    messages = params.get("messages") or []
    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    prompt_len = len((last_user or {}).get("content") or "")
    emit_notification("session.event", {
        "type": "ops/turn-started",
        "data": {"messageCount": len(messages), "promptLength": prompt_len},
    })
    emit_result(req_id, {
        "content": (
            f"[ops-python stub] received {len(messages)} messages; "
            f"user prompt length={prompt_len}. "
            f"Run id={uuid.uuid4()}"
        ),
        "tool_calls": [],
        "stop_reason": "end_turn",
        "usage": {"input": prompt_len, "output": 0},
    })


def main() -> int:
    """Read newline-delimited JSON-RPC requests from stdin, one per line."""
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
            # Notifications carry no id; we forward session.event and ignore the rest.
            if method == "session.event":
                # Parent -> child session.event is reserved for future phases.
                pass
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