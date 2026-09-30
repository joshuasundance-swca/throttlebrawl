// The swappable look layer (docs/architecture.md, "Look layer (swappable)"). Views ask for
// materials by kind and never build Three.js materials themselves, so changing the look changes
// one module. M1 ships one placeholder: flat-shaded low-poly, chosen because it reads at speed,
// not as a style pick [default].
import {
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  FrontSide,
  HemisphereLight,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  type Scene,
} from 'three';

export type MaterialKind =
  | 'road'
  | 'shoulder'
  | 'shortcut'
  | 'marking'
  | 'markingCenter'
  | 'rampMark'
  | 'post'
  | 'rail'
  | 'deck'
  | 'water'
  | 'bike'
  | 'rider'
  | 'vehicle'
  | 'ped'
  | 'prop'
  | 'weapon'
  | 'glint'
  | 'lightbar'
  | 'sky';

export interface MaterialParams {
  color?: string;
  /** Multiply by the geometry's per-vertex colours (merged primitive views use this). */
  vertexColors?: boolean;
  /** Draw both faces (vertical strips such as rails and deck fascias). */
  doubleSided?: boolean;
}

export interface LookEnv {
  timeOfDay: string;
  weather?: string;
}

export interface LookStyle {
  readonly id: string;
  material(kind: MaterialKind, params?: MaterialParams): Material;
  setupScene(scene: Scene, env: LookEnv): void;
}

/**
 * Threats (traffic, riders, the cop, hazards) render out to at least this far: fog and draw
 * distance must never hide them (docs/architecture.md, `minThreatDrawM`).
 */
export const MIN_THREAT_DRAW_M = 200;

const PALETTE: Record<MaterialKind, string> = {
  road: '#44474d',
  shoulder: '#8a8170',
  shortcut: '#b08a5a',
  marking: '#f2efe6',
  markingCenter: '#f2c14e',
  rampMark: '#ff7a1a',
  post: '#e8e2c8',
  rail: '#cfd3d6',
  deck: '#a39c90',
  water: '#19b5b0',
  bike: '#2b2b2b',
  rider: '#f2c14e',
  vehicle: '#ffffff',
  ped: '#ffffff',
  prop: '#ffffff',
  weapon: '#9aa3ab',
  glint: '#fffbe0',
  lightbar: '#ff2a2a',
  sky: '#f6b26b',
};

/** Unlit kinds: they must read as light sources (the cop's bar, the steal glint). */
const UNLIT = new Set<MaterialKind>(['glint', 'lightbar']);

const SKY_BY_TIME: Record<string, string> = {
  dawn: '#f3c6a5',
  noon: '#8fd3f0',
  'golden-hour': '#f6b26b',
  dusk: '#c9728a',
  night: '#1b1f3b',
};

export function createFlatLook(): LookStyle {
  const cache = new Map<string, Material>();
  return {
    id: 'flat-lowpoly',
    material(kind, params) {
      const vertexColors = params?.vertexColors ?? false;
      // Vertex-coloured geometry carries its own colours, so the base stays white.
      const color = params?.color ?? (vertexColors ? '#ffffff' : PALETTE[kind]);
      const doubleSided = params?.doubleSided ?? false;
      const key = `${kind}:${color}:${vertexColors ? 'v' : '-'}:${doubleSided ? 'd' : '-'}`;
      let m = cache.get(key);
      if (!m) {
        const side = doubleSided ? DoubleSide : FrontSide;
        m = UNLIT.has(kind)
          ? new MeshBasicMaterial({ color: new Color(color), vertexColors, side })
          : new MeshLambertMaterial({ color: new Color(color), flatShading: true, vertexColors, side });
        cache.set(key, m);
      }
      return m;
    },
    setupScene(scene, env) {
      const sky = SKY_BY_TIME[env.timeOfDay] ?? PALETTE.sky;
      scene.background = new Color(sky);
      // Threats render out to at least 200 m; fog only starts beyond that.
      scene.fog = new Fog(sky, MIN_THREAT_DRAW_M + 20, 700);
      const night = env.timeOfDay === 'night';
      scene.add(new HemisphereLight('#fff4e0', '#3a5a60', night ? 0.7 : 1.6));
      const sun = new DirectionalLight(night ? '#9fb0ff' : '#ffe2b0', night ? 0.6 : 1.8);
      sun.position.set(-0.6, 1, 0.4);
      scene.add(sun);
    },
  };
}
