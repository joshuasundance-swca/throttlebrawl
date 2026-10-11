"""Bounded original Chatterbox auditions using explicit, already prepared cast references.

No model acquisition or shipping is performed here. Optional model imports happen only after
all input/output validation. Use an existing compatible environment; see the tool README.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata
import json
import math
import random
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import soundfile as sf

TOOL = Path(__file__).resolve().parents[1]
REPO = TOOL.parents[1]
sys.path.insert(0, str(TOOL / "src"))

from tbvoices import dsp  # noqa: E402
from tbvoices.cast import Cast, Segment, load_cast  # noqa: E402
from tbvoices.lines import BarkLine, read_lines, speaker_lines, spoken_segments  # noqa: E402
from tbvoices.pipeline import delivery_for, line_seed  # noqa: E402

MODEL_FILES = ("ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json")
SAFE_NAME = re.compile(r"[a-zA-Z0-9_-]+\Z")


@dataclass(frozen=True)
class Variant:
    name: str
    exaggeration: float
    cfg: float

    def __post_init__(self) -> None:
        if not SAFE_NAME.fullmatch(self.name):
            raise ValueError("variant name must contain only letters, digits, underscores or hyphens")
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in (self.exaggeration, self.cfg)):
            raise ValueError("variant exaggeration and cfg must be finite values in [0, 1]")


@dataclass(frozen=True)
class Job:
    speaker: str
    line: BarkLine
    reference: Path
    reference_hash: str
    segments: list[Segment]
    lead_s: float


@dataclass(frozen=True)
class Plan:
    cast: Cast
    model_dir: Path
    model_revision: str
    output: Path
    variants: list[Variant]
    jobs: list[Job]


class Generator(Protocol):
    def __call__(
        self, text: str, reference: Path, exaggeration: float, cfg: float, temperature: float, seed: int
    ) -> tuple[dsp.Audio, int]: ...


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def plan_auditions(
    repo: Path,
    model_dir: Path,
    model_revision: str,
    references: Path,
    output: Path,
    keys: list[str],
    variants: list[Variant],
) -> Plan:
    """Validate the entire batch before loading a model or creating any output."""
    repo, model_dir, references, output = (p.resolve() for p in (repo, model_dir, references, output))
    if not model_revision.strip():
        raise ValueError("explicit model revision is required")
    if not model_dir.is_dir() or any(not (model_dir / f).is_file() for f in MODEL_FILES):
        raise ValueError("model directory must contain the original English Chatterbox checkpoint files")
    if output.exists():
        raise ValueError("output already exists; overwriting auditions is refused")
    if (
        "packs" in (part.lower() for part in output.parts)
        or (output.is_relative_to(repo) and not output.is_relative_to(repo / "scratch"))
        or output.is_relative_to(model_dir)
        or output.is_relative_to(references)
    ):
        raise ValueError("output must be outside shipped files, model and reference directories")
    if not keys or len(keys) != len(set(keys)):
        raise ValueError("select nonempty, unique exact line keys")
    if not variants or len({v.name for v in variants}) != len(variants):
        raise ValueError("select nonempty, uniquely named variants")
    cast = load_cast(repo / "tools/voices/cast.json")
    available = {
        line.key: (sid, line)
        for sid, lines in speaker_lines(cast, read_lines(repo)).items()
        for line in lines
    }
    missing = set(keys) - available.keys()
    if missing:
        raise ValueError(f"unknown or vetoed exact line keys: {sorted(missing)}")
    manifest = references / "manifest.json"
    if not manifest.is_file():
        raise ValueError("reference manifest.json is required for the synthetic cast chain")
    provenance = json.loads(manifest.read_text(encoding="utf-8"))
    jobs = []
    for key in keys:
        sid, line = available[key]
        if not all(SAFE_NAME.fullmatch(s) for s in (sid, line.pack, line.set_id, line.line_id)):
            raise ValueError("unsafe line or speaker identifier")
        reference = references / f"{sid}.wav"
        if not reference.is_file():
            raise ValueError(f"missing reference for {sid}")
        ref_hash = digest(reference)
        row = provenance.get(sid, {})
        if row.get("sha256") != ref_hash or row.get("reference") != cast.speakers[sid].reference.model_dump():
            raise ValueError(f"reference provenance does not match the synthetic cast chain for {sid}")
        audio, sr = dsp.read_wav(reference)
        if sr <= 0 or len(audio) == 0 or not np.isfinite(audio).all() or not np.any(audio):
            raise ValueError(f"empty or invalid reference for {sid}")
        segments, lead = spoken_segments(line, cast.lines.get(key))
        jobs.append(Job(sid, line, reference, ref_hash, segments, lead))
    return Plan(cast, model_dir, model_revision, output, variants, jobs)


def segment_settings(plan: Plan, job: Job, segment: Segment, variant: Variant) -> tuple[float, float, float]:
    ex, cfg, temp = delivery_for(plan.cast, plan.cast.speakers[job.speaker], job.line, segment)
    override = plan.cast.lines.get(job.line.key)
    if segment.exaggeration is None and (override is None or override.exaggeration is None):
        ex = variant.exaggeration
    if segment.cfg is None and (override is None or override.cfg is None):
        cfg = variant.cfg
    return ex, cfg, temp


def render_auditions(plan: Plan, generate: Generator, package_version: str, device: str) -> dict[str, Any]:
    """Render with an injected generator; no provider or model import is needed to test this."""
    # Exclusive root creation also closes the ordinary plan-to-render overwrite race.
    plan.output.mkdir(parents=True, exist_ok=False)
    rows = []
    for job in plan.jobs:
        sp = plan.cast.speakers[job.speaker]
        for variant in plan.variants:
            folder = plan.output / variant.name / job.line.pack / job.line.set_id
            folder.mkdir(parents=True, exist_ok=True)
            parts = [dsp.silence(dsp.SR, job.lead_s)] if job.lead_s else []
            segment_rows = []
            for i, seg in enumerate(job.segments):
                ex, cfg, temp = segment_settings(plan, job, seg, variant)
                seed = line_seed(job.line, 0) + i
                x, sr = generate(seg.text, job.reference, ex, cfg, temp, seed)
                x = np.asarray(x, dtype=np.float64)
                if x.ndim != 1 or not len(x) or sr <= 0 or not np.isfinite(x).all():
                    raise ValueError("generator must return finite nonempty mono audio and a sample rate")
                raw = folder / f"{job.line.line_id}.segment-{i}.wav"
                # FLOAT preserves generator samples beyond full scale; cleanup handles the ceiling.
                sf.write(raw, x, sr, subtype="FLOAT")
                raw_row = {"path": raw.relative_to(plan.output).as_posix(), "sha256": digest(raw)}
                x = dsp.trim(dsp.highpass(dsp.resample(x, sr, dsp.SR), dsp.SR), dsp.SR, 0.06, 0.08, 50.0)
                if seg.cut_tail_s:
                    x = dsp.cut_tail(x, dsp.SR, seg.cut_tail_s)
                if seg.gap_s and parts:
                    parts.append(dsp.silence(dsp.SR, seg.gap_s))
                parts.append(x)
                segment_rows.append(
                    {
                        **seg.model_dump(),
                        "exaggeration": ex,
                        "cfg": cfg,
                        "temperature": temp,
                        "seed": seed,
                        "raw": raw_row,
                    }
                )
            parts.append(dsp.silence(dsp.SR, sp.tail_s))
            y = dsp.normalize(np.concatenate(parts), dsp.SR, plan.cast.loudness_lufs, plan.cast.peak_dbfs)
            clip = dsp.encode_opus(y, dsp.SR, plan.cast.bitrate_kbps)
            out = folder / f"{job.line.line_id}.ogg"
            out.write_bytes(clip)
            decoded, decoded_sr = dsp.read_audio(clip)
            rows.append(
                {
                    "key": job.line.key,
                    "subtitle": job.line.text,
                    "speaker": job.speaker,
                    "variant": variant.name,
                    "variantDefaults": {
                        "exaggeration": variant.exaggeration,
                        "cfg": variant.cfg,
                    },
                    "reference": {
                        "sha256": job.reference_hash,
                        "cast": sp.reference.model_dump(),
                        "syntheticModel": "hexgrad/Kokoro-82M",
                        "license": "Apache-2.0",
                        "pitchAlreadyApplied": True,
                    },
                    "segments": segment_rows,
                    "leadS": job.lead_s,
                    "tailS": sp.tail_s,
                    "output": {
                        "path": out.relative_to(plan.output).as_posix(),
                        "bytes": len(clip),
                        "sha256": digest(out),
                        "durationS": len(decoded) / decoded_sr,
                        "lufs": dsp.loudness_lufs(decoded, decoded_sr),
                        "truePeakDbfs": dsp.true_peak_db(decoded),
                    },
                    "listening": "pending",
                    "transcript": "pending",
                    "speakerContinuity": "pending",
                }
            )
    manifest = {
        "schema": 1,
        "model": {
            "source": "https://huggingface.co/ResembleAI/chatterbox",
            "license": "MIT",
            "revision": plan.model_revision,
            "package": "chatterbox-tts",
            "packageVersion": package_version,
            "device": device,
            "checkpoints": {f: digest(plan.model_dir / f) for f in MODEL_FILES},
            "watermark": "upstream Perth retained; no removal attempted",
        },
        "cleanup": {
            "sampleRate": dsp.SR,
            "highpassHz": 80,
            "trimPreS": 0.06,
            "trimPostS": 0.08,
            "trimBelowPeakDb": 50,
            "lufsTarget": plan.cast.loudness_lufs,
            "peakTargetDbfs": plan.cast.peak_dbfs,
            "opusKbps": plan.cast.bitrate_kbps,
            "outputPitchShiftSemis": 0,
        },
        "takes": rows,
    }
    (plan.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def local_generator(plan: Plan, device: str) -> tuple[Generator, str]:
    """Original 0.1.7 API only; from_local and every call carry our explicit reference."""
    package_version = importlib.metadata.version("chatterbox-tts")
    if package_version != "0.1.7":
        raise ValueError("this adapter requires the inspected original chatterbox-tts 0.1.7 API")
    torch = importlib.import_module("torch")
    chatterbox = importlib.import_module("chatterbox.tts")
    model = chatterbox.ChatterboxTTS.from_local(str(plan.model_dir), device)

    def generate(
        text: str, reference: Path, exaggeration: float, cfg: float, temperature: float, seed: int
    ) -> tuple[dsp.Audio, int]:
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        if device == "cuda":
            torch.cuda.manual_seed_all(seed)
        audio = model.generate(
            text,
            audio_prompt_path=str(reference),
            exaggeration=exaggeration,
            cfg_weight=cfg,
            temperature=temperature,
        )
        return np.asarray(audio.detach().cpu().numpy(), dtype=np.float64).reshape(-1), int(model.sr)

    return generate, package_version


def parse_variant(value: str) -> Variant:
    try:
        name, ex, cfg = value.split(":")
        return Variant(name, float(ex), float(cfg))
    except ValueError as error:
        raise argparse.ArgumentTypeError("use name:exaggeration:cfg with both controls in [0, 1]") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--line", action="append", required=True)
    parser.add_argument("--variant", type=parse_variant, action="append", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda", "mps"), required=True)
    args = parser.parse_args()
    plan = plan_auditions(
        REPO, args.model_dir, args.model_revision, args.references, args.out, args.line, args.variant
    )
    generate, version = local_generator(plan, args.device)
    render_auditions(plan, generate, version, args.device)
    print("Audition manifest written; listening, transcripts and speaker continuity remain pending.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
