# Android ve web ikonlarını, açılış ekranını üretir: koyu zemin üzerinde yükselen üç mum
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
PUB = os.path.join(ROOT, 'public')
BG = (11, 14, 20)
PANEL = (23, 27, 38)
GREEN = (14, 203, 129)
RED = (246, 70, 93)
VIOLET = (139, 124, 255)


def mark(size, pad_ratio):
    """Şeffaf zemin üzerinde logo: üç mum (kırmızı, yeşil, yeşil) ve yükselen çizgi"""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = int(S * pad_ratio)
    w = S - 2 * p
    bw = int(w * 0.17)  # mum gövdesi genişliği
    gap = (w - 3 * bw) // 2
    wick = max(2, int(w * 0.03))
    # (gövde üst, gövde alt, fitil üst, fitil alt) — alana göre oran
    candles = [
        (RED, 0.42, 0.72, 0.34, 0.84),
        (GREEN, 0.30, 0.62, 0.20, 0.70),
        (GREEN, 0.08, 0.46, 0.0, 0.54),
    ]
    for i, (col, bt, bb, wt, wb) in enumerate(candles):
        x0 = p + i * (bw + gap)
        cx = x0 + bw // 2
        d.rounded_rectangle([cx - wick // 2, p + int(w * wt), cx + wick // 2, p + int(w * wb)], wick // 2, fill=col)
        d.rounded_rectangle([x0, p + int(w * bt), x0 + bw, p + int(w * bb)], int(bw * 0.18), fill=col)
    # alt çizgi (zemin)
    d.rounded_rectangle([p, p + int(w * 0.93), S - p, p + int(w * 0.93) + wick * 2], wick, fill=VIOLET)
    return im.resize((size, size), Image.LANCZOS)


def rounded(n, radius_ratio, color):
    m = Image.new('L', (n * 4, n * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, n * 4 - 1, n * 4 - 1], int(n * 4 * radius_ratio), fill=255)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', (n, n), color + (255,)), (0, 0), m.resize((n, n), Image.LANCZOS))
    return out


def circle(n, color):
    m = Image.new('L', (n * 4, n * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, n * 4 - 1, n * 4 - 1], fill=255)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', (n, n), color + (255,)), (0, 0), m.resize((n, n), Image.LANCZOS))
    return out


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)


dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, k in dens.items():
    n = int(48 * k)
    icon = rounded(n, 0.22, BG)
    icon.alpha_composite(mark(n, 0.2))
    save(icon, f'{RES}/mipmap-{d}/ic_launcher.png')
    rnd = circle(n, BG)
    rnd.alpha_composite(mark(n, 0.25))
    save(rnd, f'{RES}/mipmap-{d}/ic_launcher_round.png')
    f = int(108 * k)  # uyarlanabilir ikon ön planı (güvenli alan ortadaki 66dp)
    save(mark(f, 0.3), f'{RES}/mipmap-{d}/ic_launcher_foreground.png')

for folder in os.listdir(RES):
    if folder.startswith('drawable'):
        p = f'{RES}/{folder}/splash.png'
        if os.path.exists(p):
            w, h = Image.open(p).size
            sp = Image.new('RGBA', (w, h), BG + (255,))
            t = mark(int(min(w, h) * 0.32), 0.05)
            sp.alpha_composite(t, ((w - t.width) // 2, (h - t.height) // 2))
            sp.convert('RGB').save(p)

# web / iPhone ikonları
for name, n, pad, rr in [('icon-192.png', 192, 0.2, 0.22), ('icon-512.png', 512, 0.2, 0.22), ('apple-touch-icon.png', 180, 0.2, 0), ('favicon.png', 64, 0.14, 0.22)]:
    im = rounded(n, rr, BG) if rr else Image.new('RGBA', (n, n), BG + (255,))
    im.alpha_composite(mark(n, pad))
    save(im, f'{PUB}/{name}')
mk = Image.new('RGBA', (512, 512), BG + (255,))
mk.alpha_composite(mark(512, 0.3))
save(mk, f'{PUB}/icon-maskable-512.png')

with open(f'{RES}/values/ic_launcher_background.xml', 'w') as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0E14</color>\n</resources>\n')
print('ok')
