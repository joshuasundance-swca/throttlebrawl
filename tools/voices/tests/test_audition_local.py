"""Auditions are bounded, reference-conditioned and independent of installed model packages."""

from __future__ import annotations

import importlib.util
import json
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from tbvoices import dsp
from tbvoices.cast import load_cast

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "tools/voices/scripts/audition_local.py"


def module() -> Any:
    spec = importlib.util.spec_from_file_location("audition_local", SCRIPT)
    assert spec and spec.loader
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


def inputs(tmp_path: Path) -> tuple[Path, Path]:
    model, refs = tmp_path / "model", tmp_path / "refs"
    model.mkdir()
    refs.mkdir()
    for filename in ("ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json"):
        (model / filename).write_bytes(b"fake checkpoint; never loaded")
    (refs / "manifest.json").write_text("{}", encoding="utf-8")
    return model, refs


def reference(audition: Any, refs: Path, sid: str) -> None:
    cast = load_cast(REPO / "tools/voices/cast.json")
    t = np.arange(dsp.SR) / dsp.SR
    dsp.write_wav(refs / f"{sid}.wav", 0.2 * np.sin(2 * np.pi * 180 * t), dsp.SR)
    rows = json.loads((refs / "manifest.json").read_text(encoding="utf-8"))
    rows[sid] = {
        "sha256": audition.digest(refs / f"{sid}.wav"),
        "reference": cast.speakers[sid].reference.model_dump(),
    }
    (refs / "manifest.json").write_text(json.dumps(rows), encoding="utf-8")


def test_missing_reference_is_rejected_before_generation(tmp_path: Path) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    with pytest.raises(ValueError, match="reference"):
        audition.plan_auditions(
            REPO,
            model,
            "explicit-revision",
            refs,
            tmp_path / "out",
            ["base:kevin-core#kevin-pass-email"],
            [audition.Variant("restrained", 0.4, 0.5)],
        )
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("key", ["kevin-pass-email", "base:kevin-core#unknown"])
def test_keys_are_exact_not_substring_matches(tmp_path: Path, key: str) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    with pytest.raises(ValueError, match="unknown or vetoed"):
        audition.plan_auditions(
            REPO, model, "rev", refs, tmp_path / "out", [key], [audition.Variant("b", 0.4, 0.5)]
        )


def test_vetoed_voice_is_rejected(tmp_path: Path) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    repo = tmp_path / "repo"
    cast = repo / "tools/voices/cast.json"
    cast.parent.mkdir(parents=True)
    cast.write_bytes((REPO / "tools/voices/cast.json").read_bytes())
    path = repo / "packs/base/barks/kevin-core.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "id": "kevin-core",
                "lines": [
                    {"id": "kevin-pass-email", "text": "Per my last email: move.", "audioStatus": "vetoed"},
                ],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="unknown or vetoed"):
        audition.plan_auditions(
            repo,
            model,
            "rev",
            refs,
            tmp_path / "out",
            ["base:kevin-core#kevin-pass-email"],
            [audition.Variant("b", 0.4, 0.5)],
        )


@pytest.mark.parametrize("failure", ["model", "revision", "packs", "tracked", "existing", "hash", "cast"])
def test_validation_refuses_unsafe_or_unproven_inputs(tmp_path: Path, failure: str) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    sid = "kevin-from-accounting"
    reference(audition, refs, sid)
    output, revision = tmp_path / "out", "revision"
    if failure == "model":
        model = tmp_path / "absent"
    elif failure == "revision":
        revision = ""
    elif failure == "packs":
        output = tmp_path / "packs/audition"
    elif failure == "tracked":
        output = REPO / "tools/voices/forbidden-audition"
    elif failure == "existing":
        output.mkdir()
    else:
        rows = json.loads((refs / "manifest.json").read_text(encoding="utf-8"))
        rows[sid]["sha256" if failure == "hash" else "reference"] = "wrong"
        (refs / "manifest.json").write_text(json.dumps(rows), encoding="utf-8")
    with pytest.raises(ValueError):
        audition.plan_auditions(
            REPO,
            model,
            revision,
            refs,
            output,
            ["base:kevin-core#kevin-pass-email"],
            [audition.Variant("b", 0.4, 0.5)],
        )


def test_segments_controls_cleanup_seeds_and_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    cast = load_cast(REPO / "tools/voices/cast.json")
    sid = next(s for s, sp in cast.speakers.items() if sp.bark_set == "base:mayor-core")
    reference(audition, refs, sid)
    key = "base:mayor-core#mayor-down-comment"
    plan = audition.plan_auditions(
        REPO,
        model,
        "pinned-revision",
        refs,
        tmp_path / "out",
        [key],
        [audition.Variant("b", 0.4, 0.5), audition.Variant("c", 0.7, 0.4)],
    )
    # Add a contract-valid lead/cut in memory to exercise the same processing as other cast lines.
    plan.jobs[0].segments[0].cut_tail_s = 0.1
    plan = replace(plan, jobs=[replace(plan.jobs[0], lead_s=0.12)])
    calls: list[tuple[str, Path, float, float, float, int]] = []

    def fake(text: str, ref: Path, ex: float, cfg: float, temp: float, seed: int) -> tuple[dsp.Audio, int]:
        calls.append((text, ref, ex, cfg, temp, seed))
        t = np.arange(dsp.SR) / dsp.SR
        return np.asarray(0.2 * np.sin(2 * np.pi * 180 * t), dtype=np.float64), dsp.SR

    def no_pitch(*args: Any, **kwargs: Any) -> Any:
        pytest.fail("auditions must not pitch-shift a cast reference or generated output again")

    monkeypatch.setattr(dsp, "pitch_shift", no_pitch)
    shipped = plan.jobs[0].line.clip_path(REPO)
    before = audition.digest(shipped)
    manifest = audition.render_auditions(plan, fake, "test-fake", "cpu")
    assert audition.digest(shipped) == before
    assert [c[0] for c in calls[:2]] == [s.text for s in plan.jobs[0].segments]
    assert calls[1][2:4] == (0.9, 0.3)
    assert calls[3][2:4] == (0.9, 0.3)
    assert calls[0][2:4] == (0.4, 0.5) and calls[2][2:4] == (0.7, 0.4)
    assert [c[5] for c in calls[:2]] == [c[5] for c in calls[2:]]
    assert calls[1][5] == calls[0][5] + 1
    assert all(c[1] == refs.resolve() / f"{sid}.wav" for c in calls)
    assert manifest["model"]["declaredRevision"] == "pinned-revision"
    assert manifest["provenanceStatus"] == "declared; byte hashes checked, origin not authenticated"
    assert manifest["model"]["declaredSource"] == "https://huggingface.co/ResembleAI/chatterbox"
    assert manifest["model"]["declaredLicense"] == "MIT"
    assert manifest["model"]["watermarkPolicy"] == "upstream generator unchanged; survival not measured"
    assert "source" not in manifest["model"] and "watermark" not in manifest["model"]
    assert manifest["model"]["packageVersion"] == "test-fake"
    assert manifest["model"]["checkpoints"] == plan.checkpoint_hashes
    assert plan.checkpoint_hashes == {name: audition.digest(model / name) for name in audition.MODEL_FILES}
    take = manifest["takes"][0]
    assert take["subtitle"] == plan.jobs[0].line.text
    assert take["leadS"] == 0.12 and take["tailS"] == cast.speakers[sid].tail_s
    assert take["segments"][1]["gap_s"] == 0.25
    assert take["segments"][0]["cut_tail_s"] == 0.1
    assert take["reference"]["cast"] == cast.speakers[sid].reference.model_dump()
    assert take["reference"]["declaredSyntheticModel"] == "hexgrad/Kokoro-82M"
    assert take["reference"]["declaredLicense"] == "Apache-2.0"
    assert take["reference"]["sha256"] == audition.digest(refs / f"{sid}.wav")
    assert take["listening"] == take["transcript"] == take["speakerContinuity"] == "pending"
    clip = plan.output / take["output"]["path"]
    decoded, sr = dsp.read_audio(clip.read_bytes())
    assert take["output"]["sha256"] == audition.digest(clip)
    assert take["output"]["lufs"] == pytest.approx(dsp.loudness_lufs(decoded, sr))
    assert take["output"]["truePeakDbfs"] == pytest.approx(dsp.true_peak_db(decoded))
    assert len(decoded) / sr == pytest.approx(2 - 0.1 + 0.25 + 0.12 + cast.speakers[sid].tail_s, abs=0.03)
    # Leading silence and between-segment silence survive cleanup/encoding.
    assert np.max(np.abs(decoded[: int(0.08 * sr)])) < 0.001
    gap_start = int((0.12 + 0.9 + 0.04) * sr)
    assert np.max(np.abs(decoded[gap_start : gap_start + int(0.12 * sr)])) < 0.001
    assert len(list(plan.output.rglob("*.wav"))) == len(calls)
    assert len(list(plan.output.rglob("*.ogg"))) == len(plan.variants)
    assert json.loads((plan.output / "manifest.json").read_text(encoding="utf-8")) == manifest
    with pytest.raises(FileExistsError):
        audition.render_auditions(plan, fake, "test-fake", "cpu")
    assert len(calls) == 4


def test_original_adapter_uses_only_local_model_explicit_reference_and_seeded_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    reference(audition, refs, "kevin-from-accounting")
    plan = audition.plan_auditions(
        REPO,
        model,
        "rev",
        refs,
        tmp_path / "out",
        ["base:kevin-core#kevin-pass-email"],
        [audition.Variant("b", 0.4, 0.5)],
    )
    calls: list[dict[str, Any]] = []
    seeds: list[int] = []

    class Tensor:
        def detach(self) -> Tensor:
            return self

        def cpu(self) -> Tensor:
            return self

        def numpy(self) -> dsp.Audio:
            return np.asarray([np.random.random()], dtype=np.float64)

    class LocalModel:
        sr = 24000

        @staticmethod
        def from_local(directory: str, device: str) -> LocalModel:
            assert directory == str(model.resolve()) and device == "cuda"
            return LocalModel()

        def generate(self, text: str, **kwargs: Any) -> Tensor:
            calls.append({"text": text, **kwargs})
            return Tensor()

    torch = SimpleNamespace(manual_seed=seeds.append, cuda=SimpleNamespace(manual_seed_all=seeds.append))
    imports: list[str] = []

    def fake_import(name: str) -> Any:
        imports.append(name)
        return {"torch": torch, "chatterbox.tts": SimpleNamespace(ChatterboxTTS=LocalModel)}[name]

    monkeypatch.setattr(audition.importlib, "import_module", fake_import)
    monkeypatch.setattr(audition.importlib.metadata, "version", lambda name: "0.1.7")
    generate, version = audition.local_generator(plan, "cuda")
    ref = plan.jobs[0].reference
    a, sr = generate("Same words.", ref, 0.4, 0.5, 0.7, 456)
    b, _ = generate("Same words.", ref, 0.4, 0.5, 0.7, 456)
    assert np.array_equal(a, b) and sr == 24000
    assert imports == ["torch", "chatterbox.tts"] and version == "0.1.7"
    assert seeds == [456, 456, 456, 456]
    assert (
        calls
        == [
            {
                "text": "Same words.",
                "audio_prompt_path": str(ref),
                "exaggeration": 0.4,
                "cfg_weight": 0.5,
                "temperature": 0.7,
            }
        ]
        * 2
    )


def test_cli_validates_before_optional_model_loading(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    audition = module()
    model, refs = inputs(tmp_path)

    def forbidden(*args: Any) -> Any:
        pytest.fail("model loading must not run before reference validation")

    monkeypatch.setattr(audition, "local_generator", forbidden)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            str(SCRIPT),
            "--model-dir",
            str(model),
            "--model-revision",
            "rev",
            "--references",
            str(refs),
            "--out",
            str(tmp_path / "out"),
            "--line",
            "base:kevin-core#kevin-pass-email",
            "--variant",
            "b:0.4:0.5",
            "--device",
            "cpu",
        ],
    )
    with pytest.raises(ValueError, match="reference"):
        audition.main()
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("collision", ["variant", "line"])
def test_casefold_output_collisions_are_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, collision: str
) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    reference(audition, refs, "kevin-from-accounting")
    key = "base:kevin-core#kevin-pass-email"
    keys = [key]
    variants = [audition.Variant("b", 0.4, 0.5)]
    if collision == "variant":
        variants.append(audition.Variant("B", 0.7, 0.4))
    else:
        lines = audition.read_lines(REPO)
        line = next(line for line in lines if line.key == key)
        alias = replace(line, line_id=line.line_id.upper())
        keys.append(alias.key)
        monkeypatch.setattr(audition, "read_lines", lambda repo: [*lines, alias])
    with pytest.raises(ValueError, match="case-insensitive"):
        audition.plan_auditions(REPO, model, "rev", refs, tmp_path / "out", keys, variants)
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("changed", ["model", "reference"])
@pytest.mark.parametrize("stage", ["before-load", "before-generation", "completion"])
def test_input_mutations_are_rejected_without_publishing_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, changed: str, stage: str
) -> None:
    audition = module()
    model, refs = inputs(tmp_path)
    reference(audition, refs, "kevin-from-accounting")
    plan = audition.plan_auditions(
        REPO,
        model,
        "rev",
        refs,
        tmp_path / "out",
        ["base:kevin-core#kevin-pass-email"],
        [audition.Variant("b", 0.4, 0.5)],
    )
    target = model / "ve.safetensors" if changed == "model" else plan.jobs[0].reference
    if stage != "completion":
        target.write_bytes(b"changed after planning")

    def forbidden(*args: Any) -> Any:
        pytest.fail("mutated inputs must be rejected before model loading or generation")

    if stage == "before-load":
        monkeypatch.setattr(audition.importlib.metadata, "version", forbidden)
        with pytest.raises(ValueError, match="changed"):
            audition.local_generator(plan, "cpu")
    else:

        def fake(*args: Any) -> tuple[dsp.Audio, int]:
            if stage == "before-generation":
                forbidden()
            target.write_bytes(b"changed during generation")
            t = np.arange(dsp.SR) / dsp.SR
            return np.asarray(0.2 * np.sin(2 * np.pi * 180 * t), dtype=np.float64), dsp.SR

        with pytest.raises(ValueError, match="changed"):
            audition.render_auditions(plan, fake, "fake", "cpu")
    assert not (plan.output / "manifest.json").exists()
