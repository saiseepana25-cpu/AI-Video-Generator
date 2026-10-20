"""Optional local QA helper. Requires Pillow; not used by the Node pipeline."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys

folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'output/offline-water-cycle')
pairs = ['en-en', 'en-te', 'te-en', 'te-te']
phases = ['overview', 'evaporation', 'condensation', 'rain', 'collection']
tile_w, tile_h, label_h = 216, 384, 35
sheet = Image.new('RGB', (tile_w * 5, (tile_h + label_h) * 4 + 55), '#e4e8e9')
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)
except OSError:
    font = ImageFont.load_default()
draw.text((15, 16), 'VideoCraft | Offline diagnostic: narration -> captions', font=font, fill='#173342')
for row, pair in enumerate(pairs):
    for column, phase in enumerate(phases):
        image = Image.open(folder / f'{pair}.{phase}.png').convert('RGB').resize((tile_w, tile_h))
        x, y = column * tile_w, 55 + row * (tile_h + label_h)
        draw.text((x + 7, y + 6), f'{pair} / {phase}', font=font, fill='#173342')
        sheet.paste(image, (x, y + label_h))
sheet.save(folder / 'contact-sheet.jpg', quality=92)
print(folder / 'contact-sheet.jpg')
