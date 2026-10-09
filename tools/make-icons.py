"""Draws the PWA icons (a shield with a lightning bolt) with Pillow.
Run: python tools/make-icons.py   ->  icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
"""
from PIL import Image, ImageDraw
import math, os

SS = 4  # supersampling factor
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    top, bottom = (20, 54, 120), (6, 14, 40)
    for y in range(size):
        row = lerp(top, bottom, y / (size - 1))
        for x in range(size):
            # soft radial glow in the centre
            d = math.hypot(x - size / 2, y - size * .45) / (size * .6)
            glow = max(0.0, 1 - d)
            px[x, y] = tuple(min(255, round(c + glow * 38)) for c in row)
    return img


def draw_icon(size, scale, maskable):
    """`scale` shrinks the artwork (maskable icons need a ~20% safe zone)."""
    big = size * SS
    img = background(big)
    d = ImageDraw.Draw(img)
    cx, cy = big / 2, big / 2
    u = big * scale / 10000.0  # 1 unit = 1% of the artwork box (which is `scale`% of the icon)

    def pt(x, y):
        return (cx + (x - 50) * u, cy + (y - 50) * u)

    # shield
    shield = [pt(50, 8), pt(88, 20), pt(88, 52), pt(50, 94), pt(12, 52), pt(12, 20)]
    d.polygon([pt(50 + (x - 50) * 1.045, 51 + (y - 51) * 1.045) for x, y in
               [(50, 8), (88, 20), (88, 52), (50, 94), (12, 52), (12, 20)]], fill=(255, 210, 58))
    d.polygon(shield, fill=(214, 33, 43))
    # inner highlight on the upper half
    d.polygon([pt(50, 13), pt(82, 23), pt(82, 38), pt(50, 33), pt(18, 38), pt(18, 23)], fill=(232, 66, 74))
    # lightning bolt
    bolt = [pt(57, 18), pt(30, 55), pt(46, 55), pt(40, 83), pt(70, 44), pt(53, 44), pt(63, 18)]
    d.polygon([(x + u * 1.6, y + u * 1.6) for x, y in bolt], fill=(120, 14, 22))  # drop shadow
    d.polygon(bolt, fill=(255, 244, 190))
    d.line(bolt + [bolt[0]], fill=(255, 210, 58), width=max(1, round(u * .9)), joint='curve')
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
draw_icon(192, 84, False).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
draw_icon(512, 84, False).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
draw_icon(512, 62, True).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
draw_icon(180, 80, False).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
print('icons written to', os.path.abspath(OUT))
