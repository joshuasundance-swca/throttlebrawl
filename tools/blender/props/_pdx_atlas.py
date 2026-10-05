"""Pacific Northwest facade panels with tile-local UVs and no baked words."""
import json
from functools import lru_cache
from pathlib import Path

from _lib import text_panel


@lru_cache(maxsize=1)
def layout():
    path = Path(__file__).resolve().parents[3] / "packs/region-pnw/assets/textures/atlas/pacific-northwest-layout.json"
    return json.loads(path.read_text(encoding="utf-8"))


def atlas_panel(name, mats, mat, parent, width, height, centre, tile_id, repeats=1):
    unit = height/repeats
    ob = text_panel(name, mats, mat, parent, width, unit, centre)
    for key in ("text_surface", "width_m", "height_m"):
        del ob[key]
    ob["atlas_tile"] = tile_id
    sheet = layout()
    a, b, c, d = sheet["tiles"][tile_id]["rect"]
    inset = 0.5 / sheet["size"]
    for loop in ob.data.uv_layers.active.data:
        u, v = loop.uv
        loop.uv = (min(c-inset, max(a+inset, a+(c-a)*u)),
                   1-min(d-inset, max(b+inset, b+(d-b)*(1-v))))
    if repeats > 1:
        mesh = ob.data
        vertices = [tuple(v.co) for v in mesh.vertices]
        corners = list(mesh.polygons[0].vertices)
        uvs = [tuple(loop.uv) for loop in mesh.uv_layers.active.data]
        points, faces = [], []
        for k in range(repeats):
            offset = (k-(repeats-1)/2)*unit
            points.extend((x, y, z+offset) for x, y, z in vertices)
            faces.append([k*4+i for i in corners])
        mesh.clear_geometry()
        mesh.from_pydata(points, [], faces)
        layer = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for j, i in enumerate(polygon.loop_indices):
                layer.data[i].uv = uvs[j]
    return ob
