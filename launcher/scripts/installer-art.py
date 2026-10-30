#!/usr/bin/env python3
"""Draws the NSIS installer bitmaps in the Album direction (DESIGN.md §8 "Installer", design/mocks/installer.html):

  build/installerSidebar.bmp    164x314  the album cover: bookcloth, the logo sticker tilted -6 deg,
                                         "Nore Launcher" in Dela Gothic One, a version label sticker,
                                         three dot stickers + noreclient.pl
  build/uninstallerSidebar.bmp  164x314  the same cover, "Do zobaczenia" label
  build/installerHeader.bmp     150x57   cloth, version label, small logo sticker

Colours come from design/tokens.json (fallbacks of the derived cover colours), the faces from the
launcher's self-hosted woff2 (src/renderer/assets/fonts, SIL OFL 1.1) and the logo layers from
src/renderer/assets/album (scripts/build-logo-sticker.py). Deterministic: the cloth noise is seeded.
Needs Pillow, fontTools and brotli.

    python3 launcher/scripts/installer-art.py
"""
import io
import json
import math
import os
import random

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ROOT)
FONTS = os.path.join(ROOT, 'src', 'renderer', 'assets', 'fonts')
ALBUM = os.path.join(ROOT, 'src', 'renderer', 'assets', 'album')
BUILD = os.path.join(ROOT, 'build')
SS = 3  # supersampling: drawn at 3x, reduced with LANCZOS


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def tokens():
    """Album colours from design/tokens.json (derived values use their documented fallbacks)."""
    base = {'cover': '#291c3d', 'cover-tab': '#352552', 'cover-ink': '#e9e2f5', 'cover-ink-soft': '#ab9fc0', 'vinyl': '#fbfaf7',
            'accent-deep': '#6d38dc', 'ready': '#3fd27f', 'event': '#ff8a1f', 'nore': '#9d5cff', 'page': '#141216', 'ink': '#f3efe9'}
    path = os.path.join(REPO, 'design', 'tokens.json')
    if os.path.exists(path):
        c = json.load(open(path, encoding='utf-8'))['color']
        pick = lambda e: e.get('fallback') or e['value']  # noqa: E731
        base.update({
            'cover': pick(c['base']['cover']), 'cover-tab': pick(c['base']['cover-tab']), 'cover-ink': c['base']['cover-ink']['value'],
            'cover-ink-soft': c['base']['cover-ink-soft']['value'], 'vinyl': c['base']['vinyl']['value'], 'page': c['base']['page']['value'],
            'ink': c['base']['ink']['value'], 'accent-deep': c['accent']['accent-deep']['value'], 'ready': c['dot']['ready']['value'],
            'event': c['dot']['event']['value'], 'nore': pick(c['dot']['nore']),
        })
    return {k: hex_rgb(v) for k, v in base.items()}


C = tokens()


def font(name, size):
    """A woff2 face from the launcher, converted in memory for Pillow."""
    tt = TTFont(os.path.join(FONTS, name + '.woff2'))
    tt.flavor = None
    buf = io.BytesIO()
    tt.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


def onest(size, weight):
    f = font('Onest-latin', size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:  # noqa: BLE001 – a static build of the face
        pass
    return f


def cloth(w, h, seed=7):
    """Bookcloth: the cover colour with a fine weave (horizontal light threads, vertical dark threads)."""
    rnd = random.Random(seed)
    im = Image.new('RGB', (w, h), C['cover'])
    px = im.load()
    rows = [rnd.uniform(-1, 1) for _ in range(h)]
    cols = [rnd.uniform(-1, 1) for _ in range(w)]
    for y in range(h):
        for x in range(w):
            n = rows[y] * 5 - abs(cols[x]) * 4 + rnd.uniform(-2.2, 2.2)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, int(r + n))), max(0, min(255, int(g + n))), max(0, min(255, int(b + n * 1.1))))
    return im.filter(ImageFilter.GaussianBlur(0.35))


def logo_sticker(size, tilt):
    """The logo sticker: white rim layer + the artwork recoloured to the Nore violet (CSS hue-rotate 238deg)."""
    rim = Image.open(os.path.join(ALBUM, 'logo-rim.png')).convert('RGBA')
    art = Image.open(os.path.join(ALBUM, 'logo-art.png')).convert('RGBA')
    a = art.getchannel('A')
    h, s, v = art.convert('RGB').convert('HSV').split()
    h = h.point(lambda x: (x + int(238 / 360 * 255)) % 256)
    art = Image.merge('HSV', (h, s, v)).convert('RGBA')
    art.putalpha(a)
    out = Image.new('RGBA', rim.size, (0, 0, 0, 0))
    out.alpha_composite(rim)
    out.alpha_composite(art)
    out = out.resize((size, size), Image.LANCZOS)
    return out.rotate(-tilt, resample=Image.BICUBIC, expand=True)


def label(text, f, fill, ink, tilt, pad=(10, 5), rim=2 * SS, radius=7 * SS):
    """A label sticker: rounded rectangle with a vinyl rim, tilted."""
    l, t, r, b = f.getbbox(text)
    w, h = r - l + pad[0] * 2 * SS, b - t + pad[1] * 2 * SS
    im = Image.new('RGBA', (w + rim * 2 + 4, h + rim * 2 + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([2, 2, w + rim * 2 + 1, h + rim * 2 + 1], radius + rim, fill=C['vinyl'])
    d.rounded_rectangle([2 + rim, 2 + rim, w + rim + 1, h + rim + 1], radius, fill=fill)
    d.text((2 + rim + pad[0] * SS - l, 2 + rim + pad[1] * SS - t), text, font=f, fill=ink)
    return im.rotate(-tilt, resample=Image.BICUBIC, expand=True)


def dot(d, x, y, r, colour):
    d.ellipse([x - r - 1.5 * SS, y - r - 1.5 * SS, x + r + 1.5 * SS, y + r + 1.5 * SS], fill=C['vinyl'])
    d.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def finish(im, path, w, h):
    im = im.convert('RGB').resize((w, h), Image.LANCZOS)
    im.save(path, 'BMP')  # 24-bit BMP3, what NSIS MUI2 expects


def sidebar(path, tag):
    w, h = 164, 314
    im = cloth(w * SS, h * SS).convert('RGBA')
    d = ImageDraw.Draw(im)
    lg = logo_sticker(108 * SS, -6)
    im.alpha_composite(lg, (24 * SS, 26 * SS))
    title = font('DelaGothicOne-latin', 22 * SS)
    d.text((18 * SS, 158 * SS), 'Nore', font=title, fill=C['cover-ink'])
    d.text((18 * SS, 183 * SS), 'Launcher', font=title, fill=C['cover-ink'])
    lab = label(tag, onest(13 * SS, 600), C['accent-deep'], (255, 255, 255), -3)
    im.alpha_composite(lab, (16 * SS, 220 * SS))
    for i, c in enumerate([C['ready'], C['event'], C['nore']]):
        dot(d, (22 + i * 13) * SS, (h - 22) * SS, 4 * SS, c)
    d.text((60 * SS, (h - 29) * SS), 'noreclient.pl', font=onest(11 * SS, 600), fill=C['cover-ink-soft'])
    finish(im, path, w, h)


def header(path, tag):
    w, h = 150, 57
    im = cloth(w * SS, h * SS, seed=11).convert('RGBA')
    lab = label(tag, onest(11 * SS, 600), C['accent-deep'], (255, 255, 255), -3, pad=(8, 4))
    im.alpha_composite(lab, (14 * SS, 17 * SS))
    lg = logo_sticker(44 * SS, -6)
    im.alpha_composite(lg, ((w - 54) * SS, 4 * SS))
    finish(im, path, w, h)


def version_tag():
    pkg = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))
    major, minor = pkg['version'].split('.')[:2]
    return f'{major}.{minor} Beta'


if __name__ == '__main__':
    tag = version_tag()
    sidebar(os.path.join(BUILD, 'installerSidebar.bmp'), tag)
    sidebar(os.path.join(BUILD, 'uninstallerSidebar.bmp'), 'Do zobaczenia')
    header(os.path.join(BUILD, 'installerHeader.bmp'), tag)
    print('installer bitmaps written to', BUILD)
