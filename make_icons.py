"""Regenerates the three app icons in icons/. Needs Pillow (pip install pillow).
Run from the project folder:  python3 make_icons.py
Icons are simple: three overlapping sticky notes on a cream background.
"""
import os
from PIL import Image, ImageDraw

os.makedirs("icons", exist_ok=True)


def make(size, path):
    img = Image.new("RGB", (size, size), "#F1EFE8")
    s = size / 512.0

    def note(x, y, w, h, fill, edge, ang=0):
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle([x * s, y * s, (x + w) * s, (y + h) * s], radius=28 * s,
                             fill=fill, outline=edge, width=max(2, int(8 * s)))
        layer = layer.rotate(ang, center=(size / 2, size / 2), resample=Image.BICUBIC)
        img.paste(layer, (0, 0), layer)

    note(80, 90, 230, 230, "#E6F1FB", "#378ADD", 6)
    note(200, 120, 230, 230, "#FAECE7", "#D85A30", -5)
    note(130, 230, 250, 200, "#EAF3DE", "#639922", 3)
    img.save(path)


for n in (180, 192, 512):
    make(n, "icons/icon-%d.png" % n)
print("icons written")
