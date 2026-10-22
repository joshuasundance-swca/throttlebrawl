// Original AI-authored procedural geometry: a generic temperate broadleaf silhouette, not a species model.
import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry } from 'three';

/** A low-poly trunk and lobed, rounded crown, rooted at y=0. No external assets. */
export function deciduousGeometry(profile: 'rural' | 'park' = 'rural'): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const add = (geometry: BufferGeometry, color: string) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = flat.getAttribute('position');
    const normal = flat.getAttribute('normal');
    const tone = new Color(color);
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colors.push(tone.r, tone.g, tone.b);
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  };
  add(new CylinderGeometry(0.22, 0.38, 6, 6).translate(0, 3, 0), '#69523c');
  add(new CylinderGeometry(0.12, 0.2, 3, 5).rotateZ(0.5).translate(-0.6, 5.2, 0), '#69523c');
  add(new CylinderGeometry(0.12, 0.2, 3, 5).rotateZ(-0.6).translate(0.6, 5.3, 0), '#69523c');
  if (profile === 'park') {
    // A broader, layered grove crown, within the planner's existing 4.8m radius / 11.2m top.
    // The central trunk and side branches above are identical to the ordinary rural tree.
    add(new IcosahedronGeometry(1, 0).scale(3, 2.6, 2.9).translate(-1.5, 7.1, 0), '#4e693b');
    add(new IcosahedronGeometry(1, 0).scale(2.9, 2.7, 2.9).translate(1.5, 7.5, 0.2), '#617b42');
    add(new IcosahedronGeometry(1, 0).scale(3, 2.6, 2.8).translate(0, 8.5, -1.2), '#78934e');
    add(new IcosahedronGeometry(1, 0).scale(3.4, 2.6, 2.9).translate(0, 7.6, 1.2), '#597640');
  } else {
    add(new IcosahedronGeometry(1, 0).scale(2.8, 2.7, 2.6).translate(-1.4, 6.5, 0), '#56703b');
    add(new IcosahedronGeometry(1, 0).scale(2.5, 2.9, 2.6).translate(1.5, 7.1, 0.4), '#617d42');
    add(new IcosahedronGeometry(1, 0).scale(2.6, 2.5, 2.5).translate(0, 8.7, -0.8), '#70894b');
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}
