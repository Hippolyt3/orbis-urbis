/* Calque des limites administratives (pays, régions, départements, communes, quartiers).
   Source : tuiles vectorielles OpenFreeMap (données OpenStreetMap), dessinées en transparence
   par-dessus l'imagerie satellite. */
"use strict";

const BOUNDARY_FALLBACK = "https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf";
const MVT_MAX_ZOOM = 14;

// Style par niveau administratif OSM (2 = pays, 4 = région, 6 = département, 8 = commune).
// « min » = niveau de zoom à partir duquel la limite apparaît : rien sur la Terre entière,
// puis les pays, les régions, les départements, et enfin les communes.
const BOUNDARY_STYLE = {
  2: { w: 2.6, a: 0.95, min: 5 },
  3: { w: 2.0, a: 0.8, min: 7 },
  4: { w: 1.9, a: 0.85, min: 7 },
  5: { w: 1.5, a: 0.7, min: 9 },
  6: { w: 1.6, a: 0.8, min: 9 },
  7: { w: 1.8, a: 0.85, min: 11 },
  8: { w: 2.2, a: 1, min: 11 },
  // Les niveaux 9 et 10 (arrondissements, quartiers) ne sont volontairement pas dessinés
};

class BoundaryImageryProvider {
  constructor(template) {
    this.template = template;
    this.tilingScheme = new Cesium.WebMercatorTilingScheme();
    this.rectangle = this.tilingScheme.rectangle;
    this.tileWidth = 256;
    this.tileHeight = 256;
    this.minimumLevel = 0;
    this.maximumLevel = 19;
    this.hasAlphaChannel = true;
    this.errorEvent = new Cesium.Event();
    this.credit = new Cesium.Credit("Limites : © OpenFreeMap © OpenMapTiles © contributeurs OpenStreetMap");
    this.tileDiscardPolicy = undefined;
    this.proxy = undefined;
    this.ready = true;
    this.readyPromise = Promise.resolve(true);
    this.cache = new Map();
  }
  getTileCredits() { return []; }
  pickFeatures() { return undefined; }

  loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let p = this.cache.get(key);
    if (!p) {
      const url = this.template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      p = fetch(url).then(r => r.ok ? r.arrayBuffer() : null)
        .then(buf => buf ? (MVT.decode(new Uint8Array(buf), ["boundary"]).boundary || []) : [])
        .catch(() => []);
      this.cache.set(key, p);
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    }
    return p;
  }

  async requestImage(x, y, level) {
    const canvas = document.createElement("canvas");
    canvas.width = this.tileWidth; canvas.height = this.tileHeight;
    if (level < 5) return canvas;   // Terre entière : aucune limite
    // Au-delà du zoom 14, on agrandit la tuile parente
    const d = Math.max(0, level - MVT_MAX_ZOOM), z = level - d;
    const sx = x >> d, sy = y >> d, sub = 1 << d;
    const feats = await this.loadTile(z, sx, sy);
    if (!feats.length) return canvas;
    const extent = feats.extent || 4096;
    const scale = this.tileWidth * sub / extent;
    const ox = (x - (sx << d)) * this.tileWidth, oy = (y - (sy << d)) * this.tileHeight;
    const ctx = canvas.getContext("2d");
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const ordered = feats.filter(f => !f.props.maritime).sort((a, b) => (b.props.admin_level || 0) - (a.props.admin_level || 0));
    const trace = f => {
      ctx.beginPath();
      for (const line of f.lines) line.forEach(([px, py], i) => {
        const X = px * scale - ox, Y = py * scale - oy;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
    };
    // Passe 1 : liseré sombre pour la lisibilité sur l'image satellite ; passe 2 : trait clair
    for (const pass of [0, 1]) for (const f of ordered) {
      const lvl = f.props.admin_level, st = BOUNDARY_STYLE[lvl];
      if (!st || level < st.min) continue;
      const zoomBoost = level >= 15 ? 1.4 : 1;
      ctx.setLineDash(st.dash || []);
      if (pass === 0) { ctx.strokeStyle = `rgba(3,6,14,${st.a * 0.55})`; ctx.lineWidth = (st.w + 1.8) * zoomBoost; }
      else { ctx.strokeStyle = lvl === 8 || lvl === 7 ? `rgba(255,212,110,${st.a})` : `rgba(235,244,255,${st.a})`; ctx.lineWidth = st.w * zoomBoost; }
      trace(f); ctx.stroke();
    }
    return canvas;
  }
}

async function boundaryTemplate() {
  try {
    const r = await fetch("https://tiles.openfreemap.org/planet");
    const j = await r.json();
    return j.tiles?.[0] || BOUNDARY_FALLBACK;
  } catch (e) { return BOUNDARY_FALLBACK; }
}
