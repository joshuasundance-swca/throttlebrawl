"""``tbgis probe`` and ``tbgis bake``: the offline pipeline's two commands.

Run from anywhere; paths resolve against tools/gis. Both fetch at most once and then read the
cache under tools/gis/.cache (git-ignored). After a bake, format the pack files with
``npm run format`` so they match the repo's Prettier style.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from tbgis.config import BakeConfig
from tbgis.elevation import fill_gaps, parse_samples, sample_points
from tbgis.emit import bake
from tbgis.fetch import overpass, usgs_samples
from tbgis.fun import fun_report
from tbgis.lint import lint_bake
from tbgis.osm import load_ways
from tbgis.probe import report
from tbgis.stretch import build_profile, real_path, runs_of
from tbgis.tmerc import Frame

GIS = Path(__file__).resolve().parents[2]
REPO = GIS.parents[1]

# The one Overpass query: every US 1 way in the Keys, with tags and geometry.
KEYS_US1_QUERY = (
    "[out:json][timeout:120];\n"
    'way["highway"]["ref"~"(^|;) ?US 1( ?;|$)"](24.54,-81.82,25.20,-80.35);\n'
    "out tags geom;"
)
KEYS_US1_CACHE = ".cache/osm/keys-us1.json"


def cmd_probe(_: argparse.Namespace) -> int:
    meta = overpass(KEYS_US1_QUERY, GIS / KEYS_US1_CACHE)
    out = GIS / "probe" / "keys-us1.md"
    out.parent.mkdir(exist_ok=True)
    text = report(load_ways(GIS / KEYS_US1_CACHE), meta, Frame(24.7, -81.1))
    out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {out.relative_to(REPO).as_posix()}")
    return 0


def out_root(cfg: BakeConfig, repo: Path = REPO) -> Path:
    """Where a bake writes: the region's pack folder, or the config's staging root."""
    if cfg.outRoot is not None:
        return repo / cfg.outRoot
    return repo / "packs" / "base" / "regions" / cfg.region


def cmd_bake(args: argparse.Namespace) -> int:
    cfg = BakeConfig.load(Path(args.config))
    osm_raw = GIS / cfg.osmExtract
    osm = overpass(cfg.osmQuery or KEYS_US1_QUERY, osm_raw)
    ways = load_ways(osm_raw)
    rp = real_path(cfg, ways)
    es, pts = sample_points(cfg, rp)
    usgs = usgs_samples(pts, GIS / cfg.elevationExtract)
    land = parse_samples(GIS / cfg.elevationExtract, len(pts))
    p = build_profile(cfg, rp, fill_gaps(es, land, cfg.elevation.minLandM), es)
    created = args.created_at or osm.retrievedAt[:10]
    network, roads, route = bake(cfg, p, osm, usgs, created)
    errs = lint_bake(network, roads, route)
    if errs:
        for e in errs:
            print(f"lint: {e}", file=sys.stderr)
        return 1
    region = out_root(cfg)
    files = [("networks", network), *(("roads", r) for r in roads), ("routes", route)]
    for folder, doc in files:
        path = region / folder / f"{doc['id']}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(REPO).as_posix()}")
    land_ok = land[np.isfinite(land) & (land > 0)]
    print(
        f"stretch: real {p.real_length:.0f} m -> game {p.s[-1]:.0f} m in {len(roads)} roads; "
        f"compressed {len(p.compressed)} straights; tightest radius {1 / np.abs(p.kappa).max():.0f} m; "
        f"elevation {p.y.min():.2f}..{p.y.max():.2f} m, max grade {100 * np.abs(p.grade).max():.1f}%; "
        f"3DEP land {land_ok.min():.2f}..{land_ok.max():.2f} m over {land_ok.size} of {land.size} samples"
    )
    for a, b in runs_of(p.bridge):
        print(f"  bridge at {p.s[a]:.0f}..{p.s[b - 1]:.0f} m ({(b - a) * p.h:.0f} m)")
    fun = fun_report(cfg, rp, p, ways)
    fun_path = GIS / "reports" / f"{cfg.id}.fun.json"  # never inside a pack folder
    fun_path.parent.mkdir(parents=True, exist_ok=True)
    fun_path.write_text(json.dumps(fun.as_dict(), indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"fun: {json.dumps(fun.as_dict())}")
    print(f"wrote {fun_path.relative_to(REPO).as_posix()}")
    print("lint: 0 errors; now run `npm run format` at the repo root")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tbgis", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe", help="fetch (once) the Keys US 1 extract and write the probe report")
    bk = sub.add_parser("bake", help="bake one stretch config into the pack")
    bk.add_argument("config", help="path to a configs/<id>.json file")
    bk.add_argument("--created-at", help="provenance date (default: the OSM retrieval date)")
    args = ap.parse_args(argv)
    return int(cmd_probe(args) if args.cmd == "probe" else cmd_bake(args))


if __name__ == "__main__":
    raise SystemExit(main())
