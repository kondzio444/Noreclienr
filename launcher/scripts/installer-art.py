#!/usr/bin/env python3
"""Draws the NSIS installer bitmaps (sidebar 164x314, header 150x57) in the launcher's
server list look: tooltip violet-black ground, violet keyline, condensed caps and a
[1.4 BETA] rank tag. Needs Pillow, fontTools and brotli.

    python3 launcher/scripts/installer-art.py
"""
import io
import os

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'src', 'renderer', 'assets', 'fonts')
BUILD = os.path.join(ROOT, 'build')
LOGO = os.path.join(ROOT, 'src', 'renderer', 'assets', 'logo.png')

BG = (13, 9, 19)
RAIL = (23, 12, 38)
LINE = (52, 40, 74)
ACCENT = (157, 92, 255)
TEXT = (243, 238, 250)
MUTED = (143, 132, 163)
YELLOW = (255, 255, 85)
CODES = [(85, 255, 85), (255, 255, 85), (255, 170, 0), (85, 255, 255), (255, 85, 255), (170, 0, 170)]


def font(name, size, wdth=None, wght=None):
    tt = TTFont(os.path.join(FONTS, name + '.woff2'))
    tt.flavor = None
    buf = io.BytesIO()
    tt.save(buf)
    buf.seek(0)
    f = ImageFont.truetype(buf, size)
    if wdth is not None:
        want = {'wdth': wdth, 'wght': wght}
        names = [a['name'] if isinstance(a['name'], str) else a['name'].decode() for a in f.get_variation_axes()]
        tags = {'Width': 'wdth', 'Weight': 'wght'}
        f.set_variation_by_axes([want[tags.get(n, n)] for n in names])
    return f


def logo(size, hue=238):
    """The logo recoloured to the Nore violet, as the launcher does with CSS hue-rotate."""
    im = Image.open(LOGO).convert('RGBA')
    im.thumbnail((size, size), Image.LANCZOS)
    alpha = im.getchannel('A')
    h, s, v = im.convert('RGB').convert('HSV').split()
    h = h.point(lambda x: (x + int(hue / 360 * 255)) % 256)
    out = Image.merge('HSV', (h, s, v)).convert('RGBA')
    out.putalpha(alpha)
    return out


def rank_tag(draw, x, y, text, colour, pixel):
    w = draw.textlength(text, font=pixel)
    bw = draw.textlength('[', font=pixel)
    draw.rectangle([x, y, x + w + 2 * bw + 8, y + 13], fill=tuple(int(c * .14 + b * .86) for c, b in zip(colour, BG)))
    draw.text((x + 3, y + 2), '[', font=pixel, fill=MUTED)
    draw.text((x + 3 + bw + 1, y + 2), text, font=pixel, fill=colour)
    draw.text((x + 3 + bw + w + 2, y + 2), ']', font=pixel, fill=MUTED)


def sidebar(path, title):
    w, h = 164, 314
    im = Image.new('RGB', (w, h), RAIL)
    d = ImageDraw.Draw(im)
    d.line([(w - 1, 0), (w - 1, h)], fill=LINE)
    big = font('Archivo-latin', 30, 72, 900)
    small = font('Archivo-latin', 12, 90, 700)
    pixel = font('Silkscreen-latin', 8)
    lg = logo(64)
    im.paste(lg, (18, 26), lg)
    d.text((18, 104), 'NORE', font=big, fill=TEXT)
    d.text((18, 134), 'LAUNCHER', font=big, fill=TEXT)
    rank_tag(d, 18, 176, '1.4 BETA', YELLOW, pixel)
    d.text((18, 202), title, font=small, fill=MUTED)
    # the formatting-code row: the colours the launcher uses for state
    for i, c in enumerate(CODES):
        d.rectangle([18 + i * 12, h - 34, 18 + i * 12 + 7, h - 27], fill=c)
    d.text((18, h - 20), 'noroclient.pl', font=small, fill=MUTED)
    im.save(path)


def header(path):
    w, h = 150, 57
    im = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(im)
    d.line([(0, h - 1), (w, h - 1)], fill=LINE)
    big = font('Archivo-latin', 20, 72, 900)
    pixel = font('Silkscreen-latin', 8)
    lg = logo(38)
    im.paste(lg, (w - 46, 9), lg)
    d.text((10, 10), 'NORE', font=big, fill=TEXT)
    rank_tag(d, 10, 34, '1.4 BETA', YELLOW, pixel)
    d.rectangle([w - 46, 50, w - 8, 51], fill=ACCENT)
    im.save(path)


if __name__ == '__main__':
    sidebar(os.path.join(BUILD, 'installerSidebar.bmp'), 'Instalator')
    sidebar(os.path.join(BUILD, 'uninstallerSidebar.bmp'), 'Deinstalacja')
    header(os.path.join(BUILD, 'installerHeader.bmp'))
    print('installer bitmaps written to', BUILD)
