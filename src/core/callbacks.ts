// Capabilities the module graph does not draw reach a module as plain functions, typed here
// (docs/architecture.md, "Dependency rules"; M1 app-1). src/main.ts and app/ wire them:
//   onCopyReport          dev/report  -> app -> ui       (the pause screen's "copy debug report")
//   resumeAudio           audio       -> app -> platform (the start tap)
//   recordTuningChange    replay      -> app -> tuning   (a mid-race change, recorded at a tick)
//   packIndex             content     -> app -> assets   (the manifest's entries)
//   rendererStats         render      -> app -> dev      (perf probe, debug report)
//   roadQueries           road/stream -> app -> dev      (the bot's route)
//   getReplayAndSettings  replay+save -> app -> dev      (the debug file)

/** What the renderer drew last frame, for the perf probe and the debug report. */
export interface RendererStats {
  renderer: string;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  width: number;
  height: number;
  /**
   * The set pieces (boost pads, ramp trucks) the road scene draws for the current race seed: each
   * feature's id, kind, seeded slot (null when it is always there) and world position. Playtest 1c
   * item 2: a seed picks one candidate per slot, and only the picked one is drawn. Optional, so a
   * renderer that draws none may leave it out.
   */
  setPieces?: readonly DrawnSetPiece[];
  /**
   * The road events' props the last frame drew (W-P: cones, flares, signs, people, bales...), from
   * SimSnapshot.props: how many in all and by kind, and the warning signs' words. Optional, so a
   * renderer that draws none may leave it out.
   */
  eventProps?: { total: number; byKind: Readonly<Record<string, number>>; signs: readonly string[] };
}

/** One drawn set piece (RendererStats.setPieces). */
export interface DrawnSetPiece {
  id: string;
  kind: string;
  slot: string | null;
  x: number;
  z: number;
}

export type OnCopyReport = () => Promise<void>;
export type ResumeAudio = () => Promise<void>;
export type RecordTuningChange = (id: string, value: number) => void;
export type RendererStatsFn = () => RendererStats;

/** One asset manifest entry (docs/architecture.md, "Asset manifest"). */
export interface AssetIndexEntry {
  id: string;
  kind: 'mesh' | 'texture' | 'audio' | 'music-stem' | 'image' | 'font' | 'data-page' | 'procedural';
  source: 'baked' | 'remote' | 'procedural';
  path: string;
  bytes: number;
  /** SHA-256 hex, or '' until content-1's indexer computes it. */
  hash: string;
  packId: string;
}
export type PackIndexFn = () => readonly AssetIndexEntry[];

/** One lane of a road section, as the road file stores it (docs/content-packs.md, road file). */
export interface LaneInfo {
  id: string;
  dCenterM: number;
  widthM: number;
  direction: 1 | -1;
  kind: 'drive' | 'shoulder' | 'shortcut';
}

/** The road queries a route follower (the bot) needs, in road coordinates. */
export interface RouteQueries {
  /** Lanes of the section containing s on an edge (edges are numbered as the sim numbers them). */
  lanesAt(edge: number, s: number): readonly LaneInfo[];
  /** Signed curvature at s, 1/m, positive when the road turns right. */
  kappaAt(edge: number, s: number): number;
  /** Metres to the finish along the route, or Infinity off the route. */
  distanceToFinish(edge: number, s: number): number;
  /** An edge's length in metres, or NaN when there is no such edge. */
  edgeLength(edge: number): number;
}
export type RoadQueriesFn = () => RouteQueries | null;

/** What the debug file carries: the last recording and the settings record. */
export interface ReplayAndSettings {
  replay: unknown;
  settings: unknown;
}
export type GetReplayAndSettings = () => ReplayAndSettings;
