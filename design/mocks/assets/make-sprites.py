#!/usr/bin/env python3
"""Authored pixel stickers for the Nore "Album" mocks (synthetic artwork, made for this design).

Writes transparent PNGs next to this file. Each sprite is a string grid; every character is a colour key.
The same grids are meant to be reused in game through Render2D.pixels(), so the launcher, the website and
the client draw the exact same stickers. Run:  python3 design/mocks/assets/make-sprites.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

SPRITES = {
    # Halloween 2026 – glow-in-the-dark series (phosphor P glows in the dark)
    'pumpkin': (['.....gl....',
                 '...oOgOo...',
                 '.ooOoooOoo.',
                 'oOoYoOoYoOo',
                 'oOYYoOoYYOo',
                 'oOooOYOooOo',
                 'oYoOoOoOoYo',
                 'oOYYoYoYYOo',
                 'dOoYYYYYoOd',
                 '.ddOoOoOdd.',
                 '...ddddd...'],
                {'o': '#ff7417', 'O': '#e0600f', 'd': '#9a3a08', 'g': '#5e7a22', 'l': '#8fc043', 'Y': '#ffe27a'}),
    'bat': (['X.........X',
             'XX..X.X..XX',
             'XXX.XXX.XXX',
             '.XXXePeXXX.',
             '..XXXXXXX..',
             '...X.X.X...'],
            {'X': '#2a2230', 'e': '#ff7417', 'P': '#2a2230'}),
    'ghost': (['...PPPPP...',
               '..PPPPPPP..',
               '.PPPPPPPPP.',
               '.PPkPPPkPP.',
               '.PPkPPPkPP.',
               '.PPPPPPPPP.',
               '.PPPPkkPPP.',
               '.PPPPPPPPP.',
               '.PPPPPPPPP.',
               '.PP.PPP.PP.',
               '.P...P...P.'],
              {'P': '#d2ff7a', 'k': '#1a2410'}),
    'spider': (['.....w.....',
                '.....w.....',
                'k...kkk...k',
                '.k.kkkkk.k.',
                '..kkrkrkk..',
                'kkkkkkkkkkk',
                '..kkkkkkk..',
                '.k.kkkkk.k.',
                'k...kkk...k'],
               {'k': '#221c26', 'r': '#ff5a4f', 'w': '#cfc8d6'}),
    'hat': (['......kk...',
             '.....kkk...',
             '....kkkk...',
             '....kkkkk..',
             '...kkkkkk..',
             '...vvvvvv..',
             '..kkkkkkkk.',
             'kkkkkkkkkkk'],
            {'k': '#2b1f3a', 'v': '#9d5cff'}),
    'candy': (['oo.......oo',
               'ooo.www.ooo',
               '.oowooowoo.',
               '..wooowoow.',
               '.oowooowoo.',
               'ooo.www.ooo',
               'oo.......oo'],
              {'o': '#ff7417', 'w': '#fbfaf7'}),
    # Winter series
    'flake': (['....w....',
               '.w..w..w.',
               '..w.w.w..',
               '...www...',
               'wwwwiwwww',
               '...www...',
               '..w.w.w..',
               '.w..w..w.',
               '....w....'],
              {'w': '#e9f4ff', 'i': '#8fd3ff'}),
    'gift': (['...g.g...',
              '....g....',
              'rrrrgrrrr',
              'rrrrgrrrr',
              'ggggggggg',
              'rrrrgrrrr',
              'rrrrgrrrr',
              'rrrrgrrrr'],
             {'r': '#ff5a5a', 'g': '#ffd257'}),
}

# Player heads (8x8 faces). Synthetic players, not real skins.
HEADS = {
    'head-kondzio': ['hhhhhhhh', 'hhhhhhhh', 'hsssssh.', 'swwsswws', 'sbwsswbs', 'ssssssss', 'ssmmmmss', 'ssssssss'],
    'head-ola':     ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SwwSSwwS', 'SgwSSwgS', 'SSSSSSSS', 'HSSMMSSH', 'HSSSSSSH'],
    'head-bartek':  ['cccccccc', 'cccccccc', 'cttttttc', 'twwttwwt', 'tbwttwbt', 'tttttttt', 'tteeeett', 'tttttttt'],
    'head-mila':    ['RRRRRRRR', 'RRRRRRRR', 'RqqqqqqR', 'qwwqqwwq', 'qpwqqwpq', 'qqqqqqqq', 'RqqmmqqR', 'RqqqqqqR'],
    'head-steve':   ['dddddddd', 'dddddddd', 'dsssssssd'[:8], 'swwsswws', 'sbwsswbs', 'ssssssss', 'ssnnnnss', 'ssssssss'],
}
HEAD_COLORS = {
    'h': '#3b2a1e', 's': '#c99a74', 'w': '#ffffff', 'b': '#4a63c9', 'm': '#8a5a44', '.': '#3b2a1e',
    'H': '#e8c873', 'S': '#f0c8a8', 'g': '#3fa86b', 'M': '#c46a6a',
    'c': '#1d1d24', 't': '#8a6448', 'e': '#5a3a2a',
    'R': '#b23a3a', 'q': '#e9b48f', 'p': '#7a4ab8',
    'd': '#2b1e14', 'n': '#6a4030',
}


def save(name, rows, colors, scale=16):
    w = max(len(r) for r in rows)
    im = Image.new('RGBA', (w * scale, len(rows) * scale), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.' and '.' not in colors:
                continue
            c = colors.get(ch)
            if not c:
                continue
            rgb = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
            for yy in range(scale):
                for xx in range(scale):
                    px[x * scale + xx, y * scale + yy] = rgb + (255,)
    im.save(os.path.join(HERE, name + '.png'))


for n, (rows, cols) in SPRITES.items():
    save(n, rows, cols)
for n, rows in HEADS.items():
    save(n, rows, HEAD_COLORS, scale=12)
print('sprites written to', HERE)


# Die-cut variants with the vinyl rim baked in (for places where a CSS filter is not wanted, e.g. the website).
from PIL import ImageFilter


def rimmed(name, rim=10, pad=14):
    src = Image.open(os.path.join(HERE, name + '.png')).convert('RGBA')
    w, h = src.size
    out = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    out.paste(src, (pad, pad), src)
    a = out.split()[3].point(lambda v: 255 if v > 0 else 0).filter(ImageFilter.MaxFilter(rim * 2 + 1))
    base = Image.new('RGBA', out.size, (251, 250, 247, 255))
    base.putalpha(a)
    base.alpha_composite(out)
    base.save(os.path.join(HERE, name + '-sticker.png'))


for n in ['pumpkin', 'ghost', 'bat', 'flake', 'hat', 'candy']:
    rimmed(n)
