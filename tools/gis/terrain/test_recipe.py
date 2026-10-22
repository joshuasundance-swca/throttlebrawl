"""The preserved inputs and selected geometry are the regeneration oracle."""

from __future__ import annotations

import json
import struct
from dataclasses import replace
from pathlib import Path

import pytest

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
    assert decks["minimum_top_separation_m"] == 10
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
    separation = dry_proof["minimum_top_separation_m"]
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
