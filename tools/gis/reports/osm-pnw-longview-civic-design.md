# Longview civic triangle

## Source selection and intent

This is a separate point-to-point course, preserving Port Shift. Washington Way
runs southwest from its two-way east endpoint, across its mapped bridge to 30th
Avenue, then turns north. Hudson Street and 20th Avenue provide a real triangular
fork/rejoin. The direct diagonal is shorter; the side-street route adds two turns
and a disclosed authored boost pad after the corner. No faster-route claim is made.

The fork at 46.1378867, -122.9417341 and rejoin at 46.1367281, -122.9446825
are common vertices in the cached OSM geometry. Direct ways are 914561053 and
914561052. Detour ways are 5880719 and 53057477, meeting at 46.1383783,
-122.9442186. The backbone continues through Washington ways 5880132,
1503405166, 129381274, 129381273 and 876117692, then 30th way 914535557.
All selected ways permit both directions by their cached tags; the course does not
select the one-way Washington approaches farther east. Absence of a one-way tag
is treated as two-way authoring evidence, not current legal-access verification.
The extract contains no turn-restriction relations.

The approach is deliberately compact: approximately 130 m of source street before
the fork becomes about 88 m of ordinary approach plus the eased junction piece.
The start is 24 m along the approach; its three rows leave 8 m behind the last row.
A 40 m choice window starts about 24 m ahead of the start line, with its inside
edge outside the ordinary lane centre so a straight rider stays on Washington.
The right-side marked choice window precedes the actual fork. Both paths
share the westward run and 30th Avenue finish. Lane widths, eased corners, margins,
traffic connectors, pad and bridge edge protection are arcade authoring. No named
landmark or surveyed bridge dimensions are inferred from a road-only extract.

## Automated acceptance

- The start grid fits before a visible choice window, and a separate finish follows
  the rejoin by a substantial shared ride.
- Both rider paths are allowed, reach the same finish and preserve checkpoints,
  route discovery and deterministic replay. The longer branch reports a detour.
- Each two-way street and branch endpoint has legal forward and reverse ordinary
  traffic connections with finite exits. Branch traffic is opted in explicitly.
- A low-performance bike can complete either path and recover on the soft grass
  margin. Bridge deck edges instead have visible physical protection.
- Junction road meshes support the lane footprint continuously; no roadside solid
  occupies an allowed riding corridor. Test rendered geometry, not just tags.
- Cached OSM and elevation response hashes match provenance. New USGS points are
  keyed independently from Port Shift. No scene-budget or phone acceptance is
  claimed without the coordinator's acceptance evidence.

## Boundaries

This first proof implements one triangle, not the larger civic/lake diamond.
Generic PNW town dressing and a plain far-ground floor provide context. Real
landmark placements, lake trails, traffic signals and surveyed turn restrictions
remain outside the evidence. The coordinator owns route registration, build/perf,
the one served-game check and publication.
