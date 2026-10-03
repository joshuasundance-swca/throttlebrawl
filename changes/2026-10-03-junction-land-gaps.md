---
kind: fixed
audience: player
---
The land at two San Francisco junctions no longer has slots in it. At Russian Hill's Jones Street choice, the higher road's land used to stand 3 to 4 m over the lower roads. It hung over half their lanes, and through slots in it you saw the sea 40 m below or the lower land 6 m below. That land now stops beside the lower road. Past each lower road's own strip of land the hill now drops away, as it does at other hill edges. At the Park Cut turn-off, a 6 cm crack of water showed between the verge and the land past it, and it is now closed.

Two land-build fixes did this, and both apply to every network. First, a strip now looks for a lower road from the verge outward. Before, it started 4 m out and missed a lower road right beside the verge. Second, a strip that runs on to another road now also runs on to another road's land that lies within 6 m past its edge, so no slot stays between them. Only 9 rows on 3 networks needed that second fix. The geometry sweep's known-gap list is now empty. The sweep also has a new check: no road's surface has land 1.5 m or more over it. Not seen in a browser yet.
