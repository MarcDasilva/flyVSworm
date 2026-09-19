"""Traced 3D anatomy of all 302 neurons, from the NeuroML2 cells in
data/raw/morphology (see SOURCE.txt there for provenance and units).

This replaces a hand-tuned prefix-to-ganglion layout function. Nothing in
here decides where a neuron goes; the tracing does. The only judgement calls
are the frame remap and the uniform scale below, and both are asserted
against known anatomy in test_morphology.py.
"""
import json
import struct
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "morphology"
NML = "{http://www.neuroml.org/schema/neuroml2}"

MAGIC = b"WMPH"
VERSION = 1
HDR_SZ = 16

Point = tuple[float, float, float]

# Straight-line tolerance for dropping a traced point, as a fraction of body
# length. 3e-4 of a 798um animal is 0.24um, which is SMALLER THAN THE NEURITE
# BEING DRAWN — traced diameters here run 0.4-0.6um — so no displacement this
# introduces can be resolved against the wire's own thickness. That is the
# whole justification for the threshold, and it is why raising it is not a
# free win: past about 1e-3 the error exceeds a neurite diameter and the
# tracing starts visibly cutting corners in the nerve ring.
# Costs 13,869 segments -> 9,429 (320 KB -> 223 KB).
SIMPLIFY_EPS = 3e-4


@dataclass
class Arbor:
    """One neuron's traced geometry in render space."""
    name: str
    soma: Point
    segments: list[tuple[Point, Point]]


def _read_cell(path: Path) -> tuple[Point, list[tuple[Point, Point]]]:
    """Native-frame soma point and unconnected line segments for one cell.

    A <segment> always has <distal> but only sometimes <proximal>; when
    proximal is absent the segment begins at its PARENT'S distal point. Ids
    are sparse and are NOT emitted parent-before-child, so the parent's distal
    has to come from a complete id map built in a first pass. Walking the
    elements in document order and reusing "the previous distal" instead
    shreds the arbor into disconnected sticks that still render as a plausible
    fuzz — which is exactly why this is spelled out rather than inlined."""
    root = ET.parse(path).getroot()
    elems = list(root.iter(NML + "segment"))

    distal: dict[int, Point] = {}
    for s in elems:
        d = s.find(NML + "distal")
        distal[int(s.get("id"))] = (float(d.get("x")), float(d.get("y")), float(d.get("z")))

    soma: Point | None = None
    segs: list[tuple[Point, Point]] = []
    for s in elems:
        sid = int(s.get("id"))
        prox = s.find(NML + "proximal")
        parent = s.find(NML + "parent")
        if prox is not None:
            a = (float(prox.get("x")), float(prox.get("y")), float(prox.get("z")))
        elif parent is not None:
            a = distal[int(parent.get("segment"))]
        else:
            a = distal[sid]
        b = distal[sid]
        if sid == 0:
            # Segment 0 is the soma: a sphere, so proximal == distal and it
            # contributes a zero-length segment. Keep it — it is the anchor
            # every firing particle launches from, and dropping it would leave
            # cells whose soma is not on their own arbor.
            soma = b
        segs.append((a, b))

    assert soma is not None, f"{path.name} has no segment 0"
    return soma, segs


def _simplify(segs: list[tuple[Point, Point]]) -> list[tuple[Point, Point]]:
    """Drop a segment whose two endpoints are effectively the same point, and
    merge a run of two collinear segments into one.

    Deliberately local rather than a full Ramer-Douglas-Peucker over each
    branch: the tracing's redundancy is consecutive duplicate and straight
    points, and a chain walk removes those without needing to reconstruct the
    branch topology. The zero-length soma segment is exempt."""
    out: list[tuple[Point, Point]] = []
    for a, b in segs:
        if out:
            pa, pb = out[-1]
            if pb == a and _collinear(pa, pb, b):
                out[-1] = (pa, b)
                continue
        out.append((a, b))
    return out


def _collinear(a: Point, b: Point, c: Point) -> bool:
    """Is b within SIMPLIFY_EPS of the straight line a->c?"""
    ux, uy, uz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    vx, vy, vz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    L2 = ux * ux + uy * uy + uz * uz
    if L2 == 0.0:
        return False
    cx = vy * uz - vz * uy
    cy = vz * ux - vx * uz
    cz = vx * uy - vy * ux
    return (cx * cx + cy * cy + cz * cz) / L2 <= SIMPLIFY_EPS * SIMPLIFY_EPS


def load_morphology(names: list[str]) -> list[Arbor]:
    """Every named neuron's arbor, in render space, index-aligned with names.

    Render space: +x anterior, +y dorsal, +z left, origin at the centre of the
    animal's bounding box, ONE uniform scale putting nose-to-tail at 1.0. The
    native files use micrometres with y anterior-posterior (nose negative),
    z dorsoventral and x left-right, and are a posed animal — the body is
    curved in the y-z sagittal plane, which is why z spans 133um on a worm
    only 65um thick. That pose is kept: it is the animal that was traced, and
    straightening it would be inventing a posture the data does not have."""
    raw = {}
    for name in names:
        path = RAW / f"{name}.cell.nml"
        assert path.exists(), f"no traced morphology for {name} at {path}"
        raw[name] = _read_cell(path)

    pts = [p for soma, segs in raw.values() for seg in segs for p in seg]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    mid = [(lo[i] + hi[i]) / 2 for i in range(3)]
    # ONE divisor for all three axes. Per-axis normalisation would stretch a
    # 798um x 56um x 133um animal to a cube and destroy every traced angle.
    scale = hi[1] - lo[1]

    def to_render(p: Point) -> Point:
        # Native y runs nose-negative to tail-positive; negate it so +x is
        # anterior and the brain faces the same way as the body below, which
        # starts out crawling toward +x.
        return (-(p[1] - mid[1]) / scale,
                (p[2] - mid[2]) / scale,
                (p[0] - mid[0]) / scale)

    out = []
    for name in names:
        soma, segs = raw[name]
        out.append(Arbor(name, to_render(soma),
                         _simplify([(to_render(a), to_render(b)) for a, b in segs])))
    return out


def soma_positions(arbors: list[Arbor]) -> list[Point]:
    """Cell-body coordinates, index-aligned with names.json. This is what
    positions.json carries and what the firing particles fly between."""
    return [a.soma for a in arbors]


def pack_morphology(arbors: list[Arbor]) -> bytes:
    """morphology.bin: a header, a per-neuron segment range, then raw float32
    endpoint pairs.

    The vertex block is byte-for-byte a THREE.BufferAttribute's array, so the
    browser does one fetch and zero parsing. The range table is what lets the
    renderer tint each neuron's own wires with its own membrane voltage —
    without it the geometry is one anonymous blob and the whole point of
    drawing real arbors is lost."""
    n_segments = sum(len(a.segments) for a in arbors)
    hdr = struct.pack("<4sIII", MAGIC, VERSION, len(arbors), n_segments)
    assert len(hdr) == HDR_SZ

    ranges, verts = bytearray(), bytearray()
    start = 0
    for a in arbors:
        ranges += struct.pack("<II", start, len(a.segments))
        for p, q in a.segments:
            verts += struct.pack("<6f", *p, *q)
        start += len(a.segments)
    assert start == n_segments

    # 16-byte header + 8 bytes per neuron keeps the float block 8-aligned, so
    # the browser can view it without copying.
    assert (HDR_SZ + len(ranges)) % 8 == 0
    return bytes(hdr + ranges + verts)


def build(names: list[str] | None = None) -> tuple[list[Arbor], bytes]:
    """Arbors and the packed buffer for the committed name order."""
    data = Path(__file__).resolve().parent.parent / "data"
    if names is None:
        names = json.loads((data / "names.json").read_text())
    arbors = load_morphology(names)
    return arbors, pack_morphology(arbors)
