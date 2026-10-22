"""The preserved inputs and selected geometry are the regeneration oracle."""

from __future__ import annotations

import json
import struct
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.geometry import Point, Polygon  # type: ignore[import-untyped]
from shapely.ops import unary_union  # type: ignore[import-untyped]

from . import recipe

MANIFEST = Path(__file__).parent / "eagle-point" / "manifest.json"


@pytest.fixture(scope="module")
def generated() -> recipe.Mesh:
    return recipe.bake(recipe.load_inputs(MANIFEST))


def test_regeneration_matches_selected_float32_geometry(generated: recipe.Mesh) -> None:
    inputs = recipe.load_inputs(MANIFEST)
    assert recipe.geometry_sha256(generated) == inputs.manifest.expected_geometry_sha256
    recipe.validate_mesh(generated)


def test_shipped_network_uses_the_reviewed_physical_geometry() -> None:
    root = Path(__file__).resolve().parents[3]
    network = json.loads(
        (
            root / "packs/region-clinton/regions/clinton-iowa/networks/osm-clinton-eagle-point.json"
        ).read_bytes()
    )
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
