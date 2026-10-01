"""Paid calls, all through the existing Hugging Face account's Inference Providers (no new
accounts or bills), each one estimated and written to a ledger BEFORE it is sent, under a hard cap.

- Kokoro-82M (Apache-2.0) via fal-ai: the speakers' reference voices. fal's page: "$0.02 per
  1,000 characters".
- Chatterbox (MIT) via fal-ai: every bark, voiced from that speaker's Kokoro reference. fal's page:
  "Your request will cost $0.025 per 1000 characters." Its default reference is a recording of a
  real cartoon voice, so a call without our own reference is refused here, never sent.
- Whisper large-v3-turbo (MIT) via hf-inference: the transcript check. Billed by compute time;
  the estimate below is a deliberate over-estimate.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

ROUTER = "https://router.huggingface.co"
KOKORO_USD_PER_CHAR = 0.02 / 1000
CHATTERBOX_USD_PER_CHAR = 0.025 / 1000
ASR_USD_PER_CALL = 0.001  # an over-estimate; hf-inference bills seconds of compute


class BudgetExceededError(RuntimeError):
    pass


class NoReferenceError(ValueError):
    pass


def load_token(env_file: Path) -> str:
    """Loads the token silently and says only whether it is there."""
    load_dotenv(env_file)
    tok = os.environ.get("HF_TOKEN", "")
    print("token present:", "yes" if tok else "no")
    if not tok:
        raise SystemExit("no HF_TOKEN: the voice pipeline needs the existing Hugging Face token")
    return tok


@dataclass
class Ledger:
    """Every paid call, one JSON line each, appended before the call goes out."""

    path: Path
    budget_usd: float
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def rows(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        return [json.loads(ln) for ln in lines if ln.strip()]

    def spent(self) -> float:
        return float(sum(float(r.get("est_usd", 0.0)) for r in self.rows()))

    def reserve(self, kind: str, est_usd: float, **info: Any) -> None:
        with self._lock:
            spent = self.spent()
            if spent + est_usd > self.budget_usd:
                raise BudgetExceededError(
                    f"{kind}: ${spent:.4f} spent + ${est_usd:.4f} would pass the ${self.budget_usd:.2f} cap"
                )
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"at": time.time(), "kind": kind, "est_usd": est_usd, **info}) + "\n")


class TransientError(Exception):
    pass


@dataclass
class Providers:
    token: str
    ledger: Ledger
    timeout_s: float = 180.0

    def _head(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    @retry(
        retry=retry_if_exception_type(TransientError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, max=20),
        reraise=True,
    )
    def _post_json(self, url: str, body: dict[str, Any]) -> dict[str, Any]:
        r = httpx.post(url, headers=self._head(), json=body, timeout=self.timeout_s)
        if r.status_code in (429, 500, 502, 503, 504):
            raise TransientError(f"HTTP {r.status_code}")
        r.raise_for_status()
        out: dict[str, Any] = r.json()
        return out

    def _fetch(self, url: str) -> bytes:
        r = httpx.get(url, timeout=120, follow_redirects=True)
        r.raise_for_status()
        return r.content

    def kokoro(self, text: str, voice: str, speed: float, lang: str = "american-english") -> bytes:
        self.ledger.reserve("kokoro", len(text) * KOKORO_USD_PER_CHAR, chars=len(text), voice=voice)
        d = self._post_json(
            f"{ROUTER}/fal-ai/fal-ai/kokoro/{lang}", {"prompt": text, "voice": voice, "speed": speed}
        )
        return self._fetch(str(d["audio"]["url"]))

    def chatterbox(
        self,
        text: str,
        reference: bytes,
        reference_mime: str,
        exaggeration: float,
        cfg: float,
        temperature: float,
        seed: int,
        key: str,
    ) -> bytes:
        if not reference:
            raise NoReferenceError("Chatterbox without our own reference voice is never sent")
        self.ledger.reserve("chatterbox", len(text) * CHATTERBOX_USD_PER_CHAR, chars=len(text), key=key)
        data_uri = f"data:{reference_mime};base64,{base64.b64encode(reference).decode('ascii')}"
        d = self._post_json(
            f"{ROUTER}/fal-ai/fal-ai/chatterbox/text-to-speech",
            {
                "text": text,
                "audio_url": data_uri,
                "exaggeration": exaggeration,
                "cfg": cfg,
                "temperature": temperature,
                "seed": seed,
            },
        )
        return self._fetch(str(d["audio"]["url"]))

    @retry(
        retry=retry_if_exception_type(TransientError),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, max=30),
        reraise=True,
    )
    def transcribe(self, flac: bytes, key: str) -> str:
        self.ledger.reserve("asr", ASR_USD_PER_CALL, key=key)
        r = httpx.post(
            f"{ROUTER}/hf-inference/models/openai/whisper-large-v3-turbo",
            headers={**self._head(), "Content-Type": "audio/flac"},
            content=flac,
            timeout=self.timeout_s,
        )
        if r.status_code in (429, 500, 502, 503, 504):
            raise TransientError(f"HTTP {r.status_code}")
        r.raise_for_status()
        return str(r.json().get("text", "")).strip()
