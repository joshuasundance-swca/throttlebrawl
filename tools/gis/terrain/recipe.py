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


class WaterBody(River):
    id: str = Field(min_length=1)
    elevations: list[FiniteFloat] = Field(min_length=1)
    provenance: dict[str, JsonValue]


class WaterBodies(BaseModel):
    format_version: Literal[1] = Field(alias="formatVersion")
    bodies: list[WaterBody] = Field(min_length=1)

    @model_validator(mode="after")
    def source_ownership(self) -> WaterBodies:
        if len({body.id for body in self.bodies}) != len(self.bodies):
            raise ValueError("Duplicate water body identity")
        owned: list[Geometry] = []
        for body in self.bodies:
            if not body.polygons:
                raise ValueError("Empty water body geometry")
            faces = [Polygon(rings[0], rings[1:]) for rings in body.polygons if rings]
            if len(faces) != len(body.polygons) or any(not p.is_valid or p.area <= 0 for p in faces):
                raise ValueError("Invalid source water body geometry; no repair is permitted")
            area = unary_union(faces)
            if any(area.intersection(other).area for other in owned):
                raise ValueError("Overlapping water body ownership")
            owned.append(area)
        return self


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
    water_body: str | None = Field(default=None, alias="waterBody")


class Mesh(BaseModel):
    patches: list[Patch]


@dataclass(frozen=True)
class LoadedInputs:
    manifest: Manifest
    roads: RoadBand
    grid: Grid
    river: River | None
    water: WaterSamples | None
    paths: tuple[Path, ...]
    water_bodies: WaterBodies | None = None


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
    body_names = {"road_band", "grid", "water_bodies"}
    if set(manifest.inputs) not in (names, body_names):
        raise ValueError("Manifest input set must be exactly legacy water or versioned water bodies")
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
    river = River.model_validate_json(paths["river"].read_bytes()) if "river" in paths else None
    water = (
        WaterSamples.model_validate_json(paths["water_samples"].read_bytes())
        if "water_samples" in paths
        else None
    )
    bodies = (
        WaterBodies.model_validate_json(paths["water_bodies"].read_bytes())
        if "water_bodies" in paths
        else None
    )
    if not roads.triangles:
        raise ValueError("Empty road, river or interior-water input")
    loaded = LoadedInputs(
        manifest, roads, grid, river, water, (manifest_path.resolve(), *paths.values()), bodies
    )
    water_sources(loaded)
    return loaded


def water_sources(inputs: LoadedInputs) -> list[WaterBody]:
    if inputs.water_bodies is not None:
        if inputs.river is not None or inputs.water is not None:
            raise ValueError("Conflicting water input modes")
        return WaterBodies.model_validate(inputs.water_bodies.model_dump(by_alias=True)).bodies
    if (
        inputs.river is None
        or inputs.water is None
        or not inputs.river.polygons
        or not inputs.water.elevations
    ):
        raise ValueError("Invalid legacy water input mode")
    return [
        WaterBody(
            id="legacy", polygons=inputs.river.polygons, elevations=inputs.water.elevations, provenance={}
        )
    ]


def water_areas(inputs: LoadedInputs) -> list[tuple[WaterBody, Geometry]]:
    grid = inputs.grid
    domain = box(grid.x[0], grid.z[0], grid.x[-1], grid.z[-1])
    out: list[tuple[WaterBody, Geometry]] = []
    for body in water_sources(inputs):
        faces = [Polygon(rings[0], rings[1:]) for rings in body.polygons]
        if any(not face.is_valid or face.area <= 0 for face in faces):
            raise ValueError("Invalid source river polygon; no repair is permitted")
        out.append((body, unary_union(faces).intersection(domain)))
    return out


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


def authoring_cells(inputs: LoadedInputs) -> list[Geometry]:
    """Reconstruct the declared snap-rounded arrangement from preserved numeric inputs."""
    grid = inputs.grid
    domain = set_precision(box(grid.x[0], grid.z[0], grid.x[-1], grid.z[-1]), STEP)
    raw_road = road_union(inputs)
    water_sources_areas = water_areas(inputs)
    raw_water = (
        water_sources_areas[0][1]
        if len(water_sources_areas) == 1
        else unary_union([area for _, area in water_sources_areas])
    )
    water = set_precision(raw_water, STEP)
    retained = set_precision(raw_road.buffer(-0.02, quad_segs=64), STEP)
    transition = set_precision(raw_road.buffer(39.99, quad_segs=64), STEP)
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
        domain.boundary,
        water.boundary,
        retained.boundary,
        transition.boundary,
        set_precision(raw_road, STEP).boundary,
    ]
    if inputs.water_bodies is not None:
        linework += [set_precision(area, STEP).boundary for _, area in water_sources_areas]
    noded = union_all(linework, grid_size=STEP)
    return sorted(polygonize(noded), key=lambda p: (p.bounds, p.area, p.wkb_hex))


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
    sources = water_areas(inputs)
    raw_water = sources[0][1] if len(sources) == 1 else unary_union([area for _, area in sources])
    if raw_road.intersection(raw_water).area:
        raise ValueError("Road/river overlap requires an explicit new ownership decision")
    canonical_domain = set_precision(domain, STEP)
    canonical_road = set_precision(raw_road, STEP)
    water = set_precision(raw_water, STEP)
    body_areas = [(body, set_precision(area, STEP)) for body, area in sources]
    for i, (_, area) in enumerate(body_areas):
        if area.is_empty:
            raise ValueError("Water body has no coverage in the quantized source domain")
        if any(
            set_precision(area, 0).intersection(set_precision(other, 0)).area for _, other in body_areas[:i]
        ):
            raise ValueError("Quantized water body ownership overlaps")
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
    cells = authoring_cells(inputs)
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
    targets: list[tuple[Literal["grass", "water"], Geometry, WaterBody | None]] = [("grass", land, None)]
    targets += [("water", area, body) for body, area in body_areas]
    for surface, target, body in targets:
        water_y = f32(statistics.median(body.elevations)) if body is not None else 0
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
            Patch.model_validate(
                {
                    "surface": surface,
                    "vertices": vertices,
                    "triangles": triangles,
                    "waterBody": body.id if body is not None and inputs.water_bodies is not None else None,
                }
            )
        )
    mesh = Mesh(patches=patches)
    validate_mesh(mesh)
    conform_mesh(mesh)
    if inputs.roads.elevated_decks:
        validate_decks(mesh, inputs)
    return mesh


def conform_mesh(mesh: Mesh) -> None:
    """Subdivide exact collinear T-junctions using existing physical vertices only.

    A cell/target overlay can split one side of a shared edge again after global
    noding. Retain every face's coverage and every vertex; do not snap near misses,
    discard edges, move source geometry or exempt the result from coverage proof.
    """

    def on_edge(p: XZ, a: XZ, b: XZ) -> bool:
        if p in (a, b):
            return False
        px, pz, ax, az, bx, bz = (Fraction(v) for q in (p, a, b) for v in q)
        return (
            (bx - ax) * (pz - az) == (bz - az) * (px - ax)
            and min(ax, bx) <= px <= max(ax, bx)
            and min(az, bz) <= pz <= max(az, bz)
        )

    for patch in mesh.patches:
        points = [(f32(x), f32(z)) for x, _y, z in patch.vertices]
        by_point: dict[XZ, int] = {}
        for i, point in enumerate(points):
            previous = by_point.get(point)
            if previous is not None and f32(patch.vertices[previous][1]) != f32(patch.vertices[i][1]):
                raise ValueError("Inconsistent physical terrain node height")
            by_point[point] = i
        owners: dict[tuple[XZ, XZ], list[int]] = {}
        for ti, face in enumerate(patch.triangles):
            ring = [points[i] for i in face]
            for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
                owners.setdefault(cast(tuple[XZ, XZ], tuple(sorted([a, b]))), []).append(ti)
        exposed = [edge for edge, faces in owners.items() if len(faces) == 1]
        candidates = sorted({p for edge in exposed for p in edge})
        tree = STRtree([Point(p) for p in candidates])
        splits: dict[int, set[int]] = {}
        for a, b in exposed:
            for k in tree.query(LineString([a, b])):
                p = candidates[int(k)]
                if on_edge(p, a, b):
                    splits.setdefault(owners[(a, b)][0], set()).add(by_point[p])
        if not splits:
            continue
        triangles: list[Triangle] = []
        for ti, face in enumerate(patch.triangles):
            fragments = [face]
            for node in sorted(splits.get(ti, set())):
                divided: list[Triangle] = []
                for fragment in fragments:
                    for j in range(3):
                        ia, ib, ic = fragment[j], fragment[(j + 1) % 3], fragment[(j + 2) % 3]
                        if on_edge(points[node], points[ia], points[ib]):
                            divided.extend([(ia, node, ic), (node, ib, ic)])
                            break
                    else:
                        divided.append(fragment)
                fragments = divided
            triangles.extend(fragments)
        patch.triangles = triangles
    validate_mesh(mesh)


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
    natural: list[tuple[Coordinate, Coordinate, Coordinate]] = []
    for patch in mesh.patches:
        for face in patch.triangles:
            natural.append(
                cast(
                    tuple[Coordinate, Coordinate, Coordinate],
                    tuple(tuple(f32(value) for value in patch.vertices[i]) for i in face),
                )
            )
    faces = [Polygon([(v[0], v[2]) for v in t]) for t in natural]
    road_faces = [Polygon([(v[0], v[2]) for v in t]) for t in roads.triangles]
    support = unary_union([*faces, *road_faces])
    tree = STRtree(faces)
    road_tree = STRtree(road_faces)
    grid = inputs.grid
    domain = box(grid.x[0], grid.z[0], grid.x[-1], grid.z[-1])
    minimum = math.inf
    overlaps = 0
    road_overlaps = 0
    for deck in roads.elevated_decks:
        footprint = Polygon([(v[0], v[2]) for v in deck])
        if footprint.difference(domain).area:
            raise ValueError("Elevated deck lacks bounded source coverage")
        for k in road_tree.query(footprint):
            if deck_overlap_separation(deck, roads.triangles[int(k)]) is not None:
                road_overlaps += 1
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
        "natural_overlap_faces": overlaps,
        "ordinary_road_overlap_faces": road_overlaps,
        "minimum_natural_top_separation_m": minimum if math.isfinite(minimum) else None,
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
    payload = mesh.model_dump(by_alias=True, exclude_none=True)
    for patch in payload["patches"]:
        patch["vertices"] = [
            [float(float32_decimal(value)) for value in vertex] for vertex in patch["vertices"]
        ]
    return (json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n").encode("ascii")


def validate_coverage(mesh: Mesh, inputs: LoadedInputs) -> dict[str, JsonValue]:
    validate_mesh(mesh)
    unions: dict[str, Geometry] = {}
    boundaries: dict[str, set[tuple[XZ, XZ]]] = {}
    for surface in sorted({patch.surface for patch in mesh.patches}):
        selected = [patch for patch in mesh.patches if patch.surface == surface]
        faces = [
            Polygon([(patch.vertices[i][0], patch.vertices[i][2]) for i in face])
            for patch in selected
            for face in patch.triangles
        ]
        unions[surface] = unary_union(faces)
        edges: Counter[tuple[XZ, XZ]] = Counter()
        for patch in selected:
            for face in patch.triangles:
                xz = [(patch.vertices[i][0], patch.vertices[i][2]) for i in face]
                for u, v in zip(xz, xz[1:] + xz[:1], strict=True):
                    edges[cast(tuple[XZ, XZ], tuple(sorted([u, v])))] += 1
        if any(count > 2 for count in edges.values()):
            raise ValueError("Nonmanifold terrain edge")
        boundaries[surface] = {edge for edge, count in edges.items() if count == 1}
        actual = unary_union([LineString(edge) for edge in sorted(boundaries[surface])])
        if (
            actual.difference(unions[surface].boundary).length
            or unions[surface].boundary.difference(actual).length
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
    if inputs.water_bodies is not None:
        proof["water_bodies"] = validate_body_sources(mesh, inputs)
    return proof


def validate_body_sources(mesh: Mesh, inputs: LoadedInputs) -> dict[str, JsonValue]:
    """Tie every labelled output patch to its own source outline, samples and proxy level."""
    expected = water_areas(inputs)
    ids = {body.id for body, _ in expected}
    for patch in mesh.patches:
        if (patch.surface == "water" and patch.water_body not in ids) or (
            patch.surface != "water" and patch.water_body is not None
        ):
            raise ValueError("Unexpected output water body identity")
    proof: dict[str, JsonValue] = {}
    cells = authoring_cells(inputs)
    for body, area in expected:
        selected = [patch for patch in mesh.patches if patch.water_body == body.id]
        level = f32(statistics.median(body.elevations))
        if not selected or any(v[1] != level for patch in selected for v in patch.vertices):
            raise ValueError("Water body patch has missing coverage or wrong proxy level")
        actual = unary_union(
            [
                Polygon([(patch.vertices[i][0], patch.vertices[i][2]) for i in face])
                for patch in selected
                for face in patch.triangles
            ]
        )
        snapped = set_precision(area, STEP)
        target = unary_union(
            [polygon for cell in cells for polygon in polygons(intersection(cell, snapped, grid_size=STEP))]
        )
        if target.difference(actual).area or actual.difference(target).area:
            raise ValueError("Water body output does not cover its declared arrangement geometry")
        source_holes = [Polygon(ring) for polygon in polygons(area) for ring in polygon.interiors]
        planned_holes = [Polygon(ring) for polygon in polygons(target) for ring in polygon.interiors]
        if (
            len(source_holes) != len(planned_holes)
            or any(
                sum(hole.intersection(planned).area > 0 for planned in planned_holes) != 1
                for hole in source_holes
            )
            or any(
                sum(hole.intersection(planned).area > 0 for hole in source_holes) != 1
                for planned in planned_holes
            )
        ):
            raise ValueError("Water body source holes changed in the declared arrangement")
        payload = json.dumps(body.model_dump(), sort_keys=True, separators=(",", ":"), allow_nan=False)
        proof[body.id] = {
            "source_sha256": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
            "geometry_sha256": geometry_sha256(Mesh(patches=selected)),
            "source_observations": len(body.elevations),
            "source_elevation_min_m": min(body.elevations),
            "source_elevation_max_m": max(body.elevations),
            "source_median_m": statistics.median(body.elevations),
            "float32_proxy_level_m": level,
            "provenance": body.provenance,
            "planned_missing_area_m2": 0,
            "planned_extra_area_m2": 0,
            "source_missing_area_m2": area.difference(target).area,
            "source_extra_area_m2": target.difference(area).area,
            "source_boundary_displacement_m": area.boundary.hausdorff_distance(target.boundary),
            "preserved_source_holes": len(source_holes),
        }
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
