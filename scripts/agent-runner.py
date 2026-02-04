#!/usr/bin/env python3
"""
Agent runner with session memory.

Runs Claude in a loop, displays formatted output, saves raw JSON,
and auto-injects relevant context from past sessions.

Usage:
    ./scripts/agent-runner.py              # Run 100 iterations
    ./scripts/agent-runner.py --loops 5    # Run 5 iterations
    ./scripts/agent-runner.py --search "array bounds"  # Search past sessions
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ANSI colors
DIM_ITALIC = "\033[90m\033[3m"
RESET = "\033[0m"

SESSION_DIR = Path("agent-state/sessions")
CONTEXT_FILE = Path("agent-state/session-context.md")

# Keywords that indicate learnings/fixes
LEARNING_KEYWORDS = [
    "fixed",
    "the issue was",
    "root cause",
    "mistake",
    "bug was",
    "problem was",
    "solution:",
    "should have",
    "instead of",
    "the real issue",
    "actually the",
    "turns out",
]


def ensure_dirs():
    SESSION_DIR.mkdir(parents=True, exist_ok=True)


def extract_learnings_from_sessions(max_sessions=20, max_learnings=10):
    """Extract recent learnings from past sessions"""
    if not SESSION_DIR.exists():
        return []

    learnings = []
    session_files = sorted(SESSION_DIR.glob("*.jsonl"), reverse=True)[:max_sessions]

    for session_file in session_files:
        try:
            with open(session_file) as f:
                for line in f:
                    try:
                        event = json.loads(line)
                        if event.get("type") != "assistant":
                            continue

                        for content in event.get("message", {}).get("content", []):
                            if content.get("type") == "text":
                                text = content.get("text", "")
                                text_lower = text.lower()

                                # Check if this looks like a learning
                                if any(kw in text_lower for kw in LEARNING_KEYWORDS):
                                    # Skip if too short or too long
                                    if 50 < len(text) < 1000:
                                        learnings.append(
                                            {"file": session_file.name, "text": text}
                                        )
                    except json.JSONDecodeError:
                        pass
        except Exception:
            pass

    return learnings[:max_learnings]


def generate_context_file():
    """Generate a context file with learnings from past sessions"""
    learnings = extract_learnings_from_sessions()

    if not learnings:
        # No learnings yet, create minimal context
        content = """# Session Context (Auto-Generated)

No learnings extracted from past sessions yet. This file will populate as you run more sessions.
"""
    else:
        content = """# Session Context (Auto-Generated)

These are automatically extracted insights from recent sessions. Review if relevant to current task.

## Recent Learnings from Past Sessions

"""
        for i, l in enumerate(learnings, 1):
            content += f"### From {l['file']}\n"
            content += f"{l['text'][:500]}\n\n"

    CONTEXT_FILE.write_text(content)
    return len(learnings)


def format_event(event, iteration):
    """Format a Claude stream-json event for display"""
    timestamp = datetime.now().strftime("%H:%M:%S")

    if event.get("type") != "assistant":
        return None

    message = event.get("message", {})
    contents = message.get("content", [])

    lines = []
    for content in contents:
        if content.get("type") == "text":
            text = content.get("text", "")
            lines.append(f"{timestamp} [{iteration}] {text}")
        elif content.get("type") == "tool_use":
            name = content.get("name", "")
            inp = content.get("input", {})
            detail = (
                inp.get("command")
                or inp.get("file_path")
                or inp.get("pattern")
                or inp.get("query")
                or ", ".join(inp.keys())
            )
            timeout_str = f" timeout: {inp['timeout']}" if inp.get("timeout") else ""
            lines.append(
                f"{DIM_ITALIC}  {timestamp} [{iteration}] {name} {detail}{timeout_str}{RESET}"
            )

    return "\n".join(lines) if lines else None


def run_session(iteration):
    """Run one Claude session with auto-injected context"""
    session_file = (
        SESSION_DIR
        / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_session_{iteration}.jsonl"
    )

    # Generate context from past sessions BEFORE starting
    num_learnings = generate_context_file()

    # The prompt now tells Claude to read the context file too
    prompt = f"""Execute AGENT_TASK.md

IMPORTANT: Also read agent-state/session-context.md - it contains {num_learnings} auto-extracted learnings from past sessions that may be relevant."""

    cmd = [
        "claude",
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--print",
        prompt,
    ]

    print(f"\n{'='*60}")
    print(
        f"Session {iteration} | {num_learnings} learnings injected | {session_file.name}"
    )
    print(f"{'='*60}\n")

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
        )

        with open(session_file, "w") as f:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue

                # Save raw JSON
                f.write(line + "\n")
                f.flush()

                # Parse and display formatted
                try:
                    event = json.loads(line)
                    formatted = format_event(event, iteration)
                    if formatted:
                        print(formatted)
                except json.JSONDecodeError:
                    pass

        proc.wait()
        return proc.returncode

    except KeyboardInterrupt:
        print(f"\n\nSession {iteration} interrupted")
        proc.terminate()
        return 1


def search_sessions(query):
    """Search past sessions for relevant content"""
    if not SESSION_DIR.exists():
        print("No sessions found")
        return

    query_words = set(query.lower().split())
    results = []

    for session_file in sorted(SESSION_DIR.glob("*.jsonl")):
        try:
            with open(session_file) as f:
                for line_num, line in enumerate(f):
                    try:
                        event = json.loads(line)
                        if event.get("type") != "assistant":
                            continue

                        for content in event.get("message", {}).get("content", []):
                            if content.get("type") == "text":
                                text = content.get("text", "")
                                text_lower = text.lower()
                                matches = sum(1 for w in query_words if w in text_lower)
                                if matches > 0:
                                    results.append(
                                        {
                                            "file": session_file.name,
                                            "line": line_num,
                                            "score": matches,
                                            "text": text[:500],
                                        }
                                    )
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            print(f"Error reading {session_file}: {e}")

    results.sort(key=lambda x: -x["score"])

    if not results:
        print(f"No results found for: {query}")
        return

    print(f"\nFound {len(results)} matches for: {query}\n")
    for r in results[:10]:
        print(f"--- {r['file']} (score: {r['score']}) ---")
        print(r["text"][:300])
        print()


def main():
    parser = argparse.ArgumentParser(description="Run Claude agent with session memory")
    parser.add_argument("--loops", type=int, default=100, help="Number of iterations")
    parser.add_argument("--search", type=str, help="Search past sessions")
    args = parser.parse_args()

    ensure_dirs()

    if args.search:
        search_sessions(args.search)
        return

    print(f"Agent Runner with Memory")
    print(f"Sessions saved to: {SESSION_DIR}/")
    print(f"Context injected from: {CONTEXT_FILE}")

    for i in range(1, args.loops + 1):
        try:
            run_session(i)
        except KeyboardInterrupt:
            print(f"\n\nStopped after {i-1} sessions")
            break


if __name__ == "__main__":
    main()
