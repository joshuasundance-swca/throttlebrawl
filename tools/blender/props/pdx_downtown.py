"""Portland street fronts, stackable pink stone modules and word-free food carts."""
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene, text_panel
from _pdx_atlas import atlas_panel
from _vehicle_lib import polygon

COLOURS = {
    "stone": "#cf9eaa", "concrete": "#a6aaa1", "trim": "#d1d3bf",
    "steel_dark": "#34444b", "glass": "#425969", "wood": "#887451",
    "art": "#ffffff", "sign_face": "#d6dccb", "tyre": "#1c282b",
    "brick": "#846059",
}
ROOTS = ["pdx_cast_iron", "pdx_brick_loft", "pdx_office_block", "pdx_pink_tower_base",
         "pdx_pink_tower_mid", "pdx_pink_tower_crown", "pdx_food_cart_a", "pdx_food_cart_b",
         "pdx_food_cart_c", "pdx_bike_rack"]
XS = [-225, -175, -125, -75, -25, 25, 75, 125, 175, 225]
OUTLINE = [(-12, 0), (12, 0), (15, -3), (15, -21), (12, -24), (-12, -24), (-15, -21), (-15, -3)]


def facade_ring(root, name, mats, outline, height, tile, role, bottom=0, front_band=None, floors=1):
    panels = []
    for i, (a, b) in enumerate(zip(outline, outline[1:] + outline[:1])):
        dx, df = b[0]-a[0], b[1]-a[1]
        low, tall = front_band if i == 0 and front_band else (bottom, height)
        ob = atlas_panel(f"{name}_facade_{i}", mats, role, root, math.hypot(dx, df), tall,
                         (0, 0, 0), tile, repeats=floors)
        ob.location = P((a[0]+b[0])/2, (a[1]+b[1])/2, low+tall/2)
        ob.rotation_euler.z = math.atan2(-df, dx)
        panels.append(ob)
    return panels


def slab(mb, outline, low, high, role, sides=True):
    if sides:
        mb.loft([[P(x, f, low) for x, f in outline], [P(x, f, high) for x, f in outline]], role)
    else:
        for y, direction in ((low, -1), (high, 1)):
            polygon(mb, [(x, f, y) for x, f in outline], role, (0, 0, direction))


def building(name, root, mats, width, depth, height, tile):
    mb = MB(mats)
    mb.box(-depth+0.02, -0.02, -width/2+0.02, width/2-0.02, 0, height, "concrete")
    outline = [(-width/2, 0), (width/2, 0), (width/2, -depth), (-width/2, -depth)]
    role = "brick" if name == "pdx_brick_loft" else "concrete"
    # Ribbon tile carries four bands; two repeats give eight real storeys.
    floors = {"pdx_cast_iron": 3, "pdx_brick_loft": 6, "pdx_office_block": 2}[name]
    panels = facade_ring(root, name, mats, outline, height, tile, role, floors=floors)
    if name == "pdx_cast_iron":
        panels[0].location.y = 0.002
        # Geometry gives the arcade a rhythm; the atlas supplies its tall arched panes.
        for x in (-7.2, -4.8, -2.4, 0, 2.4, 4.8, 7.2):
            mb.box(-0.30, 0, x-0.12, x+0.12, 0, 4.2, "trim")
        mb.box(-0.65, 0, -7.5, 7.5, 11.5, 12, "trim")
        for x in (-6, -3, 0, 3, 6):
            mb.box(-0.65, 0, x-0.16, x+0.16, 11.0, 11.5, "trim")
    elif name == "pdx_brick_loft":
        panels[0].location.y = 0.002
        mb.box(-0.9, 0, -8, 8, 0, 0.9, "concrete")
        mb.box(-0.12, -0.001, -3, 3, 0.9, 4.1, "steel_dark")
        for x in (-2.2, 2.2):
            mb.box(-12.4, -12.2, x-0.12, x+0.12, 21, 23, "steel_dark")
        mb.cyl((0, -12.3, 23.7), "z", 2.4, 1.1, 8, "wood")
        mb.cone((0, -12.3, 24.8), 2.5, 25, 8, "steel_dark")
    else:
        mb.box(-depth, 0, -width/2, width/2, 27.5, 28, "trim")
        # The lobby is on the ground-floor facade tile, with no floating coplanar door quad.
    mb.build(name+"_body", mats, root)


def tower(name, root, mats, module):
    mb = MB(mats)
    h = {"base": 7, "mid": 14, "crown": 8}[module]
    root["module_m"] = h
    if module == "mid":
        for y, direction in ((0, -1), (h, 1)):
            polygon(mb, [(x, f, y) for x, f in OUTLINE], "stone", (0, 0, direction))
        facade_ring(root, name, mats, OUTLINE, h, "granite-bands", "stone")
    elif module == "base":
        slab(mb, OUTLINE, 0, h, "stone", sides=False)
        facade_ring(root, name, mats, OUTLINE, h, "granite-bands", "stone", front_band=(5.7, 1.3))
        mb.front_quad(0, -12, 12, 0, 5.7, "glass")
    else:
        slab(mb, OUTLINE, 0, 1, "stone")
        smaller = [(x*0.78, -12+(f+12)*0.78) for x, f in OUTLINE]
        slab(mb, smaller, 1, 7, "stone", sides=False)
        facade_ring(root, name, mats, smaller, 6, "granite-bands", "stone", bottom=1)
        mb.box(-16, -8, -6, 6, 7, 8, "steel_dark")
    mb.build(name+"_body", mats, root)


def cart(name, root, mats, idx):
    mb = MB(mats)
    # Serving side occupies z=0; chassis and trailer are behind it.
    mb.box(-2.4, -0.02, -2.5, 2.5, 0.45, 2.7, "concrete")
    mb.box(-2.4, 0, -2.5, 2.5, 2.7, 3, "steel_dark")
    for x in (-2.3, 2.3):
        mb.cyl((x, -1.5, 0.4), "x", 0.4, 0.15, 6, "tyre")
    atlas_panel(name+"_front", mats, "art", root, 5, 2.25, (0, 0, 1.575), f"food-cart-front-{idx}")
    mb.box(0.02, 0.06, -1.5, 1.5, 1.4, 1.55, "trim")
    # The serving ledge and projecting awning clear the atlas face without depth fighting.
    mb.box(-0.05, 0.8, -2.4, 2.4, 2.6, 2.68, "trim")
    text_panel(name+"_name", mats, "sign_face", root, 3.6, 0.45, (0, 0.02, 2.28))
    # Picnic furniture to one side, still behind the serving-side placement seam.
    mb.box(-2.2, -0.6, 3.2, 5.4, 0.75, 0.85, "wood")
    for f in (-2.3, -0.5):
        mb.box(f-0.12, f+0.12, 3.0, 5.6, 0.4, 0.5, "wood")
    for x in (3.5, 5.1):
        mb.box(-1.85, -0.95, x-0.09, x+0.09, 0, 0.75, "steel_dark")
    mb.build(name+"_body", mats, root)


def bike_rack(name, root, mats):
    mb = MB(mats)
    # Two low-poly wheel silhouettes and narrow frame strips keep both bikes within 40 triangles.
    for f, offset in ((-0.2, -0.25), (-0.6, 0.25)):
        for x in (-0.8, 0.8):
            pts = [(x+offset+0.35*math.cos(k*math.tau/5), f, 0.35+0.35*math.sin(k*math.tau/5))
                   for k in range(5)]
            polygon(mb, pts, "tyre", (0, 1, 0))
        for a, b in [((-0.8, 0.35), (-0.3, 0.95)), ((-0.3, 0.95), (0.65, 1.03)),
                     ((0.65, 1.03), (0.8, 0.35)), ((-0.8, 0.35), (0.8, 0.35))]:
            dx, dy = b[0]-a[0], b[1]-a[1]
            length = math.hypot(dx, dy)
            nx, ny = -dy/length*0.025, dx/length*0.025
            polygon(mb, [(a[0]+offset+nx, f, a[1]+ny), (b[0]+offset+nx, f, b[1]+ny),
                         (b[0]+offset-nx, f, b[1]-ny), (a[0]+offset-nx, f, a[1]-ny)],
                    "trim", (0, 1, 0))
        polygon(mb, [(-0.48+offset, f, 0.95), (-0.12+offset, f, 0.95), (-0.3+offset, f, 1.03)],
                "tyre", (0, 1, 0))
        polygon(mb, [(0.62+offset, f, 1.02), (0.9+offset, f, 1.1), (0.62+offset, f, 1.1)],
                "steel_dark", (0, 1, 0))
    for x in (-0.45, 0.45):
        mb.front_quad(0, x-0.04, x+0.04, 0, 1.5, "steel_dark")
    mb.front_quad(0, -0.49, 0.49, 1.5, 1.6, "steel_dark")
    mb.build(name+"_body", mats, root)


reset_scene()
mats = make_mats(COLOURS)
for name, x in zip(ROOTS, XS):
    root = empty(name, loc=(x, 0, 0))
    if name == "pdx_cast_iron":
        building(name, root, mats, 15, 14, 12, "cast-iron-round-arches")
    elif name == "pdx_brick_loft":
        building(name, root, mats, 30, 22, 21, "warehouse-steel-sash-1")
    elif name == "pdx_office_block":
        building(name, root, mats, 30, 22, 28, "ribbon-windows-1")
    elif "pink_tower" in name:
        tower(name, root, mats, name.rsplit("_", 1)[1])
    elif "food_cart" in name:
        cart(name, root, mats, ord(name[-1])-ord("a")+1)
    else:
        bike_rack(name, root, mats)
export(out_path(), texcoords=True, normals=False)
