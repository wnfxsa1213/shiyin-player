"""Generate deterministic image test data before timing the application."""
import pathlib
import sys
from PIL import Image, ImageChops

output = pathlib.Path(sys.argv[1])
vertical = Image.linear_gradient('L').resize((3840, 2160))
horizontal = Image.linear_gradient('L').transpose(Image.Transpose.ROTATE_90).resize((3840, 2160))
for index in range(3):
    shifted = ImageChops.offset(horizontal, 417 * index, 0)
    blue = ImageChops.add_modulo(shifted, vertical)
    image = Image.merge('RGB', (shifted, vertical, blue))
    image.save(output / f'fixture-{index}.png', compress_level=3)
