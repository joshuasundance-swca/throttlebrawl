# /// script
# requires-python = ">=3.11,<3.12"
# dependencies = [
#   "torch==2.14.0", "transformers>=4.50", "accelerate", "soundfile>=0.13", "scipy", "numpy",
#   "pydantic>=2.13", "httpx>=0.28", "python-dotenv>=1.1", "tenacity>=9.1",
# ]
# [tool.uv.sources]
# torch = { index = "pytorch-cu126" }
# [[tool.uv.index]]
# name = "pytorch-cu126"
# url = "https://download.pytorch.org/whl/cu126"
# explicit = true
# ///
"""A free, local listening check of the shipped bark clips, on the dev machine's GPU.

    uv run tools/voices/scripts/check_local.py --out <file.json> [--clips <dir>] [--line <key> ...]

For every clip (or the candidates under --clips, laid out <pack>/<set>/<line>.ogg) it records:
- what two Whisper models hear (large-v3-turbo, the pipeline's own checker, and large-v3, an
  independent second ear), scored with the pipeline's own word match;
- pitch (median f0 against the rival's median), pace (characters per voiced second, as a robust
  z-score within the rival), level (LUFS and peak) and silences;
- voice consistency: a WavLM speaker embedding compared with the centroid of the rival's other
  shipped clips (a robust z-score; well below the rival's band means "sounds unlike them").

The flags are machine checks; the maintainer's ears decide. Run W-S's rule: a clip is garbled when
both models hear other words (not a homophone or a number's spelling), and off-voice when its voice
z-score is under -5 (or under -3 with a pitch outlier). Models download once to the Hugging Face cache.
"""

from __future__ import annotations

import argparse
import json
import statistics as st
import sys
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch
from scipy import signal

TOOL = Path(__file__).resolve().parents[1]
REPO = TOOL.parents[1]
sys.path.insert(0, str(TOOL / "src"))

from tbvoices import dsp  # noqa: E402
from tbvoices.cast import load_cast  # noqa: E402
from tbvoices.lines import BarkLine, read_lines, speaker_lines  # noqa: E402
from tbvoices.pipeline import f0_median, match, spoken_text  # noqa: E402

ASR_MODELS = {"turbo": "openai/whisper-large-v3-turbo", "v3": "openai/whisper-large-v3"}
SV_MODEL = "microsoft/wavlm-base-plus-sv"


def load16k(path: Path) -> tuple[np.ndarray, np.ndarray, int]:
    x, sr = sf.read(str(path), always_2d=True, dtype="float64")
    mono = x.mean(axis=1)
    return mono, signal.resample_poly(mono, 16000, sr).astype(np.float32), int(sr)


def transcribe(paths: list[Path], model: str, batch: int) -> list[str]:
    from transformers import pipeline

    asr = pipeline("automatic-speech-recognition", model=model, dtype=torch.float16, device="cuda:0")
    out: list[str] = []
    for i in range(0, len(paths), batch):
        audios = [{"raw": load16k(p)[1], "sampling_rate": 16000} for p in paths[i : i + batch]]
        gen = {"language": "english", "task": "transcribe"}
        res = asr(audios, batch_size=len(audios), generate_kwargs=gen)
        out += [str(r["text"]).strip() for r in res]
        print(f"  {model}: {len(out)}/{len(paths)}", flush=True)
    del asr
    torch.cuda.empty_cache()
    return out


def embed(paths: list[Path]) -> list[np.ndarray]:
    from transformers import AutoFeatureExtractor, WavLMForXVector

    fe = AutoFeatureExtractor.from_pretrained(SV_MODEL)
    model = WavLMForXVector.from_pretrained(SV_MODEL).to("cuda:0").eval()
    out = []
    for p in paths:
        inp = fe(load16k(p)[1], sampling_rate=16000, return_tensors="pt").to("cuda:0")
        with torch.no_grad():
            e = torch.nn.functional.normalize(model(**inp).embeddings[0], dim=-1)
        out.append(e.cpu().numpy())
    del model
    torch.cuda.empty_cache()
    return out


def measure(cast: Any, line: BarkLine, path: Path) -> dict[str, Any]:
    """Pitch, pace, level and size of one clip (no models)."""
    x, _, sr = load16k(path)
    y = dsp.resample(x, sr, dsp.SR)
    a, b = dsp.voiced_bounds(y, dsp.SR)
    spoken = spoken_text(cast, line)
    return {
        "spoken": spoken,
        "durationS": round(len(y) / dsp.SR, 3),
        "cps": round(len(spoken) / max((b - a) / dsp.SR, 0.1), 2),
        "f0": f0_median(y, dsp.SR),
        "lufs": round(dsp.loudness_lufs(y, dsp.SR), 2),
        "peakDb": round(dsp.true_peak_db(y), 2),
        "bytes": path.stat().st_size,
    }


def robust_z(values: list[float], v: float) -> float:
    med = st.median(values)
    mad = st.median([abs(x - med) for x in values]) or 1e-3
    return round((v - med) / (1.4826 * mad), 2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--clips", default="", help="check candidates laid out <pack>/<set>/<line>.ogg")
    ap.add_argument("--line", action="append", default=[], help="pack:set#line (repeatable)")
    ap.add_argument("--batch", type=int, default=8)
    args = ap.parse_args()

    cast = load_cast(TOOL / "cast.json")
    jobs: list[tuple[str, BarkLine, Path]] = []
    for sid, lines in speaker_lines(cast, read_lines(REPO)).items():
        for line in lines:
            if line.clip_path(REPO).exists():
                jobs.append((sid, line, line.clip_path(REPO)))
    shipped_paths = [p for _, _, p in jobs]
    print(f"shipped clips: {len(jobs)}", flush=True)

    targets = jobs
    if args.clips:
        root = Path(args.clips)
        targets = [
            (sid, ln, root / ln.pack / ln.set_id / f"{ln.line_id}.ogg")
            for sid, ln, _ in jobs
            if (root / ln.pack / ln.set_id / f"{ln.line_id}.ogg").exists()
        ]
    if args.line:
        targets = [t for t in targets if t[1].key in set(args.line)]
    paths = [p for _, _, p in targets]

    heard = {name: transcribe(paths, model, args.batch) for name, model in ASR_MODELS.items()}
    # The rival's voice band always comes from the shipped clips (leave-one-out for a shipped one).
    shipped_emb = dict(zip(shipped_paths, embed(shipped_paths), strict=True))
    target_emb = [shipped_emb.get(p) for p in paths]
    if any(e is None for e in target_emb):
        target_emb = embed(paths)
    sums: dict[str, np.ndarray] = {}
    for sid, _, p in jobs:
        sums[sid] = sums.get(sid, 0) + shipped_emb[p]

    def own_sim(sid: str, e: np.ndarray, loo: bool) -> float:
        c = sums[sid] - (e if loo else 0)
        return float(np.dot(e, c / np.linalg.norm(c)))

    shipped_own = {p: own_sim(sid, shipped_emb[p], True) for sid, _, p in jobs}
    shipped_m = {p: measure(cast, ln, p) for _, ln, p in jobs}
    rows: list[dict[str, Any]] = []
    for i, (sid, line, path) in enumerate(targets):
        e = target_emb[i]
        assert e is not None
        m = measure(cast, line, path)
        mine = [p for s, _, p in jobs if s == sid]
        f0s = [f for f in (shipped_m[p]["f0"] for p in mine) if f]
        sim = own_sim(sid, e, path in shipped_own)
        rows.append(
            {
                "key": line.key,
                "speaker": sid,
                "text": line.text,
                **{f"heard_{n}": h[i] for n, h in heard.items()},
                **{
                    f"match_{n}": max(match(m["spoken"], h[i]), match(line.text, h[i]))
                    for n, h in heard.items()
                },
                **m,
                "f0Ratio": round(m["f0"] / st.median(f0s), 2) if m["f0"] and f0s else None,
                "paceZ": robust_z([shipped_m[p]["cps"] for p in mine], m["cps"]),
                "voiceSim": round(sim, 4),
                "voiceZ": robust_z([shipped_own[p] for p in mine], sim),
            }
        )
    Path(args.out).write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    worst = sorted(rows, key=lambda r: (min(r["match_turbo"], r["match_v3"]), r["voiceZ"]))[:15]
    for r in worst:
        words = f"{r['match_turbo']}/{r['match_v3']}"
        print(f"{r['key']}: words {words} voiceZ {r['voiceZ']} | {r['heard_turbo']}")
    print(f"checked {len(rows)}; wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
