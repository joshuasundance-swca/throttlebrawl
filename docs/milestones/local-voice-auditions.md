# Local expressive voice auditions

`[default]` Compare selected existing lines using an already downloaded original English
Chatterbox model and each speaker's existing synthetic Kokoro reference. This is an
audition tool: selection and listening remain separate from shipping clips.

## Automated acceptance

- Require an existing model directory, explicit revision, reference directory, new output
  directory outside packs, exact line keys and named exaggeration/cfg variants. Reject
  missing model/reference files and unknown or vetoed keys before model loading.
- Reject case-only duplicate variant names and case-folded collisions of every planned
  raw WAV/Opus path before loading, including on case-insensitive host mounts.
- Use only `ChatterboxTTS.from_local`; never download, load a token, select a default
  reference, fall back to a provider or write shipped content.
- Reuse cast selection, spoken segments, stable line seeds and shared DSP. Preserve each
  subtitle, segment word, gap, cut, lead and tail. Explicit segment and line controls
  override variant defaults. Never shift an already shifted reference or output again.
- Keep raw segment WAVs, cleaned Opus and a manifest in the requested new directory;
  refuse overwrite. Record cast/reference digest, declared model revision/licence/source,
  installed package version, per-segment settings/seeds, cleanup targets and decoded Opus
  measurements. Distinguish declared origin from measured byte identity; never claim origin
  authentication or watermark survival. Listening remains pending.
- Capture checkpoint hashes during planning and recheck model/reference bytes before
  model loading/generation and at completion. Input mutation rejects manifest publication.
- Pure injected-generator tests cover missing references, exact/vetoed selection, segmented
  controls, gaps/cuts/lead/tail, seeds, no double pitch, output boundaries, overwrite refusal
  provenance declarations, case-folded collisions and input mutations. No real model runs
  belong to the unit gate.

## Listening acceptance

Compare the shipped clip with restrained and expressive takes of Deacon's ditch line,
Kevin's email line, Juniper's name line and Pivot's burn-rate line. Optionally compare the
Mayor's segmented comment. Judge character continuity, words, intended turn and artifacts;
Kevin is the restraint control. Generated files alone establish no delivery-quality verdict.

## Compatibility boundary

The optional model environment is separate from the core tool lock. Upstream dependency
pins and experimentally installed dependencies are distinct evidence. Windows support,
GPU compatibility and expressive quality require an actual runtime probe and listening.
