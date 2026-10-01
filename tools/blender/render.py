"""Render a prop GLB from three fixed camera angles (runs INSIDE Blender).

    blender --background --factory-startup --python-exit-code 1 --python render.py -- \
        --glb <file.glb> --out-dir <dir> --prop <name> [--views front34,side,rear34] \
        [--framing fit|fixed] [--engine eevee|workbench]

Ported from the 2026-09-30 prop-trial harness. Outputs <out-dir>/<prop>_<view>.png
(768x512) and <prop>.render.json. Same lights, ground, colour management and cameras for
every prop. Axes: the GLB is glTF (+Y up, prop front toward +Z); Blender's importer turns
that into Z up with the prop front toward -Y, so "front" below is -Y.

Framing:
  fit   (default) - frames the imported bounding box, fitted to the vertical field of view
        (the narrower one), so tall props such as the power pole stay in frame.
  fixed - the trial's nominal framing for tow_truck, boat and palms (the same scale as the
        trial's judging renders).
A grey 1.8 m cylinder (a human-height scale reference) stands beside every prop. Boats
(any GLB with a probe_bow empty) get a sea-coloured ground.
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

# Nominal framing per prop, in Blender coordinates (Z up, front = -Y):
# (target centre, bounding radius in metres). Derived from brief.md's nominal sizes.
FIXED = {
    # truck: ramp foot at the origin, body runs 0..~20 m toward the front (-Y), 0..4.2 m tall
    "tow_truck": ((0.0, -10.0, 2.0), 11.5),
    # boat: origin at the waterline, ~7.5 m long, T-top up to ~3 m
    "boat": ((0.0, 0.0, 0.9), 4.8),
    # palms: three variants at x = -4, 0, +4, up to 10 m tall
    "palms": ((0.0, 0.0, 4.5), 8.5),
}
VIEWS = {  # name: (azimuth in degrees from the prop's front toward its left side (+X), elevation)
    "front34": (35.0, 18.0),
    "side": (90.0, 6.0),
    "front": (0.0, 6.0),  # for variants standing in a row along X, where a side view stacks them
    "rear34": (180.0 + 35.0, 28.0),  # rear quarter from the right: shows the ramp face
}
RES = (768, 512)


def args() -> dict:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"framing": "fit", "engine": "eevee", "prop": "other", "views": "front34,side,rear34"}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-").replace("-", "_")
        out[key] = argv[i + 1]
        i += 2
    return out


def flat(name: str, rgb: tuple, rough: float = 0.9) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return mat


def world_bbox(objs) -> tuple:
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for ob in objs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def pick_engine(scene, want: str) -> str:
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    if want == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"
    return scene.render.engine


def setup_workbench(scene) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = True
    sh.show_cavity = False


def main() -> None:
    a = args()
    glb = Path(a["glb"]).resolve()
    out_dir = Path(a["out_dir"]).resolve()
    prop = a["prop"]
    framing = a["framing"] if prop in FIXED else "fit"
    out_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("RENDER_FAIL no meshes in GLB")
    lo, hi = world_bbox(meshes)

    is_boat = any(o.name == "probe_bow" for o in scene.objects)
    # Ground (or sea for a boat) at Z = 0: the prop's ground plane / waterline.
    bpy.ops.mesh.primitive_plane_add(size=6000.0, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "harness_ground"
    ground.data.materials.append(
        flat("harness_sea", (0.04, 0.22, 0.30), 0.95) if is_boat
        else flat("harness_ground", (0.36, 0.36, 0.34)))

    # 1.8 m human-height reference just behind the prop's rear-left corner (where a rider
    # approaching the truck's ramp would be), visible from all three cameras.
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.25, depth=1.8,
                                        location=(hi.x + 0.6, hi.y + 1.5, 0.9))
    fig = bpy.context.active_object
    fig.name = "harness_scale_1p8m"
    fig.data.materials.append(flat("harness_figure", (0.18, 0.2, 0.24)))

    # Neutral light: one sun (front-left, high) plus a uniform grey world.
    sun_data = bpy.data.lights.new("harness_sun", "SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(3.0)
    sun = bpy.data.objects.new("harness_sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (Vector((0.45, -0.6, 0.75)).normalized()).to_track_quat("Z", "Y").to_euler()
    world = bpy.data.worlds.new("harness_world")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.78, 0.8, 0.82, 1.0)
    bg.inputs["Strength"].default_value = 0.35

    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    engine = pick_engine(scene, a["engine"])
    if engine.startswith("BLENDER_EEVEE"):
        scene.eevee.taa_render_samples = 16
    else:
        setup_workbench(scene)

    cam_data = bpy.data.cameras.new("harness_cam")
    cam_data.lens = 35.0
    cam_data.sensor_fit = "AUTO"
    cam_data.clip_end = 8000.0
    cam = bpy.data.objects.new("harness_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    if framing == "fixed":
        centre, radius = Vector(FIXED[prop][0]), FIXED[prop][1]
    else:
        centre = (lo + hi) / 2
        radius = max((hi - lo).length / 2, 0.5)
    # With sensor_fit AUTO and a landscape frame, cam_data.angle is the HORIZONTAL field of
    # view and the vertical one is narrower. "fit" fits the bounding sphere to the narrower one;
    # "fixed" keeps the trial's horizontal fit, so its renders match the trial's.
    hfov = cam_data.angle
    vfov = 2 * math.atan(math.tan(hfov / 2) * RES[1] / RES[0])
    dist = radius / math.sin((vfov if framing == "fit" else hfov) / 2) * 1.05

    views = [(v, *VIEWS[v]) for v in a["views"].split(",")]
    shots = []
    for name, az, el in views:
        azr, elr = math.radians(az), math.radians(el)
        # front = -Y, left side = +X; azimuth rotates from front toward left.
        d = Vector((math.sin(azr) * math.cos(elr), -math.cos(azr) * math.cos(elr), math.sin(elr)))
        cam.location = centre + d * dist
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        path = out_dir / f"{prop}_{name}.png"
        scene.render.filepath = str(path)
        try:
            bpy.ops.render.render(write_still=True)
        except RuntimeError as exc:  # no GPU context: fall back once, record it
            print("EEVEE_FAIL", exc)
            setup_workbench(scene)
            engine = "BLENDER_WORKBENCH"
            bpy.ops.render.render(write_still=True)
        shots.append({"view": name, "azimuth_deg": az, "elevation_deg": el,
                      "camera_blender": [round(v, 3) for v in cam.location], "png": str(path)})

    info = {
        "glb": str(glb), "prop": prop, "framing": framing, "engine": engine,
        "resolution": list(RES), "lens_mm": cam_data.lens, "distance_m": round(dist, 3),
        "target_blender": [round(v, 3) for v in centre], "radius_m": radius,
        # Blender (x, y, z) -> glTF (x, z, -y)
        "bbox_gltf_min": [round(lo.x, 3), round(lo.z, 3), round(-hi.y, 3)],
        "bbox_gltf_max": [round(hi.x, 3), round(hi.z, 3), round(-lo.y, 3)],
        "shots": shots,
    }
    (out_dir / f"{prop}.render.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print("RENDER_OK", engine, [s["png"] for s in shots])


main()
