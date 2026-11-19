"""Draws the 今晚吃啥 app icon: a dice resting on a dinner plate, on a warm tomato-to-mango background.
Run: python tools/make-icons.py   (writes icons/*.png)"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient(s, c1, c2):
    n = 64  # small diagonal gradient, scaled up smoothly
    g = Image.new('RGB', (n, n))
    for y in range(n):
        for x in range(n):
            g.putpixel((x, y), lerp(c1, c2, (x * 0.4 + y) / (1.4 * (n - 1))))
    return g.resize((s, s), Image.BILINEAR)


def shadow(size, box, radius, blur, alpha):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius, fill=alpha)
    return m.filter(ImageFilter.GaussianBlur(blur))


def draw(size, pad=0.0):
    s = size * 4
    img = gradient(s, (255, 122, 69), (255, 190, 80)).convert('RGBA')
    k = 1 - pad * 2
    c = s / 2
    R = s * 0.36 * k
    # plate shadow, plate, rim
    sh = shadow((s, s), [c - R, c - R + s * 0.03 * k, c + R, c + R + s * 0.03 * k], R, s * 0.025, 90)
    img.paste((150, 50, 10), (0, 0), sh)
    d = ImageDraw.Draw(img)
    d.ellipse([c - R, c - R, c + R, c + R], fill=(255, 252, 248))
    r2 = R * 0.74
    d.ellipse([c - r2, c - r2, c + r2, c + r2], fill=(255, 239, 226))
    r3 = R * 0.70
    d.ellipse([c - r3, c - r3, c + r3, c + r3], fill=(255, 248, 241))
    # dice (rotated rounded square with five pips)
    D = R * 0.95
    dice = Image.new('RGBA', (int(D * 1.6), int(D * 1.6)), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dice)
    o = D * 0.3
    dd.rounded_rectangle([o, o, o + D, o + D], D * 0.2, fill=(255, 92, 58))
    dd.rounded_rectangle([o, o, o + D, o + D * 0.5], D * 0.2, fill=(255, 112, 76))
    dd.rectangle([o, o + D * 0.3, o + D, o + D * 0.5], fill=(255, 112, 76))
    pr = D * 0.085
    for px, py in [(0.27, 0.27), (0.73, 0.27), (0.5, 0.5), (0.27, 0.73), (0.73, 0.73)]:
        x, y = o + D * px, o + D * py
        dd.ellipse([x - pr, y - pr, x + pr, y + pr], fill=(255, 255, 255))
    dice = dice.rotate(14, resample=Image.BICUBIC)
    dsh = Image.new('L', dice.size, 0)
    dsh.paste(dice.split()[3].point(lambda a: 70 if a > 0 else 0), (0, 0))
    dsh = dsh.filter(ImageFilter.GaussianBlur(s * 0.012))
    pos = (int(c - dice.size[0] / 2), int(c - dice.size[1] / 2 - R * 0.04))
    img.paste((140, 40, 10), (pos[0], pos[1] + int(s * 0.015)), dsh)
    img.alpha_composite(dice, pos)
    # sparkles
    def sparkle(cx, cy, r):
        pts = []
        for i in range(8):
            a = i * math.pi / 4 - math.pi / 2
            rr = r if i % 2 == 0 else r * 0.3
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        d.polygon(pts, fill=(255, 255, 255))
    d = ImageDraw.Draw(img)
    sparkle(c + R * 0.98, c - R * 0.92, s * 0.045 * k)
    sparkle(c - R * 1.02, c + R * 0.78, s * 0.03 * k)
    return img.convert('RGB').resize((size, size), Image.LANCZOS)


draw(192).save(os.path.join(OUT, 'icon-192.png'))
draw(512).save(os.path.join(OUT, 'icon-512.png'))
draw(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
draw(512, pad=0.1).save(os.path.join(OUT, 'maskable-512.png'))
print('icons written')
