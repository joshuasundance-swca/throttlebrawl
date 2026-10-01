"""Contact sheet: every rendered prop as one row of its three views (optional; needs Pillow).

    python sheet.py <render_dir> <out.png> <prop> [<prop> ...] [--scale 0.6667]

Reads <render_dir>/<prop>.render.json (written by render.py) for each prop's views in order,
and writes one PNG: a label strip per row, then the views side by side. Runs with any Python
that has Pillow; render.mjs skips it with a note when Pillow is missing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

LABEL_H = 26


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    scale = float(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 2 / 3
    if "--scale" in sys.argv:
        args.remove(sys.argv[sys.argv.index("--scale") + 1])
    render_dir, out, props = Path(args[0]), Path(args[1]), args[2:]
    rows = []
    for prop in props:
        info = json.loads((render_dir / f"{prop}.render.json").read_text(encoding="utf-8"))
        views = [s["view"] for s in info["shots"]]
        imgs = [Image.open(render_dir / f"{prop}_{v}.png").convert("RGB") for v in views]
        rows.append((prop, views, imgs))
    w, h = rows[0][2][0].size
    tw, th = int(w * scale), int(h * scale)
    cols = max(len(r[2]) for r in rows)
    sheet = Image.new("RGB", (tw * cols, (th + LABEL_H) * len(rows)), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    for k, (prop, views, imgs) in enumerate(rows):
        y = k * (th + LABEL_H)
        draw.text((8, y + 7), f"{prop}   |   " + "   |   ".join(views), fill=(230, 230, 230))
        for i, im in enumerate(imgs):
            sheet.paste(im.resize((tw, th), Image.LANCZOS), (i * tw, y + LABEL_H))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print("SHEET_OK", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
