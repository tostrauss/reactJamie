"""Build a flyer-ready QR badge for the liberi x JAMIE beerpong flyer.

White rounded card + navy QR + coral CTA, on a transparent background so it
drops straight into the bottom-left corner of the black flyer.
"""
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont

# --- config -------------------------------------------------------------
URL = "https://app.jamie-app.com/?utm_source=flyer&utm_medium=print&utm_campaign=liberi-beerpong"
NAVY = (35, 27, 67)      # #231B43  brand dark
CORAL = (253, 118, 102)  # #FD7666  brand coral
WHITE = (255, 255, 255)

OUT_BADGE = "marketing/flyer-qr-badge.png"        # drop onto the black flyer
OUT_PLAIN = "marketing/flyer-qr-plain.png"        # bare navy QR, no card

# --- 1. QR code ---------------------------------------------------------
qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=20, border=2)
qr.add_data(URL)
qr.make(fit=True)
qr_img = qr.make_image(fill_color=NAVY, back_color=WHITE).convert("RGB")
qr_img.save(OUT_PLAIN)
qr_size = qr_img.size[0]

# --- 2. plain white rounded card (QR only, no text) --------------------
pad = int(qr_size * 0.10)          # padding around the QR inside the card
card_w = qr_size + pad * 2
card_h = qr_size + pad * 2

card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
draw = ImageDraw.Draw(card)
radius = int(card_w * 0.08)
draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=WHITE)
card.paste(qr_img, (pad, pad))
card.save(OUT_BADGE)
print(f"QR encodes: {URL}")
print(f"{OUT_BADGE}  {card.size[0]}x{card.size[1]}")
print(f"{OUT_PLAIN}  {qr_img.size[0]}x{qr_img.size[1]}")
