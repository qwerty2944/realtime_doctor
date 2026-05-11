#!/usr/bin/env python3
"""Flood-fill near-white pixels from image corners into transparent.

Preserves the colored icon interior; only the surrounding white plate is
removed. Designed for the squircle macOS icon — corners are always white
plate, so a BFS from the four corners only touches the plate.

Usage:
    python3 scripts/transparent-bg.py <png_in> [png_out]
"""
from __future__ import annotations
import sys
from collections import deque
from PIL import Image

WHITE_THRESH = 230  # treat (>=R, >=G, >=B) as white plate
ALPHA_FULL = 250    # only flood through opaque pixels


def is_white(px):
    r, g, b, a = px
    return a >= ALPHA_FULL and r >= WHITE_THRESH and g >= WHITE_THRESH and b >= WHITE_THRESH


def main():
    if len(sys.argv) < 2:
        print('usage: transparent-bg.py <png_in> [png_out]', file=sys.stderr)
        sys.exit(1)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src

    img = Image.open(src).convert('RGBA')
    w, h = img.size
    pixels = img.load()

    visited = bytearray(w * h)
    q = deque()
    for c in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if not is_white(pixels[c]):
            continue
        q.append(c)
        visited[c[1] * w + c[0]] = 1

    cleared = 0
    while q:
        x, y = q.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        cleared += 1
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                idx = ny * w + nx
                if visited[idx]:
                    continue
                if is_white(pixels[nx, ny]):
                    visited[idx] = 1
                    q.append((nx, ny))

    img.save(dst, format='PNG')
    print(f'[transparent-bg] {src} -> {dst}: {cleared} px transparent')


if __name__ == '__main__':
    main()
