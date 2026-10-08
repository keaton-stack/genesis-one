// R21 WK (HANDOFF_R21_WORKERS.md): a .glb fetch and pre-parse off the main thread (module worker, started by plan_workers.js).
// In: {op:"init", meshopt:url} | {op:"glb", id, url | buf, ktx, split} | {op:"abort", id}.
// Out: {id, ok:true, json, bvs, bytes, ms} with every buffer view the glTF parser will ask for as its own ArrayBuffer (transferred):
//   - EXT_meshopt_compression views decoded here (the same wasm decoder three uses);
//   - plain views copied out of the binary chunk;
//   - image views (KTX2, JPEG, PNG) as their own buffers, except JPEG / PNG fallbacks of KHR_texture_basisu textures when the
//     main thread has a KTX2 loader (never read then);
//   - split: a non-interleaved buffer view read by several accessors is cut into one buffer per accessor (json rewritten), so every
//     vertex and index array owns its buffer and nothing downstream has to copy it.
// Or {id, ok:true, raw:ArrayBuffer} for a file this worker does not handle (the main thread parses it as before), or {id, ok:false, err}.
let MD = null, MDP = null;
const CTRL = new Map();
const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const OKEXT = new Set(["EXT_meshopt_compression", "KHR_mesh_quantization", "KHR_texture_basisu", "KHR_texture_transform", "KHR_materials_ior", "KHR_materials_specular", "KHR_materials_emissive_strength", "KHR_materials_unlit", "KHR_materials_transmission", "KHR_materials_clearcoat", "KHR_materials_sheen", "KHR_materials_volume", "KHR_materials_iridescence", "KHR_materials_anisotropy", "KHR_materials_dispersion", "KHR_lights_punctual", "EXT_texture_webp", "EXT_texture_avif"]);

function meshopt() { if (MD) return Promise.resolve(MD); if (!MDP) return Promise.reject(new Error("no decoder")); return MDP; }

function parseGlb(ab, ktx, split) {
  const dv = new DataView(ab); if (ab.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) return null;   // "glTF" v2
  let off = 12, json = null, bin = null;
  while (off + 8 <= ab.byteLength) { const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true); off += 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, off, len))); else if (type === 0x004e4942) bin = { o: off, n: len }; off += len; }
  if (!json || !json.asset) return null;
  for (const e of json.extensionsUsed || []) if (!OKEXT.has(e)) return null;   // Draco or anything else that reads buffers: the main thread's parser
  const bvs = json.bufferViews || [], bufs = json.buffers || [];
  for (let i = 0; i < bufs.length; i++) { const b = bufs[i]; const fb = b.extensions && b.extensions.EXT_meshopt_compression && b.extensions.EXT_meshopt_compression.fallback; if (b.uri !== undefined || (i > 0 && !fb)) return null; }
  // which views are read
  const need = new Set(), skipImg = new Set();
  for (const a of json.accessors || []) { if (a.bufferView !== undefined) need.add(a.bufferView); if (a.sparse) { need.add(a.sparse.indices.bufferView); need.add(a.sparse.values.bufferView); } }
  const imgs = json.images || [], fallbackOnly = new Set();
  if (ktx) { const used = new Set(); for (const t of json.textures || []) { const ex = t.extensions || {}; if (ex.KHR_texture_basisu) used.add(ex.KHR_texture_basisu.source); else if (ex.EXT_texture_webp) used.add(ex.EXT_texture_webp.source); else if (ex.EXT_texture_avif) used.add(ex.EXT_texture_avif.source); else if (t.source !== undefined) used.add(t.source); }
    for (let i = 0; i < imgs.length; i++) if (!used.has(i)) fallbackOnly.add(i); }
  for (let i = 0; i < imgs.length; i++) if (imgs[i].bufferView !== undefined) { if (fallbackOnly.has(i)) skipImg.add(imgs[i].bufferView); else need.add(imgs[i].bufferView); }
  return { json, bin, need, skipImg, bvs, split, caps: null };
}

function sliceOf(ab, bin, bv) { const o = bin.o + (bv.byteOffset || 0), n = bv.byteLength; if (o + n > bin.o + bin.n) throw new Error("buffer view out of range"); return ab.slice(o, o + n); }

// R6 (client.js) caps KTX2 textures after the transcode by dropping their top mip levels (r6Ktx: R6.ktxCap on every texture;
// r6DropMips: R6.ormCap on images used only as occlusion / metal-rough maps). The same levels are cut here from the container
// before the transcode (UASTC, zstd or none: each level is coded on its own, so the levels kept transcode to the same bytes), so
// they are never transcoded, sent or held. BasisLZ (ETC1S) files and anything unusual are left whole for R6 to cap as before.
function ormOnly(json) { const use = {}, tex = json.textures || [];
  const mark = (ti, orm) => { const t = ti !== undefined && tex[ti]; if (!t) return; const ex = t.extensions || {}; const src = ex.KHR_texture_basisu ? ex.KHR_texture_basisu.source : ex.EXT_texture_webp ? ex.EXT_texture_webp.source : ex.EXT_texture_avif ? ex.EXT_texture_avif.source : t.source; if (src === undefined) return; use[src] = use[src] === undefined ? orm : use[src] && orm; };
  for (const m of json.materials || []) { const pb = m.pbrMetallicRoughness || {}; mark(pb.baseColorTexture && pb.baseColorTexture.index, false); mark(pb.metallicRoughnessTexture && pb.metallicRoughnessTexture.index, true); mark(m.normalTexture && m.normalTexture.index, false); mark(m.occlusionTexture && m.occlusionTexture.index, true); mark(m.emissiveTexture && m.emissiveTexture.index, false);
    const ext = m.extensions || {}; for (const k in ext) { const e = ext[k]; if (e && typeof e === "object") for (const q in e) if (e[q] && typeof e[q] === "object" && e[q].index !== undefined) mark(e[q].index, false); } }
  return use; }
const KTXID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
function ktxTrim(buf, cap) {
  const u8 = new Uint8Array(buf); if (buf.byteLength < 80) return null; for (let i = 0; i < 12; i++) if (u8[i] !== KTXID[i]) return null;
  const dv = new DataView(buf), vk = dv.getUint32(12, true), W = dv.getUint32(20, true), H = dv.getUint32(24, true), D = dv.getUint32(28, true), layers = dv.getUint32(32, true), faces = dv.getUint32(36, true), L = dv.getUint32(40, true), sc = dv.getUint32(44, true);
  if (vk !== 0 || (sc !== 0 && sc !== 1 && sc !== 2) || D > 0 || layers > 1 || faces !== 1 || L < 2 || !W || !H) return null;
  let k = 0; while (L - k > 1 && Math.max(Math.max(1, W >> k), Math.max(1, H >> k)) > cap) k++;
  if (!k) return null; if (80 + L * 24 > buf.byteLength) return null;
  const lv = []; for (let i = 0; i < L; i++) { const o = 80 + i * 24; lv.push([Number(dv.getBigUint64(o, true)), Number(dv.getBigUint64(o + 8, true)), Number(dv.getBigUint64(o + 16, true))]); }
  let end = 0; for (let i = k; i < L; i++) end = Math.max(end, lv[i][0] + lv[i][1]);
  const meta = Math.max(dv.getUint32(48, true) + dv.getUint32(52, true), dv.getUint32(56, true) + dv.getUint32(60, true), Number(dv.getBigUint64(64, true) + dv.getBigUint64(72, true)));
  for (let i = k; i < L; i++) if (lv[i][0] < meta || lv[i][0] + lv[i][1] > buf.byteLength) return null;
  const out = buf.slice(0, Math.max(end, meta)), o2 = new DataView(out);
  o2.setUint32(20, Math.max(1, W >> k), true); o2.setUint32(24, Math.max(1, H >> k), true); o2.setUint32(40, L - k, true);
  for (let i = 0; i < L; i++) { const o = 80 + i * 24, src = lv[i + k]; o2.setBigUint64(o, BigInt(src ? src[0] : 0), true); o2.setBigUint64(o + 8, BigInt(src ? src[1] : 0), true); o2.setBigUint64(o + 16, BigInt(src ? src[2] : 0), true); }
  // BasisLZ (ETC1S): the global data holds one 20 byte image descriptor per level (level 0 first) ahead of the shared codebooks;
  // the cut levels' descriptors go, the rest moves up in place (the codebooks are the same for every level)
  if (sc === 1) { const so = Number(dv.getBigUint64(64, true)), sl = Number(dv.getBigUint64(72, true)); if (sl < 20 + L * 20 || so + sl > buf.byteLength) return null;
    const head = new Uint8Array(buf, so, 20), descs = new Uint8Array(buf, so + 20 + k * 20, (L - k) * 20), rest = new Uint8Array(buf, so + 20 + L * 20, sl - 20 - L * 20), o8 = new Uint8Array(out);
    o8.set(head, so); o8.set(descs, so + 20); o8.set(rest, so + 20 + (L - k) * 20); o8.fill(0, so + sl - k * 20, so + sl); o2.setBigUint64(72, BigInt(sl - k * 20), true); }
  return { buf: out, k, saved: buf.byteLength - out.byteLength, unc: lv.slice(0, k).reduce((a, x) => a + x[2], 0) };
}

async function build(ab, P) {
  const { json, bin, need, bvs } = P, out = {}, tr = [];
  let hasMo = false; for (const i of need) if (bvs[i].extensions && bvs[i].extensions.EXT_meshopt_compression) { hasMo = true; break; }
  const D = hasMo ? await meshopt() : null; if (D && D.ready) await D.ready;
  for (const i of need) { const bv = bvs[i]; if (!bv) continue; const mo = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (mo) { if (!bin) throw new Error("no binary chunk"); const src = new Uint8Array(ab, bin.o + (mo.byteOffset || 0), mo.byteLength); const tgt = new Uint8Array(mo.count * mo.byteStride); D.decodeGltfBuffer(tgt, mo.count, mo.byteStride, src, mo.mode, mo.filter); out[i] = tgt.buffer; }
    else { if (!bin || bv.buffer !== 0) throw new Error("view " + i + " has no data"); out[i] = sliceOf(ab, bin, bv); } }
  // one buffer per accessor (only non-interleaved views read by several accessors, no sparse)
  if (P.split) { const users = {}; (json.accessors || []).forEach((a, ai) => { if (a.bufferView !== undefined && !a.sparse) (users[a.bufferView] || (users[a.bufferView] = [])).push(ai); else if (a.sparse && a.bufferView !== undefined) users[a.bufferView] = null; });
    for (const k in users) { const L = users[k]; if (!L || L.length < 2) continue; const bv = bvs[k], src = out[k]; if (!src) continue; let ok = true;
      for (const ai of L) { const a = json.accessors[ai], eb = (CS[a.componentType] || 0) * (NC[a.type] || 0); if (!eb || (bv.byteStride && bv.byteStride !== eb)) { ok = false; break; } const o = a.byteOffset || 0; if (o + a.count * eb > src.byteLength) { ok = false; break; } }
      if (!ok) continue;
      for (const ai of L) { const a = json.accessors[ai], eb = CS[a.componentType] * NC[a.type], o = a.byteOffset || 0, ni = bvs.length; bvs.push({ buffer: 0, byteLength: a.count * eb, wkSplit: +k }); if (bv.byteStride) bvs[ni].byteStride = bv.byteStride; out[ni] = src.slice(o, o + a.count * eb); a.bufferView = ni; a.byteOffset = 0; }
      delete out[k]; } }
  // KTX2 images R6 would cap: cut before the transcode (json.wkTrim[src] = levels cut, read by the client's counters)
  if (P.caps) { const orm = ormOnly(json), imgs = json.images || []; for (let i = 0; i < imgs.length; i++) { const im = imgs[i]; if (im.bufferView === undefined || im.mimeType !== "image/ktx2" || !out[im.bufferView]) continue;
      const cap = orm[i] ? Math.min(P.caps.ktx, P.caps.orm) : P.caps.ktx; if (!(cap > 0)) continue; let r = null; try { r = ktxTrim(out[im.bufferView], cap); } catch (e) { r = null; }
      if (r) { out[im.bufferView] = r.buf; (json.wkTrim || (json.wkTrim = {}))[i] = [r.k, r.saved, r.unc, orm[i] ? 1 : 0]; } } }
  for (const k in out) tr.push(out[k]);
  json.wkPre = true;
  return { json, bvs: out, tr };
}

async function job(m) {
  const t0 = performance.now(); let ab = m.buf || null, bytes = 0;
  if (!ab) { const ac = new AbortController(); CTRL.set(m.id, ac); try { const r = await fetch(m.url, { signal: ac.signal, credentials: "same-origin" }); if (!r.ok) throw new Error("http " + r.status); ab = await r.arrayBuffer(); } finally { CTRL.delete(m.id); } }
  bytes = ab.byteLength; const tf = performance.now();
  let P = null; try { P = parseGlb(ab, !!m.ktx, !!m.split); if (P && m.caps && m.ktx) P.caps = m.caps; } catch (e) { P = null; }
  if (!P) { self.postMessage({ id: m.id, ok: true, raw: ab, bytes, ms: [Math.round(tf - t0), 0] }, [ab]); return; }
  let R = null; try { R = await build(ab, P); } catch (err) { self.postMessage({ id: m.id, ok: true, raw: ab, bytes, err: String(err && err.message || err), ms: [Math.round(tf - t0), 0] }, [ab]); return; }
  self.postMessage({ id: m.id, ok: true, json: m.jtxt ? null : R.json, jtxt: m.jtxt ? JSON.stringify(R.json) : null, bvs: R.bvs, bytes, ms: [Math.round(tf - t0), Math.round(performance.now() - tf)] }, R.tr);
}

self.onmessage = (e) => { const m = e.data || {};
  if (m.op === "init") { if (m.meshopt) MDP = import(m.meshopt).then((mod) => { MD = mod.MeshoptDecoder; return MD.ready.then(() => MD); }); self.postMessage({ id: 0, ok: true, init: true }); return; }
  if (m.op === "abort") { const c = CTRL.get(m.id); if (c) try { c.abort(); } catch (x) {} return; }
  if (m.op === "glb") job(m).catch((err) => { self.postMessage({ id: m.id, ok: false, abort: !!(err && err.name === "AbortError"), err: String(err && err.message || err) }); });
};
