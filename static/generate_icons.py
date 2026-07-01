# generate_icons.py — one-time icon generation from icon.svg
# Run: python3 generate_icons.py
import cairosvg

cairosvg.svg2png(url="icon.svg", write_to="icon-192.png", output_width=192, output_height=192)
cairosvg.svg2png(url="icon.svg", write_to="icon-512.png", output_width=512, output_height=512)
print("Icons generated: icon-192.png, icon-512.png")
