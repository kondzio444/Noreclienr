#!/usr/bin/env python3
"""Builds the launcher's self-hosted Album fonts (CSP font-src 'self': no remote fonts).

Input: a folder with the upstream TTFs from github.com/google/fonts (SIL OFL 1.1):
  DelaGothicOne.ttf  (ofl/delagothicone/DelaGothicOne-Regular.ttf)
  Onest.ttf          (ofl/onest/Onest[wght].ttf, variable 100-900)
  PixelifySans.ttf   (ofl/pixelifysans/PixelifySans[wght].ttf, variable 400-700)
Output: launcher/src/renderer/assets/fonts/<Family>-latin.woff2 and -latin-ext.woff2
(the same unicode ranges fonts.css declares). Needs fonttools + brotli.

  python3 launcher/scripts/build-fonts.py <ttf-folder>
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

# Google Fonts' latin / latin-ext ranges (kept in sync with src/renderer/fonts.css)
LATIN = '0000-00FF,0131,0152-0153,02BB-02BC,02C6,02DA,02DC,0304,0308,0329,2000-206F,20AC,2122,2191,2193,2212,2215,FEFF,FFFD'
LATIN_EXT = '0100-02BA,02BD-02C5,02C7-02CC,02CE-02D7,02DD-02FF,0304,0308,0329,1D00-1DBF,1E00-1E9F,1EF2-1EFF,2020,20A0-20AB,20AD-20C0,2113,2C60-2C7F,A720-A7FF'

FAMILIES = {'DelaGothicOne': 'DelaGothicOne.ttf', 'Onest': 'Onest.ttf', 'PixelifySans': 'PixelifySans.ttf'}


def codepoints(spec):
    out = []
    for part in spec.split(','):
        a, _, b = part.partition('-')
        out.extend(range(int(a, 16), int(b or a, 16) + 1))
    return out


def build(src, dst, ranges):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.drop_tables += ['DSIG']
    font = TTFont(src)
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=codepoints(ranges))
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(dst)
    return os.path.getsize(dst)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src_dir = sys.argv[1]
    out = os.path.join(os.path.dirname(__file__), '..', 'src', 'renderer', 'assets', 'fonts')
    os.makedirs(out, exist_ok=True)
    for fam, file in FAMILIES.items():
        src = os.path.join(src_dir, file)
        for suffix, ranges in (('latin', LATIN), ('latin-ext', LATIN_EXT)):
            dst = os.path.join(out, f'{fam}-{suffix}.woff2')
            print(f'{dst}: {build(src, dst, ranges)} B')


if __name__ == '__main__':
    main()
