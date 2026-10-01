"""Reference voices, takes, the transcript check, and the finished clips."""

from __future__ import annotations

import hashlib
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from . import dsp
from .cast import Cast, Segment, Speaker
from .lines import BarkLine, spoken_segments
from .numbers import digits_to_words
from .providers import Providers

#: A take is kept at once when its transcript matches this well; below it, another seed is tried.
GOOD_MATCH = 0.9
EXAGGERATION_CAP = 0.75


@dataclass
class Paths:
    repo: Path
    tool: Path = field(init=False)
    cache: Path = field(init=False)

    def __post_init__(self) -> None:
        self.tool = self.repo / "tools" / "voices"
        self.cache = self.tool / ".cache"

    @property
    def cast(self) -> Path:
        return self.tool / "cast.json"

    @property
    def takes(self) -> Path:
        return self.tool / "takes.json"

    @property
    def ledger(self) -> Path:
        return self.cache / "ledger.jsonl"

    def ref_wav(self, speaker: str) -> Path:
        return self.cache / "refs" / f"{speaker}.wav"

    def take_wav(self, line: BarkLine, seed: int) -> Path:
        return self.cache / "takes" / line.pack / line.set_id / f"{line.line_id}.s{seed}.wav"

    def raw_take(self, line: BarkLine, seed: int, segment: int, settings: str) -> Path:
        """The model's own output, kept so the clean-up can be redone without paying again."""
        return (
            self.cache / "raw" / line.pack / line.set_id / f"{line.line_id}.s{seed}.{segment}.{settings}.wav"
        )


_CONTRACTIONS = (
    (re.compile(r"(\w)in'(?=\W|$)"), r"\1ing"),  # "darlin'" is heard as "darling"
    (re.compile(r"'ve\b"), " have"),
    (re.compile(r"'ll\b"), " will"),
    (re.compile(r"'re\b"), " are"),
    (re.compile(r"\bctrl\b"), "control"),
)


def words(text: str) -> list[str]:
    t = digits_to_words(text.lower().replace("’", "'"))
    for pat, rep in _CONTRACTIONS:
        t = pat.sub(rep, t)
    t = re.sub(r"<[a-z ]+>", " ", t).replace("—", " ").replace("-", " ").replace(".", " ")
    # Apostrophes drop out: Whisper hears "Line's moving" as "Lines moving".
    return re.findall(r"[a-z]+", t.replace("'", "").replace("’", ""))


def match(spoken: str, heard: str) -> float:
    return round(SequenceMatcher(None, words(spoken), words(heard)).ratio(), 3)


def f0_median(x: dsp.Audio, sr: int) -> float | None:
    """A crude autocorrelation pitch over voiced 40 ms frames (60-400 Hz)."""
    n = int(0.04 * sr)
    hop = n // 2
    thr = 0.3 * float(np.sqrt(np.mean(x**2)))
    f0s: list[float] = []
    lo, hi = int(sr / 400), int(sr / 60)
    for i in range(0, len(x) - n, hop):
        fr = x[i : i + n] - np.mean(x[i : i + n])
        if float(np.sqrt(np.mean(fr**2))) < thr:
            continue
        ac = np.correlate(fr, fr, "full")[n - 1 :]
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.45 * ac[0]:
            f0s.append(sr / k)
    return round(float(np.median(f0s)), 1) if f0s else None


def flac(x: dsp.Audio, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1, 1), sr, format="FLAC", subtype="PCM_16")
    return buf.getvalue()


# ---- References --------------------------------------------------------------------------------


def make_reference(p: Paths, prov: Providers, cast: Cast, sid: str, force: bool = False) -> Path:
    """The speaker's reference: a Kokoro read of their passage, cleaned, shifted and normalised."""
    out = p.ref_wav(sid)
    if out.exists() and not force:
        return out
    ref = cast.speakers[sid].reference
    raw = prov.kokoro(ref.text, ref.voice, ref.speed, ref.lang)
    x, sr = dsp.read_audio(raw)
    x = dsp.resample(x, sr, dsp.SR)
    x = dsp.pitch_shift(dsp.highpass(x, dsp.SR), ref.pitch_semis)
    x = dsp.trim(x, dsp.SR, 0.05, 0.2)
    x = dsp.normalize(x, dsp.SR, -20.0, -3.0)
    dsp.write_wav(out, x, dsp.SR)
    return out


# ---- Takes -------------------------------------------------------------------------------------


def line_seed(line: BarkLine, attempt: int) -> int:
    """A stable seed per line (the same line always starts from the same take)."""
    h = 0
    for ch in line.key:
        h = (h * 131 + ord(ch)) % 2_000_000_011
    return 1 + (h + attempt * 7919) % 2_000_000_000


def delivery_for(cast: Cast, sp: Speaker, line: BarkLine, seg: Segment) -> tuple[float, float, float]:
    ov = cast.lines.get(line.key)
    shift = cast.triggers.get(line.trigger)
    # Past about 0.8 the voice drifts away from its reference (higher, a different person), so the
    # speaker's level plus the trigger's shift stops there; an explicit override may go further.
    ex = min(EXAGGERATION_CAP, sp.delivery.exaggeration + (shift.exaggeration if shift else 0.0))
    if ov and ov.exaggeration is not None:
        ex = ov.exaggeration
    if seg.exaggeration is not None:
        ex = seg.exaggeration
    cfg = seg.cfg if seg.cfg is not None else (ov.cfg if ov and ov.cfg is not None else sp.delivery.cfg)
    return round(min(1.0, max(0.0, ex)), 3), cfg, sp.delivery.temperature


def render_take(p: Paths, prov: Providers, cast: Cast, sid: str, line: BarkLine, seed: int) -> dsp.Audio:
    sp = cast.speakers[sid]
    ref_bytes = flac(*dsp.read_wav(p.ref_wav(sid)))
    segments, lead = spoken_segments(line, cast.lines.get(line.key))
    parts: list[dsp.Audio] = [dsp.silence(dsp.SR, lead)] if lead else []
    for i, seg in enumerate(segments):
        ex, cfg, temp = delivery_for(cast, sp, line, seg)
        # The cache key covers everything the model hears, so a changed line or setting pays again.
        settings = hashlib.sha1(
            json.dumps([seg.text, sp.reference.model_dump(), ex, cfg, temp]).encode("utf-8")
        ).hexdigest()[:10]
        cached = p.raw_take(line, seed, i, settings)
        if cached.exists():
            raw = cached.read_bytes()
        else:
            raw = prov.chatterbox(
                seg.text, ref_bytes, "audio/flac", ex, cfg, temp, seed + i, key=f"{line.key}/s{seed}/{i}"
            )
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(raw)
        x, sr = dsp.read_audio(raw)
        # A generous lead pad and a low threshold keep a soft first consonant ("Kin", "Fare's").
        x = dsp.trim(dsp.highpass(dsp.resample(x, sr, dsp.SR), dsp.SR), dsp.SR, 0.06, 0.08, 50.0)
        if seg.cut_tail_s:
            x = dsp.cut_tail(x, dsp.SR, seg.cut_tail_s)
        if seg.gap_s and parts:
            parts.append(dsp.silence(dsp.SR, seg.gap_s))
        parts.append(x)
    parts.append(dsp.silence(dsp.SR, sp.tail_s))
    y = np.concatenate(parts)
    return dsp.normalize(y, dsp.SR, cast.loudness_lufs, cast.peak_dbfs)


def spoken_text(cast: Cast, line: BarkLine) -> str:
    segs, _ = spoken_segments(line, cast.lines.get(line.key))
    return " ".join(s.text for s in segs)


def produce_line(
    p: Paths, prov: Providers, cast: Cast, sid: str, line: BarkLine, max_takes: int = 3
) -> dict[str, Any]:
    """Takes until one transcribes well (or the takes run out); the best one becomes the clip."""
    spoken = spoken_text(cast, line)
    segments, _ = spoken_segments(line, cast.lines.get(line.key))
    cut = any(s.cut_tail_s for s in segments)
    tried: list[dict[str, Any]] = []
    best: tuple[float, dsp.Audio, dict[str, Any]] | None = None
    for attempt in range(max_takes):
        seed = line_seed(line, attempt)
        y = render_take(p, prov, cast, sid, line, seed)
        dsp.write_wav(p.take_wav(line, seed), y, dsp.SR)
        heard = prov.transcribe(flac(y, dsp.SR), key=f"{line.key}/s{seed}")
        # Whisper writes numbers as digits ("Error 404"), so the subtitle text counts as a match too.
        score = max(match(spoken, heard), match(line.text, heard))
        info = {"seed": seed, "heard": heard, "match": score, "durationS": round(len(y) / dsp.SR, 2)}
        tried.append(info)
        if best is None or score > best[0]:
            best = (score, y, info)
        if score >= GOOD_MATCH:
            break
    assert best is not None
    score, y, info = best
    clip = dsp.encode_opus(y, dsp.SR, cast.bitrate_kbps)
    out = line.clip_path(p.repo)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(clip)
    sp = cast.speakers[sid]
    ex, cfg, _ = delivery_for(cast, sp, line, segments[0])
    f0 = f0_median(y, dsp.SR)
    ref_f0 = f0_median(*dsp.read_wav(p.ref_wav(sid)))
    # The clip should sit near its reference's pitch: far off means the voice drifted (or the
    # provider ignored the reference), so a person listens before it ships.
    drift = bool(f0 and ref_f0 and not 0.7 <= f0 / ref_f0 <= 1.45)
    reasons = [
        r
        for r, on in (("transcript", score < GOOD_MATCH), ("cut-off word", cut), ("pitch drift", drift))
        if on
    ]
    return {
        "key": line.key,
        "speaker": sid,
        "text": line.text,
        "spoken": spoken,
        "seed": info["seed"],
        "match": score,
        "heard": info["heard"],
        "takes": len(tried),
        "tried": tried,
        "durationS": info["durationS"],
        "bytes": len(clip),
        "lufs": round(dsp.loudness_lufs(y, dsp.SR), 1),
        "peakDb": round(dsp.true_peak_db(y), 2),
        "f0": f0,
        "refF0": ref_f0,
        "exaggeration": ex,
        "cfg": cfg,
        "review": reasons,
    }


def load_takes(p: Paths) -> dict[str, dict[str, Any]]:
    if not p.takes.exists():
        return {}
    rows: dict[str, dict[str, Any]] = json.loads(p.takes.read_text(encoding="utf-8"))
    return rows


def save_takes(p: Paths, rows: dict[str, dict[str, Any]]) -> None:
    p.takes.write_text(json.dumps(dict(sorted(rows.items())), indent=2) + "\n", encoding="utf-8")


def produce_many(
    p: Paths,
    prov: Providers,
    cast: Cast,
    jobs: list[tuple[str, BarkLine]],
    workers: int = 4,
    max_takes: int = 3,
) -> list[dict[str, Any]]:
    rows = load_takes(p)

    def one(job: tuple[str, BarkLine]) -> dict[str, Any]:
        sid, line = job
        try:
            return produce_line(p, prov, cast, sid, line, max_takes)
        except Exception as e:
            return {"key": line.key, "speaker": sid, "error": f"{type(e).__name__}: {str(e)[:300]}"}

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(one, jobs))
    for r in results:
        if "error" not in r:
            rows[r["key"]] = {k: v for k, v in r.items() if k != "key"}
    save_takes(p, rows)
    return results
