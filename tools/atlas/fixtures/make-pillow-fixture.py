"""Writes tools/atlas/fixtures/pillow-48.png, the decoder's outside-writer fixture (atlas.test.ts).

A 37 x 23 indexed PNG written by Pillow, not by png.mjs, so the test proves the decoder reads a
PNG-8 another encoder made. 48 palette entries keep Pillow at bit depth 8 (it drops to 4 bits or
fewer at 16 colours or fewer). The test recomputes the same palette and pixels.

    python tools/atlas/fixtures/make-pillow-fixture.py
"""

from pathlib import Path

from PIL import Image

W, H, N = 37, 23, 48
img = Image.new("P", (W, H))
palette: list[int] = []
for i in range(N):
    palette += [i * 5, 255 - i * 5, (i * 37) % 256]
img.putpalette(palette)
img.putdata([(x * 7 + y * 3) % N for y in range(H) for x in range(W)])
img.save(Path(__file__).with_name("pillow-48.png"), optimize=False)
