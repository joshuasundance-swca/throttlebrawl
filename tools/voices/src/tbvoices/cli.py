"""tbvoices: plan, references, takes, pack fields, the listening page and the ledger.

uv run tbvoices plan                 # every line, how it is spoken, lint, and the cost (no calls)
uv run tbvoices refs                 # the speakers' reference voices (paid, Kokoro)
uv run tbvoices gen --speaker kevin-from-accounting --limit 3   # prove small first
uv run tbvoices gen                  # every live line without a clip
uv run tbvoices apply                # audioAsset, audioStatus and the batch on the bark sets
uv run tbvoices page --out <dir>     # the listening page for approval and veto
uv run tbvoices cost                 # the ledger
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from .cast import load_cast
from .lines import lint_spoken, read_lines, speaker_lines, spoken_segments
from .pipeline import Paths, make_reference, produce_many, spoken_text
from .providers import CHATTERBOX_USD_PER_CHAR, KOKORO_USD_PER_CHAR, Ledger, Providers, load_token


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "AGENTS.md").exists() and (parent / "packs").is_dir():
            return parent
    raise SystemExit("run inside the throttlebrawl repo")


def env_file(repo: Path) -> Path:
    # The main checkout's .env (a worktree has none of its own).
    for cand in (repo / ".env", *(p / ".env" for p in repo.parents)):
        if cand.exists():
            return cand
    return repo / ".env"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tbvoices")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan")
    refs_p = sub.add_parser("refs")
    refs_p.add_argument("--speaker", action="append")
    refs_p.add_argument("--force", action="store_true")
    gen_p = sub.add_parser("gen")
    gen_p.add_argument("--speaker", action="append")
    gen_p.add_argument("--line", action="append", help="pack:set#line")
    gen_p.add_argument("--limit", type=int, default=0)
    gen_p.add_argument("--force", action="store_true", help="redo lines that already have a clip")
    gen_p.add_argument("--max-takes", type=int, default=3)
    gen_p.add_argument("--workers", type=int, default=4)
    sub.add_parser("apply")
    page_p = sub.add_parser("page")
    page_p.add_argument("--out", required=True)
    sub.add_parser("cost")
    args = ap.parse_args(argv)

    repo = repo_root()
    p = Paths(repo)
    cast = load_cast(p.cast)
    lines = read_lines(repo)
    by_speaker = speaker_lines(cast, lines)

    if args.cmd == "plan":
        chars = 0
        problems = 0
        for sid, ls in by_speaker.items():
            print(f"\n{sid} ({len(ls)} lines)")
            for line in ls:
                segs, lead = spoken_segments(line, cast.lines.get(line.key))
                bad = lint_spoken(line, segs)
                problems += len(bad)
                chars += sum(len(s.text) for s in segs)
                mark = "  !" if bad else "   "
                print(
                    f"{mark} {line.line_id}: {spoken_text(cast, line)}"
                    + (f"  [lead {lead}s]" if lead else "")
                )
                for b in bad:
                    print(f"      {b}")
        ref_chars = sum(len(sp.reference.text) for sp in cast.speakers.values())
        cost = chars * CHATTERBOX_USD_PER_CHAR + ref_chars * KOKORO_USD_PER_CHAR
        n = sum(len(v) for v in by_speaker.values())
        print(f"\n{n} lines, {chars} chars; references {ref_chars} chars; one take each about ${cost:.3f}")
        print(f"lint problems: {problems}")
        return 1 if problems else 0

    ledger = Ledger(p.ledger, cast.budget_usd)
    if args.cmd == "cost":
        rows = ledger.rows()
        by_kind = Counter(r["kind"] for r in rows)
        usd: dict[str, float] = defaultdict(float)
        for row in rows:
            usd[row["kind"]] += float(row["est_usd"])
        for k in sorted(by_kind):
            print(f"{k}: {by_kind[k]} calls, ${usd[k]:.4f}")
        print(f"total: {len(rows)} calls, ${ledger.spent():.4f} of the ${cast.budget_usd:.2f} cap")
        return 0
    if args.cmd == "apply":
        from .apply import apply_packs

        changed = apply_packs(p, cast, lines)
        print(f"bark sets updated: {changed}")
        return 0
    if args.cmd == "page":
        from .page import build_page

        out = build_page(p, cast, lines, Path(args.out))
        print(f"page: {out}")
        return 0

    for sid in args.speaker or []:
        if sid not in cast.speakers:
            raise SystemExit(f"unknown speaker {sid}")
    prov = Providers(load_token(env_file(repo)), ledger)
    speakers = args.speaker or list(cast.speakers)
    if args.cmd == "refs":
        for sid in speakers:
            print("reference:", make_reference(p, prov, cast, sid, force=args.force).relative_to(repo))
        return 0

    # gen
    jobs = []
    for sid in speakers:
        for line in by_speaker[sid]:
            if args.line and line.key not in args.line:
                continue
            if not args.force and line.clip_path(repo).exists():
                continue
            segs, _ = spoken_segments(line, cast.lines.get(line.key))
            bad = lint_spoken(line, segs)
            if bad:
                print(f"skipped {line.key}: {bad[0]}", file=sys.stderr)
                continue
            jobs.append((sid, line))
    if args.limit:
        jobs = jobs[: args.limit]
    for sid in {s for s, _ in jobs}:
        make_reference(p, prov, cast, sid)
    print(f"lines to voice: {len(jobs)}; ledger before: ${ledger.spent():.4f}")
    results = produce_many(p, prov, cast, jobs, workers=args.workers, max_takes=args.max_takes)
    errors = [r for r in results if "error" in r]
    review = [r for r in results if r.get("review")]
    for r in errors:
        print("ERROR", r["key"], r["error"], file=sys.stderr)
    for r in review:
        print(f"review {r['key']}: match {r['match']} heard {r['heard']!r}")
    print(
        json.dumps(
            {
                "voiced": len(results) - len(errors),
                "errors": len(errors),
                "review": len(review),
                "ledger_usd": round(ledger.spent(), 4),
            }
        )
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
