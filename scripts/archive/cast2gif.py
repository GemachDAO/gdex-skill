#!/usr/bin/env python3
"""Render an asciinema v2 .cast into a clean animated GIF (pyte + Pillow)."""
import json
import sys
import pyte
from PIL import Image, ImageDraw, ImageFont

CAST = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gdex-demo.cast"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/gdex-demo.gif"

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
FS = 17
PAD = 18
FPS = 12  # sampling rate
BG = (13, 17, 23)

PALETTE = {
    "default": (201, 209, 217), "black": (72, 79, 88), "red": (255, 123, 114),
    "green": (63, 185, 80), "brown": (210, 153, 34), "yellow": (210, 153, 34),
    "blue": (88, 166, 255), "magenta": (188, 140, 255), "cyan": (57, 197, 207),
    "white": (177, 186, 196),
    "brightblack": (110, 118, 129), "brightred": (255, 161, 152),
    "brightgreen": (86, 211, 100), "brightyellow": (227, 179, 65),
    "brightblue": (121, 192, 255), "brightmagenta": (210, 168, 255),
    "brightcyan": (86, 212, 221), "brightwhite": (240, 246, 252),
}


def color(name, bold):
    if name == "default":
        return PALETTE["brightwhite"] if bold else PALETTE["default"]
    if isinstance(name, str) and len(name) == 6:
        try:
            return tuple(int(name[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            pass
    if bold and name in PALETTE and "bright" + name in PALETTE:
        return PALETTE["bright" + name]
    return PALETTE.get(name, PALETTE["default"])


def main():
    lines = open(CAST).read().splitlines()
    header = json.loads(lines[0])
    cols, rows = header.get("width", 100), header.get("height", 30)
    events = [json.loads(l) for l in lines[1:] if l.strip()]

    screen = pyte.Screen(cols, rows)
    stream = pyte.Stream(screen)

    font = ImageFont.truetype(FONT, FS)
    font_b = ImageFont.truetype(FONT_B, FS)
    cw = font.getbbox("M")[2]
    ch = FS + 6
    W = cols * cw + PAD * 2
    H = rows * ch + PAD * 2

    def render():
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        for y in range(rows):
            row = screen.buffer[y]
            for x in range(cols):
                cell = row[x]
                if cell.data and cell.data != " ":
                    fg = color(cell.fg, cell.bold)
                    d.text((PAD + x * cw, PAD + y * ch), cell.data,
                           font=font_b if cell.bold else font, fill=fg)
        return img.convert("P", palette=Image.ADAPTIVE, colors=128)

    frames, durations = [], []
    last_t = 0.0
    interval = 1.0 / FPS
    acc = 0.0
    for t, kind, data in events:
        if kind != "o":
            continue
        stream.feed(data)
        dt = t - last_t
        last_t = t
        acc += dt
        if acc >= interval:
            frames.append(render())
            durations.append(int(acc * 1000))
            acc = 0.0
    # final frame, held
    frames.append(render())
    durations.append(2200)

    print(f"frames={len(frames)} size={W}x{H}")
    frames[0].save(OUT, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, optimize=False, disposal=1)


if __name__ == "__main__":
    main()
