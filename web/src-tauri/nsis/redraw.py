#!/usr/bin/env python3
"""
Redraw the NSIS installer pictures in Orbit's own colours.

The Windows installer draws two bitmaps: the sidebar down the left of every
page, and the header strip along the top. Both were still the purple the app
wore before the Orbital Focus pass, which is the first thing anyone installing
Orbit sees.

Run from the repository root, with Pillow installed:

    python3 packaging/linux/../../web/src-tauri/nsis/redraw.py   # see note below

This file lives beside the pictures it draws so the drawing and the result are
never separated. The mark is the icon's own geometry, scaled per bitmap, and the
type is the same family the app falls back to.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = Path('/usr/share/fonts/truetype/dejavu')

# src/data/brand.ts, so the installer and the window agree.
BG_TOP = (27, 29, 34)
BG_BOTTOM = (8, 9, 11)
ACCENT = (211, 243, 107)
INK = (250, 255, 238)
INK_WARM = (205, 237, 99)
MUTED = (141, 144, 151)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    return ImageFont.truetype(str(FONTS / name), size)


def plate(width: int, height: int) -> Image.Image:
    """The background: one graphite wash, dark at the bottom, lit at the top."""
    image = Image.new('RGB', (width, height), BG_BOTTOM)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)),
        )
    # A single lime wash behind wherever the mark sits, so the plate is not flat.
    glow = Image.new('RGB', (width, height), (0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    cx = width * 0.5
    cy = height * 0.42
    radius = min(width, height) * 0.46
    gdraw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(36, 42, 14))
    glow = glow.filter(ImageFilter.GaussianBlur(min(width, height) * 0.2))
    # A wash, not a spotlight: enough that the plate is not a flat rectangle,
    # little enough that the mark still sits on graphite rather than on olive.
    return Image.blend(image, glow, 0.42)


def mark(size: int) -> Image.Image:
    """
    Orbit's own application icon, at the size this picture needs.

    The installer pictures used to be drawn from a hand-kept copy of the mark,
    which is how they ended up still purple: two drawings of the same thing,
    only one of them updated. The PNG beside them is the real thing, generated
    from `icons/icon.svg` by `npx tauri icon`, so it is the source here too.

    The mark has always been a rounded plate, so it is drawn as it is: cutting a
    second, larger corner radius out of it left a hairline of transparency along
    every edge once the two radii disagreed by a pixel.
    """
    source = Image.open(HERE.parent / 'icons' / 'icon.png').convert('RGBA')
    return source.resize((size, size), Image.LANCZOS)


def centre(draw: ImageDraw.ImageDraw, text: str, fnt, cx: int, y: int, fill):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    draw.text((cx - (right - left) / 2 - left, y), text, font=fnt, fill=fill)


def sidebar() -> Image.Image:
    width, height = 164, 314
    image = plate(width, height)
    glyph = mark(58)
    image.paste(glyph, (round((width - 58) / 2), 92), glyph)
    draw = ImageDraw.Draw(image)
    centre(draw, 'Orbit', font(25, True), width // 2, 176, INK)
    centre(draw, 'Game library', font(11), width // 2, 210, MUTED)
    draw.line([(58, 240), (width - 58, 240)], fill=ACCENT, width=1)
    return image


def header() -> Image.Image:
    width, height = 150, 57
    image = plate(width, height)
    glyph = mark(34)
    image.paste(glyph, (12, round((height - 34) / 2)), glyph)
    draw = ImageDraw.Draw(image)
    draw.text((56, 10), 'Orbit', font=font(17, True), fill=INK)
    draw.text((56, 32), 'Setup', font=font(10), fill=MUTED)
    return image


def main() -> None:
    sidebar().save(HERE / 'sidebar.bmp', format='BMP')
    header().save(HERE / 'header.bmp', format='BMP')
    print('wrote', HERE / 'sidebar.bmp')
    print('wrote', HERE / 'header.bmp')


if __name__ == '__main__':
    main()
