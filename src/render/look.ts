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
  type Texture,
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
  // Playtest 1b: ground beside the road (sand, under the roadside zones).
  | 'land'
  | 'water'
  | 'bike'
  | 'rider'
  | 'vehicle'
  | 'ped'
  | 'prop'
  | 'weapon'
  | 'glint'
  | 'lightbar'
  | 'sky'
  // M2 render-2's feel visuals.
  | 'spark'
  | 'splash'
  | 'tint'
  | 'flash'
  | 'board';

export interface MaterialParams {
  color?: string;
  /** Multiply by the geometry's per-vertex colours (merged primitive views use this). */
  vertexColors?: boolean;
  /** Draw both faces (vertical strips such as rails and deck fascias). */
  doubleSided?: boolean;
  /** A texture (a board's printed face). */
  map?: Texture;
  /**
   * A screen overlay (the slow-motion tint): transparent, drawn over everything, no depth and no
   * fog. Its owner animates the material's `opacity`, so it is one material per overlay colour.
   */
  overlay?: boolean;
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
  land: '#d8c08c',
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
  spark: '#ffd25a',
  splash: '#e8fbff',
  tint: '#3a5cff',
  flash: '#ffffff',
  board: '#ffffff',
};

/** Unlit kinds: they must read as light sources (the cop's bar, the steal glint). */
const UNLIT = new Set<MaterialKind>(['glint', 'lightbar', 'spark', 'tint', 'board']);

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
      // Vertex-coloured geometry carries its own colours, so the base stays white; an overlay's
      // vertex colours only carry its vignette alpha, so it keeps its kind's colour.
      const color = params?.color ?? (vertexColors && !params?.overlay ? '#ffffff' : PALETTE[kind]);
      const doubleSided = params?.doubleSided ?? false;
      const map = params?.map ?? null;
      const overlay = params?.overlay ?? false;
      const key = `${kind}:${color}:${vertexColors ? 'v' : '-'}:${doubleSided ? 'd' : '-'}:${map?.uuid ?? '-'}:${overlay ? 'o' : '-'}`;
      let m = cache.get(key);
      if (!m) {
        const side = doubleSided ? DoubleSide : FrontSide;
        if (overlay) {
          m = new MeshBasicMaterial({
            color: new Color(color),
            vertexColors,
            side,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            fog: false,
          });
        } else if (UNLIT.has(kind)) {
          m = new MeshBasicMaterial({ color: new Color(color), vertexColors, side, map });
        } else if (kind === 'flash') {
          // A hit's flash: the body's own colours, washed toward white.
          m = new MeshLambertMaterial({
            color: new Color(color),
            flatShading: true,
            vertexColors,
            side,
            emissive: new Color('#ffffff'),
            emissiveIntensity: 0.6,
          });
        } else {
          m = new MeshLambertMaterial({
            color: new Color(color),
            flatShading: true,
            vertexColors,
            side,
            map,
          });
        }
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
