"""One-shot: Alembic (Ogawa) -> flat triangle-soup binary for the web scene.

No Alembic library exists for JS and none is installed here, so the mesh is
read straight out of the Ogawa container: a tree of groups whose leaves are
data blocks, each array sample prefixed by a 16-byte key. Run once; the
output in wormed/data is what the browser loads.
"""
import json, struct, sys

DATA = 1 << 63


def load(path):
    f = open(path, 'rb').read()
    assert f[:5] == b'Ogawa', 'not an Ogawa alembic archive'
    root, = struct.unpack_from('<Q', f, 8)
    blocks = {}

    def walk(off, prefix):
        n, = struct.unpack_from('<Q', f, off)
        for i, k in enumerate(struct.unpack_from('<%dQ' % n, f, off + 8)):
            path = '%s/%d' % (prefix, i)
            if k == 0:
                continue
            if k & DATA:
                o = k & ~DATA
                if o:
                    size, = struct.unpack_from('<Q', f, o)
                    blocks[path] = (o + 8, size)
            else:
                walk(k, path)

    walk(root, '')
    return f, blocks


def arrays(f, blocks, base, kind, width):
    """Array samples carry a 16-byte key before the values."""
    off, size = blocks[base]
    n = (size - 16) // width
    return struct.unpack_from('<%d%s' % (n, kind), f, off + 16)


def objects(f, blocks):
    """Each object is <obj>/0 xform, <obj>/1 mesh. The xform is a row-vector
    M44d, so a vertex multiplies it from the LEFT."""
    out = []
    for i in range(1, 64):
        p = '/2/1/%d' % i
        mesh = p + '/1/0/0' if (p + '/1/0/0/1/0') in blocks else p + '/0/0'
        if (mesh + '/1/0') not in blocks:
            continue
        pos = arrays(f, blocks, mesh + '/1/0', 'f', 4)
        idx = arrays(f, blocks, mesh + '/2/0', 'i', 4)
        cnt = arrays(f, blocks, mesh + '/3/0', 'i', 4)
        # An object with no xform node has its MESH properties at that path
        # instead, so the matrix is taken ONLY when the block is the right
        # size — 16 doubles behind the key.
        xf = blocks.get(p + '/0/0/2/0')
        m = arrays(f, blocks, p + '/0/0/2/0', 'd', 8) if xf and xf[1] == 144 else None
        out.append((pos, idx, cnt, m))
    return out


def triangles(pos, idx, cnt, m):
    """Alembic winds faces clockwise where three.js wants counter-clockwise,
    so each fan is emitted reversed — otherwise the whole model renders
    inside-out under backface culling."""
    def xform(v):
        if not m:
            return v
        x, y, z = v
        return (x * m[0] + y * m[4] + z * m[8] + m[12],
                x * m[1] + y * m[5] + z * m[9] + m[13],
                x * m[2] + y * m[6] + z * m[10] + m[14])

    verts = [xform(pos[i:i + 3]) for i in range(0, len(pos), 3)]
    tris, k = [], 0
    for c in cnt:
        face = idx[k:k + c]
        k += c
        for j in range(1, c - 1):
            for vi in (face[0], face[j + 1], face[j]):
                tris.extend(verts[vi])
    return tris


def main(src, dst):
    f, blocks = load(src)
    parts, floats = [], []
    for pos, idx, cnt, m in objects(f, blocks):
        t = triangles(pos, idx, cnt, m)
        parts.append(len(t) // 9)
        floats.extend(t)
    header = json.dumps({'parts': parts}).encode()
    with open(dst, 'wb') as o:
        o.write(struct.pack('<I', len(header)))
        o.write(header)
        o.write(struct.pack('<%df' % len(floats), *floats))
    xs, ys, zs = floats[0::3], floats[1::3], floats[2::3]
    print('parts', parts, 'tris', sum(parts))
    print('bbox x[%.3f %.3f] y[%.3f %.3f] z[%.3f %.3f]'
          % (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
