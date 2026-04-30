"""
install-logo.py — Convert a source logo into every format the project needs.

Reads:
    SOURCE_PATH (a .jpg / .png / anything Pillow can open)

Writes:
    app/frontend/build/icon.png                           (1024x1024 PNG)
    app/frontend/build/icon.ico                           (multi-res .ico:
                                                           16/24/32/48/64/128/256)
    app/frontend/public/watchdog-logo.png                 (1024x1024 PNG)
    website/public/app/watchdog-logo.png                  (1024x1024 PNG)
    website/public/watchdog-logo.png                      (1024x1024 PNG, new)

Idempotent — safe to re-run any time the source image changes.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


# ── paths ─────────────────────────────────────────────────────────────────────
ROOT  = Path(__file__).resolve().parents[3]   # C:\WATCH-DOG
APP   = ROOT / "app"
WEB   = ROOT / "website"

OUTPUTS = [
    APP / "frontend" / "build"  / "icon.png",
    APP / "frontend" / "public" / "watchdog-logo.png",
    WEB / "public"   / "app"    / "watchdog-logo.png",
    WEB / "public"   / "watchdog-logo.png",
]

ICO_OUTPUT = APP / "frontend" / "build" / "icon.ico"

# Standard Windows icon sizes — covers 16x16 (file explorer) up to 256x256 (large
# taskbar / Start menu). Electron-builder reads all of these from the .ico.
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

PNG_TARGET = 1024   # square; logo gets resampled into a 1024x1024 PNG


def square_pad(img: Image.Image, size: int, bg=(0, 0, 0, 0)) -> Image.Image:
    """Resize the longer edge to `size`, then pad to a perfect square with
    a transparent (or `bg`) background. Keeps the original aspect ratio
    and never crops anything off."""
    w, h = img.size
    scale = size / max(w, h)
    new_w, new_h = int(round(w * scale)), int(round(h * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), bg)
    canvas.paste(resized, ((size - new_w) // 2, (size - new_h) // 2), resized if resized.mode == "RGBA" else None)
    return canvas


def main(src_path: str) -> None:
    src = Path(src_path)
    if not src.exists():
        print(f"[install-logo] source not found: {src}", file=sys.stderr)
        sys.exit(1)

    print(f"[install-logo] reading {src}")
    img = Image.open(src).convert("RGBA")
    print(f"[install-logo] source dimensions: {img.size}")

    # ── master 1024px PNG ────────────────────────────────────────────────────
    master = square_pad(img, PNG_TARGET)
    print(f"[install-logo] master PNG: {master.size}")

    for out in OUTPUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        master.save(out, format="PNG", optimize=True)
        size_kb = out.stat().st_size / 1024
        print(f"[install-logo] wrote {out}   ({size_kb:.0f} KB)")

    # ── multi-resolution .ico for the .exe ──────────────────────────────────
    ICO_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    master.save(ICO_OUTPUT, format="ICO", sizes=ICO_SIZES)
    size_kb = ICO_OUTPUT.stat().st_size / 1024
    print(f"[install-logo] wrote {ICO_OUTPUT}   ({size_kb:.0f} KB, sizes={ICO_SIZES})")

    print("[install-logo] done")


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src:
        print("usage: install-logo.py <path/to/source-logo.png>", file=sys.stderr)
        sys.exit(2)
    main(src)
