"""R6: GPU-compressed (KTX2 / Basis Universal) versions of the big uncompressed textures, with the JPEGs kept as fallbacks.

1. /tex PBR sets (desktop tier): writes tex/<name>.ktx2 next to every tex/<name>.jpg listed in TEX below. The image is flipped
   vertically first: TextureLoader textures upload with flipY, compressed textures cannot be flipped at upload. client.js (R6)
   loads the .ktx2 when the KTX2 loader is available and falls back to the .jpg otherwise.
2. People rigs (models/*.glb): every JPEG image gets a KTX2 copy appended to the binary chunk; its textures get
   KHR_texture_basisu pointing at the copy and keep `source` = the JPEG (the glTF fallback for a loader without KTX2).
   Occlusion / metallic-roughness-only images are encoded at 1024 px at most.

Codec per image: normal maps UASTC. Colour and data maps: ETC1S when its transcoded PSNR against the source is at least
ETC1S_MIN dB (small download), otherwise UASTC (near-lossless, about 1 byte a pixel on disk after zstd). The GPU footprint is
the same either way on desktop (BC7 / BC1 from the transcoder are 1 / 0.5 bytes a pixel versus 4 for the JPEG path).

Needs ktx.exe from KTX-Software 4.4.x: python scripts/r6_ktx_textures.py --ktx <dir with ktx.exe> [--only tex|glb] [names...]
"""
import io, json, os, struct, subprocess, sys, tempfile
import numpy as np
from PIL import Image

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXD = os.path.join(APP, "public", "tex")
MODD = os.path.join(APP, "public", "models")
ETC1S_MIN = 42.0
SETS2 = ["adobe", "apron", "dirt", "rock", "sand", "sand2", "tile", "turf", "wood"]
SETS1 = ["corrugated", "detail", "detail2", "jet_carpet", "jet_gold", "jet_leather", "jet_wall", "jet_walnut", "terrazzo", "travertine", "wicker"]
TEX = [s + x for s in SETS2 + SETS1 for x in ("", "_n", "_r")] + ["wall_detail"]
RIGS = ["beth", "brad", "concierge", "jake", "joe", "linetech", "paul", "pilot", "resident_f", "resident_m", "will", "host", "char_m", "char_f"]

args = sys.argv[1:]
def opt(name, d=None):
    if name in args: i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return d
KTX = os.path.join(opt("--ktx", os.environ.get("KTX_BIN", "")), "ktx.exe")
ONLY = opt("--only")
NAMES = set(args)
TMP = tempfile.mkdtemp(prefix="r6ktx_")


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(" ".join(cmd) + "\n" + r.stdout + r.stderr)


def psnr(png, ktx2, w, h):
    raw = ktx2 + ".raw"; run([KTX, "extract", "--transcode", "rgba8", "--level", "0", "--raw", ktx2, raw])
    r = np.fromfile(raw, dtype=np.uint8)[: w * h * 4].reshape(h, w, 4)[:, :, :3].astype(float); os.remove(raw)
    a = np.asarray(Image.open(png).convert("RGB"), dtype=float); m = ((a - r) ** 2).mean()
    return 99.0 if m < 1e-9 else 10 * np.log10(255 ** 2 / m)


def encode(pil, kind, wrap, tag):
    """kind: colour | data | normal. Returns (bytes, codec, psnr)."""
    png = os.path.join(TMP, tag + ".png"); pil.convert("RGB").save(png); w, h = pil.size
    fmt, tf = ("R8G8B8_SRGB", "srgb") if kind == "colour" else ("R8G8B8_UNORM", "linear")
    base = [KTX, "create", "--format", fmt, "--assign-tf", tf, "--generate-mipmap", "--mipmap-wrap", "wrap" if wrap else "clamp"]
    ua = os.path.join(TMP, tag + "_u.ktx2"); et = os.path.join(TMP, tag + "_e.ktx2")
    if kind != "normal":
        run(base + ["--encode", "basis-lz", "--qlevel", "255", "--clevel", "2", png, et]); pe = psnr(png, et, w, h)
        if pe >= ETC1S_MIN: return open(et, "rb").read(), "etc1s", pe
    run(base + ["--encode", "uastc", "--uastc-quality", "2", "--zstd", "20", png, ua]); pu = psnr(png, ua, w, h)
    return open(ua, "rb").read(), "uastc", pu


def do_tex():
    for n in TEX:
        if NAMES and n not in NAMES: continue
        src = os.path.join(TEXD, n + ".jpg")
        if not os.path.exists(src): print("missing", src); continue
        kind = "normal" if n.endswith("_n") else "data" if (n.endswith("_r") or n == "wall_detail") else "colour"
        pil = Image.open(src).convert("RGB").transpose(Image.FLIP_TOP_BOTTOM)
        data, codec, p = encode(pil, kind, True, n)
        open(os.path.join(TEXD, n + ".ktx2"), "wb").write(data)
        print("tex/%s.ktx2 %s %s %.1f dB %d KB (jpg %d KB)" % (n, kind, codec, p, len(data) // 1024, os.path.getsize(src) // 1024), flush=True)


def read_glb(p):
    b = open(p, "rb").read(); jl = struct.unpack("<I", b[12:16])[0]; js = json.loads(b[20:20 + jl]); o = 20 + jl
    bl = struct.unpack("<I", b[o:o + 4])[0]; return js, bytearray(b[o + 8:o + 8 + bl])


def write_glb(p, js, binb):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8"); jb += b" " * ((4 - len(jb) % 4) % 4)
    binb = bytes(binb) + b"\0" * ((4 - len(binb) % 4) % 4)
    with open(p, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb); f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)


def do_glb():
    for k in RIGS:
        if NAMES and k not in NAMES: continue
        p = os.path.join(MODD, k + ".glb")
        if not os.path.exists(p): continue
        js, binb = read_glb(p)
        if "KHR_texture_basisu" in (js.get("extensionsUsed") or []) and any((t.get("extensions") or {}).get("KHR_texture_basisu") for t in js.get("textures", [])):
            print(k, "already has KTX2 copies"); continue
        tex = js.get("textures", []); use = {}
        def mark(ti, kind):
            if ti is None or ti >= len(tex): return
            s = tex[ti].get("source")
            if s is None: return
            prev = use.get(s)
            use[s] = kind if prev is None or prev == kind else ("colour" if "colour" in (prev, kind) else "normal" if "normal" in (prev, kind) else "data")
        for m in js.get("materials", []):
            pb = m.get("pbrMetallicRoughness", {})
            mark((pb.get("baseColorTexture") or {}).get("index"), "colour"); mark((pb.get("metallicRoughnessTexture") or {}).get("index"), "orm")
            mark((m.get("occlusionTexture") or {}).get("index"), "orm"); mark((m.get("normalTexture") or {}).get("index"), "normal"); mark((m.get("emissiveTexture") or {}).get("index"), "colour")
        out = []
        for si, im in enumerate(list(js.get("images", []))):
            if im.get("mimeType") not in ("image/jpeg", "image/png") or "bufferView" not in im or si not in use: continue
            bv = js["bufferViews"][im["bufferView"]]; o = bv.get("byteOffset", 0)
            pil = Image.open(io.BytesIO(bytes(binb[o:o + bv["byteLength"]]))).convert("RGB"); kind = use[si]
            if kind == "orm":
                kind = "data"
                if max(pil.size) > 1024: s = 1024 / max(pil.size); pil = pil.resize((round(pil.size[0] * s), round(pil.size[1] * s)), Image.LANCZOS)
            data, codec, pq = encode(pil, kind, False, "%s_%d" % (k, si))
            binb += b"\0" * ((16 - len(binb) % 16) % 16); off = len(binb); binb += data
            js["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(data)})
            js["images"].append({"bufferView": len(js["bufferViews"]) - 1, "mimeType": "image/ktx2"}); ni = len(js["images"]) - 1
            for t in tex:
                if t.get("source") == si: t.setdefault("extensions", {})["KHR_texture_basisu"] = {"source": ni}
            out.append("%d %s %s %dx%d %.1f dB %d KB" % (si, kind, codec, pil.size[0], pil.size[1], pq, len(data) // 1024))
        if not out: continue
        js["buffers"][0]["byteLength"] = len(binb)
        eu = js.setdefault("extensionsUsed", [])
        if "KHR_texture_basisu" not in eu: eu.append("KHR_texture_basisu")
        before = os.path.getsize(p); write_glb(p, js, binb)
        print("models/%s.glb %d -> %d KB: %s" % (k, before // 1024, os.path.getsize(p) // 1024, "; ".join(out)), flush=True)


if ONLY in (None, "tex"): do_tex()
if ONLY in (None, "glb"): do_glb()
