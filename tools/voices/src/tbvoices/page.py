"""The listening page: every clip by rival, with its line, how it was spoken, the automated
check, and Keep / Cut voice / Redo buttons plus a note. Self-contained (clips embedded), so it
can be opened from disk or published as is. Picks stay in the browser and copy out as plain text
for the agent who applies them (`audioStatus: "vetoed"` plus `audioNote`, or a new take)."""

from __future__ import annotations

import base64
import html
import json
from pathlib import Path
from typing import Any

from . import dsp
from .cast import Cast
from .lines import BarkLine, speaker_lines
from .pipeline import Paths, load_takes, spoken_text

CSS = """
:root { --bg:#f3f1ea; --paper:#fffdf6; --fg:#16171a; --muted:#5b5e63; --rule:#d6d2c4; --accent:#b3261e;
  --keep:#1f6f43; --cut:#b3261e; --redo:#8a5a00; --chip:#ebe6d6; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#121315; --paper:#1b1d20; --fg:#ecebe6;
  --muted:#a6a8ab; --rule:#33363a; --accent:#f07167; --keep:#5fc58d; --cut:#f07167; --redo:#e0b050; --chip:#26292d;
  color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#121315; --paper:#1b1d20; --fg:#ecebe6; --muted:#a6a8ab; --rule:#33363a; --accent:#f07167;
  --keep:#5fc58d; --cut:#f07167; --redo:#e0b050; --chip:#26292d; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 860px; margin: 0 auto; padding: 18px 16px 80px; }
h1 { font-size: 1.7rem; margin: 4px 0 6px; letter-spacing: -0.01em; }
h2 { font-size: 1.25rem; margin: 0; }
p { margin: 6px 0; }
.lede { color: var(--muted); }
.bar { position: sticky; top: 0; z-index: 2; background: var(--bg); padding: 8px 0; border-bottom: 1px solid var(--rule);
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bar .count { color: var(--muted); font-size: 0.9rem; margin-right: auto; }
button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--rule); background: var(--paper);
  color: var(--fg); padding: 6px 10px; min-height: 40px; }
button[aria-pressed="true"].keep { background: var(--keep); border-color: var(--keep); color: #fff; }
button[aria-pressed="true"].cut { background: var(--cut); border-color: var(--cut); color: #fff; }
button[aria-pressed="true"].redo { background: var(--redo); border-color: var(--redo); color: #fff; }
button.filter[aria-pressed="true"] { outline: 2px solid var(--accent); }
.rival { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; margin: 16px 0; }
.rival header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; }
.rival .who { color: var(--muted); font-size: 0.92rem; }
.rival .ref { margin: 8px 0 4px; font-size: 0.9rem; color: var(--muted); }
audio { width: 100%; height: 36px; margin: 4px 0; }
.clip { border-top: 1px solid var(--rule); padding: 10px 0; }
.clip .line { font-weight: 650; font-size: 1.05rem; }
.clip .meta { color: var(--muted); font-size: 0.85rem; overflow-wrap: anywhere; }
.chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 1px 8px; font-size: 0.78rem;
  margin-right: 4px; }
.chip.flag { background: var(--redo); color: #fff; }
.picks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.picks input { flex: 1 1 200px; min-width: 0; font: inherit; padding: 6px 8px; border-radius: 8px;
  border: 1px solid var(--rule); background: var(--bg); color: var(--fg); min-height: 40px; }
.hidden { display: none; }
textarea { width: 100%; min-height: 140px; font: 13px/1.4 ui-monospace, Consolas, monospace; background: var(--paper);
  color: var(--fg); border: 1px solid var(--rule); border-radius: 8px; padding: 8px; }
"""

JS = """
const DATA = JSON.parse(document.getElementById('data').textContent);
const KEY = 'tb-voice-picks-' + DATA.batch;
let picks = {};
try { picks = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { picks = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) {} render(); };
const root = document.getElementById('rivals');
let onlyFlagged = false;
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
function build() {
  for (const r of DATA.rivals) {
    const box = el('section', { class: 'rival', id: r.id });
    const playAll = el('button', { onclick: () => playSeq(box) }, 'Play all');
    box.append(el('header', {}, el('h2', {}, r.name), el('span', { class: 'who' }, r.note), playAll));
    box.append(el('p', { class: 'ref' }, 'Reference voice (synthetic): ' + r.reference));
    if (r.refAudio) box.append(el('audio', { controls: '', preload: 'none', src: r.refAudio }));
    for (const c of r.clips) {
      const flags = c.review.map((f) => el('span', { class: 'chip flag' }, f));
      const meta = el('div', { class: 'meta' },
        el('span', { class: 'chip' }, c.trigger), ...flags,
        c.spoken !== c.text ? 'Spoken as: \\u201c' + c.spoken + '\\u201d. ' : '',
        'Heard by the checker: \\u201c' + c.heard + '\\u201d (match ' + c.match + '). ',
        c.durationS + ' s, ' + Math.round(c.bytes / 102.4) / 10 + ' KB. ' + c.ref);
      const note = el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note for ' + c.text });
      note.value = (picks[c.ref] && picks[c.ref].note) || '';
      note.addEventListener('change', () => { picks[c.ref] = { ...(picks[c.ref] || {}), note: note.value }; save(); });
      const pick = (v) => () => { const cur = picks[c.ref] || {}; picks[c.ref] = { ...cur, verdict: cur.verdict === v ? '' : v }; save(); };
      const row = el('div', { class: 'picks' },
        el('button', { class: 'keep', 'data-v': 'keep', onclick: pick('keep') }, 'Keep'),
        el('button', { class: 'cut', 'data-v': 'cut', onclick: pick('cut') }, 'Cut voice'),
        el('button', { class: 'redo', 'data-v': 'redo', onclick: pick('redo') }, 'Redo'),
        note);
      const audio = el('audio', { controls: '', preload: 'none', src: c.audio });
      box.append(el('div', { class: 'clip', 'data-ref': c.ref, 'data-flagged': c.review.length ? '1' : '0' },
        el('div', { class: 'line' }, c.text), audio, meta, row));
    }
    root.append(box);
  }
}
function playSeq(box) {
  const list = [...box.querySelectorAll('.clip:not(.hidden) audio')];
  let i = 0;
  const next = () => { if (i >= list.length) return; const a = list[i++]; a.onended = next; a.play().catch(() => {}); };
  next();
}
function render() {
  let n = 0, k = 0, c = 0, r = 0;
  for (const clip of document.querySelectorAll('.clip')) {
    const p = picks[clip.dataset.ref] || {};
    for (const b of clip.querySelectorAll('button[data-v]')) b.setAttribute('aria-pressed', String(p.verdict === b.dataset.v));
    clip.classList.toggle('hidden', onlyFlagged && clip.dataset.flagged !== '1');
    n++; if (p.verdict === 'keep') k++; if (p.verdict === 'cut') c++; if (p.verdict === 'redo') r++;
  }
  document.getElementById('count').textContent = n + ' clips: ' + k + ' kept, ' + c + ' cut, ' + r + ' to redo';
  const lines = [];
  for (const [ref, p] of Object.entries(picks)) {
    if (!p.verdict && !p.note) continue;
    lines.push((p.verdict || 'note').toUpperCase() + ' ' + ref + (p.note ? ' \\u2014 ' + p.note : ''));
  }
  document.getElementById('out').value = 'Voice picks (' + DATA.batch + '):\\n' + (lines.join('\\n') || '(none yet)');
}
document.getElementById('flagged').addEventListener('click', (e) => {
  onlyFlagged = !onlyFlagged; e.currentTarget.setAttribute('aria-pressed', String(onlyFlagged)); render();
});
document.getElementById('copy').addEventListener('click', async () => {
  const t = document.getElementById('out');
  try { await navigator.clipboard.writeText(t.value); document.getElementById('copy').textContent = 'Copied'; }
  catch (e) { t.select(); }
});
build();
render();
"""


def _data_uri(path: Path) -> str:
    return "data:audio/ogg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def build_page(p: Paths, cast: Cast, lines: list[BarkLine], out_dir: Path) -> Path:
    takes = load_takes(p)
    groups = speaker_lines(cast, lines)
    rivals: list[dict[str, Any]] = []
    total = 0
    for sid, sp in cast.speakers.items():
        ref_audio = ""
        ref_wav = p.ref_wav(sid)
        if ref_wav.exists():
            x, sr = dsp.read_wav(ref_wav)
            ref_audio = "data:audio/ogg;base64," + base64.b64encode(dsp.encode_opus(x, sr, 24)).decode(
                "ascii"
            )
        clips = []
        for line in groups[sid]:
            clip = line.clip_path(p.repo)
            t = takes.get(line.key)
            if not clip.exists() or not t:
                continue
            total += 1
            clips.append(
                {
                    "ref": line.content_ref,
                    "text": line.text,
                    "spoken": spoken_text(cast, line),
                    "trigger": line.trigger,
                    "heard": t.get("heard", ""),
                    "match": t.get("match", 0),
                    "review": t.get("review") or [],
                    "durationS": t.get("durationS", 0),
                    "bytes": clip.stat().st_size,
                    "audio": _data_uri(clip),
                }
            )
        r = sp.reference
        rivals.append(
            {
                "id": sid,
                "name": sp.name,
                "note": sp.note,
                "reference": f"Kokoro-82M {r.voice}, speed {r.speed}, pitch {r.pitch_semis:+g} semitones",
                "refAudio": ref_audio,
                "clips": clips,
            }
        )
    data = json.dumps({"batch": cast.batch_id, "rivals": rivals}).replace("</", "<\\/")
    flagged = sum(1 for rv in rivals for c in rv["clips"] if c["review"])
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rival Voice Check</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<h1>Rival voice check</h1>
<p class="lede">Every spoken bark in the game, by rival ({total} clips, batch {html.escape(cast.batch_id)}). Each rival
has one voice, cloned from a synthetic reference voice (no real person's voice). Listen, then tap
<b>Keep</b>, <b>Cut voice</b> (the subtitle stays, the voice goes) or <b>Redo</b> (a new take), add a
note if you like, and send me the copied list. Nothing waits for this: the clips are already in the game,
and a cut or redo lands in the next build. The checker's transcript and the flags are machine checks;
your ears decide. {flagged} clips carry a flag worth a listen first.</p>
<div class="bar"><span class="count" id="count"></span>
<button class="filter" id="flagged" aria-pressed="false">Flagged only</button>
<button id="copy">Copy my picks</button></div>
<div id="rivals"></div>
<h2>Your picks</h2>
<p class="lede">Paste this into chat.</p>
<textarea id="out" readonly aria-label="Your picks as text"></textarea>
</div>
<script id="data" type="application/json">{data}</script>
<script>{JS}</script>
</body>
</html>
"""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "voices.html"
    out.write_text(page, encoding="utf-8")
    return out
