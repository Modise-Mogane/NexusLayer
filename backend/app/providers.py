"""AI provider adapter (backend-only credentials, deterministic fallback).

Verified configuration (live-tested 2026-11-04):
- Provider: Meta Model API, OpenAI-compatible Chat Completions.
- Default base URL: https://api.meta.ai/v1 (documented default; MODEL_BASE_URL
  overrides it). Auth: `Authorization: Bearer <MODEL_API_KEY>`.
- Model: META_MODEL (verified with `muse-spark-1.3`).
- The model spends completion budget on reasoning tokens, so calls use a
  generous max_tokens floor; `finish_reason: length` with empty content is
  reported as budget exhaustion, not success.
- `response_format: {"type": "json_object"}` is supported and used for
  structured outputs, which callers validate against Pydantic schemas.

Back-compat: META_MODEL_API_KEY is accepted as MODEL_API_KEY. Baseten is a
second OpenAI-compatible provider (base https://inference.baseten.co/v1)
selected via AI_PROVIDER=baseten with BASETEN_API_KEY + BASETEN_MODEL.
Each provider reports its own configured/verified state; verify() tests one
provider at a time with a real authenticated call.

No network call is made unless explicitly requested. Provider failures,
timeouts, and malformed responses are caught and returned as structured
errors; callers fall back to local deterministic logic. Secrets are never
logged, never returned by any endpoint, and never embedded in error strings.
"""

import json
import os
import urllib.request

TIMEOUT_S = 60
MAX_TOKENS_DEFAULT = 3000
MAX_TOKENS_FLOOR = 1500

DEFAULT_BASE_URL = "https://api.meta.ai/v1"
BASETEN_BASE_URL = "https://inference.baseten.co/v1"


def active_provider_name() -> str:
    name = (os.getenv("AI_PROVIDER") or "meta").strip().lower()
    return name if name in ("meta", "baseten") else "meta"


def provider_credentials(provider: str) -> tuple[str, str, str]:
    """Return (api_key, model, base_url) for a provider; empty when unset."""
    if provider == "baseten":
        return (
            os.getenv("BASETEN_API_KEY") or "",
            os.getenv("BASETEN_MODEL") or "",
            os.getenv("BASETEN_BASE_URL") or BASETEN_BASE_URL,
        )
    return (
        os.getenv("MODEL_API_KEY") or os.getenv("META_MODEL_API_KEY") or "",
        os.getenv("META_MODEL") or "",
        os.getenv("MODEL_BASE_URL") or DEFAULT_BASE_URL,
    )


def provider_config() -> dict:
    key, model, base_url = provider_credentials("meta")
    bkey, bmodel, burl = provider_credentials("baseten")
    return {
        "active_provider": active_provider_name(),
        "model_api_key_present": bool(key),
        "meta_model": model,
        "base_url": base_url,
        "base_url_defaulted": not bool(os.getenv("MODEL_BASE_URL")),
        "baseten_key_present": bool(bkey),
        "baseten_model": bmodel,
        "baseten_base_url": burl,
    }


def _provider_state(provider: str) -> str:
    key, model, _ = provider_credentials(provider)
    if key and model:
        return "configured"
    if key or model:
        return "partially_configured"
    return "unavailable"


def provider_status() -> dict:
    cfg = provider_config()
    active = cfg["active_provider"]
    states = {"meta": _provider_state("meta"), "baseten": _provider_state("baseten")}
    state = states[active]
    model = cfg["meta_model"] if active == "meta" else cfg["baseten_model"]
    base_url = cfg["base_url"] if active == "meta" else cfg["baseten_base_url"]
    label = "Meta Model API" if active == "meta" else "Baseten inference"
    return {
        "state": state,
        "provider": active,
        "model": model,
        "base_url": base_url,
        "mode": "ai" if state == "configured" else "local_deterministic",
        "providers": {
            name: {"state": st,
                   "model": cfg["meta_model"] if name == "meta" else cfg["baseten_model"]}
            for name, st in states.items()
        },
        "note": (
            f"Provider ready ({label})."
            if state == "configured"
            else "AI credentials incomplete; deterministic local logic active."
            if state == "unavailable"
            else "Partial credentials; deterministic local logic active."
        ),
    }


def _post_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    timeout: int = TIMEOUT_S,
    max_tokens: int = MAX_TOKENS_DEFAULT,
    json_mode: bool = False,
    temperature: float = 0.2,
) -> dict:
    """Minimal OpenAI-compatible chat request via stdlib (no SDK dependency)."""
    url = base_url.rstrip("/") + "/chat/completions"
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max(max_tokens, MAX_TOKENS_FLOOR),
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer REDACTED"},
        method="POST",
    )
    # Set the real header after construction so no request repr can leak it.
    req.add_unredirected_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_text(data: dict) -> tuple[str | None, str, str]:
    """Return (content_or_None, finish_reason, error)."""
    try:
        choices = data.get("choices") or []
        if not choices:
            return None, "", "empty_choices"
        message = choices[0].get("message") or {}
        finish = choices[0].get("finish_reason", "")
        content = message.get("content")
        if not content:
            if finish == "length":
                return None, finish, "budget_exhausted"
            return None, finish, "empty_response"
        return str(content), finish, ""
    except (AttributeError, TypeError, KeyError) as exc:
        return None, "", f"malformed_response: {type(exc).__name__}"


def chat(
    messages: list[dict],
    timeout: int = TIMEOUT_S,
    max_tokens: int = MAX_TOKENS_DEFAULT,
    temperature: float = 0.2,
    provider: str | None = None,
) -> dict:
    """Attempt a provider chat call; returns {ok, text|error, model, ...}."""
    name = provider or active_provider_name()
    key, model, base_url = provider_credentials(name)
    if not key or not model:
        return {"ok": False, "error": "provider_not_configured", "model": model}
    try:
        data = _post_chat(base_url, key, model, messages, timeout, max_tokens, False, temperature)
        text, finish, error = _extract_text(data)
        if text is None:
            return {"ok": False, "error": error, "model": model, "finish_reason": finish}
        return {"ok": True, "text": text, "model": model, "finish_reason": finish}
    except Exception as exc:  # provider failures must never crash simulation
        return {"ok": False, "error": f"{type(exc).__name__}", "model": model}


def chat_json(
    messages: list[dict],
    timeout: int = TIMEOUT_S,
    max_tokens: int = MAX_TOKENS_DEFAULT,
    temperature: float = 0.1,
    provider: str | None = None,
) -> dict:
    """Chat call with JSON object mode; returns {ok, data|error, model, ...}."""
    name = provider or active_provider_name()
    key, model, base_url = provider_credentials(name)
    if not key or not model:
        return {"ok": False, "error": "provider_not_configured", "model": model}
    try:
        data = _post_chat(base_url, key, model, messages, timeout, max_tokens, True, temperature)
        text, finish, error = _extract_text(data)
        if text is None:
            return {"ok": False, "error": error, "model": model, "finish_reason": finish}
        try:
            parsed = json.loads(_strip_fences(text))
        except json.JSONDecodeError:
            return {"ok": False, "error": "invalid_json", "model": model,
                    "finish_reason": finish}
        return {"ok": True, "data": parsed, "model": model, "finish_reason": finish}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}", "model": model}


def chat_stream(
    messages: list[dict],
    timeout: int = 120,
    max_tokens: int = MAX_TOKENS_DEFAULT,
    temperature: float = 0.2,
    provider: str | None = None,
):
    """Yield SSE text deltas from a streaming chat call (OpenAI-compatible).

    Yields dicts: {"delta": str} for content, then {"done": True, ...} or
    {"error": str}. The caller assembles the full reply for persistence.
    """
    name = provider or active_provider_name()
    key, model, base_url = provider_credentials(name)
    if not key or not model:
        yield {"error": "provider_not_configured"}
        return
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max(max_tokens, MAX_TOKENS_FLOOR),
        "stream": True,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    req.add_unredirected_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield {"delta": str(delta)}
                if choices[0].get("finish_reason"):
                    yield {"done": True, "finish_reason": choices[0]["finish_reason"],
                           "model": model}
                    return
    except Exception as exc:
        yield {"error": f"{type(exc).__name__}"}
        return
    yield {"done": True, "model": model}


def _strip_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def verify(timeout: int = 45, provider: str | None = None) -> dict:
    """Live verification ping of one provider: asks for a fixed token."""
    name = provider or active_provider_name()
    out = chat(
        [{"role": "user", "content": "Reply with exactly: LINK_OK"}],
        timeout=timeout,
        max_tokens=2000,
        temperature=0.0,
        provider=name,
    )
    if not out.get("ok"):
        return {"verified": False, "error": out.get("error"),
                "model": out.get("model", ""), "provider": name}
    text = str(out.get("text", "")).strip()
    return {
        "verified": "LINK_OK" in text,
        "model": out.get("model", ""),
        "finish_reason": out.get("finish_reason", ""),
        "provider": name,
    }
