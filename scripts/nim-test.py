#!/usr/bin/env python3
"""
Quick NIM smoke-test for any model on integrate.api.nvidia.com.
Usage:
    NVIDIA_API_KEY=nvapi-xxx python scripts/nim-test.py [model] [prompt]

Defaults:
    model  = z-ai/glm-5.1
    prompt = (read from stdin, or falls back to a hello message)

Examples:
    NVIDIA_API_KEY=nvapi-xxx python scripts/nim-test.py
    NVIDIA_API_KEY=nvapi-xxx python scripts/nim-test.py z-ai/glm-5.1 "What tools can you use?"
    echo "Plan a relay session" | NVIDIA_API_KEY=nvapi-xxx python scripts/nim-test.py moonshotai/kimi-k2.6
"""

import os
import sys

from openai import OpenAI

_TTY = sys.stdout.isatty() and os.getenv("NO_COLOR") is None
_DIM = "\033[90m" if _TTY else ""
_BOLD = "\033[1m" if _TTY else ""
_CYAN = "\033[36m" if _TTY else ""
_RESET = "\033[0m" if _TTY else ""

api_key = os.getenv("NVIDIA_API_KEY")
if not api_key:
    sys.exit("Error: NVIDIA_API_KEY is not set")

model = sys.argv[1] if len(sys.argv) > 1 else "z-ai/glm-5.1"

# Prompt: argv[2], piped stdin, or a default.
if len(sys.argv) > 2:
    prompt = sys.argv[2]
elif not sys.stdin.isatty():
    prompt = sys.stdin.read().strip()
else:
    prompt = "Hello! What can you do, and what tools do you support?"

print(f"{_DIM}model : {model}{_RESET}", file=sys.stderr)
print(f"{_DIM}prompt: {prompt[:120]}{'…' if len(prompt) > 120 else ''}{_RESET}", file=sys.stderr)
print(file=sys.stderr)

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=api_key,
)

try:
    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,   # one sampling knob — top_p AND temperature together is redundant
        max_tokens=16384,
        stream=True,
    )

    in_reasoning = False
    for chunk in completion:
        if not getattr(chunk, "choices", None) or not chunk.choices:
            continue
        delta = getattr(chunk.choices[0], "delta", None)
        if delta is None:
            continue

        # Some NIM models (Nemotron with NIM_ENABLE_THINKING=on) surface chain-of-
        # thought in a separate `reasoning_content` field. Print it dimmed.
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            if not in_reasoning:
                print(f"{_DIM}<thinking>", end="", flush=True)
                in_reasoning = True
            print(reasoning, end="", flush=True)
            continue

        if in_reasoning:
            print(f"</thinking>{_RESET}", flush=True)
            in_reasoning = False

        content = getattr(delta, "content", None)
        if content is not None:
            print(content, end="", flush=True)

    if in_reasoning:
        print(f"</thinking>{_RESET}", flush=True)
    print()  # final newline

except KeyboardInterrupt:
    print(f"\n{_DIM}(interrupted){_RESET}", file=sys.stderr)
    sys.exit(130)
except Exception as e:
    print(f"\n{_DIM}error: {e}{_RESET}", file=sys.stderr)
    sys.exit(1)
