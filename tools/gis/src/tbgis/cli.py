"""``tbgis probe``, ``tbgis bake`` and ``tbgis network``: the offline pipeline's commands.

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
from tbgis.fetch import FetchMeta, overpass, usgs_samples
from tbgis.fun import fun_report
from tbgis.lint import lint_bake, lint_network
from tbgis.network import NetworkConfig, bake_network
from tbgis.osm import load_ways
from tbgis.probe import report
from tbgis.stretch import F64, RealPath, build_profile, real_path, runs_of
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


def land_from_usgs(sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, FetchMeta]:
    """One line's land elevation: one 3DEP request (cached), gaps filled."""
    es, pts = sample_points(sc, rp)
    meta = usgs_samples(pts, GIS / sc.elevationExtract)
    land = parse_samples(GIS / sc.elevationExtract, len(pts))
    return es, fill_gaps(es, land, sc.elevation.minLandM), meta


def write_json(path: Path, doc: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {path.relative_to(REPO).as_posix()}")


def remove_stale(region: Path, config_ref: str, written: set[str]) -> None:
    """Removes the files an earlier bake of this same network config wrote and this one did not (a
    road renamed or a junction moved): every osm- file whose provenance names the config."""
    for folder in ("networks", "roads", "routes"):
        for path in sorted((region / folder).glob("osm-*.json")):
            if path.name in written:
                continue
            doc = json.loads(path.read_text(encoding="utf-8"))
            prov = doc.get("provenance") or doc.get("meta", {}).get("provenance") or {}
            if prov.get("tool", {}).get("configRef") == config_ref:
                path.unlink()
                print(f"removed {path.relative_to(REPO).as_posix()} (stale: no longer baked)")


def cmd_network(args: argparse.Namespace) -> int:
    cfg = NetworkConfig.load(Path(args.config))
    osm = overpass(cfg.osmQuery, GIS / cfg.osmExtract)
    ways = load_ways(GIS / cfg.osmExtract)
    out = bake_network(cfg, osm, ways, land_from_usgs, args.created_at or osm.retrievedAt[:10])
    errs = lint_network(out.network, out.roads, out.routes)
    if errs:
        for e in errs:
            print(f"lint: {e}", file=sys.stderr)
        return 1
    region = REPO / cfg.outRoot
    written = {f"{cfg.id}.json"}
    write_json(region / "networks" / f"{cfg.id}.json", out.network)
    for r in out.roads:
        write_json(region / "roads" / f"{r['id']}.json", r)
        written.add(f"{r['id']}.json")
    for rt in out.routes:
        write_json(region / "routes" / f"{rt['id']}.json", rt)
        written.add(f"{rt['id']}.json")
    remove_stale(region, f"tools/gis/networks/{cfg.id}.json", written)
    write_json(GIS / "reports" / f"{cfg.id}.network.json", out.report)  # never inside a pack folder
    print(f"network: {json.dumps(out.report)}")
    print("lint: 0 errors; now run `npm run format` at the repo root")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tbgis", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe", help="fetch (once) the Keys US 1 extract and write the probe report")
    bk = sub.add_parser("bake", help="bake one stretch config into the pack")
    bk.add_argument("config", help="path to a configs/<id>.json file")
    bk.add_argument("--created-at", help="provenance date (default: the OSM retrieval date)")
    nw = sub.add_parser("network", help="bake one real-road network config into the pack")
    nw.add_argument("config", help="path to a networks/<id>.json file")
    nw.add_argument("--created-at", help="provenance date (default: the OSM retrieval date)")
    args = ap.parse_args(argv)
    commands = {"probe": cmd_probe, "bake": cmd_bake, "network": cmd_network}
    return int(commands[args.cmd](args))


if __name__ == "__main__":
    raise SystemExit(main())
