// stream: chunk activation around the stream focus points (docs/architecture.md, "Chunks").
// M1 packs a region into one chunk with one page per edge, so activation builds the whole road
// network at load, and the "hold the sim until the data it needs is loaded" contract is a no-op
// that always says ready. assets-1 owns this folder after app-1.
import {
  createRoadNetwork,
  createRouteProgress,
  type BakedNetworkBundle,
  type BakedRoute,
  type RoadNetwork,
  type RouteProgress,
} from '../road';

export interface FocusPoint {
  x: number;
  z: number;
}

export interface RegionStream {
  /** The road network handle: the one object the sim, render and camera all read. */
  readonly road: RoadNetwork;
  /** A route's distance-to-finish table over this network. */
  routeFor(route: BakedRoute): RouteProgress;
  /** True when every profile page the sim's required radius needs is resident. */
  isReady(): boolean;
  /** Stream focus points (sim anchors plus the camera). Drives visual chunks only, never the sim. */
  update(focus: readonly FocusPoint[]): void;
}

/** Activates a region's single M1 chunk. */
export function activateRegion(bundle: BakedNetworkBundle): RegionStream {
  const road = createRoadNetwork(bundle);
  const routes = new Map<string, RouteProgress>();
  return {
    road,
    routeFor(route) {
      let r = routes.get(route.id);
      if (!r) {
        r = createRouteProgress(road, route);
        routes.set(route.id, r);
      }
      return r;
    },
    isReady: () => true,
    update: () => {},
  };
}
