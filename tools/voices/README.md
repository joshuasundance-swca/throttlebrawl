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

## Licences

Kokoro-82M is Apache-2.0; its model card lists CC BY training data (Koniwa, CC BY 3.0; SIWIS, CC BY
4.0), credited in `THIRD_PARTY_ASSETS.md`. Chatterbox is MIT, and every file it makes carries Resemble
AI's inaudible "Perth" watermark. Whisper is MIT and is used only to check the clips. The clips are
labelled AI-generated in `THIRD_PARTY_ASSETS.md`.
