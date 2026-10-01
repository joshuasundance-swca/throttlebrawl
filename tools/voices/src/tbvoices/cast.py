"""The casting manifest (tools/voices/cast.json): one consistent voice per speaker, the delivery
settings, and per-line spoken-text overrides. Pydantic models, so a typo fails loudly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Reference(Strict):
    """The speaker's reference voice: a synthetic Kokoro read, never a recording of a person."""

    voice: str = Field(description="A Kokoro-82M preset voice id, such as am_onyx.")
    lang: Literal["american-english", "british-english"] = "american-english"
    speed: float = Field(1.0, ge=0.5, le=2.0)
    pitch_semis: float = Field(0.0, ge=-6, le=6, description="Shifts the reference (timbre and size).")
    text: str = Field(min_length=80, description="An in-character passage, about 8 to 12 seconds read.")


class Delivery(Strict):
    """Chatterbox settings. exaggeration: emotion intensity; cfg: lower is slower and looser."""

    exaggeration: float = Field(0.45, ge=0.0, le=1.0)
    cfg: float = Field(0.5, ge=0.0, le=1.0)
    temperature: float = Field(0.7, ge=0.05, le=2.0)


class Speaker(Strict):
    bark_set: str = Field(description="The qualified bark-set id, such as base:deacon-core.")
    name: str
    note: str = Field(description="The character's voice in one line, for the listening page.")
    reference: Reference
    delivery: Delivery = Delivery()
    #: Extra seconds of silence after the clip (a slow speaker's breath before the next bark).
    tail_s: float = Field(0.06, ge=0.0, le=1.0)


class Segment(Strict):
    """One generated piece of a line. Pieces join with `gap_s` of silence before them."""

    text: str = Field(min_length=1)
    gap_s: float = Field(0.0, ge=0.0, le=2.0)
    #: Cuts this much voiced audio off the piece's end: a word broken off mid-way ("subscri-").
    cut_tail_s: float = Field(0.0, ge=0.0, le=1.0)
    exaggeration: float | None = Field(None, ge=0.0, le=1.0)
    cfg: float | None = Field(None, ge=0.0, le=1.0)


class LineOverride(Strict):
    """How a line is spoken when its subtitle text would trip the model."""

    spoken: str | None = None
    segments: list[Segment] | None = None
    #: Silence before the line (a leading ellipsis: "...The swamp remembers.").
    lead_s: float = Field(0.0, ge=0.0, le=2.0)
    exaggeration: float | None = Field(None, ge=0.0, le=1.0)
    cfg: float | None = Field(None, ge=0.0, le=1.0)
    note: str | None = None


class TriggerShift(Strict):
    exaggeration: float = 0.0


class Cast(Strict):
    batch_id: str
    loudness_lufs: float = Field(-17.0, ge=-30, le=-10)
    peak_dbfs: float = Field(-1.5, ge=-6, le=0)
    #: Opus at this bitrate, mono 24 kHz.
    bitrate_kbps: int = Field(24, ge=12, le=64)
    budget_usd: float = Field(gt=0)
    #: Delivery shifts by trigger (a hit taken is louder than a taunt).
    triggers: dict[str, TriggerShift] = {}
    speakers: dict[str, Speaker]
    lines: dict[str, LineOverride] = {}


def load_cast(path: Path) -> Cast:
    return Cast.model_validate(json.loads(path.read_text(encoding="utf-8")))
