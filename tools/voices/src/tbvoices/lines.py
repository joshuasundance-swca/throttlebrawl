"""Bark lines from the packs, and how each one is spoken.

A clip's asset id follows the line's content reference: `<pack>:bark-set/<set>#<line>` is spoken
by `packs/<pack>/assets/audio/barks/<set>/<line>.ogg`, asset id `audio/barks/<set>/<line>`. The
game finds clips by that rule, so a clip can never drift from its line.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .cast import Cast, LineOverride, Segment


@dataclass(frozen=True)
class BarkLine:
    pack: str
    set_id: str
    line_id: str
    text: str
    trigger: str
    status: str
    speaker: str
    #: The voice's own status: a vetoed voice is never generated again (the text may stay live).
    audio_status: str = "live"

    @property
    def key(self) -> str:
        """`<pack>:<set>#<line>`, the cast file's line key."""
        return f"{self.pack}:{self.set_id}#{self.line_id}"

    @property
    def content_ref(self) -> str:
        return f"{self.pack}:bark-set/{self.set_id}#{self.line_id}"

    @property
    def asset_id(self) -> str:
        return f"audio/barks/{self.set_id}/{self.line_id}"

    def clip_path(self, repo: Path) -> Path:
        return repo / "packs" / self.pack / "assets" / f"{self.asset_id}.ogg"


def read_lines(repo: Path) -> list[BarkLine]:
    """Every bark line in every pack, in pack, set and file order."""
    out: list[BarkLine] = []
    for path in sorted((repo / "packs").glob("*/barks/*.json")):
        pack = path.parent.parent.name
        data = json.loads(path.read_text(encoding="utf-8"))
        speaker = str((data.get("defaults") or {}).get("speaker", ""))
        for line in data.get("lines", []):
            out.append(
                BarkLine(
                    pack=pack,
                    set_id=str(data["id"]),
                    line_id=str(line["id"]),
                    text=str(line["text"]),
                    trigger=str(line.get("trigger", "")),
                    status=str(line.get("status", "live")),
                    speaker=str(line.get("speaker", speaker)),
                    audio_status=str(line.get("audioStatus", "live")),
                )
            )
    return out


_ELLIPSIS = re.compile(r"…|\.\.\.")


def spoken_segments(line: BarkLine, override: LineOverride | None) -> tuple[list[Segment], float]:
    """The pieces to generate for a line, and the lead silence."""
    if override and override.segments:
        return list(override.segments), override.lead_s
    text = override.spoken if override and override.spoken else line.text
    lead = override.lead_s if override else 0.0
    # Ellipses read as a pause; a leading one is silence before the line.
    if _ELLIPSIS.match(text.strip()):
        text = _ELLIPSIS.sub("", text.strip(), count=1).strip()
        lead = max(lead, 0.35)
    text = _ELLIPSIS.sub("...", text)
    return [Segment(text=text)], lead


_ACRONYM = re.compile(r"\b(?!I\b|OK\b)[A-Z]{2,}\b")


def lint_spoken(line: BarkLine, segments: list[Segment]) -> list[str]:
    """Text the models read badly. Each needs a cast-file override, so the fix is a decision."""
    problems: list[str] = []
    for seg in segments:
        t = seg.text
        if re.search(r"\d", t):
            problems.append(f"digits in {t!r}: spell the number the way the rival says it")
        if re.search(r"[—–-]\s*$", t) and seg.cut_tail_s == 0:
            problems.append(f"{t!r} ends mid-word: say the whole word and cut it with cut_tail_s")
        if "—" in t.rstrip("—– "):
            problems.append(f"{t!r} has a dash mid-line: split it into segments")
        if _ACRONYM.search(t.replace("H.R.", "").replace("I.P.", "")):
            problems.append(f"{t!r} has caps: models read them flat or as letters; respell or segment")
    return problems


def speaker_lines(cast: Cast, lines: list[BarkLine]) -> dict[str, list[BarkLine]]:
    """Live lines grouped by cast speaker (via each speaker's bark set)."""
    by_set = {sp.bark_set: sid for sid, sp in cast.speakers.items()}
    out: dict[str, list[BarkLine]] = {sid: [] for sid in cast.speakers}
    for line in lines:
        sid = by_set.get(f"{line.pack}:{line.set_id}")
        if sid is not None and line.status != "vetoed" and line.audio_status != "vetoed":
            out[sid].append(line)
    return out
