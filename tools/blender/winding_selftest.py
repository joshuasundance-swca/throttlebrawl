"""Blender regression: detect inward geometry and preserve UV/sway while correcting it."""

import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "props"))
from _winding import outward_references, prepare_winding

bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new("inward_tetrahedron")
vertices = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
faces = [(0, 1, 2), (0, 3, 1), (0, 2, 3), (1, 3, 2)]
me.from_pydata(vertices, [], faces)
me.materials.append(bpy.data.materials.new("paint_primary"))
ob = bpy.data.objects.new("fixture", me)
bpy.context.scene.collection.objects.link(ob)
sway = me.attributes.new("_SWAY", "FLOAT", "POINT")
for i, item in enumerate(sway.data):
    item.value = i / 3
uv = me.uv_layers.new(name="UVMap")
for i, item in enumerate(uv.data):
    item.uv = (i / 12, 1 - i / 12)
original_uv = [{tuple(me.vertices[loop.vertex_index].co): tuple(uv.data[loop.index].uv)
                for loop in (me.loops[index] for index in polygon.loop_indices)} for polygon in me.polygons]
references = outward_references(me)
assert sum(polygon.normal.dot(normal) < 0 for polygon, normal in zip(me.polygons, references)) == 4
prepare_winding()
assert len(me.polygons) == 4
assert [tuple(vertex.co) for vertex in me.vertices] == vertices
assert [round(item.value, 6) for item in me.attributes["_SWAY"].data] == [0, 0.333333, 0.666667, 1]
assert me.materials[0].name == "paint_primary"
assert all(polygon.normal.dot(normal) > 0 for polygon, normal in zip(me.polygons, references))
for polygon, original in zip(me.polygons, original_uv):
    assert polygon.material_index == 0
    for index in polygon.loop_indices:
        loop = me.loops[index]
        assert tuple(me.uv_layers["UVMap"].data[index].uv) == original[tuple(me.vertices[loop.vertex_index].co)]
print("WINDING_SELFTEST_OK: detected 4 inward faces; preserved vertices, roles, UVs and _SWAY")
