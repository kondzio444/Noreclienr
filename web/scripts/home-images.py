#!/usr/bin/env python3
"""Builds the home page pictures (web/public/assets/home/*.webp) from real captures of Nore Client
and Nore Launcher. Every picture on the page is a screenshot of the product itself.

    python3 web/scripts/home-images.py <capture-dir>

<capture-dir> holds the raw PNG captures (in-game shots from the mod, launcher shots from Electron).
Missing in-game shots fall back to the older captures already in web/public/assets/api.
"""
import os
import sys

from PIL import Image, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public', 'assets')
OUT = os.path.join(PUB, 'home')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, 'raw')


def first(*names):
    for n in names:
        p = n if os.path.isabs(n) else os.path.join(SRC, n)
        if os.path.exists(p):
            return p
    raise SystemExit('missing source: ' + ', '.join(names))


def crop(im, ratio, focus=(0.5, 0.5)):
    """Crops to width/height = ratio around a focus point (fractions of the image)."""
    w, h = im.size
    if w / h > ratio:
        nw = int(h * ratio)
        x = int(min(max(focus[0] * w - nw / 2, 0), w - nw))
        return im.crop((x, 0, x + nw, h))
    nh = int(w / ratio)
    y = int(min(max(focus[1] * h - nh / 2, 0), h - nh))
    return im.crop((0, y, w, y + nh))


def save(im, name, size, quality=82):
    im = im.convert('RGB')
    im = im.resize(size, Image.LANCZOS)
    im.save(os.path.join(OUT, name), 'WEBP', quality=quality, method=6)
    print('wrote', name, size)


def still(name, src, ratio, size, focus=(0.5, 0.5)):
    save(crop(Image.open(src), ratio, focus), name, size)


def animated(name, src, ratio, size, focus=(0.5, 0.5)):
    im = Image.open(src)
    frames, durations = [], []
    for f in ImageSequence.Iterator(im):
        frames.append(crop(f.convert('RGB'), ratio, focus).resize(size, Image.LANCZOS))
        durations.append(f.info.get('duration', 80))
    frames[0].save(os.path.join(OUT, name), 'WEBP', save_all=True, append_images=frames[1:], duration=durations, loop=0, quality=80, method=6)
    print('wrote', name, size, len(frames), 'frames')


os.makedirs(OUT, exist_ok=True)
API = os.path.join(PUB, 'api')
still('menu.webp', first('menu.png', os.path.join(API, 'menu-news.webp')), 16 / 9, (1600, 900))
T = (1200, 750)
still('radial.webp', first('radial.png', os.path.join(API, 'radial-menu.webp')), 16 / 10, T)
still('modules.webp', first('modules.png', 'clickgui.png'), 16 / 10, T)
still('launcher.webp', first('launcher-home.png'), 16 / 10, T)
still('servers.webp', first('launcher-servers.png'), 16 / 10, T)
still('wizard.webp', first('launcher-wizard.png'), 16 / 10, T)
still('updater.webp', first('updater.png'), 16 / 10, T)
still('sky.webp', first('sky-zorza.png', 'sky-kosmos.png', 'sky.png'), 16 / 10, T, (0.5, 0.35))
still('panorama.webp', first('panorama.png'), 16 / 10, T, (0.55, 0.5))
w = Image.open(first('launcher-winter.png'))
save(w.crop((0, 0, 720, 450)), 'winter.webp', (640, 400))
animated('halloween.webp', os.path.join(PUB, 'halloween.gif'), 16 / 10, (640, 400))
animated('ward-capes.webp', os.path.join(PUB, 'halloween.gif'), 1, (900, 900))
for name, src, focus in (('ward-hat.webp', 'wardrobe-hat.png', (0.5, 0.35)), ('ward-wings.webp', 'wardrobe-wings.png', (0.5, 0.45))):
    p = first(src, 'wardrobe-f5.png')
    still(name, p, 1, (900, 900), focus)
