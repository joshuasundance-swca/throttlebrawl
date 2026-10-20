"""The preserved inputs and selected geometry are the regeneration oracle."""

from __future__ import annotations

import json
import struct
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
