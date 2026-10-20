"""Convert the approved app-icon.png to macOS and Windows icon containers on macOS."""
from pathlib import Path
import struct
import subprocess
import tempfile

assets = Path(__file__).resolve().parents[1] / 'apps/desktop/assets'
source = assets / 'app-icon.png'

def resize(size, target):
    subprocess.run(['sips', '-z', str(size), str(size), str(source), '--out', str(target)],
                   check=True, stdout=subprocess.DEVNULL)

with tempfile.TemporaryDirectory(prefix='bdm-icon-') as temp:
    icons = Path(temp) / 'AppIcon.iconset'
    icons.mkdir()
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            resize(size * scale, icons / (f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'))
    subprocess.run(['iconutil', '-c', 'icns', str(icons), '-o', str(assets / 'icon.icns')], check=True)
    sizes = (16, 32, 48, 64, 128, 256)
    images = []
    for size in sizes:
        target = Path(temp) / f'{size}.png'
        resize(size, target)
        images.append(target.read_bytes())
    offset = 6 + 16 * len(sizes)
    entries = []
    for size, data in zip(sizes, images):
        entries.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    (assets / 'icon.ico').write_bytes(struct.pack('<HHH', 0, 1, len(sizes)) + b''.join(entries) + b''.join(images))
