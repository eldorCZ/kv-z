#!/usr/bin/env python3
"""Checks that self-hosted fonts cover Czech (Dodatek 4, V4.1).

Usage: python scripts/check-fonts.py FAMILY=file1.woff2,file2.woff2 [FAMILY=...]
The files of one family (latin + latin-ext subsets) are checked together. Exit code 1 when a glyph is missing.
Requires fontTools and brotli (pip install fonttools brotli).
"""
import sys
from fontTools.ttLib import TTFont

SAMPLE = "Příliš žluťoučký kůň úpěl ďábelské ódy"
CZECH = "ěščřžýáíéúůďťňó ĚŠČŘŽÝÁÍÉÚŮĎŤŇÓ „“‚‘–…0123456789%"
REQUIRED = sorted(set(SAMPLE + SAMPLE.upper() + CZECH) - {" "})


def cmap_of(paths):
    chars = set()
    for p in paths:
        font = TTFont(p)
        chars |= set(font.getBestCmap().keys())
    return chars


def main(argv):
    failed = False
    for arg in argv:
        family, files = arg.split("=", 1)
        have = cmap_of(files.split(","))
        missing = [c for c in REQUIRED if ord(c) not in have]
        status = "OK" if not missing else "CHYBÍ: " + " ".join(missing)
        print(f"{family}: {status}")
        failed |= bool(missing)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
