"""The voice pipeline's offline parts: spoken text, lint, clean-up, loudness, encoding, the cap."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from tbvoices import dsp
from tbvoices.cast import LineOverride, Segment, load_cast
from tbvoices.lines import BarkLine, lint_spoken, read_lines, speaker_lines, spoken_segments
from tbvoices.numbers import digits_to_words, int_words
from tbvoices.pipeline import match, words
from tbvoices.providers import BudgetExceededError, Ledger, NoReferenceError, Providers

REPO = Path(__file__).resolve().parents[3]
SR = dsp.SR


def line(text: str, line_id: str = "x") -> BarkLine:
    return BarkLine("base", "kevin-core", line_id, text, "overtake", "live", "kevin-from-accounting")


def tone(seconds: float, hz: float = 200.0, amp: float = 0.3) -> dsp.Audio:
    t = np.arange(int(seconds * SR)) / SR
    return np.asarray(amp * np.sin(2 * np.pi * hz * t), dtype=np.float64)


def test_numbers_read_as_words() -> None:
    assert int_words(22) == "twenty-two"
    assert int_words(404) == "four hundred four"
    assert int_words(1996) == "one thousand nine hundred ninety-six"
    assert digits_to_words("Error 404, 56k") == "Error four hundred four, fifty-sixk"


def test_transcript_match_ignores_case_punctuation_apostrophes_and_digits() -> None:
    assert match("Line's moving. You're not.", "Lines moving. You're not.") == 1.0
    assert match("Twenty-two years.", "22 years") == 1.0
    assert words("Per my last email: move.") == ["per", "my", "last", "email", "move"]
    assert match("Pray the ditch is soft, sinner.", "Pray the ditch of soft, sinner.") < 1.0


def test_the_clip_rule_follows_the_content_reference() -> None:
    bl = line("Per my last email: move.", "kevin-pass-email")
    assert bl.content_ref == "base:bark-set/kevin-core#kevin-pass-email"
    assert bl.asset_id == "audio/barks/kevin-core/kevin-pass-email"
    assert (
        bl.clip_path(Path("/r")).as_posix()
        == "/r/packs/base/assets/audio/barks/kevin-core/kevin-pass-email.ogg"
    )


def test_lint_catches_what_the_models_read_badly() -> None:
    def problems(text: str) -> list[str]:
        segs, _ = spoken_segments(line(text), None)
        return lint_spoken(line(text), segs)

    assert problems("Per my last email: move.") == []
    assert any("digits" in p for p in problems("Error 404. Dignity not found."))
    assert any("mid-word" in p for p in problems("DON'T PICK UP THE—"))
    assert any("caps" in p for p in problems("No comment. NO COMMENT."))
    assert problems("Flagging that for H.R.") == []
    # A cut segment is the fix for a mid-word line.
    seg = [Segment(text="Smash that subscribe.", cut_tail_s=0.25)]
    assert lint_spoken(line("Smash that subscri—"), seg) == []


def test_a_leading_ellipsis_becomes_silence() -> None:
    segs, lead = spoken_segments(line("…The swamp remembers."), None)
    assert [s.text for s in segs] == ["The swamp remembers."]
    assert lead >= 0.3
    segs, lead = spoken_segments(line("Buffering… buffering… hit."), None)
    assert segs[0].text == "Buffering... buffering... hit." and lead == 0
    ov = LineOverride(spoken="Fifty-six K and still in first.")
    assert spoken_segments(line("56k and still in first."), ov)[0][0].text == ov.spoken


def test_the_cast_covers_every_bark_set_and_lints_clean() -> None:
    cast = load_cast(REPO / "tools" / "voices" / "cast.json")
    lines = read_lines(REPO)
    sets = {f"{bl.pack}:{bl.set_id}" for bl in lines}
    assert sets == {sp.bark_set for sp in cast.speakers.values()}
    groups = speaker_lines(cast, lines)
    for sid, ls in groups.items():
        assert ls, sid
        for bl in ls:
            segs, _ = spoken_segments(bl, cast.lines.get(bl.key))
            assert lint_spoken(bl, segs) == [], bl.key
    # Every override names a real line.
    keys = {bl.key for bl in lines}
    assert set(cast.lines) <= keys
    # One voice per speaker: no two speakers share a reference voice and pitch.
    refs = [(sp.reference.voice, sp.reference.pitch_semis) for sp in cast.speakers.values()]
    assert len(refs) == len(set(refs))


def test_trim_keeps_a_short_pad_and_cut_tail_breaks_the_word_off() -> None:
    x = np.concatenate([np.zeros(SR), tone(1.0), np.zeros(SR)])
    y = dsp.trim(x, SR, 0.03, 0.1)
    assert 1.1 < len(y) / SR < 1.2
    z = dsp.cut_tail(tone(1.0), SR, 0.25)
    assert abs(len(z) / SR - 0.75) < 0.02


def test_loudness_normalises_and_the_limiter_holds_the_ceiling() -> None:
    quiet = tone(2.0, amp=0.02)
    loud = tone(2.0, amp=0.9)
    for x in (quiet, loud):
        y = dsp.normalize(x, SR, -17.0, -1.5)
        assert abs(dsp.loudness_lufs(y, SR) - -17.0) < 0.6
        assert dsp.true_peak_db(y) <= -1.5
    # A sine at full scale reads about -3 LUFS (K-weighted 1 kHz is near unity).
    assert abs(dsp.loudness_lufs(tone(2.0, 1000.0, 1.0), SR) - -3.0) < 0.5


def test_opus_clips_are_small_and_decode() -> None:
    data = dsp.encode_opus(tone(2.0), SR, 24)
    assert 4_000 < len(data) < 9_000
    y, sr = dsp.read_audio(data)
    assert sr in dsp.OPUS_RATES and abs(len(y) / sr - 2.0) < 0.05


def test_the_ledger_refuses_a_call_over_the_cap(tmp_path: Path) -> None:
    ledger = Ledger(tmp_path / "ledger.jsonl", budget_usd=0.01)
    ledger.reserve("kokoro", 0.006, chars=300)
    with pytest.raises(BudgetExceededError):
        ledger.reserve("chatterbox", 0.005, chars=200)
    assert ledger.spent() == pytest.approx(0.006)
    assert len(ledger.rows()) == 1


def test_chatterbox_is_never_sent_without_our_reference(tmp_path: Path) -> None:
    prov = Providers("token", Ledger(tmp_path / "l.jsonl", 1.0))
    with pytest.raises(NoReferenceError):
        prov.chatterbox("Hi.", b"", "audio/flac", 0.5, 0.5, 0.7, 1, key="k")
    # Refused before anything was reserved or sent.
    assert prov.ledger.rows() == []
