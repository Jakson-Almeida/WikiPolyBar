"""Generate Chrome extension PNG icons and favicon.ico from the source mark."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "extension" / "icons"
SOURCE_CANDIDATES = [
    Path(r"C:\Users\DELL\.cursor\projects\c-Users-DELL-Documents-GitHub-WikiPolyBar\assets\wikipoly-icon-source.png"),
    ICONS / "icon-source.png",
]

NAVY = (27, 58, 107, 255)
NAVY_DEEP = (16, 38, 74, 255)
WHITE = (255, 255, 255, 255)
GOLD = (232, 185, 35, 255)
SKY = (109, 158, 235, 255)
PILL_WHITE = (236, 242, 250, 255)


def rounded_rect(size: int, radius: int, fill) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\calibrib.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_mark(size: int) -> Image.Image:
    """Crisp geometric mark that stays legible at 16px."""
    radius = max(3, round(size * 0.22))
    img = rounded_rect(size, radius, NAVY)
    draw = ImageDraw.Draw(img)

    if size >= 32:
        inset = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inset_draw = ImageDraw.Draw(inset)
        pad = max(1, size // 32)
        inset_draw.rounded_rectangle(
            (pad, pad, size - 1 - pad, size - 1 - pad),
            radius=max(2, radius - pad),
            fill=NAVY_DEEP,
        )
        img = Image.alpha_composite(img, inset)
        draw = ImageDraw.Draw(img)

    f = font(max(10, int(size * (0.62 if size <= 16 else 0.56))))
    letter = "W"
    bbox = draw.textbbox((0, 0), letter, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pills_h = 0 if size < 24 else max(2, round(size * 0.07))
    gap = 0 if size < 24 else max(2, round(size * 0.06))
    content_h = th + (gap + pills_h if pills_h else 0)
    x = (size - tw) / 2 - bbox[0]
    y = (size - content_h) / 2 - bbox[1] - (size * 0.04 if size >= 48 else 0)
    draw.text((x, y), letter, font=f, fill=WHITE)

    if pills_h:
        count = 4 if size >= 48 else 3
        colors = [PILL_WHITE, GOLD, SKY, PILL_WHITE][:count]
        total_w = int(size * 0.46)
        pill_w = max(3, int((total_w - (count - 1) * max(1, size * 0.03)) / count))
        start_x = (size - (pill_w * count + max(1, int(size * 0.03)) * (count - 1))) / 2
        py = y + bbox[1] + th + gap
        for i, color in enumerate(colors):
            px = start_x + i * (pill_w + max(1, int(size * 0.03)))
            draw.rounded_rectangle(
                (px, py, px + pill_w, py + pills_h),
                radius=pills_h / 2,
                fill=color,
            )
    return img


def crop_opaque(im: Image.Image, pad_ratio: float = 0.02) -> Image.Image:
    rgb = im.convert("RGB")
    white = Image.new("RGB", im.size, (255, 255, 255))
    bbox = ImageChops.difference(rgb, white).getbbox()
    if not bbox:
        bbox = im.getbbox()
    if not bbox:
        return im
    cropped = im.crop(bbox)
    pad = max(2, int(min(cropped.size) * pad_ratio))
    canvas = Image.new("RGBA", (cropped.width + pad * 2, cropped.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(cropped, (pad, pad))
    return canvas


def fit_square(im: Image.Image, size: int) -> Image.Image:
    im = im.convert("RGBA")
    im = crop_opaque(im)
    side = max(im.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return square.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)

    source = next((p for p in SOURCE_CANDIDATES if p.exists()), None)
    if source and source != ICONS / "icon-source.png":
        shutil.copy2(source, ICONS / "icon-source.png")
        source = ICONS / "icon-source.png"

    art = Image.open(source).convert("RGBA") if source else None

    outputs: dict[int, Image.Image] = {}
    for size in (16, 32, 48, 128):
        drawn = draw_mark(size)
        if art is not None and size >= 48:
            fitted = fit_square(art, size)
            # Keep the AI mark for store/toolbar sizes; drawn mark for favicon-small.
            outputs[size] = fitted
        else:
            outputs[size] = drawn
        outputs[size].save(ICONS / f"icon{size}.png", "PNG")

    # 16px from the AI art is usually muddy; keep the drawn mark.
    outputs[16] = draw_mark(16)
    outputs[16].save(ICONS / "icon16.png", "PNG")
    outputs[32] = draw_mark(32)
    outputs[32].save(ICONS / "icon32.png", "PNG")

    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    outputs[32].save(
        ICONS / "favicon.ico",
        format="ICO",
        sizes=ico_sizes,
        append_images=[outputs[16], outputs[48] if 48 in outputs else draw_mark(48)],
    )

    # SVG companion for docs / future regeneration.
    (ICONS / "icon.svg").write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="WikiPoly Bar">
  <rect width="128" height="128" rx="28" fill="#1B3A6B"/>
  <text x="64" y="78" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="72" fill="#fff">W</text>
  <rect x="32" y="92" width="12" height="8" rx="4" fill="#ECF2FA"/>
  <rect x="49" y="92" width="12" height="8" rx="4" fill="#E8B923"/>
  <rect x="66" y="92" width="12" height="8" rx="4" fill="#6D9EEB"/>
  <rect x="83" y="92" width="12" height="8" rx="4" fill="#ECF2FA"/>
</svg>
""",
        encoding="utf-8",
    )
    print(f"Wrote icons in {ICONS}")


if __name__ == "__main__":
    main()
