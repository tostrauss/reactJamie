"""Place the QR badge into the bottom-left corner of the beerpong flyer."""
from PIL import Image

FLYER_IN = r"c:\Users\tobia\Downloads\IMG_8242.JPG.jpeg"
BADGE_IN = "marketing/flyer-qr-badge.png"
OUT = "marketing/beerpong-flyer-qr.png"

WIDTH_FRAC = 0.19       # badge width relative to flyer width
LEFT_FRAC = 0.035       # margin from left edge
BOTTOM_FRAC = 0.02      # margin from bottom edge (smaller = further down)

flyer = Image.open(FLYER_IN).convert("RGBA")
badge = Image.open(BADGE_IN).convert("RGBA")

fw, fh = flyer.size
target_w = int(fw * WIDTH_FRAC)
scale = target_w / badge.width
target_h = int(badge.height * scale)
badge = badge.resize((target_w, target_h), Image.LANCZOS)

x = int(fw * LEFT_FRAC)
y = fh - target_h - int(fh * BOTTOM_FRAC)

flyer.alpha_composite(badge, (x, y))
flyer.convert("RGB").save(OUT, quality=95)
print(f"flyer {fw}x{fh}  badge {target_w}x{target_h}  at ({x},{y})")
print(f"-> {OUT}")
