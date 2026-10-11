# tools/voices: spoken rival barks

The offline pipeline behind the rivals' voices (the maintainer, 2026-10-01: "aim for quality,
realism, flavor, and consistency. we may need to iterate, use other models, prompting techniques,
reference audio, etc, and let me veto somehow"). It turns every live bark line in the packs into a
small Opus clip next to the pack's other assets. The game never talks to any of these services: it
plays the committed clips. CI never runs this tool; its output is gated by the unit tests
(`src/audio/bark-clips.test.ts`) and the size check like any pack file.

## How a voice is made

1. **One voice per rival.** `cast.json` gives each rival a reference voice: a short in-character
   passage read by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) in one of
   its synthetic preset voices, at a speed and a pitch shift that suit the character. No recording
   of a real person is ever used, and Chatterbox's own preset voices and default reference are never
   used either (the code refuses a call without our reference).
2. **Every line in that voice.** [Chatterbox](https://huggingface.co/ResembleAI/chatterbox) (MIT)
   speaks each line from the rival's reference, so the timbre stays the same across all of a
   rival's lines while the delivery follows the words. `exaggeration` (emotion) and `cfg` (pace)
   are set per rival and shifted per trigger: a hit taken is louder than a taunt.
3. **Lines the models trip on** get a spoken version in `cast.json`'s `lines`. The subtitle text
   never changes; only how it is said:
   - a word broken off mid-way: say the whole word, then cut its end in audio (`cut_tail_s`);
   - numbers spelled the way the rival says them ("Error four oh four");
   - a shout as a second, louder take of the same words (`segments`);
   - a leading ellipsis becomes a beat of silence.
   `tbvoices plan` lists any line that still needs one (digits, a dangling dash, capitals).
4. **A transcript check on every take.** Whisper large-v3-turbo transcribes each take; below a 0.9
   word match the line is tried again with the next seed (three takes at most) and the best one is
   kept. Each clip's pitch is also compared with its rival's reference, so a voice that drifts is
   flagged. The flags are machine checks: the maintainer's ears decide.
5. **Clean-up.** Mono, 24 kHz, an 80 Hz high-pass, silence trimmed (a generous lead pad keeps a
   soft first consonant), BS.1770 loudness normalised to -17 LUFS with a -1.5 dBFS peak ceiling,
   then Ogg Opus at 24 kbps: about 8 KB a line, 1.9 MB for all 247.
6. **Into the packs.** `tbvoices apply` writes each voiced line's `audioAsset` and `audioStatus`,
   and the batch's provenance as the set's `meta.voice`.

The clip for `<pack>:bark-set/<set>#<line>` is `packs/<pack>/assets/audio/barks/<set>/<line>.ogg`.
The game finds clips by that rule (`src/audio/bark-voices.ts`).

## Run it

It is its own small Python project, managed with [uv](https://docs.astral.sh/uv/). The paid calls
go through the existing Hugging Face account's Inference Providers, with the token in the repo's
`.env` (`HF_TOKEN`, loaded silently; the tool prints only whether it is there).

```sh
cd tools/voices
uv sync
uv run tbvoices plan                       # every line and how it is spoken, lint, the cost (no calls)
uv run tbvoices gen --speaker kevin-from-accounting --limit 3   # prove small first
uv run tbvoices gen                        # every live line without a clip
uv run tbvoices gen --line "base:kevin-core#kevin-pass-email" --force   # one new take
uv run tbvoices apply && cd ../.. && npm run format   # the pack fields
uv run tbvoices page --out ../../scratch/voices/page   # the listening page (veto and redo)
uv run tbvoices cost                       # the ledger
uv run pytest && uv run ruff check && uv run mypy
```

- **Cost.** Every paid call is estimated and written to `.cache/ledger.jsonl` before it is sent,
  and a call that would pass `cast.json`'s `budget_usd` is refused. Prices from the providers'
  pages (2026-10-01): Kokoro on fal "$0.02 per 1,000 characters", Chatterbox on fal "$0.025 per 1000
  characters"; the Whisper check is billed by compute time and counted at a deliberately high
  $0.001 a call. One pass over all 247 lines is about 7,900 characters, about $0.20 of speech.
- **Repeatable.** Each line's takes use fixed seeds, and the model's raw output is kept in
  `.cache/raw/` (git-ignored), so changing the clean-up never pays again. `takes.json` records the
  take each clip came from, what the checker heard, and why a clip is flagged.
- **Vetoes.** The listening page records Keep, Cut voice and Redo per clip and copies them out as
  text. Cut voice: set the line's `audioStatus` to `vetoed` (add an `audioNote`), then
  `tbvoices apply` removes the clip; the generator never voices it again. Redo: change the
  rival's or the line's settings in `cast.json` and run `gen --line ... --force`. A line cut in the
  game with "cut this" loses its voice with its words.

## Free local check and redo (GPU)

Two standalone scripts run on the dev machine's GPU with no provider, account or bill. Each is a
uv script with its own dependencies (CUDA PyTorch, so they never touch this project's lock); the
models download once to the Hugging Face cache.

```sh
uv run scripts/check_local.py --out ../../scratch/voices/check.json        # every shipped clip
uv run scripts/redo_local.py --out ../../scratch/voices/redo --line "base:kevin-core#kevin-pass-pin"
uv run scripts/check_local.py --out ../../scratch/voices/redo.json --clips ../../scratch/voices/redo/t0
```

- `check_local.py` transcribes each clip with Whisper large-v3-turbo (the pipeline's own checker)
  and large-v3 (a second, independent ear), and measures pitch, pace, level and voice consistency
  (a WavLM speaker embedding against the rival's other clips, as a robust z-score).
- `redo_local.py` speaks a line with Kokoro-82M in the rival's reference voice (the preset, speed
  and pitch shift every Chatterbox take was cloned from) at a few speeds, cleaned exactly like the
  shipped clips.
- Run W-S's rule (2026-10-02): a clip is **garbled** when both Whisper models hear other words (a
  homophone such as "brakes"/"breaks" or a number's spelling does not count), and **off-voice** when
  its voice z-score is under -5, or under -3 with a pitch outlier; a deliberate shout (the Mayor's
  "No comment!") is off-voice by design. A redo replaces a clip only when both models hear it right
  (homophones aside) and its voice z-score is either inside the rival's normal band (-2 or above) or
  better than the old take's. The pick goes in the line's `audioNote` and the set's
  `meta.voice.review` (`kept`, `redone`, `cut`), so the maintainer can veto it later.

## Local expressive auditions (optional environment)

`scripts/audition_local.py` compares exact existing lines with the original English
`chatterbox-tts==0.1.7` API. It requires an already downloaded model, an explicit model
revision, prepared synthetic cast references and named emotion/pace settings. It performs
no acquisition, paid calls, token loading or pack updates. Run it with a compatible existing
Python environment that also has this tool's core dependencies available:

```sh
python tools/voices/scripts/audition_local.py \
  --model-dir scratch/voices/models/chatterbox --model-revision <checkpoint-revision> \
  --references scratch/voices/refs --out scratch/voices/auditions/new-comparison \
  --device cuda --variant restrained:0.4:0.5 --variant expressive:0.7:0.4 \
  --line 'base:deacon-core#deacon-start-ditch' \
  --line 'base:kevin-core#kevin-pass-email' \
  --line 'region-pnw:juniper-core#juniper-taken-name-wrong' \
  --line 'region-sf:pivot-core#pivot-crash-burn'
```

The model directory must contain `ve.safetensors`, `t3_cfg.safetensors`,
`s3gen.safetensors` and `tokenizer.json`. The adapter calls `from_local`, then supplies an
explicit `audio_prompt_path` on every segment; Python, NumPy and Torch are seeded per
segment. Fixed seeds permit matched comparisons, but do not promise bit-identical GPU
output across environments.

Each reference is `<cast-speaker-id>.wav`, prepared by the existing synthetic-reference
chain (`pipeline.make_reference`): Kokoro preset, passage, speed and pitch, followed by its
existing DSP. The reference directory must contain `manifest.json`, keyed by cast speaker id:

```json
{
  "cast-speaker-id": {
    "sha256": "<digest-of-the-reference-wav>",
    "reference": {"voice": "<preset>", "lang": "american-english", "speed": 1.0,
                  "pitch_semis": 0.0, "text": "<exact-cast-reference-passage>"}
  }
}
```

Prepare this record with the synthetic reference, using the exact `reference.model_dump()`
from the cast. The script checks the digest and complete cast record; this validates the
declared chain, not the origin of an arbitrary recording. Never use real-person recordings.
The already applied reference pitch is not applied to generated output again.

Output must be a new directory outside packs and shipped files (within this checkout,
use `scratch/`). An existing directory is refused, including a partially failed run; keep
that evidence and choose a new directory. Files are `<variant>/<pack>/<set>/<line>.ogg`
and `.segment-<index>.wav`, plus `manifest.json`. Raw FLOAT WAVs preserve generator samples;
Opus uses the shared cleanup. The manifest records subtitle, segment words/controls,
gaps/cuts/lead/tail, reference and checkpoint digests, revision, model licence/source,
installed package version, seeds, cleanup targets and measured decoded Opus LUFS,
true peak, duration, bytes and digest. Upstream watermarking is retained; raw generation
is not de-watermarked. Listening, transcripts and speaker continuity remain pending.

Variant defaults change only segments without explicit cast line/segment controls. The
optional `base:mayor-core#mayor-down-comment` preserves its second segment's explicit
exaggeration 0.9, cfg 0.3 and 0.25-second gap in both variants. Listen to the shipped clip
and both candidates on each line before selecting; Kevin is the restraint control.
No audition is automatically applied, and the paid `apply` attribution is not suitable
for a local-model selection without a separate provenance update.

This script adds no core dependency or lockfile change. Chatterbox's upstream dependency
pins are separate from any experimentally installed compatibility environment. Successful
pure tests establish planning/DSP behavior only; Windows support, actual GPU execution,
model compatibility and emotion quality require recorded runtime and listening evidence.
See [the audition contract](../../docs/milestones/local-voice-auditions.md).

## Licences

Kokoro-82M is Apache-2.0; its model card lists CC BY training data (Koniwa, CC BY 3.0; SIWIS, CC BY
4.0), credited in `THIRD_PARTY_ASSETS.md`. Chatterbox is MIT, and every file it makes carries Resemble
AI's inaudible "Perth" watermark. Whisper is MIT and is used only to check the clips. The clips are
labelled AI-generated in `THIRD_PARTY_ASSETS.md`.
