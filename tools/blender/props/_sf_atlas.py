"""SF-only atlas panels; leave the Keys helper and its exports unchanged."""
import json
from functools import lru_cache
from pathlib import Path

from _lib import text_panel


@lru_cache(maxsize=1)
def layout():
    path = Path(__file__).resolve().parents[3] / "packs/region-sf/assets/textures/atlas/san-francisco-layout.json"
    return json.loads(path.read_text(encoding="utf-8"))


def atlas_panel(name, mats, mat, parent, width, height, centre, tile_id):
    ob = text_panel(name, mats, mat, parent, width, height, centre)
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
    return ob
