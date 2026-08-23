"""Keyless verification for the scenario接入 templates.

Runs three checks that prove both接入 shapes work without a model call or
network access:

1. Subagent wire — spawn `hello_subagent.py`, exchange `initialize` and
   `agent.turn`, assert the stub response is well-formed.
2. Skill frontmatter — load `hello-scenario/SKILL.md`, parse the YAML
   frontmatter, assert `name` and `description` are present.
3. Skill body — assert the file contains a Markdown body after the
   closing `---` so the Skill registry will accept the entry.

Run from the repository root:

    python3 docs/ops/templates/verify.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SUBAGENT_DIR = REPO_ROOT / "docs/ops/templates/subagent"
SKILL_DIR = REPO_ROOT / "docs/ops/templates/skill"
SKILL_ENTRY = SKILL_DIR / "hello-scenario/SKILL.md"
PYTHON_PEER = SUBAGENT_DIR / "hello_subagent.py"
BUNDLED_SKILL_ENTRY = REPO_ROOT / "packages/ops/ops-skill/skills/next-best-action/SKILL.md"


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def check_subagent_wire() -> None:
    """Exchange initialize + agent.turn with the Python peer."""
    if not PYTHON_PEER.exists():
        fail(f"missing Python peer: {PYTHON_PEER}")
    payload_init = json.dumps({
        "jsonrpc": "2.0",
        "id": "1",
        "method": "initialize",
        "params": {"agentId": "verify", "sessionId": "verify-1"},
    })
    payload_turn = json.dumps({
        "jsonrpc": "2.0",
        "id": "2",
        "method": "agent.turn",
        "params": {"messages": [{"role": "user", "content": "hello"}]},
    })
    stdin = payload_init + "\n" + payload_turn + "\n"
    completed = subprocess.run(
        ["python3", "-m", "hello_subagent"],
        input=stdin,
        capture_output=True,
        text=True,
        cwd=SUBAGENT_DIR,
        check=False,
        timeout=10,
    )
    if completed.returncode != 0:
        fail(f"python peer exit={completed.returncode}; stderr={completed.stderr}")
    frames = []
    for line in completed.stdout.splitlines():
        if not line.strip():
            continue
        try:
            frames.append(json.loads(line))
        except json.JSONDecodeError:
            fail(f"non-JSON stdout line: {line!r}")

    responses = [frame for frame in frames if frame.get("id") is not None]
    if len(responses) < 2:
        fail(f"expected >=2 JSON-RPC responses, got: {frames!r}")

    init_frame = next((frame for frame in responses if frame.get("id") == "1"), None)
    if init_frame is None:
        fail(f"initialize response id=1 missing: {frames!r}")
    if init_frame.get("result", {}).get("agentId") != "verify":
        fail(f"initialize did not echo agentId: {init_frame}")

    turn_frame = next((frame for frame in responses if frame.get("id") == "2"), None)
    if turn_frame is None:
        fail(f"agent.turn response id=2 missing: {frames!r}")
    content = turn_frame.get("result", {}).get("content", "")
    if "[hello-subagent stub]" not in content:
        fail(f"agent.turn stub content missing: {content!r}")
    print("PASS: subagent wire (initialize + agent.turn)")


def check_skill_frontmatter(path: Path, label: str) -> None:
    """Parse a SKILL.md frontmatter and assert the required keys."""
    if not path.exists():
        fail(f"missing SKILL.md: {path}")
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not match:
        fail(f"{label}: SKILL.md frontmatter not delimited by --- on separate lines")
    frontmatter_raw, body = match.group(1), match.group(2).strip()

    try:
        import yaml
    except ImportError:
        print(f"SKIP: PyYAML unavailable; cannot parse {label} SKILL.md frontmatter")
        return

    frontmatter = yaml.safe_load(frontmatter_raw)
    if not isinstance(frontmatter, dict):
        fail(f"{label}: SKILL.md frontmatter is not a mapping: {type(frontmatter).__name__}")
    name = frontmatter.get("name")
    description = frontmatter.get("description")
    if not isinstance(name, str) or not name:
        fail(f"{label}: SKILL.md frontmatter missing string `name`")
    if not isinstance(description, str) or not description:
        fail(f"{label}: SKILL.md frontmatter missing string `description`")
    if not re.fullmatch(r"[a-z][a-z0-9-]*", name):
        fail(f"{label}: SKILL.md name `{name}` is not kebab-case")
    if not body:
        fail(f"{label}: SKILL.md body is empty after the frontmatter")
    print(f"PASS: skill frontmatter ({label} name={name!r}, body={len(body)} chars)")


def main() -> int:
    check_subagent_wire()
    check_skill_frontmatter(SKILL_ENTRY, "template:hello-scenario")
    if BUNDLED_SKILL_ENTRY.exists():
        check_skill_frontmatter(BUNDLED_SKILL_ENTRY, "bundled:next-best-action")
    else:
        print(f"SKIP: bundled Skill not present yet: {BUNDLED_SKILL_ENTRY}")
    print("OK: scenario接入 templates verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
