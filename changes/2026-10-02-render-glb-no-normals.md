---
kind: changed
audience: dev
---
Seven scenery models (the conifers, row houses, cable car, sawmill, trestle bent, fog banks and power pole) now ship without vertex normals, and the game rebuilds each face's normal from its corners when it loads them. Their shading is unchanged: the rebuilt normals match the old ones within 0.02 degrees on every triangle. The build is 121 KB smaller. Models whose faces are not flat or whose winding disagrees with their normals (the tow truck, boat, palms, mangroves and skiff), and the two with sign text (the bait shack and road signs), keep their normals. The build now never inlines a model into the JavaScript: the trestle bent and power pole fell under the 4 KB inlining limit, which would have put them in the first-load bundle and loaded the trestle for every region.
