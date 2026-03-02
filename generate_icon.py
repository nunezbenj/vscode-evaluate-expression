from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 256
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

S = SIZE / 128

def s(v):
    return round(v * S)

# Background gradient (approximate with vertical bands)
for y in range(s(4), s(124)):
    t = (y - s(4)) / (s(120))
    r = int(43 + (26 - 43) * t)
    g = int(94 + (58 - 94) * t)
    b = int(167 + (110 - 167) * t)
    draw.line([(s(4), y), (s(123), y)], fill=(r, g, b, 255))

# Round the background corners
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([s(4), s(4), s(124), s(124)], radius=s(20), fill=255)
img.putalpha(mask)

# Calculator body
draw.rounded_rectangle([s(22), s(16), s(106), s(112)], radius=s(8), fill=(27, 40, 56, 255), outline=(61, 90, 128, 255), width=max(1, s(1.5)))

# Screen
draw.rounded_rectangle([s(28), s(22), s(100), s(52)], radius=s(4), fill=(30, 30, 46, 255))

# Try to load a monospace font
try:
    font_small = ImageFont.truetype("consola.ttf", s(9))
    font_code = ImageFont.truetype("consola.ttf", s(10))
    font_btn = ImageFont.truetype("consola.ttf", s(9))
    font_btn_bold = ImageFont.truetype("consolab.ttf", s(9))
except:
    font_small = ImageFont.load_default()
    font_code = ImageFont.load_default()
    font_btn = ImageFont.load_default()
    font_btn_bold = ImageFont.load_default()

# Screen text
draw.text((s(34), s(24)), ">>>", fill=(79, 195, 247, 255), font=font_small)
draw.text((s(34), s(36)), "f(x) = 42", fill=(166, 227, 161, 255), font=font_code)

# Button colors
btn_color = (61, 90, 128, 255)
accent_color = (230, 165, 46, 255)
code_btn_color = (79, 195, 247, 255)
btn_text = (205, 214, 244, 255)
dark_text = (27, 40, 56, 255)

# Button grid
buttons = [
    # row 1
    [("7", btn_color, btn_text), ("8", btn_color, btn_text), ("9", btn_color, btn_text), ("+", accent_color, dark_text)],
    # row 2
    [("4", btn_color, btn_text), ("5", btn_color, btn_text), ("6", btn_color, btn_text), ("=", accent_color, dark_text)],
    # row 3
    [("1", btn_color, btn_text), ("2", btn_color, btn_text), ("3", btn_color, btn_text), ("{ }", code_btn_color, dark_text)],
]

for row_i, row in enumerate(buttons):
    for col_i, (label, bg, fg) in enumerate(row):
        x1 = s(28 + col_i * 19)
        y1 = s(58 + row_i * 16)
        x2 = x1 + s(15)
        y2 = y1 + s(12)
        draw.rounded_rectangle([x1, y1, x2, y2], radius=s(2), fill=bg)
        # Center text
        bbox = draw.textbbox((0, 0), label, font=font_btn)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = x1 + (s(15) - tw) // 2
        ty = y1 + (s(12) - th) // 2 - s(1)
        draw.text((tx, ty), label, fill=fg, font=font_btn_bold if label in ("+", "=", "{ }") else font_btn)

# Play button (green circle with white triangle) - bottom right
cx, cy, cr = s(100), s(104), s(14)
draw.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=(76, 175, 80, 255))

# White triangle
tri = [(s(95), s(96)), (s(95), s(112)), (s(108), s(104))]
draw.polygon(tri, fill=(255, 255, 255, 255))

# Save at 128x128
img_128 = img.resize((128, 128), Image.LANCZOS)
img_128.save("images/icon.png")

# Also save a 256x256 for high-DPI
img.save("images/icon@2x.png")

print("Icon generated: images/icon.png (128x128) and images/icon@2x.png (256x256)")
