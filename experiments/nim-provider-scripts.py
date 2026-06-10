import requests, base64

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = False

def read_b64(path):
  with open(path, "rb") as f:
    return base64.b64encode(f.read()).decode()

headers = {
  "Authorization": "Bearer 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",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "moonshotai/kimi-k2.6",
  "messages": [{"role":"user","content":""}],
  "max_tokens": 16384,
  "temperature": 1.00,
  "top_p": 1.00,
  "stream": stream,
  
}

response = requests.post(invoke_url, headers=headers, json=payload, stream=stream)
if stream:
    for line in response.iter_lines():
        if line:
            print(line.decode("utf-8"))
else:
    print(response.json())


from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="nvidia/nemotron-3-ultra-550b-a55b",
  messages=[{"role":"user","content":""}],
  temperature=1,
  top_p=0.95,
  max_tokens=16384,
  extra_body={"chat_template_kwargs":{"enable_thinking":True},"reasoning_budget":16384},
  stream=True
)

for chunk in completion:
  if not chunk.choices:
    continue
  reasoning = getattr(chunk.choices[0].delta, "reasoning_content", None)
  if reasoning:
    print(reasoning, end="")
  if chunk.choices[0].delta.content is not None:
    print(chunk.choices[0].delta.content, end="")


from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="nvidia/nemotron-3-ultra-550b-a55b",
  messages=[{"role":"user","content":""}],
  temperature=1,
  top_p=0.95,
  max_tokens=16384,
  extra_body={"chat_template_kwargs":{"enable_thinking":True},"reasoning_budget":16384},
  stream=True
)

for chunk in completion:
  if not chunk.choices:
    continue
  reasoning = getattr(chunk.choices[0].delta, "reasoning_content", None)
  if reasoning:
    print(reasoning, end="")
  if chunk.choices[0].delta.content is not None:
    print(chunk.choices[0].delta.content, end="")

import requests, base64

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = False


headers = {
  "Authorization": "Bearer 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",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "mistralai/mistral-medium-3.5-128b",
  "reasoning_effort": "high",
  "messages": [{"role":"user","content":""}],
  "max_tokens": 16384,
  "temperature": 0.70,
  "top_p": 1.00,
  "stream": stream
}



response = requests.post(invoke_url, headers=headers, json=payload)

if stream:
    for line in response.iter_lines():
        if line:
            print(line.decode("utf-8"))
else:
    print(response.json())

import os

from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = os.getenv("NVIDIA_API_KEY", "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")
)



completion = client.chat.completions.create(
  model="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  messages=[{"role":"user","content":""}],
  temperature=0.6,
  top_p=0.95,
  max_tokens=65536,
  extra_body={"chat_template_kwargs":{"enable_thinking":True},"reasoning_budget":16384},
  stream=False
)

reasoning = getattr(completion.choices[0].message, "reasoning_content", None)
if reasoning:
  print(reasoning)
print(completion.choices[0].message.content)

from openai import OpenAI
import os
import sys

_USE_COLOR = sys.stdout.isatty() and os.getenv("NO_COLOR") is None
_REASONING_COLOR = "\033[90m" if _USE_COLOR else ""
_RESET_COLOR = "\033[0m" if _USE_COLOR else ""

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="z-ai/glm-5.1",
  messages=[{"role":"user","content":""}],
  temperature=1,
  top_p=1,
  max_tokens=16384,
  
  stream=True
)

for chunk in completion:
  if not getattr(chunk, "choices", None):
    continue
  if len(chunk.choices) == 0 or getattr(chunk.choices[0], "delta", None) is None:
    continue
  delta = chunk.choices[0].delta
  if getattr(delta, "content", None) is not None:
    print(delta.content, end="")

import requests, base64

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = False


headers = {
  "Authorization": "Bearer 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",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "mistralai/mistral-small-4-119b-2603",
  "reasoning_effort": "high",
  "messages": [{"role":"user","content":""}],
  "max_tokens": 16384,
  "temperature": 0.10,
  "top_p": 1.00,
  "stream": stream
}



response = requests.post(invoke_url, headers=headers, json=payload)

if stream:
    for line in response.iter_lines():
        if line:
            print(line.decode("utf-8"))
else:
    print(response.json())

import requests, base64

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = False

def read_b64(path):
  with open(path, "rb") as f:
    return base64.b64encode(f.read()).decode()

headers = {
  "Authorization": "Bearer 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",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "nvidia/ising-calibration-1-35b-a3b",
  "messages": [{"role":"user","content":""}],
  "max_tokens": 32768,
  "temperature": 0.20,
  "top_p": 1.00,
  "stream": stream,
  
}
response = requests.post(invoke_url, headers=headers, json=payload, stream=stream)
if stream:
    for line in response.iter_lines():
        if line:
            print(line.decode("utf-8"))
else:
    print(response.json())

from openai import OpenAI


client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
  messages=[{"role":"user","content":""}],
  temperature=1.00,
  top_p=0.01,
  max_tokens=1024,
  stream=False
)


print(completion.choices[0].message.content)
from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="deepseek-ai/deepseek-v4-pro",
  messages=[{"role":"user","content":""}],
  temperature=1,
  top_p=0.95,
  max_tokens=16384,
  extra_body={"chat_template_kwargs":{"thinking":False}},
  stream=False
)

print(completion.choices[0].message.content)


import requests, base64

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = False



headers = {
  "Authorization": "Bearer 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",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "microsoft/phi-4-multimodal-instruct",
  "messages": [{"role":"user","content":""}],
  "max_tokens": 512,
  "temperature": 0.10,
  "top_p": 0.70,
  "frequency_penalty": 0.00,
  "presence_penalty": 0.00,
  "stream": stream
}

response = requests.post(invoke_url, headers=headers, json=payload)

if stream:
    for line in response.iter_lines():
        if line:
            print(line.decode("utf-8"))
else:
    print(response.json())

from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)

completion = client.chat.completions.create(
  model="meta/llama-3.1-8b-instruct",
  messages=[{"role":"user","content":""}],
  temperature=0.2,
  top_p=0.7,
  max_tokens=1024,
  stream=False
)

# Handle both content and tool calls for non-streaming
if completion.choices[0].message.content is not None:
  print(completion.choices[0].message.content)


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


import requests, base64

invoke_url = "https://ai.api.nvidia.com/v1/vlm/google/paligemma"
stream = True

with open("dog.jpeg", "rb") as f:
    image_b64 = base64.b64encode(f.read()).decode()

assert len(image_b64) < 180_000, \
  "To upload larger images, use the assets API (see docs)"

headers = {
  "Authorization": "Bearer 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",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "messages": [
    {
      "role": "user",
      "content": f'Describe the image. <img src="data:image/jpeg;base64,{image_b64}" />'
    }
  ],
  "max_tokens": 512,
  "temperature": 1.00,
  "top_p": 0.70,
  "stream": stream
}

response = requests.post(invoke_url, headers=headers, json=payload)

if stream:
    for line in response.iter_lines():
        if line:
            print(line.decode("utf-8"))
else:
    print(response.json())
from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)

completion = client.chat.completions.create(
  model="openai/gpt-oss-120b",
  messages=[{"role":"user","content":""}],
  temperature=1,
  top_p=1,
  max_tokens=4096,
  stream=False
)

reasoning = getattr(completion.choices[0].message, "reasoning_content", None)
if reasoning:
  print(reasoning)
print(completion.choices[0].message.content)
from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)


completion = client.chat.completions.create(
  model="nvidia/nemotron-3-ultra-550b-a55b",
  messages=[{"role":"user","content":""}],
  temperature=1,
  top_p=0.95,
  max_tokens=16384,
  extra_body={"chat_template_kwargs":{"enable_thinking":True},"reasoning_budget":16384},
  stream=True
)

for chunk in completion:
  if not chunk.choices:
    continue
  reasoning = getattr(chunk.choices[0].delta, "reasoning_content", None)
  if reasoning:
    print(reasoning, end="")
  if chunk.choices[0].delta.content is not None:
    print(chunk.choices[0].delta.content, end="")
