// The swappable look layer (docs/architecture.md, "Look layer (swappable)"). Views ask for
// materials by kind and never build Three.js materials themselves, so changing the look changes
// one module. The walking skeleton ships one placeholder: flat-shaded low-poly, chosen because it
// reads at speed, not as a style pick.
import {
  Color,
  Fog,
  HemisphereLight,
  DirectionalLight,
  MeshLambertMaterial,
  type Material,
  type Scene,
} from 'three';

export type MaterialKind = 'road' | 'shoulder' | 'marking' | 'post' | 'water' | 'bike' | 'rider' | 'sky';

export interface LookEnv {
  timeOfDay: string;
}

export interface LookStyle {
  readonly id: string;
  material(kind: MaterialKind, params?: { color?: string }): Material;
  setupScene(scene: Scene, env: LookEnv): void;
}

const PALETTE: Record<MaterialKind, string> = {
  road: '#44474d',
  shoulder: '#8a8170',
  marking: '#f2e6c8',
  post: '#e8e2c8',
  water: '#19b5b0',
  bike: '#2b2b2b',
  rider: '#f2c14e',
  sky: '#f6b26b',
};

export function createFlatLook(): LookStyle {
  const cache = new Map<string, Material>();
  return {
    id: 'flat-lowpoly',
    material(kind, params) {
      const color = params?.color ?? PALETTE[kind];
      const key = `${kind}:${color}`;
      let m = cache.get(key);
      if (!m) {
        m = new MeshLambertMaterial({ color: new Color(color), flatShading: true, vertexColors: false });
        cache.set(key, m);
      }
      return m;
    },
    setupScene(scene, env) {
      const sky = env.timeOfDay === 'night' ? '#1b1f3b' : PALETTE.sky;
      scene.background = new Color(sky);
      // Threats render out to at least 200 m; fog only starts beyond that.
      scene.fog = new Fog(sky, 220, 700);
      scene.add(new HemisphereLight('#fff4e0', '#3a5a60', 1.6));
      const sun = new DirectionalLight('#ffe2b0', 1.8);
      sun.position.set(-0.6, 1, 0.4);
      scene.add(sun);
    },
  };
}
