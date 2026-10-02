"""R6: cap the JPEG / PNG images embedded in the people's rig .glb files (desktop pack 2048 px, mobile pack 1024 px).

The rigs (concierge, residents, staff, players' hosts) carried 3072 px albedo maps (48 MB each on the GPU, uncompressed) and the
mobile pack 1536 px maps (not a power of two). Every other byte of the file is kept as is (meshopt streams, accessors, skins,
animations); only the image buffer views are re-encoded and the binary chunk is re-laid out with every offset remapped.
The client also caps glTF images at load time (R6 in client.js), so this only saves download and decode time.

    python scripts/r6_cap_rig_textures.py [--dry]
"""
import io, json, os, struct, sys
from PIL import Image

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = [(os.path.join(APP, "public", "models"), 2048), (os.path.join(APP, "public", "models_m"), 1024)]
RIGS = ["beth", "brad", "concierge", "host", "jake", "joe", "linetech", "paul", "pilot", "resident_f", "resident_m", "will", "char_m", "char_f"]
DRY = "--dry" in sys.argv


def read_glb(p):
    b = open(p, "rb").read()
    magic, ver, total = struct.unpack("<III", b[:12]); assert magic == 0x46546C67 and ver == 2
    jl, jt = struct.unpack("<II", b[12:20]); assert jt == 0x4E4F534A
    js = json.loads(b[20:20 + jl]); o = 20 + jl
    bl, bt = struct.unpack("<II", b[o:o + 8]); assert bt == 0x004E4942
    return js, b[o + 8:o + 8 + bl]


def write_glb(p, js, binb):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8"); jb += b" " * ((4 - len(jb) % 4) % 4)
    binb = bytes(binb) + b"\0" * ((4 - len(binb) % 4) % 4)
    with open(p, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)


def cap(p, size):
    js, binb = read_glb(p)
    bvs = js.get("bufferViews", [])
    refs = []   # every (dict, key prefix) that points into buffer 0
    for bv in bvs:
        if bv.get("buffer", 0) == 0: refs.append(bv)
        ext = (bv.get("extensions") or {}).get("EXT_meshopt_compression")
        if ext and ext.get("buffer", 0) == 0: refs.append(ext)
    img_bv = {}
    for im in js.get("images", []):
        if "bufferView" in im and im.get("mimeType") in ("image/jpeg", "image/png"): img_bv[im["bufferView"]] = im
    repl = {}; log = []
    for bi, im in img_bv.items():
        bv = bvs[bi]; o = bv.get("byteOffset", 0); data = binb[o:o + bv["byteLength"]]
        pil = Image.open(io.BytesIO(data)); w, h = pil.size
        if max(w, h) <= size: continue
        k = size / max(w, h); nw, nh = max(1, round(w * k)), max(1, round(h * k))
        out = io.BytesIO()
        if im["mimeType"] == "image/jpeg":
            pil.convert("RGB").resize((nw, nh), Image.LANCZOS).save(out, "JPEG", quality=92, optimize=True)
        else:
            pil.resize((nw, nh), Image.LANCZOS).save(out, "PNG", optimize=True)
        repl[id(bv)] = out.getvalue(); log.append("%dx%d->%dx%d %dKB->%dKB" % (w, h, nw, nh, len(data) // 1024, len(repl[id(bv)]) // 1024))
    if not repl: return None
    # re-lay the binary chunk: every distinct range in its old order, 16-byte aligned, images replaced
    ranges = sorted({(r.get("byteOffset", 0), r["byteLength"]) for r in refs})
    for (a0, l0), (a1, l1) in zip(ranges, ranges[1:]): assert a0 + l0 <= a1, "overlapping ranges in " + p
    newpos = {}; nb = bytearray()
    byrange = {}
    for r in refs: byrange.setdefault((r.get("byteOffset", 0), r["byteLength"]), []).append(r)
    for (o, l) in ranges:
        nb += b"\0" * ((16 - len(nb) % 16) % 16)
        rs = byrange[(o, l)]; data = None
        for r in rs:
            if id(r) in repl: data = repl[id(r)]
        if data is None: data = binb[o:o + l]
        newpos[(o, l)] = (len(nb), len(data)); nb += data
    for r in refs:
        no, nl = newpos[(r.get("byteOffset", 0), r["byteLength"])]; r["byteOffset"] = no; r["byteLength"] = nl
    js["buffers"][0]["byteLength"] = len(nb)
    if not DRY: write_glb(p, js, nb)
    return log


for d, size in PACKS:
    for k in RIGS:
        p = os.path.join(d, k + ".glb")
        if not os.path.exists(p): continue
        before = os.path.getsize(p); r = cap(p, size)
        if r: print(os.path.relpath(p, APP), before // 1024, "KB ->", os.path.getsize(p) // 1024, "KB", "; ".join(r))
