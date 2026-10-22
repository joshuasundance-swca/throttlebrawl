"""Portable offline recipe for the selected Eagle terrain, with no runtime dependency."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import struct
from collections import Counter
from dataclasses import dataclass
from fractions import Fraction
from itertools import pairwise
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Literal, cast

import numpy as np
import pydantic
import shapely  # type: ignore[import-untyped]
from pydantic import BaseModel, Field, FiniteFloat, JsonValue, StrictInt, model_validator
from shapely import (
    constrained_delaunay_triangles,
    difference,
    intersection,
    set_precision,
    union_all,
)
from shapely.geometry import LineString, Point, Polygon, box  # type: ignore[import-untyped]
from shapely.ops import nearest_points, polygonize, unary_union  # type: ignore[import-untyped]
from shapely.strtree import STRtree  # type: ignore[import-untyped]

Coordinate = tuple[float, float, float]
XZ = tuple[float, float]
Triangle = tuple[StrictInt, StrictInt, StrictInt]
# Shapely's pinned distribution has no typing metadata. Keep that untyped
# boundary explicit; data contracts, public functions and numeric results are typed.
Geometry = Any
STEP = 2**-10
SUPPORT_EPSILON = 1e-7


class Grid(BaseModel):
    """Original double-precision DEM samples, row-major Z then X."""

    x: list[FiniteFloat]
    z: list[FiniteFloat]
    height_rows: list[list[FiniteFloat]] = Field(alias="heightRows")

    @model_validator(mode="after")
    def valid_shape(self) -> Grid:
        for axis in (self.x, self.z):
            if len(axis) < 2 or any(b <= a for a, b in pairwise(axis)):
                raise ValueError("DEM axes must increase and contain at least two samples")
            if len(set(np.diff(axis))) != 1:
                raise ValueError("This selected recipe requires a uniform DEM grid")
        if len(self.height_rows) != len(self.z) or any(len(row) != len(self.x) for row in self.height_rows):
            raise ValueError("No-data or invalid DEM array shape")
        return self

    def height(self, x: float, z: float) -> float:
        """Evaluate the original source triangle plane without changing the samples."""
        i = min(len(self.x) - 2, max(0, math.floor((x - self.x[0]) / (self.x[1] - self.x[0]))))
        j = min(len(self.z) - 2, max(0, math.floor((z - self.z[0]) / (self.z[1] - self.z[0]))))
        u = (x - self.x[i]) / (self.x[i + 1] - self.x[i])
        v = (z - self.z[j]) / (self.z[j + 1] - self.z[j])
        h = self.height_rows
        if u + v <= 1:
            return h[j][i] * (1 - u - v) + h[j][i + 1] * u + h[j + 1][i] * v
        return h[j + 1][i + 1] * (u + v - 1) + h[j][i + 1] * (1 - v) + h[j + 1][i] * (1 - u)


class RoadBand(BaseModel):
    """Ground-owning road faces and explicitly elevated top faces, in world metres."""

    triangles: list[tuple[Coordinate, Coordinate, Coordinate]]
    elevated_decks: list[tuple[Coordinate, Coordinate, Coordinate]] = Field(
        default_factory=list, alias="elevatedDecks"
    )

    @model_validator(mode="after")
    def physical_faces(self) -> RoadBand:
        for name in ("triangles", "elevated_decks"):
            rounded = []
            for triangle in getattr(self, name):
                # Validate the original evidence as well as its actual physical representation.
                for vertex in triangle:
                    for value in vertex:
                        f32(value)
                if signed_area2([(v[0], v[2]) for v in triangle]) >= 0:
                    raise ValueError("Non-upward original road/deck face")
                physical = cast(
                    tuple[Coordinate, Coordinate, Coordinate],
                    tuple(tuple(f32(value) for value in vertex) for vertex in triangle),
                )
                if signed_area2([(v[0], v[2]) for v in physical]) >= 0:
                    raise ValueError("Non-upward or collapsed Float32 road/deck face")
                rounded.append(physical)
            setattr(self, name, rounded)
        return self


class River(BaseModel):
    polygons: list[list[list[tuple[FiniteFloat, FiniteFloat]]]]


class WaterSamples(BaseModel):
    elevations: list[FiniteFloat]


class InputFile(BaseModel):
    path: str
    sha256: str


class Manifest(BaseModel):
    inputs: dict[str, InputFile]
    authoring_versions: dict[str, str]
    expected_geometry_sha256: str
    provenance: dict[str, JsonValue]


class Patch(BaseModel):
    surface: Literal["grass", "water"]
    vertices: list[Coordinate]
    triangles: list[Triangle]


class Mesh(BaseModel):
    patches: list[Patch]


@dataclass(frozen=True)
class LoadedInputs:
    manifest: Manifest
    roads: RoadBand
    grid: Grid
    river: River
    water: WaterSamples
    paths: tuple[Path, ...]


def f32(value: float) -> float:
    """Round once at the same physical precision used by the runtime."""
    if not math.isfinite(value):
        raise ValueError("Coordinates must be finite")
    try:
        rounded = float(struct.unpack("<f", struct.pack("<f", value))[0])
    except OverflowError as error:
        raise ValueError("Coordinate is outside finite Float32 range") from error
    if not math.isfinite(rounded):
        raise ValueError("Coordinate is outside finite Float32 range")
    return rounded


def float32_decimal(value: float) -> str:
    """Use the first 1..9 significant-digit decimal retaining the Float32 bits."""
    selected = f32(value)
    bits = struct.pack("<f", selected)
    if selected == 0:
        return "-0.0" if math.copysign(1, selected) < 0 else "0"
    for precision in range(1, 10):
        text = format(selected, f".{precision}g")
        try:
            candidate = struct.pack("<f", float(text))
        except OverflowError:
            continue
        if candidate == bits:
            return text
    raise ValueError("No round-tripping Float32 decimal")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_inputs(manifest_path: Path) -> LoadedInputs:
    manifest = Manifest.model_validate_json(manifest_path.read_bytes())
    names = {"road_band", "grid", "river", "water_samples"}
    if set(manifest.inputs) != names:
        raise ValueError("Manifest must name exactly the four numeric input files")
    versions = {
        "shapely": str(shapely.__version__),
        "geos": str(shapely.geos_version_string),
        "numpy": np.__version__,
        "pydantic": pydantic.__version__,
    }
    if versions != manifest.authoring_versions:
        raise ValueError(f"Authoring versions differ from the pinned manifest: {versions}")
    paths = {name: (manifest_path.parent / spec.path).resolve() for name, spec in manifest.inputs.items()}
    for name, path in paths.items():
        if sha256(path) != manifest.inputs[name].sha256:
            raise ValueError(f"Preserved numeric input hash differs: {name}")
    roads = RoadBand.model_validate_json(paths["road_band"].read_bytes())
    # Short decimal storage is lossless only after restoring the original F32
    # values BEFORE GEOS union or road-plane evaluation.
    roads.triangles = [
        cast(
            tuple[Coordinate, Coordinate, Coordinate],
            tuple(cast(Coordinate, tuple(f32(value) for value in vertex)) for vertex in triangle),
        )
        for triangle in roads.triangles
    ]
    grid = Grid.model_validate_json(paths["grid"].read_bytes())
    river = River.model_validate_json(paths["river"].read_bytes())
    water = WaterSamples.model_validate_json(paths["water_samples"].read_bytes())
    if not roads.triangles or not river.polygons or not water.elevations:
        raise ValueError("Empty road, river or interior-water input")
    return LoadedInputs(manifest, roads, grid, river, water, (manifest_path.resolve(), *paths.values()))


def polygons(geometry: Geometry) -> list[Geometry]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [part for child in getattr(geometry, "geoms", []) for part in polygons(child)]


def signed_area2(xz: list[XZ]) -> float:
    a, b, c = xz
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def road_union(inputs: LoadedInputs) -> Geometry:
    faces = [Polygon([(v[0], v[2]) for v in triangle]) for triangle in inputs.roads.triangles]
    if any(not face.is_valid or face.area <= 0 for face in faces):
        raise ValueError("Invalid original road-band face; no repair is permitted")
    return unary_union(faces)


def bake(inputs: LoadedInputs) -> Mesh:
    """Reproduce the selected algorithm, face order and Float32 node values."""
    grid = inputs.grid
    domain = box(grid.x[0], grid.z[0], grid.x[-1], grid.z[-1])
    raw_road = road_union(inputs)
    faces = [Polygon([(v[0], v[2]) for v in triangle]) for triangle in inputs.roads.triangles]
    planes = [
        np.linalg.solve([[v[0], v[2], 1] for v in t], [v[1] for v in t]) for t in inputs.roads.triangles
    ]
    tree = STRtree(faces)
    river_faces = [Polygon(rings[0], rings[1:]) for rings in inputs.river.polygons]
    if any(not face.is_valid or face.area <= 0 for face in river_faces):
        raise ValueError("Invalid source river polygon; no repair is permitted")
    raw_water = unary_union(river_faces).intersection(domain)
    if raw_road.intersection(raw_water).area:
        raise ValueError("Road/river overlap requires an explicit new ownership decision")
    canonical_domain = set_precision(domain, STEP)
    canonical_road = set_precision(raw_road, STEP)
    water = set_precision(raw_water, STEP)
    # Test the actual snapped boundaries without snapping the intersection again;
    # a second fixed-precision overlay can erase a thin newly introduced overlap.
    if set_precision(canonical_road, 0).intersection(set_precision(water, 0)).area:
        raise ValueError("Quantized road/river overlap requires an ownership decision")
    retained_road = set_precision(raw_road.buffer(-0.02, quad_segs=64), STEP)
    transition = set_precision(raw_road.buffer(39.99, quad_segs=64), STEP)
    if retained_road.is_empty:
        raise ValueError("The inward road offset collapsed")
    land = difference(canonical_domain, union_all([water, retained_road], grid_size=STEP), grid_size=STEP)
    if not land.is_valid or not water.is_valid:
        raise ValueError("Invalid overlay; no repair is permitted")
    edges: set[tuple[XZ, XZ]] = set()
    for j in range(len(grid.z) - 1):
        for i in range(len(grid.x) - 1):
            a, b = (grid.x[i], grid.z[j]), (grid.x[i + 1], grid.z[j])
            c, d = (grid.x[i], grid.z[j + 1]), (grid.x[i + 1], grid.z[j + 1])
            for points in [(a, b, c), (b, d, c)]:
                for u, v in zip(points, points[1:] + points[:1], strict=True):
                    edges.add(cast(tuple[XZ, XZ], tuple(sorted([u, v]))))
    linework = [LineString(edge) for edge in sorted(edges)]
    linework += [
        canonical_domain.boundary,
        water.boundary,
        retained_road.boundary,
        transition.boundary,
        canonical_road.boundary,
    ]
    noded = union_all(linework, grid_size=STEP)
    cells = sorted(polygonize(noded), key=lambda p: (p.bounds, p.area, p.wkb_hex))
    inside = [transition.covers(cell.representative_point()) for cell in cells]
    final_transition = unary_union([cell for cell, yes in zip(cells, inside, strict=True) if yes])
    boundary = final_transition.boundary
    outside_nodes = {
        tuple(v)
        for cell, yes in zip(cells, inside, strict=True)
        if not yes
        for polygon in polygons(cell)
        for ring in [polygon.exterior, *polygon.interiors]
        for v in ring.coords
    }
    if final_transition.difference(raw_road.buffer(40, quad_segs=256)).area:
        raise ValueError("Final transition exceeds the conservative 40 m offset")
    node_y: dict[XZ, float] = {}

    def grass_y(x: float, z: float) -> float:
        key, point = (x, z), Point(x, z)
        if key not in node_y:
            dem = grid.height(x, z)
            value = dem
            if (
                key not in outside_nodes
                and final_transition.contains(point)
                and boundary.distance(point) > SUPPORT_EPSILON
            ):
                q = nearest_points(point, raw_road.boundary)[1]
                ids = [
                    int(k)
                    for k in tree.query(q.buffer(SUPPORT_EPSILON))
                    if faces[k].distance(q) <= SUPPORT_EPSILON
                ]
                if not ids:
                    raise ValueError("No actual road face supports the nearest boundary")
                height = max(float(planes[k][0] * q.x + planes[k][1] * q.y + planes[k][2]) for k in ids)
                outer, distance = boundary.distance(point), point.distance(q)
                weight = 1.0 if raw_road.covers(point) else outer / (outer + distance)
                value = dem + (height - 0.06 - dem) * weight
            node_y[key] = f32(value)
        return node_y[key]

    patches: list[Patch] = []
    water_y = f32(statistics.median(inputs.water.elevations))
    for surface, target in [("grass", land), ("water", water)]:
        vertices: list[Coordinate] = []
        triangles: list[Triangle] = []
        indices: dict[Coordinate, int] = {}
        for cell in cells:
            for polygon in polygons(intersection(cell, target, grid_size=STEP)):
                for triangle in constrained_delaunay_triangles(polygon).geoms:
                    xz = [(float(x), float(z)) for x, z in list(triangle.exterior.coords)[:3]]
                    if signed_area2(xz) > 0:
                        xz = [xz[0], xz[2], xz[1]]
                    xyz = [(f32(x), water_y if surface == "water" else grass_y(x, z), f32(z)) for x, z in xz]
                    face_indices = []
                    for vertex in xyz:
                        if vertex not in indices:
                            indices[vertex] = len(vertices)
                            vertices.append(vertex)
                        face_indices.append(indices[vertex])
                    triangles.append(cast(Triangle, tuple(face_indices)))
        patches.append(
            Patch(surface=cast(Literal["grass", "water"], surface), vertices=vertices, triangles=triangles)
        )
    mesh = Mesh(patches=patches)
    validate_mesh(mesh)
    if inputs.roads.elevated_decks:
        validate_decks(mesh, inputs)
    return mesh


def deck_overlap_separation(
    deck: tuple[Coordinate, Coordinate, Coordinate],
    ground: tuple[Coordinate, Coordinate, Coordinate],
) -> Fraction | None:
    """Exact rational clipping and plane comparison of two actual Float32 triangles."""
    xyz = [[tuple(Fraction(v) for v in vertex) for vertex in face] for face in (deck, ground)]
    ring = [(v[0], v[2]) for v in xyz[0]]

    def cross(
        a: tuple[Fraction, Fraction], b: tuple[Fraction, Fraction], p: tuple[Fraction, Fraction]
    ) -> Fraction:
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

    clip = [(v[0], v[2]) for v in xyz[1]]
    for a, b in zip(clip, [*clip[1:], clip[0]], strict=True):
        previous_ring, ring = ring, []
        if not previous_ring:
            return None
        for p, q in zip(previous_ring, [*previous_ring[1:], previous_ring[0]], strict=True):
            cp, cq = cross(a, b, p), cross(a, b, q)
            if cp <= 0:
                ring.append(p)
            if (cp < 0 < cq) or (cq < 0 < cp):
                t = cp / (cp - cq)
                ring.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    if len(ring) < 3 or not sum(
        p[0] * q[1] - p[1] * q[0] for p, q in zip(ring, [*ring[1:], ring[0]], strict=True)
    ):
        return None

    def height(face: list[tuple[Fraction, ...]], x: Fraction, z: Fraction) -> Fraction:
        a, b, c = face
        dx1, dz1, dy1 = b[0] - a[0], b[2] - a[2], b[1] - a[1]
        dx2, dz2, dy2 = c[0] - a[0], c[2] - a[2], c[1] - a[1]
        det = dx1 * dz2 - dx2 * dz1
        return a[1] + ((dy1 * dz2 - dy2 * dz1) * (x - a[0]) + (dx1 * dy2 - dx2 * dy1) * (z - a[2])) / det

    return min(height(xyz[0], x, z) - height(xyz[1], x, z) for x, z in ring)


def validate_decks(mesh: Mesh, inputs: LoadedInputs) -> dict[str, JsonValue]:
    """Prove full projected support and strictly positive F32 top-plane separation.

    This is not a deck thickness, underside, survey or navigable clearance claim.
    A linear plane difference attains its minimum at an overlap polygon vertex.
    """
    # Revalidate mutable/directly constructed evidence, not only file-loaded inputs.
    roads = RoadBand.model_validate(inputs.roads.model_dump(by_alias=True))
    natural = list(roads.triangles)
    for patch in mesh.patches:
        for face in patch.triangles:
            natural.append(
                cast(
                    tuple[Coordinate, Coordinate, Coordinate],
                    tuple(tuple(f32(value) for value in patch.vertices[i]) for i in face),
                )
            )
    faces = [Polygon([(v[0], v[2]) for v in t]) for t in natural]
    support = unary_union(faces)
    tree = STRtree(faces)
    grid = inputs.grid
    domain = box(grid.x[0], grid.z[0], grid.x[-1], grid.z[-1])
    minimum = math.inf
    overlaps = 0
    for deck in roads.elevated_decks:
        footprint = Polygon([(v[0], v[2]) for v in deck])
        if footprint.difference(domain).area:
            raise ValueError("Elevated deck lacks bounded source coverage")
        for k in tree.query(footprint):
            separation = deck_overlap_separation(deck, natural[int(k)])
            if separation is None:
                continue
            if separation <= 0 or float(separation) <= 0:
                raise ValueError("Elevated deck has nonpositive Float32 top separation")
            minimum = min(minimum, float(separation))
            overlaps += 1
        if footprint.difference(support).area:
            raise ValueError("Elevated deck lacks natural ground/water coverage")
    return {
        "faces": len(roads.elevated_decks),
        "overlap_faces": overlaps,
        "minimum_top_separation_m": minimum,
    }


def validate_mesh(mesh: Mesh) -> None:
    """Check the observable final Float32 geometry, never discard a bad face."""
    if not mesh.patches:
        raise ValueError("Empty terrain")
    for patch in mesh.patches:
        if len(patch.vertices) < 3 or not patch.triangles:
            raise ValueError("Empty terrain patch")
        rounded = [tuple(f32(v) for v in vertex) for vertex in patch.vertices]
        if patch.surface == "water" and len({vertex[1] for vertex in rounded}) != 1:
            raise ValueError("Water must be horizontal")
        for face in patch.triangles:
            if len(set(face)) != 3 or any(i < 0 or i >= len(rounded) for i in face):
                raise ValueError("Invalid triangle indices")
            if signed_area2([(rounded[i][0], rounded[i][2]) for i in face]) >= 0:
                raise ValueError("Non-upward or collapsed Float32 triangle")


def geometry_sha256(mesh: Mesh) -> str:
    """Hash ordered surface names, counts, little-endian XYZ F32 and U32 faces."""
    digest = hashlib.sha256(b"throttlebrawl-terrain-f32-v1\0")
    digest.update(struct.pack("<I", len(mesh.patches)))
    for patch in mesh.patches:
        label = patch.surface.encode("ascii")
        digest.update(struct.pack("<I", len(label)) + label)
        digest.update(struct.pack("<II", len(patch.vertices), len(patch.triangles)))
        for vertex in patch.vertices:
            digest.update(struct.pack("<fff", *vertex))
        for triangle in patch.triangles:
            digest.update(struct.pack("<III", *triangle))
    return digest.hexdigest()


def encode_mesh(mesh: Mesh) -> bytes:
    """Compact portable JSON; consumers restore Float32 before physical use."""
    payload = mesh.model_dump()
    for patch in payload["patches"]:
        patch["vertices"] = [
            [float(float32_decimal(value)) for value in vertex] for vertex in patch["vertices"]
        ]
    return (json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n").encode("ascii")


def validate_coverage(mesh: Mesh, inputs: LoadedInputs) -> dict[str, JsonValue]:
    validate_mesh(mesh)
    unions: dict[str, Geometry] = {}
    boundaries: dict[str, set[tuple[XZ, XZ]]] = {}
    for patch in mesh.patches:
        faces = [
            Polygon([(patch.vertices[i][0], patch.vertices[i][2]) for i in face]) for face in patch.triangles
        ]
        unions[patch.surface] = unary_union(faces)
        edges: Counter[tuple[XZ, XZ]] = Counter()
        for face in patch.triangles:
            xz = [(patch.vertices[i][0], patch.vertices[i][2]) for i in face]
            for u, v in zip(xz, xz[1:] + xz[:1], strict=True):
                edges[cast(tuple[XZ, XZ], tuple(sorted([u, v])))] += 1
        if any(count > 2 for count in edges.values()):
            raise ValueError("Nonmanifold terrain edge")
        boundaries[patch.surface] = {edge for edge, count in edges.items() if count == 1}
        actual = unary_union([LineString(edge) for edge in sorted(boundaries[patch.surface])])
        if (
            actual.difference(unions[patch.surface].boundary).length
            or unions[patch.surface].boundary.difference(actual).length
        ):
            raise ValueError("Unmatched terrain boundary edge")
    grid = inputs.grid
    domain = box(grid.x[0], grid.z[0], grid.x[-1], grid.z[-1])
    raw_road = road_union(inputs)
    combined = unary_union([raw_road, *unions.values()])
    if domain.difference(combined).area or combined.difference(domain).area:
        raise ValueError("Actual road plus terrain does not cover exactly the bounded domain")
    if unions["grass"].intersection(unions["water"]).area or raw_road.intersection(unions["water"]).area:
        raise ValueError("Unexpected water overlap")
    shared = boundaries["grass"] & boundaries["water"]
    shared_lines = unary_union([LineString(edge) for edge in sorted(shared)])
    shoreline = unions["grass"].boundary.intersection(unions["water"].boundary)
    if shoreline.difference(shared_lines).length or shared_lines.difference(shoreline).length:
        raise ValueError("Unmatched grass/water shoreline edge")
    proof: dict[str, JsonValue] = {
        "world_missing_area_m2": 0,
        "outside_domain_area_m2": 0,
        "shared_shoreline_edges": len(shared),
        "shared_shoreline_length_m": float(shared_lines.length),
    }
    if inputs.roads.elevated_decks:
        proof["elevated_decks"] = validate_decks(mesh, inputs)
    return proof


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(payload)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def regenerate(manifest_path: Path, output: Path, proof_output: Path) -> dict[str, JsonValue]:
    inputs = load_inputs(manifest_path)
    outputs = {output.resolve(), proof_output.resolve()}
    if len(outputs) != 2 or outputs.intersection(inputs.paths):
        raise ValueError("Output paths must differ from each other and every preserved input")
    mesh = bake(inputs)
    physical_hash = geometry_sha256(mesh)
    if physical_hash != inputs.manifest.expected_geometry_sha256:
        raise ValueError("Regenerated Float32 vertices/indices differ from the selected geometry")
    coverage = validate_coverage(mesh, inputs)
    payload = encode_mesh(mesh)
    if geometry_sha256(Mesh.model_validate_json(payload)) != physical_hash:
        raise ValueError("Decimal serialization changed physical Float32 geometry")
    proof: dict[str, JsonValue] = {
        "geometry_sha256": physical_hash,
        "json_sha256": hashlib.sha256(payload).hexdigest(),
        "json_bytes": len(payload),
        "coverage": coverage,
        "input_sha256": {name: spec.sha256 for name, spec in inputs.manifest.inputs.items()},
        "authoring_versions": {name: version for name, version in inputs.manifest.authoring_versions.items()},
        "provenance": inputs.manifest.provenance,
    }
    # No output directory or file is touched until ALL validation above succeeds.
    proof_bytes = (json.dumps(proof, indent=2, allow_nan=False) + "\n").encode("utf-8")
    atomic_write(output, payload)
    atomic_write(proof_output, proof_bytes)
    return proof


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--proof-output", type=Path, required=True)
    args = parser.parse_args()
    proof = regenerate(args.manifest, args.output, args.proof_output)
    print(json.dumps({"geometry_sha256": proof["geometry_sha256"], "json_bytes": proof["json_bytes"]}))


if __name__ == "__main__":
    main()
