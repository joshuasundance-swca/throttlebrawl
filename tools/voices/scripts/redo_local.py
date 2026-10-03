# /// script
# requires-python = ">=3.11,<3.12"
# dependencies = [
#   "torch==2.14.0", "kokoro>=0.9.4", "transformers>=4.50", "soundfile>=0.13", "scipy", "numpy",
#   "pydantic>=2.13", "httpx>=0.28", "python-dotenv>=1.1", "tenacity>=9.1",
#   "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
# ]
# [tool.uv.sources]
# torch = { index = "pytorch-cu126" }
# [[tool.uv.index]]
# name = "pytorch-cu126"
# url = "https://download.pytorch.org/whl/cu126"
# explicit = true
# ///
"""Free local redo takes: Kokoro-82M (Apache-2.0) on the dev machine's GPU, in the rival's own
reference voice (cast.json's preset, speed and pitch shift: the voice every Chatterbox take was
cloned from), cleaned exactly like the shipped clips (tbvoices.dsp: high-pass, trim, -17 LUFS,
the peak ceiling, Ogg Opus 24 kbps). No paid calls, no providers, no account.

    uv run tools/voices/scripts/redo_local.py --out <dir> --line <key> [--line ...] [--speeds 1,0.94,1.06]

Each speed variant is written to <dir>/t<i>/<pack>/<set>/<line>.ogg. Check them with
check_local.py --clips <dir>/t<i>, then copy the best one over the line's clip, add an
`audioNote` to the line and list it in its set's `meta.voice.review` (README, "Vetoes").
Kokoro has no seed and no emotion knob, so variants come from the speed and the spoken text
(cast.json's `lines`: a beat ("...") between words that run together is the usual fix).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

TOOL = Path(__file__).resolve().parents[1]
REPO = TOOL.parents[1]
sys.path.insert(0, str(TOOL / "src"))

from tbvoices import dsp  # noqa: E402
from tbvoices.cast import load_cast  # noqa: E402
from tbvoices.lines import read_lines, speaker_lines, spoken_segments  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--line", action="append", required=True, help="pack:set#line (repeatable)")
    ap.add_argument("--speeds", default="1.0,0.94,1.06", help="multipliers of the rival's speed")
    args = ap.parse_args()

    from kokoro import KPipeline

    cast = load_cast(TOOL / "cast.json")
    wanted = set(args.line)
    jobs = [
        (sid, ln)
        for sid, ls in speaker_lines(cast, read_lines(REPO)).items()
        for ln in ls
        if ln.key in wanted
    ]
    missing = wanted - {ln.key for _, ln in jobs}
    if missing:
        raise SystemExit(f"unknown or vetoed lines: {sorted(missing)}")
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cuda")
    out_root = Path(args.out)
    log = []
    for sid, line in jobs:
        sp = cast.speakers[sid]
        ref = sp.reference
        segments, lead = spoken_segments(line, cast.lines.get(line.key))
        for ti, mult in enumerate(float(s) for s in args.speeds.split(",")):
            parts: list[dsp.Audio] = [dsp.silence(dsp.SR, lead)] if lead else []
            for seg in segments:
                chunks = [
                    np.asarray(a.cpu().numpy() if hasattr(a, "cpu") else a, dtype=np.float64)
                    for _, _, a in pipe(seg.text, voice=ref.voice, speed=ref.speed * mult)
                ]
                # The reference chain (pipeline.make_reference): high-pass, then the pitch shift.
                x = dsp.pitch_shift(dsp.highpass(np.concatenate(chunks), dsp.SR), ref.pitch_semis)
                x = dsp.trim(x, dsp.SR, 0.06, 0.08, 50.0)
                if seg.cut_tail_s:
                    x = dsp.cut_tail(x, dsp.SR, seg.cut_tail_s)
                if seg.gap_s and parts:
                    parts.append(dsp.silence(dsp.SR, seg.gap_s))
                parts.append(x)
            parts.append(dsp.silence(dsp.SR, sp.tail_s))
            y = dsp.normalize(np.concatenate(parts), dsp.SR, cast.loudness_lufs, cast.peak_dbfs)
            clip = dsp.encode_opus(y, dsp.SR, cast.bitrate_kbps)
            out = out_root / f"t{ti}" / line.pack / line.set_id / f"{line.line_id}.ogg"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(clip)
            row = {
                "key": line.key,
                "take": ti,
                "voice": ref.voice,
                "speed": round(ref.speed * mult, 3),
                "pitch": ref.pitch_semis,
                "bytes": len(clip),
                "durationS": round(len(y) / dsp.SR, 2),
            }
            log.append(row)
            print(row, flush=True)
    (out_root / "redo.json").write_text(json.dumps(log, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
