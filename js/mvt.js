/* Décodeur minimal de tuiles vectorielles (format Mapbox Vector Tile). */
"use strict";
(function (root) {
  function Reader(buf) { this.b = buf; this.p = 0; }
  Reader.prototype.varint = function () {
    let r = 0, s = 0, byte;
    do { byte = this.b[this.p++]; if (s < 28) r |= (byte & 0x7f) << s; else r += (byte & 0x7f) * Math.pow(2, s); s += 7; } while (byte & 0x80);
    return r >>> 0 === r ? r : r;
  };
  Reader.prototype.skip = function (wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.p += this.varint();
    else if (wire === 5) this.p += 4;
    else throw new Error("wire " + wire);
  };
  const td = new TextDecoder();
  function readValue(r, end) {
    let v = null;
    while (r.p < end) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 1) { const len = r.varint(); v = td.decode(r.b.subarray(r.p, r.p + len)); r.p += len; }
      else if (f === 2) { v = new DataView(r.b.buffer, r.b.byteOffset + r.p, 4).getFloat32(0, true); r.p += 4; }
      else if (f === 3) { v = new DataView(r.b.buffer, r.b.byteOffset + r.p, 8).getFloat64(0, true); r.p += 8; }
      else if (f === 4 || f === 5) v = r.varint();
      else if (f === 6) { const n = r.varint(); v = (n >>> 1) ^ -(n & 1); }
      else if (f === 7) v = !!r.varint();
      else r.skip(w);
    }
    return v;
  }
  function packed(r) { const len = r.varint(), end = r.p + len, out = []; while (r.p < end) out.push(r.varint()); return out; }
  function geometry(cmds) {
    // Renvoie une liste de lignes [[x,y], ...] en coordonnées de tuile
    const lines = []; let x = 0, y = 0, cur = null, i = 0;
    while (i < cmds.length) {
      const c = cmds[i++], id = c & 7, count = c >> 3;
      if (id === 7) { if (cur && cur.length) cur.push(cur[0].slice()); continue; }
      for (let k = 0; k < count; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
        if (id === 1) { cur = [[x, y]]; lines.push(cur); } else cur.push([x, y]);
      }
    }
    return lines;
  }
  // Décode seulement les couches demandées : { nom: [{ props, type, lines }] , extent }
  function decode(buf, wanted) {
    const r = new Reader(buf), out = {};
    while (r.p < r.b.length) {
      const tag = r.varint();
      if (tag >> 3 !== 3 || (tag & 7) !== 2) { r.skip(tag & 7); continue; }
      const layerLen = r.varint(), end = r.p + layerLen;
      let name = null, extent = 4096; const keys = [], valueRanges = [], feats = [];
      while (r.p < end) {
        const t = r.varint(), f = t >> 3, w = t & 7;
        if (w === 2) {
          const len = r.varint(), a = r.p; r.p += len;
          if (f === 1) name = td.decode(r.b.subarray(a, a + len));
          else if (f === 2) feats.push([a, a + len]);
          else if (f === 3) keys.push(td.decode(r.b.subarray(a, a + len)));
          else if (f === 4) valueRanges.push([a, a + len]);
        } else if (f === 5) extent = r.varint();
        else r.skip(w);
      }
      r.p = end;
      if (!wanted.includes(name)) continue;
      const values = valueRanges.map(([a, b]) => { r.p = a; return readValue(r, b); });
      const list = out[name] = [];
      list.extent = extent;
      for (const [a, b] of feats) {
        r.p = a; let tags = [], type = 0, geom = [];
        while (r.p < b) {
          const t = r.varint(), f = t >> 3;
          if (f === 2) tags = packed(r);
          else if (f === 3) type = r.varint();
          else if (f === 4) geom = packed(r);
          else r.skip(t & 7);
        }
        const props = {};
        for (let k = 0; k < tags.length; k += 2) props[keys[tags[k]]] = values[tags[k + 1]];
        list.push({ props, type, lines: geometry(geom) });
      }
      r.p = end;
    }
    return out;
  }
  root.MVT = { decode };
})(typeof window !== "undefined" ? window : globalThis);
