"""Render the Aurora constellation icon set. Run by hand, never in CI.

    python3 scripts/make-icons.py

Needs Pillow (`pip install Pillow`), which is NOT a project dependency — this
runs when the icon changes, which is roughly never, and adding a Python
toolchain to a pnpm repo to redraw six circles is a bad trade.

This file is the only source for the icon geometry, so edit the constants here
rather than touching public/*.png. Note that .py sits outside check-locale,
cspell and prettier, all of which only see .ts/.tsx/.md/.css/.yaml/.sh/.json --
so nothing mechanical guards the prose in here. Keep it en-US by hand.


Everything is drawn at RENDER px and downsampled with LANCZOS, so a 16px
favicon is supersampled 128x. Gradients (the ground vignette, the node halos)
are built at 256px and scaled up, which is smoother than drawing concentric
circles and costs nothing.
"""

import math
import os
from PIL import Image, ImageDraw

RENDER = 2048  # internal canvas; every output downsamples from this

BG_EDGE = (11, 12, 14)  # #0B0C0E  the app background
BG_CENTER = (23, 19, 10)  # #17130A  a few percent of warmth, nothing more

GOLD_BRIGHT = (242, 216, 155)  # #F2D89B
GOLD = (232, 199, 122)  # #E8C77A  the app accent
GOLD_DIM = (199, 171, 106)  # #C7AB6A
PURPLE = (156, 143, 212)  # #9C8FD4  concept
BLUE = (127, 168, 217)  # #7FA8D9  title
EDGE = (122, 106, 66)  # #7A6A42

# (x, y, r, fill) in a 0-100 space, the same geometry as the mockup
NODES = [
    (32, 34, 8.0, GOLD_BRIGHT),
    (62, 24, 5.5, GOLD),
    (74, 50, 7.0, PURPLE),
    (46, 56, 6.0, GOLD_DIM),
    (26, 66, 5.0, GOLD_DIM),
    (58, 78, 6.5, BLUE),
]
LINKS = [(0, 1), (1, 2), (0, 3), (2, 3), (0, 4), (4, 5), (3, 5)]
# (x, y, radius, color, alpha) -- the mockup values exactly. A FLAT alpha across
# alpha across the disc, not a peak: see DISC, which holds them out to 72% of
# the radius and only then feathers. An earlier version ramped from the center
# instead, which looked like the same numbers and measured eight times weaker.
HALOS = [(32, 34, 16, GOLD, 0.16), (74, 50, 14, PURPLE, 0.18), (58, 78, 14, BLUE, 0.18)]
EDGE_W = 2.4

# The simplified mark for 16 and 32, where six nodes and seven edges are mud.
# Three nodes keeps the three-hue identity; nothing else survives anyway.
SMALL_NODES = [(32, 36, 13, GOLD_BRIGHT), (72, 42, 11, PURPLE), (52, 74, 12, BLUE)]
SMALL_LINKS = [(0, 1), (0, 2), (1, 2)]
SMALL_EDGE_W = 6.0


def falloff(size, power=1.0):
    """A radial alpha ramp: opaque at the center, transparent at the edge."""
    g = Image.new("L", (256, 256))
    px = g.load()
    c = 127.5
    for y in range(256):
        for x in range(256):
            d = math.hypot(x - c, y - c) / c
            v = 0.0 if d >= 1.0 else (1.0 - d) ** power
            px[x, y] = int(v * 255)
    return g.resize((size, size), Image.BICUBIC)


VIGNETTE = falloff(512, power=1.15)  # ground: broader, flatter


def ground(size, warm=True):
    img = Image.new("RGB", (size, size), BG_EDGE)
    if not warm:
        return img
    # Center of warmth sits at 44%/40% so it is not a bullseye.
    span = int(size * 1.44)
    mask = VIGNETTE.resize((span, span), Image.BICUBIC)
    glow = Image.new("RGB", (span, span), BG_CENTER)
    img.paste(glow, (int(size * 0.44) - span // 2, int(size * 0.40) - span // 2), mask)
    return img


def draw_mark(img, nodes, links, halos, edge_w, scale=1.0):
    """Draw at 4x then downsample: PIL has no antialiased primitives."""
    S = img.size[0]
    OS = 4
    layer = Image.new("RGBA", (S * OS, S * OS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def pt(x, y):
        cx = (x - 50) * scale + 50
        cy = (y - 50) * scale + 50
        return cx / 100 * S * OS, cy / 100 * S * OS

    for a, b in links:
        x1, y1, _, _ = nodes[a]
        x2, y2, _, _ = nodes[b]
        d.line([pt(x1, y1), pt(x2, y2)], fill=EDGE + (255,), width=int(edge_w * scale / 100 * S * OS), joint="curve")

    for x, y, r, fill in nodes:
        cx, cy = pt(x, y)
        rr = r * scale / 100 * S * OS
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill + (255,))

    layer = layer.resize((S, S), Image.LANCZOS)

    # Halos go UNDER the mark, pasted STRAIGHT onto the ground.
    #
    # Not via an intermediate RGBA layer: compositing the color onto a
    # transparent (so black) layer darkens it by the mask, and the layer's own
    # alpha then applies the mask a second time. The color lands at alpha
    # squared. Measured on the first build: +4 red just outside the gold node
    # where the mockup gives +34.
    #
    # The disc is HARD-EDGED, drawn the same way the nodes are -- oversampled
    # and downsampled, so the rim is antialiased and nothing more. Two softer
    # versions were tried and both were wrong: a center-out ramp erased them,
    # and a feathered rim turned a disc of color into a blur. The mockup drew
    # plain circles at a flat opacity, and that crispness is the look.
    if halos:
        for x, y, r, col, alpha in halos:
            rr = int(r * scale / 100 * S * 2)
            if rr < 2:
                continue
            m = Image.new("L", (rr * OS, rr * OS), 0)
            ImageDraw.Draw(m).ellipse([0, 0, rr * OS - 1, rr * OS - 1], fill=int(255 * alpha))
            m = m.resize((rr, rr), Image.LANCZOS)
            patch = Image.new("RGB", (rr, rr), col)
            cx = int(((x - 50) * scale + 50) / 100 * S) - rr // 2
            cy = int(((y - 50) * scale + 50) / 100 * S) - rr // 2
            img.paste(patch, (cx, cy), m)

    img.paste(layer, (0, 0), layer)
    return img


def full(size, scale=1.0, warm=True):
    img = ground(RENDER, warm)
    draw_mark(img, NODES, LINKS, HALOS, EDGE_W, scale)
    return img.resize((size, size), Image.LANCZOS)


def small(size):
    # Flat ground, no halos: soft gradients band at 16px and gain nothing.
    img = ground(RENDER, warm=False)
    draw_mark(img, SMALL_NODES, SMALL_LINKS, None, SMALL_EDGE_W)
    return img.resize((size, size), Image.LANCZOS)


OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
jobs = [
    ("favicon-16.png", small(16)),
    ("favicon-32.png", small(32)),
    ("apple-icon-180.png", full(180)),
    ("icon-192.png", full(192)),
    ("icon-512.png", full(512)),
    # Android crops to a circle of 80% diameter, so the mark shrinks and the
    # ground runs full bleed underneath it.
    ("icon-maskable-192.png", full(192, scale=0.82)),
    ("icon-maskable-512.png", full(512, scale=0.82)),
]
for name, im in jobs:
    im.save(f"{OUT}/{name}", "PNG", optimize=True)
    print(f"  {name:26} {im.size[0]}x{im.size[1]}")
