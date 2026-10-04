"""Audit exported tessellation against the builders' outward polygon normals.

Closed parts have already run recalc_face_normals in their builder; open panels
have explicit winding. A warped quad can still tessellate into a triangle facing
the opposite way. Freeze Blender's exact loop triangles and reverse only those
triangles, without changing vertices, diagonals, roles, UVs or point attributes.
"""

import json

import bmesh
import bpy


def outward_references(me):
    """Re-derive closed components independently; open panels keep authored fronts."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    pending = set(bm.faces)
    while pending:
        first = min(pending, key=lambda face: face.index)
        component, stack = set(), [first]
        while stack:
            face = stack.pop()
            if face in component:
                continue
            component.add(face)
            stack.extend(other for edge in face.edges for other in edge.link_faces if other not in component)
        pending -= component
        if all(len(edge.link_faces) == 2 for face in component for edge in face.edges):
            bmesh.ops.recalc_face_normals(bm, faces=sorted(component, key=lambda face: face.index))
    bm.normal_update()
    normals = [face.normal.copy() for face in bm.faces]
    bm.free()
    return normals


def prepare_winding():
    """Print one auditable JSON line; process shared mesh datablocks only once."""
    rows = []
    for me in sorted(bpy.data.meshes, key=lambda mesh: mesh.name):
        me.calc_loop_triangles()
        vertices = [vertex.co.copy() for vertex in me.vertices]
        references = outward_references(me)
        records = []
        before = 0
        degenerate = 0
        for triangle in me.loop_triangles:
            indices = list(triangle.vertices)
            loops = list(triangle.loops)
            normal = references[triangle.polygon_index]
            a, b, c = (vertices[index] for index in indices)
            cross = (b - a).cross(c - a)
            degenerate += cross.length_squared == 0
            wrong = cross.dot(normal) < 0
            before += wrong
            if wrong:
                indices[1], indices[2] = indices[2], indices[1]
                loops[1], loops[2] = loops[2], loops[1]
            records.append((indices, loops, triangle.material_index, normal))
        if before:
            # Snapshot before clearing geometry. Existing scripts use scalar
            # point attributes (_SWAY); fail visibly if a new kind needs copying.
            attributes = []
            uv_names = {layer.name for layer in me.uv_layers}
            # These Blender built-ins are restored explicitly by from_pydata,
            # material_index below and use_smooth=False on every output face.
            builtins = {"position", "material_index", "sharp_face", "sharp_edge"}
            for attribute in me.attributes:
                if (attribute.name.startswith(".") or attribute.is_internal or attribute.name in uv_names
                        or attribute.name in builtins):
                    continue
                if attribute.domain != "POINT" or attribute.data_type != "FLOAT":
                    raise RuntimeError(f"{me.name}: unsupported attribute {attribute.name}")
                attributes.append((attribute.name, [item.value for item in attribute.data]))
            uvs = [(layer.name, [tuple(item.uv) for item in layer.data]) for layer in me.uv_layers]
            me.clear_geometry()
            me.from_pydata(vertices, [], [record[0] for record in records])
            for polygon, record in zip(me.polygons, records):
                polygon.material_index = record[2]
                polygon.use_smooth = False
            for name, values in attributes:
                attribute = me.attributes.get(name) or me.attributes.new(name, "FLOAT", "POINT")
                for item, value in zip(attribute.data, values):
                    item.value = value
            for name, values in uvs:
                layer = me.uv_layers.get(name) or me.uv_layers.new(name=name)
                for polygon, record in zip(me.polygons, records):
                    for loop, source in zip(polygon.loop_indices, record[1]):
                        layer.data[loop].uv = values[source]
            me.update()
        after = 0
        me.calc_loop_triangles()
        if len(me.loop_triangles) != len(records):
            raise RuntimeError(f"{me.name}: winding repair changed the triangle count")
        for triangle, record in zip(me.loop_triangles, records):
            a, b, c = (me.vertices[index].co for index in triangle.vertices)
            normal = record[3]
            after += (b - a).cross(c - a).dot(normal) < 0
        if after:
            raise RuntimeError(f"{me.name}: {after} triangles still oppose their outward reference")
        rows.append({"mesh": me.name, "triangles": len(records), "before": before,
                     "after": after, "degenerate": degenerate})
    print("WINDING_AUDIT " + json.dumps(rows, sort_keys=True, separators=(",", ":")))
