#!/usr/bin/env python3
"""Bakes the die-cut logo sticker layers for the launcher (DESIGN.md §5 "Die-cut contour").

From src/renderer/assets/logo.png (orange artwork; the page recolours it to the accent with hue-rotate)
it writes two aligned 320x320 layers into src/renderer/assets/album/:
  logo-art.png  – the artwork, padded so the rim has room
  logo-rim.png  – the white vinyl rim (the artwork's silhouette grown by ~5 px at 64 px display size)
The rim stays white whatever the accent; only the art layer is hue-rotated.

  python3 launcher/scripts/build-logo-sticker.py
"""
import os

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'src', 'renderer', 'assets')
VINYL = (251, 250, 247, 255)  # design/tokens.json colors.vinyl
SIZE = 320
ART = 270          # artwork box inside the canvas
GROW = 13          # rim width in canvas px (~2.6 px at 64 px)


def main():
    logo = Image.open(os.path.join(ASSETS, 'logo.png')).convert('RGBA')
    logo = logo.crop(logo.getbbox())
    logo.thumbnail((ART, ART), Image.LANCZOS)
    art = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    art.paste(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2), logo)
    alpha = art.split()[3].point(lambda a: 255 if a > 60 else 0)
    grown = alpha.filter(ImageFilter.MaxFilter(GROW * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2)).point(lambda a: 255 if a > 110 else 0)
    rim = Image.new('RGBA', (SIZE, SIZE), VINYL)
    rim.putalpha(grown.filter(ImageFilter.GaussianBlur(0.7)))
    out = os.path.join(ASSETS, 'album')
    os.makedirs(out, exist_ok=True)
    art.save(os.path.join(out, 'logo-art.png'), optimize=True)
    rim.save(os.path.join(out, 'logo-rim.png'), optimize=True)
    print('wrote logo-art.png, logo-rim.png')


if __name__ == '__main__':
    main()
