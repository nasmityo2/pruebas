from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "stokko-source.png"
PUBLIC = ROOT / "public"
IMAGES = PUBLIC / "images"
ASSETS = ROOT / "assets"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "seguisb.ttf" if bold else "segoeui.ttf"
    candidate = Path("C:/Windows/Fonts") / name
    if candidate.exists():
        return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def gradient(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    start = (25, 20, 120)
    end = (0, 177, 194)
    for x in range(width):
        ratio = x / max(width - 1, 1)
        color = tuple(round(a + (b - a) * ratio) for a, b in zip(start, end))
        draw.line((x, 0, x, height), fill=color)
    return image


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source artwork: {SOURCE}")
    IMAGES.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")

    logo = ImageOps.fit(source, (1024, 1024), method=Image.Resampling.LANCZOS)
    logo.save(IMAGES / "stokko-logo.png", optimize=True)
    ImageOps.fit(logo, (512, 512), method=Image.Resampling.LANCZOS).save(
        IMAGES / "default-logo.png", optimize=True
    )

    icon_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    for destination in (IMAGES / "icon.ico", PUBLIC / "icon.ico", PUBLIC / "favicon.ico"):
        logo.save(destination, format="ICO", sizes=icon_sizes)

    splash = gradient((1200, 675))
    splash_logo = ImageOps.fit(logo, (480, 480), method=Image.Resampling.LANCZOS)
    splash.paste(splash_logo, (75, 98), splash_logo)
    splash_draw = ImageDraw.Draw(splash)
    splash_draw.text((620, 228), "Stokko", font=font(92, bold=True), fill="white")
    splash_draw.text(
        (626, 340),
        "Inventario y ventas, bajo control.",
        font=font(28),
        fill=(224, 242, 254),
    )
    splash.save(IMAGES / "splash.png", optimize=True)

    dialog = ImageOps.fit(splash, (493, 312), method=Image.Resampling.LANCZOS)
    dialog.save(ASSETS / "installer-dialog.png", optimize=True)
    banner = gradient((493, 58))
    banner_draw = ImageDraw.Draw(banner)
    banner_draw.text((20, 9), "Stokko", font=font(30, bold=True), fill="white")
    banner.save(ASSETS / "installer-banner.png", optimize=True)

    print("[STOKKO_BRAND_ASSETS_OK]")


if __name__ == "__main__":
    main()
