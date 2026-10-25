"""The preserved inputs and selected geometry are the regeneration oracle."""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.geometry import Point, Polygon  # type: ignore[import-untyped]
from shapely.ops import unary_union  # type: ignore[import-untyped]

from . import recipe

MANIFEST = Path(__file__).parent / "eagle-point" / "manifest.json"
MANIFESTS = sorted(Path(__file__).parent.glob("*/manifest.json"))
CachedBake = Callable[[Path], tuple[recipe.LoadedInputs, recipe.Mesh]]


@pytest.mark.parametrize(
    "manifest_path",
    MANIFESTS,
    ids=lambda path: path.parent.name,
)
def test_every_shipped_manifest_loads_its_exact_committed_inputs(manifest_path: Path) -> None:
    # Input hashes describe committed canonical bytes. Historical source-capture
    # hashes remain provenance; no terrain bake or geometry fingerprint update is needed.
    recipe.load_inputs(manifest_path)


@pytest.fixture(scope="module")
def cached_bake() -> CachedBake:
    baked: dict[Path, tuple[recipe.LoadedInputs, recipe.Mesh]] = {}

    def get(manifest_path: Path) -> tuple[recipe.LoadedInputs, recipe.Mesh]:
        if manifest_path not in baked:
            inputs = recipe.load_inputs(manifest_path)
            baked[manifest_path] = inputs, recipe.bake(inputs)
        return baked[manifest_path]

    return get


@pytest.fixture(scope="module")
def generated(cached_bake: CachedBake) -> recipe.Mesh:
    return cached_bake(MANIFEST)[1]


@pytest.mark.parametrize("manifest_path", MANIFESTS, ids=lambda path: path.parent.name)
def test_every_shipped_manifest_regenerates_its_selected_geometry(
    manifest_path: Path, cached_bake: CachedBake
) -> None:
    inputs, mesh = cached_bake(manifest_path)
    assert recipe.geometry_sha256(mesh) == inputs.manifest.expected_geometry_sha256, (
        f"{manifest_path.parent.name}: regenerated geometry differs from its selected manifest"
    )


def test_regeneration_matches_selected_float32_geometry(generated: recipe.Mesh) -> None:
    inputs = recipe.load_inputs(MANIFEST)
    assert recipe.geometry_sha256(generated) == inputs.manifest.expected_geometry_sha256
    recipe.validate_mesh(generated)


def test_shipped_network_uses_the_reviewed_physical_geometry() -> None:
    root = Path(__file__).resolve().parents[3]
    # Use the same public, hash-verified materializer as Node pack checks and Vite.
    # This integration check needs repository Node; the standalone recipe does not.
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Network integration check needs the repository Node installation")
    result = subprocess.run(
        [
            node,
            "--input-type=module",
            "-e",
            "import { readFileSync } from 'node:fs';"
            "import path from 'node:path';"
            "const [modulePath, root, relative] = process.argv.slice(1);"
            "const { packInputs } = await import(modulePath);"
            "process.stdout.write(packInputs(root).materialize(relative,"
            "readFileSync(path.join(root, relative), 'utf8')));",
            (root / "scripts/pack-inputs.mjs").as_uri(),
            str(root),
            "packs/region-clinton/regions/clinton-iowa/networks/osm-clinton-eagle-point.json",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    network = json.loads(result.stdout)
    mesh = recipe.Mesh.model_validate(network["terrain"])
    expected = recipe.load_inputs(MANIFEST).manifest.expected_geometry_sha256
    assert recipe.geometry_sha256(mesh) == expected
    assert network["provenance"]["terrain"]["geometrySha256"] == expected


def test_short_decimals_preserve_every_selected_vertex_bit(generated: recipe.Mesh) -> None:
    encoded = recipe.encode_mesh(generated)
    decoded = recipe.Mesh.model_validate_json(encoded)
    assert recipe.geometry_sha256(decoded) == recipe.geometry_sha256(generated)
    assert encoded == recipe.encode_mesh(generated)
    assert json.loads(encoded)["patches"]


def test_successful_regeneration_writes_matching_mesh_and_proof(tmp_path: Path) -> None:
    output, proof_path = tmp_path / "mesh.json", tmp_path / "proof.json"
    proof = recipe.regenerate(MANIFEST, output, proof_path)
    decoded = recipe.Mesh.model_validate_json(output.read_bytes())
    assert recipe.geometry_sha256(decoded) == proof["geometry_sha256"]
    assert recipe.sha256(output) == proof["json_sha256"]
    assert json.loads(proof_path.read_bytes()) == proof
    coverage = proof["coverage"]
    assert isinstance(coverage, dict)
    assert coverage["world_missing_area_m2"] == 0


@pytest.mark.parametrize("value", [0.0, -0.0, 1e-30, -0.123456789, 177.440093994, 800.0, 3.4028234e38])
def test_short_decimal_roundtrips_float32(value: float) -> None:
    selected = recipe.f32(value)
    assert struct.pack("<f", float(recipe.float32_decimal(selected))) == struct.pack("<f", selected)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_coordinate_is_refused(value: float) -> None:
    with pytest.raises(ValueError, match="finite"):
        recipe.float32_decimal(value)


def test_validation_failure_preserves_both_existing_outputs(tmp_path: Path) -> None:
    output, proof = tmp_path / "mesh.json", tmp_path / "proof.json"
    output.write_bytes(b"existing mesh")
    proof.write_bytes(b"existing proof")
    bad_manifest = tmp_path / "manifest.json"
    bad_manifest.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError):
        recipe.regenerate(bad_manifest, output, proof)
    assert output.read_bytes() == b"existing mesh"
    assert proof.read_bytes() == b"existing proof"


def test_output_cannot_replace_a_preserved_input(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="input"):
        recipe.regenerate(MANIFEST, MANIFEST, tmp_path / "proof.json")


def test_mismatched_selected_geometry_preserves_outputs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output, proof = tmp_path / "mesh.json", tmp_path / "proof.json"
    output.write_bytes(b"existing mesh")
    proof.write_bytes(b"existing proof")
    inputs = recipe.load_inputs(MANIFEST)
    inputs.manifest.expected_geometry_sha256 = "0" * len(inputs.manifest.expected_geometry_sha256)
    monkeypatch.setattr(recipe, "load_inputs", lambda _path: inputs)
    with pytest.raises(ValueError, match="selected geometry"):
        recipe.regenerate(MANIFEST, output, proof)
    assert output.read_bytes() == b"existing mesh"
    assert proof.read_bytes() == b"existing proof"


def test_float32_collapse_is_refused() -> None:
    mesh = recipe.Mesh(
        patches=[
            recipe.Patch(
                surface="grass", vertices=[(0, 0, 0), (1e-50, 0, 0), (0, 0, 1)], triangles=[(0, 1, 2)]
            )
        ]
    )
    with pytest.raises(ValueError, match="collapsed"):
        recipe.validate_mesh(mesh)


def test_dem_nodata_is_refused() -> None:
    with pytest.raises(ValueError):
        recipe.Grid.model_validate({"x": [0, 1], "z": [0, 1], "heightRows": [[0, 0], [0, float("nan")]]})


def rectangle(
    x0: float, z0: float, x1: float, z1: float, y: float
) -> list[tuple[recipe.Coordinate, recipe.Coordinate, recipe.Coordinate]]:
    a, b, c, d = (x0, y, z0), (x1, y, z0), (x0, y, z1), (x1, y, z1)
    return [(a, c, b), (b, c, d)]


def synthetic_inputs(*, deck_y: float = 10) -> recipe.LoadedInputs:
    return recipe.LoadedInputs(
        manifest=recipe.load_inputs(MANIFEST).manifest,
        roads=recipe.RoadBand.model_validate(
            {
                "triangles": rectangle(0, 0, 4, 100, 1),
                "elevatedDecks": rectangle(40, 20, 60, 80, deck_y),
            }
        ),
        grid=recipe.Grid(x=[0, 50, 100], z=[0, 50, 100], heightRows=[[2, 2, 2]] * 3),
        river=recipe.River(polygons=[[[(40, 0), (60, 0), (60, 100), (40, 100)]]]),
        water=recipe.WaterSamples(elevations=[0]),
        paths=(),
    )


def test_declared_deck_preserves_water_and_land_without_pulling_the_collar() -> None:
    inputs = synthetic_inputs()
    baseline = synthetic_inputs()
    baseline = replace(baseline, roads=recipe.RoadBand(triangles=inputs.roads.triangles))
    actual = recipe.bake(inputs)
    assert recipe.geometry_sha256(actual) == recipe.geometry_sha256(recipe.bake(baseline))
    proof = recipe.validate_coverage(actual, inputs)
    decks = proof["elevated_decks"]
    assert isinstance(decks, dict)
    assert decks["faces"] == 2
    assert decks["minimum_natural_top_separation_m"] == 10
    # Move the same deck over dry land, including the existing approach's collar.
    inputs = replace(
        inputs,
        roads=recipe.RoadBand.model_validate(
            {
                "triangles": inputs.roads.triangles,
                "elevatedDecks": rectangle(10, 20, 30, 80, 10),
            }
        ),
    )
    dry = recipe.bake(inputs)
    assert recipe.geometry_sha256(dry) == recipe.geometry_sha256(actual)
    dry_proof = recipe.validate_coverage(dry, inputs)["elevated_decks"]
    assert isinstance(dry_proof, dict)
    separation = dry_proof["minimum_natural_top_separation_m"]
    assert isinstance(separation, (int, float))
    assert 8 <= separation < 10


def test_undeclared_road_water_overlap_is_still_rejected() -> None:
    inputs = synthetic_inputs()
    inputs = replace(
        inputs, roads=recipe.RoadBand(triangles=inputs.roads.triangles + rectangle(40, 20, 60, 80, 10))
    )
    with pytest.raises(ValueError, match="Road/river overlap"):
        recipe.bake(inputs)


def test_undeclared_overlap_introduced_by_precision_grid_is_rejected() -> None:
    inputs = synthetic_inputs()
    inputs = replace(
        inputs,
        roads=recipe.RoadBand(triangles=[((0, 1, 0), (0, 1, 100), (4, 1, 100))]),
        river=recipe.River(polygons=[[[(0.0041, 0.1), (3.9961, 99.9), (10, 99.9), (10, 0.1)]]]),
    )
    with pytest.raises(ValueError, match="Quantized road/river overlap"):
        recipe.bake(inputs)


@pytest.mark.parametrize("height", [0, -1, 1e-50])
def test_deck_water_intersection_and_float32_collapsed_separation_reject(height: float) -> None:
    inputs = synthetic_inputs(deck_y=height)
    with pytest.raises(ValueError, match="top separation"):
        recipe.bake(inputs)


def test_deck_crossing_a_land_plane_rejects_even_when_its_centre_is_above() -> None:
    inputs = synthetic_inputs()
    inputs = replace(
        inputs,
        roads=recipe.RoadBand.model_validate(
            {
                "triangles": inputs.roads.triangles,
                "elevatedDecks": [((50, 4, 20), (50, 4, 80), (90, 1, 20))],
            }
        ),
    )
    with pytest.raises(ValueError, match="top separation"):
        recipe.bake(inputs)


@pytest.mark.parametrize(
    "bad",
    [
        [((40, 10, 20), (60, 10, 20), (40, 10, 80))],  # downward
        [((40, 10, 20), (40 + 1e-8, 10, 20), (40, 10, 80))],  # F32 collapse
        [((40, float("nan"), 20), (40, 10, 80), (60, 10, 20))],
        [((40, 10, 20), (40, float("inf"), 80), (60, 10, 20))],
    ],
)
def test_invalid_deck_evidence_is_refused(bad: object) -> None:
    inputs = synthetic_inputs()
    with pytest.raises(ValueError):
        inputs = replace(
            inputs,
            roads=recipe.RoadBand.model_validate({"triangles": inputs.roads.triangles, "elevatedDecks": bad}),
        )
        recipe.bake(inputs)


def test_deck_outside_source_domain_has_no_coverage_proof() -> None:
    inputs = synthetic_inputs()
    inputs = replace(
        inputs,
        roads=recipe.RoadBand.model_validate(
            {
                "triangles": inputs.roads.triangles,
                "elevatedDecks": rectangle(90, 20, 110, 80, 10),
            }
        ),
    )
    with pytest.raises(ValueError, match=r"deck.*coverage"):
        recipe.bake(inputs)


def test_missing_natural_ground_below_deck_is_not_hidden_by_deck_coverage() -> None:
    inputs = synthetic_inputs()
    mesh = recipe.bake(inputs)
    # Remove the whole water patch: the elevated deck must not fill that missing coverage.
    mesh.patches = [p for p in mesh.patches if p.surface != "water"]
    with pytest.raises(ValueError, match="cover"):
        recipe.validate_coverage(mesh, inputs)


def water_bodies_payload() -> dict[str, object]:
    return {
        "formatVersion": 1,
        "bodies": [
            {
                "id": "lake",
                "polygons": [
                    [[(40, 0), (60, 0), (60, 40), (40, 40)], [(46, 10), (54, 10), (54, 30), (46, 30)]]
                ],
                "elevations": [2, 3, 4],
                "provenance": {"source": "synthetic lake observations"},
            },
            {
                "id": "canal",
                "polygons": [[[(60, 50), (80, 50), (80, 100), (60, 100)]]],
                "elevations": [4, 6],
                "provenance": {"source": "synthetic canal observations"},
            },
        ],
    }


def body_inputs() -> recipe.LoadedInputs:
    return replace(
        synthetic_inputs(),
        river=None,
        water=None,
        water_bodies=recipe.WaterBodies.model_validate(water_bodies_payload()),
    )


def test_body_specific_proxy_levels_holes_and_identity_survive_bake_and_proof() -> None:
    inputs = body_inputs()
    mesh = recipe.bake(inputs)
    water = [p for p in mesh.patches if p.surface == "water"]
    assert {p.water_body: {v[1] for v in p.vertices} for p in water} == {"lake": {3}, "canal": {5}}
    lake = next(p for p in water if p.water_body == "lake")
    lake_faces = unary_union(
        [Polygon([(lake.vertices[i][0], lake.vertices[i][2]) for i in face]) for face in lake.triangles]
    )
    assert not lake_faces.covers(Point(50, 20))  # source island remains dry
    assert lake_faces.covers(Point(42, 20))  # positive water control
    proof = recipe.validate_coverage(mesh, inputs)
    bodies = proof["water_bodies"]
    assert isinstance(bodies, dict)
    assert set(bodies) == {"lake", "canal"}
    lake_proof = bodies["lake"]
    assert isinstance(lake_proof, dict)
    assert lake_proof["source_elevation_min_m"] == 2
    assert lake_proof["source_elevation_max_m"] == 4
    assert lake_proof["source_observations"] == 3
    assert lake_proof["provenance"] == {"source": "synthetic lake observations"}
    decoded = recipe.Mesh.model_validate_json(recipe.encode_mesh(mesh))
    assert [p.water_body for p in decoded.patches] == [p.water_body for p in mesh.patches]
    for patch in decoded.patches:
        patch.vertices = [(recipe.f32(x), recipe.f32(y), recipe.f32(z)) for x, y, z in patch.vertices]
    assert recipe.validate_coverage(decoded, inputs) == proof


def test_all_body_patches_count_in_world_coverage_and_shoreline_proof() -> None:
    inputs = body_inputs()
    mesh = recipe.bake(inputs)
    proof = recipe.validate_coverage(mesh, inputs)
    assert proof["world_missing_area_m2"] == 0
    mesh.patches = [p for p in mesh.patches if p.water_body != "canal"]
    with pytest.raises(ValueError, match=r"cover|body"):
        recipe.validate_coverage(mesh, inputs)


def test_relabelled_body_or_wrong_level_cannot_claim_source_identity() -> None:
    inputs = body_inputs()
    for change in ("identity", "level"):
        mesh = recipe.bake(inputs)
        patch = next(p for p in mesh.patches if p.water_body == "canal")
        if change == "identity":
            patch.water_body = "lake"
        else:
            patch.vertices = [(x, 3, z) for x, _y, z in patch.vertices]
        with pytest.raises(ValueError, match=r"body|level"):
            recipe.validate_coverage(mesh, inputs)


@pytest.mark.parametrize("mutation", ["duplicate", "empty", "nonfinite", "overlap", "invalid"])
def test_invalid_or_ambiguous_water_body_sources_reject(mutation: str) -> None:
    payload = water_bodies_payload()
    bodies = payload["bodies"]
    assert isinstance(bodies, list)
    if mutation == "duplicate":
        bodies[1]["id"] = bodies[0]["id"]
    elif mutation == "empty":
        bodies[0]["elevations"] = []
    elif mutation == "nonfinite":
        bodies[0]["elevations"] = [float("nan")]
    elif mutation == "overlap":
        bodies[1]["polygons"] = bodies[0]["polygons"]
    else:
        bodies[0]["polygons"] = [[[(0, 0), (10, 10), (0, 10), (10, 0)]]]
    with pytest.raises(ValueError):
        recipe.WaterBodies.model_validate(payload)


def test_versioned_body_manifest_loads_and_mixed_input_sets_reject(tmp_path: Path) -> None:
    inputs = synthetic_inputs()
    files = {
        "road_band": inputs.roads.model_dump(by_alias=True),
        "grid": inputs.grid.model_dump(by_alias=True),
        "water_bodies": water_bodies_payload(),
    }
    manifest = inputs.manifest.model_copy(deep=True)
    manifest.inputs = {}
    for key, payload in files.items():
        path = tmp_path / f"{key}.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        manifest.inputs[key] = recipe.InputFile(path=path.name, sha256=recipe.sha256(path))
    path = tmp_path / "manifest.json"
    path.write_text(manifest.model_dump_json(), encoding="utf-8")
    loaded = recipe.load_inputs(path)
    assert loaded.river is None and loaded.water is None
    assert loaded.water_bodies is not None
    assert recipe.geometry_sha256(recipe.bake(loaded)) == recipe.geometry_sha256(recipe.bake(body_inputs()))
    manifest.inputs["river"] = manifest.inputs["water_bodies"]
    path.write_text(manifest.model_dump_json(), encoding="utf-8")
    with pytest.raises(ValueError, match="input"):
        recipe.load_inputs(path)


def test_direct_mixed_water_modes_reject() -> None:
    with pytest.raises(ValueError, match=r"water.*mode"):
        recipe.bake(replace(body_inputs(), river=synthetic_inputs().river))


def test_existing_connected_approach_road_may_meet_deck_at_grade() -> None:
    inputs = synthetic_inputs(deck_y=1)
    inputs = replace(
        inputs,
        roads=recipe.RoadBand.model_validate(
            {"triangles": inputs.roads.triangles, "elevatedDecks": rectangle(2, 20, 4, 80, 1)}
        ),
    )
    mesh = recipe.bake(inputs)
    proof = recipe.validate_coverage(mesh, inputs)["elevated_decks"]
    assert isinstance(proof, dict)
    overlaps = proof["ordinary_road_overlap_faces"]
    assert isinstance(overlaps, int)
    assert overlaps > 0
    separation = proof["minimum_natural_top_separation_m"]
    assert isinstance(separation, (int, float))
    assert separation > 0


def test_exact_existing_edge_nodes_make_conforming_faces_without_moving_coverage() -> None:
    patch = recipe.Patch(
        surface="grass",
        vertices=[(0, 0, 0), (4, 0, 0), (4, 0, 4), (0, 0, 4), (2, 0, 2)],
        triangles=[(0, 2, 1), (0, 3, 4), (4, 3, 2)],
    )
    original_vertices = list(patch.vertices)
    original_union = unary_union(
        [Polygon([(patch.vertices[i][0], patch.vertices[i][2]) for i in t]) for t in patch.triangles]
    )
    mesh = recipe.Mesh(patches=[patch])
    recipe.conform_mesh(mesh)
    assert patch.vertices == original_vertices
    assert len(patch.triangles) == 4
    actual_union = unary_union(
        [Polygon([(patch.vertices[i][0], patch.vertices[i][2]) for i in t]) for t in patch.triangles]
    )
    assert actual_union.equals(original_union)
    # The long diagonal is actually subdivided, not suppressed from the topology proof.
    edges = [tuple(sorted([t[i], t[(i + 1) % 3]])) for t in patch.triangles for i in range(3)]
    assert (0, 2) not in edges
    assert edges.count((0, 4)) == edges.count((2, 4)) == 2


def test_conformity_never_snaps_a_nearby_noncollinear_node() -> None:
    patch = recipe.Patch(
        surface="grass",
        vertices=[(0, 0, 0), (4, 0, 0), (4, 0, 4), (0, 0, 4), (2, 0, 2.000000238418579)],
        triangles=[(0, 2, 1), (0, 3, 4), (4, 3, 2)],
    )
    original = patch.model_dump()
    recipe.conform_mesh(recipe.Mesh(patches=[patch]))
    assert patch.model_dump() == original


def test_fractional_body_proxy_serialization_restores_actual_float32_before_physical_proof() -> None:
    inputs = body_inputs()
    assert inputs.water_bodies is not None
    inputs.water_bodies.bodies[0].elevations = [0.207804784, 0.207804784, 0.207804784]
    mesh = recipe.bake(inputs)
    original = recipe.validate_coverage(mesh, inputs)
    decoded = recipe.Mesh.model_validate_json(recipe.encode_mesh(mesh))
    for patch in decoded.patches:
        patch.vertices = [(recipe.f32(x), recipe.f32(y), recipe.f32(z)) for x, y, z in patch.vertices]
    assert recipe.geometry_sha256(decoded) == recipe.geometry_sha256(mesh)
    assert recipe.validate_coverage(decoded, inputs) == original


def test_body_proof_uses_declared_noded_plan_and_reports_source_displacement() -> None:
    inputs = body_inputs()
    assert inputs.water_bodies is not None
    inputs.water_bodies.bodies[0].polygons = [
        [[(40.003, 0.101), (60.701, 0.109), (60.303, 40.503), (40.107, 40.011)]]
    ]
    mesh = recipe.bake(inputs)
    proof = recipe.validate_coverage(mesh, inputs)["water_bodies"]
    assert isinstance(proof, dict)
    lake = proof["lake"]
    assert isinstance(lake, dict)
    assert lake["planned_missing_area_m2"] == lake["planned_extra_area_m2"] == 0
    displacement = lake["source_boundary_displacement_m"]
    assert isinstance(displacement, (int, float)) and displacement > 0
    # Changing preserved geometry cannot validate the old output under the same body ID.
    inputs.water_bodies.bodies[0].polygons = [[[(41, 1), (59, 1), (59, 39), (41, 39)]]]
    with pytest.raises(ValueError, match=r"body.*geometry"):
        recipe.validate_coverage(mesh, inputs)


def test_declared_precision_cannot_silently_remove_a_source_water_hole() -> None:
    inputs = body_inputs()
    assert inputs.water_bodies is not None
    inputs.water_bodies.bodies[0].polygons = [
        [
            [(40, 0), (60, 0), (60, 40), (40, 40)],
            [(50, 20), (50.0001, 20), (50.0001, 20.0001), (50, 20.0001)],
        ]
    ]
    mesh = recipe.bake(inputs)
    with pytest.raises(ValueError, match="source holes"):
        recipe.validate_coverage(mesh, inputs)


def mesh_height(mesh: recipe.Mesh, x: float, z: float) -> float | None:
    for patch in mesh.patches:
        if patch.surface != "grass":
            continue
        for face in patch.triangles:
            a, b, c = [patch.vertices[i] for i in face]
            dx1, dz1 = b[0] - a[0], b[2] - a[2]
            dx2, dz2 = c[0] - a[0], c[2] - a[2]
            det = dx1 * dz2 - dx2 * dz1
            u = ((x - a[0]) * dz2 - (z - a[2]) * dx2) / det
            v = (dx1 * (z - a[2]) - dz1 * (x - a[0])) / det
            if u >= 0 and v >= 0 and u + v <= 1:
                return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1])
    return None


def graded_inputs(
    guides: list[tuple[recipe.Coordinate, recipe.Coordinate, recipe.Coordinate]],
) -> recipe.LoadedInputs:
    inputs = synthetic_inputs()
    return replace(
        inputs,
        roads=recipe.RoadBand.model_validate(
            {**inputs.roads.model_dump(by_alias=True), "groundGrades": guides}
        ),
    )


def test_ground_grade_is_an_untucked_plane_not_a_cutout_and_has_bounded_influence() -> None:
    inputs = graded_inputs(rectangle(10, 20, 20, 30, 7))
    mesh = recipe.bake(inputs)
    baseline = recipe.bake(synthetic_inputs())
    assert mesh_height(mesh, 15, 25) == 7
    assert mesh_height(baseline, 15, 25) != 7
    for x, z in [(11, 21), (19, 21), (11, 29), (19, 29)]:
        assert mesh_height(mesh, x, z) == 7
    assert mesh_height(mesh, 100, 100) == mesh_height(baseline, 100, 100) == 2
    assert recipe.validate_coverage(mesh, inputs)["world_missing_area_m2"] == 0
    # No source water plane or outline changes, even where a transition reaches it.
    water = [p for p in mesh.patches if p.surface == "water"]
    old_water = [p for p in baseline.patches if p.surface == "water"]
    assert {v[1] for p in water for v in p.vertices} == {v[1] for p in old_water for v in p.vertices}

    def footprint(patches: list[recipe.Patch]) -> recipe.Geometry:
        return unary_union(
            [Polygon([(p.vertices[i][0], p.vertices[i][2]) for i in t]) for p in patches for t in p.triangles]
        )

    assert footprint(water).equals(footprint(old_water))
    assert inputs.roads.triangles == synthetic_inputs().roads.triangles
    assert inputs.roads.elevated_decks == synthetic_inputs().roads.elevated_decks


@pytest.mark.parametrize("kind", ["road", "deck", "water", "other-plane"])
def test_grade_ownership_conflicts_are_rejected(kind: str) -> None:
    guide = {
        "road": rectangle(2, 20, 8, 30, 7),
        "deck": rectangle(45, 20, 55, 30, 7),
        "water": rectangle(45, 0, 55, 10, 7),
        "other-plane": rectangle(15, 20, 25, 30, 8),
    }[kind]
    inputs = graded_inputs(rectangle(10, 20, 20, 30, 7) + guide)
    with pytest.raises(ValueError, match="grade"):
        recipe.bake(inputs)


def test_consistent_overlapping_grade_planes_are_unambiguous() -> None:
    inputs = graded_inputs(rectangle(10, 20, 20, 30, 7) + rectangle(15, 20, 25, 30, 7))
    assert mesh_height(recipe.bake(inputs), 17, 25) == 7


def test_shared_grade_boundary_cannot_have_conflicting_node_heights() -> None:
    inputs = graded_inputs(rectangle(10, 20, 20, 30, 7) + rectangle(20, 20, 30, 30, 8))
    with pytest.raises(ValueError, match="grade"):
        recipe.bake(inputs)


@pytest.mark.parametrize(
    "bad",
    [
        [((10, 7, 20), (20, 7, 20), (10, 7, 30))],
        [((10, 7, 20), (10 + 1e-8, 7, 20), (10, 7, 30))],
        [((10, float("nan"), 20), (10, 7, 30), (20, 7, 20))],
    ],
)
def test_invalid_grade_evidence_is_rejected(
    bad: list[tuple[recipe.Coordinate, recipe.Coordinate, recipe.Coordinate]],
) -> None:
    with pytest.raises(ValueError):
        recipe.bake(graded_inputs(bad))


def test_sloped_grade_follows_its_actual_plane_without_road_tuck() -> None:
    guides = [tuple((x, x / 2 + 1, z) for x, _y, z in face) for face in rectangle(10, 20, 20, 30, 0)]
    inputs = graded_inputs([(face[0], face[1], face[2]) for face in guides])
    assert mesh_height(recipe.bake(inputs), 15, 25) == 8.5


@pytest.mark.parametrize("target", ["road", "water"])
def test_grade_conflict_introduced_only_by_quantization_is_rejected(target: str) -> None:
    triangle = ((0, 7, 0), (0, 7, 100), (4, 7, 100))
    a, b, c, d = (0.0041, 7, 0.1), (3.9961, 7, 99.9), (10, 7, 99.9), (10, 7, 0.1)
    if target == "water":
        inputs = graded_inputs([((10, 7, 0), (10, 7, 100), (14, 7, 100))])
        inputs = replace(
            inputs, river=recipe.River(polygons=[[[(10.0041, 0.1), (13.9961, 99.9), (20, 99.9), (20, 0.1)]]])
        )
    else:
        inputs = graded_inputs([(a, b, c), (a, c, d)])
        payload = inputs.roads.model_dump(by_alias=True)
        payload["triangles"] = [triangle]
        inputs = replace(inputs, roads=recipe.RoadBand.model_validate(payload))
    with pytest.raises(ValueError, match="grade"):
        recipe.bake(inputs)


def test_grade_outside_source_domain_does_not_create_new_coverage() -> None:
    with pytest.raises(ValueError, match=r"grade.*coverage"):
        recipe.bake(graded_inputs(rectangle(95, 20, 105, 30, 7)))


def test_non_grid_aligned_grade_owns_its_declared_snapped_plane() -> None:
    inputs = graded_inputs([((10.0004, 7, 20.0004), (12.0004, 7, 30.0004), (20.0004, 7, 22.0004))])
    mesh = recipe.bake(inputs)
    # The declared STEP outline includes nodes outside the original evidence.
    # Those nodes still belong to the desired plane, not a near-one blend.
    assert mesh_height(mesh, 10, 20) == 7
    assert mesh_height(mesh, 12, 30) == 7
    assert mesh_height(mesh, 14, 24) == 7


def test_non_grid_aligned_sloped_grade_uses_original_physical_plane() -> None:
    face = ((10.0004, 6.0002, 20.0004), (12.0004, 7.0002, 30.0004), (20.0004, 11.0002, 22.0004))
    inputs = graded_inputs([face])
    mesh = recipe.bake(inputs)
    for x, z in [(10, 20), (12, 30), (20, 22)]:
        assert mesh_height(mesh, x, z) == recipe.f32(
            float(recipe.exact_height(inputs.roads.ground_grades[0], x, z))
        )


@pytest.mark.parametrize("target", ["deck", "other-plane"])
def test_grade_quantization_conflicts_also_reject_decks_and_other_guides(target: str) -> None:
    obstacle: list[tuple[recipe.Coordinate, recipe.Coordinate, recipe.Coordinate]] = [
        ((10, 8, 0), (10, 8, 100), (14, 8, 100))
    ]
    a, b, c, d = (10.0041, 7, 0.1), (13.9961, 7, 99.9), (20, 7, 99.9), (20, 7, 0.1)
    guides: list[tuple[recipe.Coordinate, recipe.Coordinate, recipe.Coordinate]] = [(a, b, c), (a, c, d)]
    source = Polygon([(v[0], v[2]) for v in obstacle[0]])
    guide = Polygon([(v[0], v[2]) for v in (a, b, c, d)])
    assert source.intersection(guide).area == 0
    inputs = graded_inputs(guides + (obstacle if target == "other-plane" else []))
    if target == "deck":
        inputs.roads.elevated_decks = obstacle
    with pytest.raises(ValueError, match="grade"):
        recipe.bake(inputs)


def test_grades_retain_identified_water_levels_holes_and_full_body_proof() -> None:
    baseline = body_inputs()
    inputs = replace(
        baseline,
        roads=recipe.RoadBand.model_validate(
            {**baseline.roads.model_dump(by_alias=True), "groundGrades": rectangle(10, 20, 20, 30, 7)}
        ),
    )
    mesh = recipe.bake(inputs)
    assert mesh_height(mesh, 15, 25) == 7
    proof = recipe.validate_coverage(mesh, inputs)
    old_proof = recipe.validate_coverage(recipe.bake(baseline), baseline)
    assert proof["world_missing_area_m2"] == 0
    bodies, old_bodies = proof["water_bodies"], old_proof["water_bodies"]
    assert isinstance(bodies, dict) and isinstance(old_bodies, dict)
    for identity, body in bodies.items():
        old = old_bodies[identity]
        assert isinstance(body, dict) and isinstance(old, dict)
        for key in ("source_sha256", "float32_proxy_level_m", "preserved_source_holes"):
            assert body[key] == old[key]
        assert body["planned_missing_area_m2"] == body["planned_extra_area_m2"] == 0


def test_grade_transition_changes_nearby_ground_and_keeps_missing_ground_invalid() -> None:
    inputs = graded_inputs(rectangle(10, 20, 20, 30, 7))
    mesh = recipe.bake(inputs)
    old_height = mesh_height(recipe.bake(synthetic_inputs()), 30, 25)
    transition_height = mesh_height(mesh, 30, 25)
    assert old_height is not None and transition_height is not None
    assert old_height < transition_height < 7
    grass = next(p for p in mesh.patches if p.surface == "grass")
    grass.triangles = [
        face
        for face in grass.triangles
        if not Polygon([(grass.vertices[i][0], grass.vertices[i][2]) for i in face]).covers(Point(15, 25))
    ]
    with pytest.raises(ValueError, match=r"cover|boundary"):
        recipe.validate_coverage(mesh, inputs)


@pytest.mark.parametrize("corner_x", [19.98046875, 19.9951171875])
def test_gentle_grade_transition_near_a_dem_edge_has_no_interpolation_cliff(corner_x: float) -> None:
    # Mild, compatible controls: a 1 m road, a 1.1 m grade and a 2 m DEM.
    # A rotated grade corner close to a source grid edge must not interpolate
    # a 20 m edge's distant controls into a centimetre-wide artificial cliff.
    a, b = (12, 1.1, 15), (10, 1.1, 25)
    c, d = (corner_x, 1.1, 16.5), (corner_x - 2, 1.1, 26.5)
    inputs = graded_inputs([(a, b, c), (c, b, d)])
    inputs = replace(
        inputs,
        grid=recipe.Grid(
            x=list(range(0, 101, 20)),
            z=list(range(0, 101, 20)),
            heightRows=[[2] * 6] * 6,
        ),
    )
    mesh = recipe.bake(inputs)
    corner = Point(c[0], c[2])
    normals = []
    for patch in mesh.patches:
        if patch.surface != "grass":
            continue
        for face in patch.triangles:
            vertices = [patch.vertices[i] for i in face]
            if Polygon([(v[0], v[2]) for v in vertices]).distance(corner) > 0.05:
                continue
            (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = vertices
            det = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)
            dx = ((y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0)) / det
            dz = ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / det
            normals.append(1 / math.sqrt(1 + dx * dx + dz * dz))
    assert normals
    assert min(normals) >= 0.9
    assert mesh_height(mesh, c[0], c[2]) == recipe.f32(c[1])
    assert recipe.validate_coverage(mesh, inputs)["world_missing_area_m2"] == 0
