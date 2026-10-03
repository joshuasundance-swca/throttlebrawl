"""Writes each voiced line's clip and status into its bark set (the taste log the maintainer
vetoes against), plus the batch's provenance on the set. Run `npm run format` afterwards.

- `audioAsset`: the clip's asset id, by the rule the game plays by (lines.py).
- `audioStatus`: `live` when shipped; `vetoed` when the maintainer cut the voice (the clip file is
  then removed, the field and an `audioNote` stay as the record). `draft` is accepted but not acted
  on yet: the game finds clips by file, so a draft clip still plays; veto it to keep it silent.
- `meta.voice`: how the set's clips were made (models, the reference voice, the cast file), plus
  `review`, the last listening pass's picks (how many clips were kept, which lines were redone or
  cut), which this keeps. Each redone or cut line says why in its own `audioNote`.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from .cast import Cast
from .lines import BarkLine
from .pipeline import Paths


def _with_after(obj: dict[str, Any], after: str, items: dict[str, Any]) -> dict[str, Any]:
    """`obj` with `items` set, placed right after the key `after` (at the end if it is missing)."""
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if k in items:
            continue
        out[k] = v
        if k == after:
            out.update(items)
    for k, v in items.items():
        out.setdefault(k, v)
    return out


def apply_packs(p: Paths, cast: Cast, lines: list[BarkLine]) -> int:
    by_set = {sp.bark_set: (sid, sp) for sid, sp in cast.speakers.items()}
    changed = 0
    for path in sorted((p.repo / "packs").glob("*/barks/*.json")):
        pack = path.parent.parent.name
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        hit = by_set.get(f"{pack}:{data['id']}")
        if not hit:
            continue
        _, sp = hit
        before = json.dumps(data, sort_keys=True)
        voiced = 0
        new_lines = []
        for line in data["lines"]:
            bl = BarkLine(pack, str(data["id"]), str(line["id"]), str(line["text"]), "", "", "")
            clip = bl.clip_path(p.repo)
            status = str(line.get("audioStatus", "live"))
            if status == "vetoed":
                if clip.exists():
                    clip.unlink()
                new_lines.append(line)
                continue
            if clip.exists():
                voiced += 1
                line = _with_after(line, "text", {"audioAsset": bl.asset_id, "audioStatus": status})
            new_lines.append(line)
        data["lines"] = new_lines
        if voiced:
            ref = sp.reference
            meta = dict(data.get("meta") or {})
            prev = meta.get("voice") if isinstance(meta.get("voice"), dict) else {}
            meta["voice"] = {
                # Keeps what a person or a later pass recorded on the set (the `review` of kept,
                # redone and cut clips); the batch fields below are rewritten from the cast.
                **(prev or {}),
                "origin": "ai-batch",
                "batchId": cast.batch_id,
                "model": "ResembleAI/chatterbox (MIT), via fal on Hugging Face Inference Providers",
                "reference": f"hexgrad/Kokoro-82M (Apache-2.0) voice {ref.voice}, speed {ref.speed}, "
                f"pitch {ref.pitch_semis:+g} semitones; synthetic, no real person's voice",
                "promptRef": "tools/voices/cast.json",
                "generatedAt": (prev or {}).get("generatedAt", date.today().isoformat()),
            }
            data["meta"] = meta
        if json.dumps(data, sort_keys=True) != before:
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            changed += 1
    return changed


def clip_bytes(repo: Path) -> int:
    return sum(f.stat().st_size for f in (repo / "packs").glob("*/assets/audio/barks/**/*.ogg"))
