// R6: the Founders' Cache tokens get the $GBACK coin face (tex/coin_face.jpg, from the brand coin) on both sides and a green
// metal edge, instead of a plain gold disc. The client builds the coins in buildMinigames (HUNT.coins, one shared
// CylinderGeometry whose groups are 0 edge, 1 and 2 the faces); this swaps their materials once they exist.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var CO = window.PLAN_COIN = window.PLAN_COIN || { v: "r6-1", done: false, errs: [] };
  function note(w, e) { if (CO.errs.length < 40) CO.errs.push(w + ": " + ((e && e.message) || e)); }
  function mats() {
    var tex = new THREE.TextureLoader().load("/tex/coin_face.jpg");
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.center.set(0.5, 0.5); tex.rotation = Math.PI / 2;   // the cap UVs turn with the upright cylinder
    var face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22, metalness: 0.35, roughness: 0.38 });
    var edge = new THREE.MeshStandardMaterial({ color: 0x3fc463, emissive: 0x1b7a35, emissiveIntensity: 0.35, metalness: 0.75, roughness: 0.3 });
    return [edge, face, face];
  }
  // the client's auto-instancer merges the twelve coin meshes into one InstancedMesh at the scene root (same geometry
  // parameters), so the swap targets that, and the source meshes too in case a tier keeps them separate
  function isCoinGeo(g) { var p = g && g.parameters; return !!p && p.radiusTop === 0.55 && p.radiusBottom === 0.55 && p.height === 0.12 && g.groups && g.groups.length >= 3; }
  var M = null, last = 0;
  function apply(now) {
    if (typeof HUNT === "undefined" || !HUNT.coins || !HUNT.coins.length || typeof THREE === "undefined" || typeof scene === "undefined") return;
    if (now - last < 2000) return; last = now;
    try {
      if (!M) M = mats();
      HUNT.coins.forEach(function (c) { if (c && c.m && isCoinGeo(c.m.geometry) && c.m.material !== M) c.m.material = M; });
      var kids = scene.children; for (var i = 0; i < kids.length; i++) { var o = kids[i]; if (o.isInstancedMesh && o.material !== M && isCoinGeo(o.geometry)) { o.material = M; CO.inst = (CO.inst || 0) + 1; } }
      CO.done = true; CO.n = HUNT.coins.length;
    } catch (e) { note("apply", e); }
  }
  window.PLAN_HOOKS.frame.push({ name: "planCoin", fn: function () { apply(performance.now()); } });
})();
