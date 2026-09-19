"""One-shot: pull the packed JPEGs out of a .blend into wormed/data/textures.

The MacBook .obj references textures/KeyB.jpg, TopLine.jpg and macScreen.jpg
but ships none of them; the .blend has all three packed inside it. No Blender
here to open it with, so the images are carved out of the file by their JPEG
markers and told apart by SIZE — they are a 2560x1440 wallpaper, a 160x160
key and a 160x8 strip, which nothing else in the file resembles.
"""
import os, re, struct, sys

WANT = {(2560, 1440): 'macScreen.jpg', (160, 160): 'KeyB.jpg', (160, 8): 'TopLine.jpg'}


def dimensions(d):
    """Width and height off the first SOF marker, or None if there isn't one."""
    i = 2
    while i < len(d) - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        marker = d[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = struct.unpack('>HH', d[i + 5:i + 9])
            return w, h
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length, = struct.unpack('>H', d[i + 2:i + 4])
        i += 2 + length
    return None


def main(blend, outdir):
    raw = open(blend, 'rb').read()
    os.makedirs(outdir, exist_ok=True)
    found = {}
    for m in re.finditer(rb'\xff\xd8\xff', raw):
        end = raw.find(b'\xff\xd9', m.start())
        if end < 0:
            continue
        data = raw[m.start():end + 2]
        name = WANT.get(dimensions(data) or ())
        # Photoshop leaves a thumbnail inside the file, so the FIRST match at
        # a given size is the real image and later ones are its previews.
        if name and name not in found:
            found[name] = data
            open(os.path.join(outdir, name), 'wb').write(data)
    for size, name in WANT.items():
        print('%-16s %s' % (name, len(found[name]) if name in found else 'MISSING'), size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
