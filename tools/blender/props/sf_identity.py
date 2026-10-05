"""Presidio wind-shaped cypress and pale blue-gum silhouettes; original flat geometry."""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene

COLOURS = {"bark": "#4c493c", "foliage_dark": "#284b3c",
           "bark_pale": "#d0caba", "leaf_light": "#7d9e96"}
ICO_TOP = (1 + math.sqrt(5)) / 2 / math.sqrt(1 + ((1 + math.sqrt(5)) / 2)**2)


def cypress(mats):
    root = empty("sf_cypress", loc=(-12, 0, 0))
    mb = MB(["bark", "foliage_dark"], sway=True)
    mb.tube([(0, 0, 0), (0, 0, 1), (0.6, 0, 3.2), (2.3, 0.1, 9.2)],
            [0.65, 0.6, 0.48, 0.24], "bark", sides=5, sways=[0, 0.02, 0.05, 0.2])
    for tip in ((-2, 0.8, 7.9), (4.2, 1, 10.3), (5.3, -1, 12.5)):
        mb.tube([(0.6, 0, 3.2), tip], [0.35, 0.13], "bark", sides=4,
                sways=[0.05, 0.25])
    mb.cur_sway = 1
    for centre, radii in (((-1.3, 0.3, 8.3), (3.6, 2.8, 1.2)),
                         ((2.2, 0.5, 10.3), (4.6, 3, 1.2)),
                         ((4, -0.7, 12.8), (4.7, 3.1, 1.2 / ICO_TOP)),
                         ((5.6, 0.8, 11.3), (3.1, 2.6, 0.85)),
                         ((-2.5, 0.6, 7.4), (2.5, 2, 0.85)),
                         ((3.4, -2, 9.1), (3, 2.4, 0.85))):
        mb.blob(centre, radii, "foliage_dark")
    mb.build("sf_cypress_body", mats, root)


def eucalyptus(mats):
    root = empty("sf_eucalyptus", loc=(12, 0, 0))
    mb = MB(["bark_pale", "leaf_light"], sway=True)
    mb.tube([(0, 0, 0), (0, 0, 1), (-0.3, 0.1, 10), (0.5, 0, 22)],
            [0.5, 0.48, 0.32, 0.12], "bark_pale", sides=4, sways=[0, 0.02, 0.1, 0.4])
    for tip in ((-2, 0.4, 17), (2, -0.7, 19), (-1.5, -1, 21), (1.8, 0.6, 23)):
        mb.tube([(0, 0, 12), tip], [0.16, 0.06], "bark_pale", sides=4,
                sways=[0.15, 0.55])
    mb.cur_sway = 1
    for centre, radii in (((-2, 0.4, 17.7), (1.9, 1.7, 2.2)),
                         ((2, -0.7, 19.8), (1.9, 1.8, 2)),
                         ((-1.5, -1, 21.5), (1.8, 1.5, 2)),
                         ((1.3, 0.6, 23), (1.8, 1.7, 2 / ICO_TOP)),
                         ((0.3, 1.7, 20), (1.7, 1.5, 2.1)),
                         ((-1.2, 0.6, 15.6), (1.8, 1.4, 1.9))):
        mb.blob(centre, radii, "leaf_light")
    mb.build("sf_eucalyptus_body", mats, root)


reset_scene()
mats = make_mats(COLOURS)
cypress(mats)
eucalyptus(mats)
export(out_path(), normals=False)
