/* Orbis Urbis : un globe Google Earth où l'on achète les communes du monde. */
"use strict";

const CFG = window.ORBIS_CONFIG || {};
/* ---------- Économie ---------- */
const START = 0;             // crédits de départ
const BASE_PRICE = 1000;     // prix d'une commune sans habitants
const PER_HAB = 0.5;         // + 0,50 ₵ par habitant (Tokyo ≈ 4,9 millions)
const YIELD = 0.15;          // revenu horaire = 15 % du prix
const $ = id => document.getElementById(id);

/* ---------- Outils ---------- */
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let regionNames = null; try { regionNames = new Intl.DisplayNames(["fr"], { type: "region" }); } catch (e) {}
const countryOf = cc => { try { return regionNames?.of(cc) || cc; } catch (e) { return cc; } };
const fmt = n => Math.floor(n).toLocaleString("fr-FR").replace(/ /g, " ");
const fmtShort = n => n >= 1e6 ? (n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: n >= 1e7 ? 0 : 1 }) + " M ₵" : n >= 1e4 ? Math.round(n / 1000) + " k ₵" : fmt(n) + " ₵";
const fmtPop = p => !p ? "non renseignée" : p >= 1e6 ? (p / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M" : fmt(p);
const toRad = Math.PI / 180;
function angDist(lat1, lng1, lat2, lng2) {
  const s = Math.sin((lat2 - lat1) * toRad / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin((lng2 - lng1) * toRad / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / toRad;
}

/* ---------- Communes (GeoNames, plus de 500 habitants) ---------- */
const N = { count: 0, gid: [], name: [], cc: [], lat: null, lng: null, pop: null, byGid: new Map(), grid: new Map(), slugs: null };
const priceOf = i => Math.round(BASE_PRICE + N.pop[i] * PER_HAB);

async function loadCommunes(onProgress) {
  const res = await fetch("data/communes.txt");
  if (!res.ok) throw new Error("http " + res.status);
  const total = +res.headers.get("content-length") || 9.6e6;
  const reader = res.body.getReader(), dec = new TextDecoder();
  let text = "", got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; text += dec.decode(value, { stream: true }); onProgress(Math.min(0.99, got / total)); }
  text += dec.decode();
  const lines = text.split("\n"); if (!lines[lines.length - 1]) lines.pop();
  const n = lines.length;
  N.lat = new Float32Array(n); N.lng = new Float32Array(n); N.pop = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const f = lines[i].split("\t");
    N.gid.push(f[0]); N.name.push(f[1]); N.cc.push(f[2]);
    N.lat[i] = +f[3]; N.lng[i] = +f[4]; N.pop[i] = +f[5];
    N.byGid.set(f[0], i);
    const k = (Math.floor(N.lat[i]) + 90) * 400 + (Math.floor(N.lng[i]) + 180);
    let cell = N.grid.get(k); if (!cell) N.grid.set(k, cell = []); cell.push(i);
  }
  N.count = n;
}
function commune(i) {
  return { i, gid: N.gid[i], name: N.name[i], cc: N.cc[i], country: countryOf(N.cc[i]), lat: N.lat[i], lng: N.lng[i], pop: N.pop[i], price: priceOf(i), rank: i + 1 };
}
function around(lat, lng, r, fn) {
  const la0 = Math.max(-90, Math.floor(lat - r)), la1 = Math.min(89, Math.floor(lat + r));
  const span = Math.min(180, r / Math.max(0.05, Math.cos(Math.min(89, Math.abs(lat) + r) * toRad)));
  const lo0 = Math.floor(lng - span), lo1 = Math.floor(lng + span);
  for (let a = la0; a <= la1; a++) for (let o = lo0; o <= lo1; o++) {
    const oo = ((o + 180) % 360 + 360) % 360 - 180;
    const cell = N.grid.get((a + 90) * 400 + (oo + 180)); if (cell) for (const i of cell) fn(i);
  }
}
function nearest(lat, lng, maxDeg) {
  let best = -1, bd = maxDeg;
  around(lat, lng, maxDeg, i => { const d = angDist(lat, lng, N.lat[i], N.lng[i]); if (d < bd) { bd = d; best = i; } });
  return best;
}

/* ---------- Joueurs (Supabase : comptes, profils, achats partagés) ---------- */
const S = { uid: null, email: "", me: null, owners: new Map(), profiles: new Map(), selected: null, busy: false };
const sb = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase)
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey)
  : null;
function balance() {
  const p = S.me; if (!p) return START;
  return Number(p.balance) + Number(p.rate) * (Date.now() - new Date(p.updated_at).getTime()) / 3.6e6;
}
// Vert : mes communes. Rouge : celles des autres joueurs.
const MINE = "#34d27a", RIVAL = "#ff4a4a";
const colorFor = uid => uid === S.uid ? MINE : RIVAL;
const nameFor = uid => uid === S.uid ? "Vous" : (S.profiles.get(uid)?.pseudo || "Un joueur");
const hueOf = id => { let h = 0; for (const ch of id || "") h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

/* ---------- La Terre (CesiumJS) ---------- */
Cesium.Ion.defaultAccessToken = CFG.cesiumIonToken || "";
const viewer = new Cesium.Viewer("globe", {
  baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
  homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false, scene3DOnly: true,
});
const scene = viewer.scene, camera = viewer.camera;
scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b1b30");
scene.screenSpaceCameraController.minimumZoomDistance = 120;
scene.screenSpaceCameraController.maximumZoomDistance = 4.5e7;
// Zoom uniquement à la molette (et au pincement sur écran tactile) ; le clic droit sert à incliner la vue
{
  const ssc = scene.screenSpaceCameraController, E = Cesium.CameraEventType;
  ssc.zoomEventTypes = [E.WHEEL, E.PINCH];
  ssc.tiltEventTypes = [E.RIGHT_DRAG, E.MIDDLE_DRAG, E.PINCH, { eventType: E.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL }];
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

/* Pincement à deux doigts sur pavé tactile : Chrome, Edge et Firefox l'envoient comme
   « molette + Ctrl », Safari comme un geste. On zoome vers l'endroit sous les doigts. */
function zoomToward(clientX, clientY, factor) {
  // factor < 1 : on se rapproche ; factor > 1 : on s'éloigne
  const rect = viewer.canvas.getBoundingClientRect();
  const pos = new Cesium.Cartesian2(clientX - rect.left, clientY - rect.top);
  const target = camera.pickEllipsoid(pos) || camera.pickEllipsoid(new Cesium.Cartesian2(rect.width / 2, rect.height / 2));
  const h = camera.positionCartographic.height;
  const ssc = scene.screenSpaceCameraController;
  factor = Math.min(Math.max(factor, ssc.minimumZoomDistance / h), ssc.maximumZoomDistance / h);
  if (!target) { camera.zoomIn(h * (1 - factor)); return; }
  const toTarget = Cesium.Cartesian3.subtract(target, camera.position, new Cesium.Cartesian3());
  const dist = Cesium.Cartesian3.magnitude(toTarget);
  Cesium.Cartesian3.normalize(toTarget, toTarget);
  camera.move(toTarget, dist * (1 - factor));
}
viewer.container.addEventListener("wheel", e => {
  if (!e.ctrlKey) return;               // défilement normal : laissé à Cesium (molette de souris)
  e.preventDefault(); e.stopPropagation();
  stopSpin();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomToward(e.clientX, e.clientY, Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.012))));
}, { capture: true, passive: false });
let gestureScale = 1;
viewer.container.addEventListener("gesturestart", e => { e.preventDefault(); gestureScale = 1; stopSpin(); });
viewer.container.addEventListener("gesturechange", e => {
  e.preventDefault();
  const f = gestureScale / e.scale; gestureScale = e.scale;
  zoomToward(e.clientX, e.clientY, f);
});
viewer.container.addEventListener("gestureend", e => e.preventDefault());
viewer.creditDisplay.addStaticCredit(new Cesium.Credit("Communes : GeoNames (CC BY 4.0)"));
camera.setView({ destination: Cesium.Cartesian3.fromDegrees(10, 30, 2.2e7) });

let EARTH = "satellite";
async function setupEarth() {
  // Imagerie satellite Esri : toujours chargée, sert de secours sans clé Google
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19, credit: "Imagerie © Esri, Maxar, Earthstar Geographics",
  }));
  // Quadrillage des limites : pays, régions, départements, communes, quartiers
  boundaryTemplate().then(t => viewer.imageryLayers.addImageryProvider(new BoundaryImageryProvider(t)));
  if (!CFG.googleMapsApiKey && !CFG.cesiumIonToken) return;
  try {
    const tiles = await Cesium.createGooglePhotorealistic3DTileset({ key: CFG.googleMapsApiKey || undefined, onlyUsingWithGoogleGeocoder: true });
    scene.primitives.add(tiles);
    scene.globe.show = false;
    EARTH = "google";
  } catch (e) {
    console.warn(e);
    toast("La Terre 3D de Google n'a pas pu se charger. Vérifiez la clé dans js/config.js.", "err");
  }
}

// Rotation lente au démarrage, jusqu'au premier geste
let spinning = true;
const stopSpin = () => { spinning = false; };
["pointerdown", "wheel", "touchstart"].forEach(ev => viewer.canvas.addEventListener(ev, stopSpin, { passive: true }));
viewer.clock.onTick.addEventListener(() => { if (spinning) camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0006); });

/* Marqueurs : seulement les communes de la zone regardée */
const pointsLayer = scene.primitives.add(new Cesium.PointPrimitiveCollection());
const labelsLayer = scene.primitives.add(new Cesium.LabelCollection());
const selLayer = scene.primitives.add(new Cesium.PointPrimitiveCollection());
const C = Cesium.Color;
const WHITE = C.fromCssColorString("#eaf2ff"), DIM = C.fromCssColorString("#b9cde2").withAlpha(0.85), OUT = C.fromCssColorString("#03050b").withAlpha(0.7);

function viewState() {
  const cg = camera.positionCartographic;
  const h = cg.height, R = 6371000;
  const nadir = { lat: cg.latitude / toRad, lng: cg.longitude / toRad };
  const horizon = Math.acos(R / (R + h)) / toRad;
  const mid = camera.pickEllipsoid(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
  let center = nadir;
  if (mid) { const g = Cesium.Cartographic.fromCartesian(mid); center = { lat: g.latitude / toRad, lng: g.longitude / toRad }; }
  const r = Math.min(horizon, h / 111000 * 1.4 + 0.01);
  return { h, nadir, horizon, center, r: Math.max(r, angDist(nadir.lat, nadir.lng, center.lat, center.lng) * 1.6) };
}

let markersT = 0;
function scheduleMarkers() { clearTimeout(markersT); markersT = setTimeout(updateMarkers, 120); }
camera.percentageChanged = 0.05;
camera.changed.addEventListener(scheduleMarkers);
camera.moveEnd.addEventListener(updateMarkers);

// Les points des communes apparaissent en même temps que le quadrillage des limites de communes
// (niveau 11 du calque de limites, soit environ 40 km d'altitude), pour ne pas surcharger le navigateur.
const MARKERS_MAX_HEIGHT = 40000;
const HINT_DEFAULT = document.getElementById("hint").textContent;
function updateMarkers() {
  if (!N.count) return;
  const v = viewState();
  const hint = document.getElementById("hint");
  if (v.h > MARKERS_MAX_HEIGHT) {
    if (pointsLayer.length || labelsLayer.length) { pointsLayer.removeAll(); labelsLayer.removeAll(); }
    hint.textContent = "Zoomez sur une ville pour faire apparaître les communes";
    return;
  }
  hint.textContent = HINT_DEFAULT;
  const visible = i => angDist(v.nadir.lat, v.nadir.lng, N.lat[i], N.lng[i]) < v.horizon * 0.98 && angDist(v.center.lat, v.center.lng, N.lat[i], N.lng[i]) < v.r;
  const cand = [];
  if (v.r > 10) { for (let i = 0; i < Math.min(N.count, 30000) && cand.length < 700; i++) if (visible(i)) cand.push(i); }
  else { around(v.center.lat, v.center.lng, v.r, i => { if (visible(i)) cand.push(i); }); cand.sort((a, b) => a - b); cand.length = Math.min(cand.length, 1500); }
  for (const [gid] of S.owners) { const i = N.byGid.get(gid); if (i !== undefined && !cand.includes(i) && visible(i)) cand.push(i); }

  pointsLayer.removeAll(); labelsLayer.removeAll();
  const maxLabels = innerWidth < 720 ? 25 : 50, sep = v.r / 9, labelled = [];
  if (S.selected && visible(S.selected.i)) labelled.push(S.selected.i);
  for (const i of cand) {
    const own = S.owners.get(N.gid[i])?.o;
    const pop = N.pop[i];
    if (own && own === S.uid) { /* déjà dessinée en vert par drawMine */ }
    else pointsLayer.add({
      position: Cesium.Cartesian3.fromDegrees(N.lng[i], N.lat[i], 0),
      pixelSize: own ? 11 : pop >= 1e6 ? 8 : pop >= 1e5 ? 6 : 4,
      color: own ? C.fromCssColorString(colorFor(own)) : pop >= 1e5 ? WHITE : DIM,
      outlineColor: OUT, outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id: { i },
    });
    const nearMiddle = v.r <= 10 || angDist(v.nadir.lat, v.nadir.lng, N.lat[i], N.lng[i]) < v.horizon * 0.55;
    if (nearMiddle && labelled.length < maxLabels && !labelled.includes(i) && labelled.every(j => angDist(N.lat[i], N.lng[i], N.lat[j], N.lng[j]) > sep)) labelled.push(i);
  }
  for (const i of labelled) {
    const own = S.owners.get(N.gid[i])?.o, sel = S.selected?.i === i;
    labelsLayer.add({
      position: Cesium.Cartesian3.fromDegrees(N.lng[i], N.lat[i], 0),
      text: N.name[i],
      font: `${sel ? 700 : 600} ${sel ? 16 : 13}px Inter, system-ui, sans-serif`,
      fillColor: own ? C.fromCssColorString(colorFor(own)) : C.WHITE,
      outlineColor: C.BLACK.withAlpha(0.85), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT, verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(9, 0),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id: { i },
    });
  }
}

/* ---------- Niveaux d'amélioration (identiques à supabase/04_ameliorations.sql) ---------- */
// cost : prix de l'amélioration VERS ce niveau, en part du prix de la commune
const LEVELS = [
  null,
  { name: "Commune",  mult: 1 },
  { name: "Marché",   mult: 1.5, cost: 0.5 },
  { name: "Gare",     mult: 2,   cost: 1 },
  { name: "Aéroport", mult: 3,   cost: 2 },
  { name: "Monument", mult: 5,   cost: 4 },
];
const levelOf = o => Math.min(5, Math.max(1, o?.lv || 1));
const incomeOf = (o, basePrice) => (o?.p || basePrice) * YIELD * LEVELS[levelOf(o)].mult;
const investedOf = (o, basePrice) => o?.inv || o?.p || basePrice;

/* ---------- Mes communes : un point vert visible à toutes les échelles ---------- */
// Dessiné au-dessus du sol (sans traverser la Terre), même vu depuis l'espace.
const mineLayer = scene.primitives.add(new Cesium.PointPrimitiveCollection());
const MINE_COLOR = C.fromCssColorString(MINE);
let mineKey = "";
function drawMine() {
  if (!N.count) return;
  const gids = [];
  for (const [gid, o] of S.owners) if (o.o === S.uid) gids.push(gid);
  const key = S.uid + ":" + gids.sort().map(g => g + "@" + levelOf(S.owners.get(g))).join(",");
  if (key === mineKey) return;
  mineKey = key;
  mineLayer.removeAll();
  for (const gid of gids) {
    const i = N.byGid.get(gid); if (i === undefined) continue;
    const lv = levelOf(S.owners.get(gid));
    mineLayer.add({
      position: Cesium.Cartesian3.fromDegrees(N.lng[i], N.lat[i], 200),
      pixelSize: 7 + lv * 2, color: MINE_COLOR,
      outlineColor: lv === 5 ? C.fromCssColorString("#f2c14e") : C.WHITE.withAlpha(0.9), outlineWidth: lv === 5 ? 3 : 2,
      id: { i },
    });
  }
}

// Halo doré qui pulse autour de la commune choisie
let selPoint = null;
scene.preRender.addEventListener(() => {
  if (!selPoint) return;
  const t = (performance.now() % 1400) / 1400;
  selPoint.pixelSize = 12 + t * 26;
  selPoint.outlineColor = C.fromCssColorString("#f2c14e").withAlpha(1 - t);
});

// Clic : sur un marqueur, ou au plus près de l'endroit cliqué
new Cesium.ScreenSpaceEventHandler(viewer.canvas).setInputAction(ev => {
  if (!N.count) return;
  const picked = scene.pick(ev.position);
  if (picked?.id && typeof picked.id.i === "number") return select(picked.id.i, false);
  let cart = scene.pickPositionSupported ? scene.pickPosition(ev.position) : undefined;
  if (!cart) cart = camera.pickEllipsoid(ev.position);
  if (!cart) return;
  const g = Cesium.Cartographic.fromCartesian(cart);
  const i = nearest(g.latitude / toRad, g.longitude / toRad, Math.max(0.005, viewState().r / 15));
  if (i >= 0) select(i, false);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

/* ---------- Fiche commune ---------- */
function flyTo(c) {
  stopSpin();
  const range = c.pop > 1e6 ? 28000 : c.pop > 1e5 ? 9000 : 2600;
  camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 0), 10), {
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(EARTH === "google" ? -35 : -55), range), duration: 3,
  });
}
function select(i, fly) {
  const c = commune(i);
  S.sellConfirm = null;
  S.selected = c;
  if (fly) flyTo(c);
  selLayer.removeAll();
  selPoint = selLayer.add({ position: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 0), color: C.TRANSPARENT, outlineWidth: 2.5, pixelSize: 12, disableDepthTestDistance: Number.POSITIVE_INFINITY });
  document.body.classList.add("has-card");
  $("card").hidden = false;
  renderCard(); updateMarkers();
}
$("close").onclick = () => { S.selected = null; selPoint = null; selLayer.removeAll(); $("card").hidden = true; document.body.classList.remove("has-card"); updateMarkers(); };

function renderCard() {
  const c = S.selected; if (!c) return;
  const own = S.owners.get(c.gid);
  $("c-country").textContent = c.country;
  $("c-name").textContent = c.name;
  $("c-coords").textContent = `${Math.abs(c.lat).toFixed(3)}° ${c.lat >= 0 ? "N" : "S"} · ${Math.abs(c.lng).toFixed(3)}° ${c.lng >= 0 ? "E" : "O"}`;
  $("c-pop").textContent = fmtPop(c.pop);
  $("c-price").textContent = fmt(own?.p || c.price) + " ₵";
  $("c-yield").textContent = "+" + fmt(own?.o ? incomeOf(own, c.price) : c.price * YIELD) + " ₵/h";
  renderLevel(c, own);
  $("c-rank").textContent = "#" + fmt(c.rank);
  const box = $("c-owner"), buy = $("buy"), note = $("c-note");
  box.className = "owner"; box.textContent = "";
  buy.hidden = false; $("sell-box").hidden = true;
  const sw = document.createElement("span"); sw.className = "sw";
  const label = document.createElement("span");
  if (own?.o) {
    const mine = own.o === S.uid;
    if (mine) box.classList.add("mine");
    sw.style.background = colorFor(own.o);
    const since = new Date(own.t).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    label.textContent = mine ? `Cette commune vous appartient depuis le ${since}` : `Possédée par ${nameFor(own.o)} depuis le ${since}`;
    buy.disabled = true; buy.textContent = "Déjà vendue";
    if (mine) {
      const refund = Math.floor(investedOf(own, c.price) / 2), confirming = S.sellConfirm === c.gid;
      buy.hidden = true; $("sell-box").hidden = false;
      $("sell").hidden = confirming; $("sell-confirm").hidden = !confirming;
      $("sell").textContent = `Vendre pour ${fmt(refund)} ₵`;
      $("sell-yes").textContent = S.busy ? "Vente en cours…" : "Oui, vendre";
      $("sell-yes").disabled = S.busy;
      note.textContent = confirming
        ? `Vous récupérez la moitié de ce que vous y avez investi, ${fmt(refund)} ₵, et perdez ${fmt(incomeOf(own, c.price))} ₵ de revenu par heure. Elle redeviendra libre pour tous les joueurs.`
        : `Elle vous rapporte ${fmt(incomeOf(own, c.price))} ₵ par heure. En la vendant, vous récupérez la moitié de ce que vous y avez investi.`;
    } else note.textContent = "Chaque commune n'a qu'un propriétaire. Il en reste des centaines de milliers ailleurs.";
  } else {
    sw.style.background = "rgba(220,235,255,.6)";
    label.textContent = "Commune libre, sans propriétaire";
    if (!sb) {
      buy.disabled = true; buy.textContent = "Multijoueur non configuré";
      note.textContent = "Ajoutez les clés de votre projet Supabase dans js/config.js pour acheter des communes.";
    } else if (!S.uid) {
      buy.disabled = false; buy.textContent = "Se connecter pour acheter";
      note.textContent = `Prix : ${fmt(c.price)} ₵. Créez un compte gratuit pour bâtir votre empire.`;
    } else {
      const bal = balance(), short = bal < c.price;
      buy.disabled = S.busy || short;
      buy.textContent = S.busy ? "Achat en cours…" : `Acheter pour ${fmt(c.price)} ₵`;
      note.textContent = short ? `Il vous manque ${fmt(c.price - bal)} ₵. Vos communes génèrent des revenus chaque heure.` : `Rentabilisée en ${Math.round(1 / YIELD)} heures.`;
    }
  }
  box.append(sw, label);
}

/* ---------- Achat ---------- */
$("buy").onclick = async () => {
  const c = S.selected; if (!c || S.owners.get(c.gid)?.o || S.busy) return;
  if (!sb) return toast("Ajoutez vos clés Supabase dans js/config.js pour jouer.", "err");
  if (!S.uid) return openAuth("login");
  if (balance() < c.price) return toast("Trésor insuffisant pour cette commune.", "err");
  S.busy = true; renderCard();
  const { data, error } = await sb.rpc("buy_commune", { p_gid: c.gid });
  S.busy = false;
  if (error) { toast(error.message || "L'achat n'a pas abouti. Réessayez.", "err"); renderCard(); return; }
  S.me = data; S.profiles.set(S.uid, data);
  S.owners.set(c.gid, { o: S.uid, p: c.price, t: Date.now(), lv: 1, inv: c.price });
  toast(`${c.name} rejoint votre empire.`, "ok");
  renderAll();
};

/* ---------- Amélioration ---------- */
function renderLevel(c, own) {
  const box = $("c-level");
  $("c-level-next").textContent = "";
  if (!own?.o) { box.hidden = true; return; }
  box.hidden = false;
  const lv = levelOf(own), mine = own.o === S.uid;
  $("c-level-name").textContent = `Niveau ${lv} · ${LEVELS[lv].name}`;
  $("c-level-mult").textContent = `revenu ×${String(LEVELS[lv].mult).replace(".", ",")}`;
  $("c-pips").querySelectorAll("i").forEach((pip, k) => pip.classList.toggle("on", k < lv));
  const up = $("upgrade");
  up.hidden = !mine;
  if (!mine) return;
  if (lv >= 5) { up.disabled = true; up.textContent = "Niveau maximum atteint"; up.title = ""; return; }
  const next = LEVELS[lv + 1], cost = Math.ceil((own.p || c.price) * next.cost);
  const gain = (own.p || c.price) * YIELD * (next.mult - LEVELS[lv].mult);
  up.disabled = S.busy || balance() < cost;
  up.textContent = S.busy ? "Construction…" : `Améliorer · ${fmt(cost)} ₵`;
  up.title = `Revenu ×${String(next.mult).replace(".", ",")} : +${fmt(gain)} ₵/h`;
  $("c-level-next").textContent = balance() < cost
    ? `Prochain niveau : ${next.name} (+${fmt(gain)} ₵/h). Il vous manque ${fmt(cost - balance())} ₵.`
    : `Prochain niveau : ${next.name}, +${fmt(gain)} ₵ de revenu par heure.`;
}
$("upgrade").onclick = async () => {
  const c = S.selected, own = c && S.owners.get(c.gid);
  if (!own || own.o !== S.uid || S.busy || levelOf(own) >= 5) return;
  S.busy = true; renderCard();
  const { data, error } = await sb.rpc("upgrade_commune", { p_gid: c.gid });
  S.busy = false;
  if (error) { toast(frError(error), "err"); renderCard(); return; }
  const lv = levelOf(own) + 1, cost = Math.ceil(own.p * LEVELS[lv].cost);
  S.me = data; S.profiles.set(S.uid, data);
  S.owners.set(c.gid, { ...own, lv, inv: investedOf(own, c.price) + cost });
  toast(`${c.name} passe au niveau ${lv} : ${LEVELS[lv].name} !`, "ok");
  renderAll();
};

/* ---------- Vente : on récupère la moitié de ce qui a été investi ---------- */
$("sell").onclick = () => { if (S.selected) { S.sellConfirm = S.selected.gid; renderCard(); $("sell-yes").focus(); } };
$("sell-no").onclick = () => { S.sellConfirm = null; renderCard(); $("sell").focus(); };
$("sell-yes").onclick = async () => {
  const c = S.selected; if (!c || S.busy || S.owners.get(c.gid)?.o !== S.uid) return;
  S.busy = true; renderCard();
  const { data, error } = await sb.rpc("sell_commune", { p_gid: c.gid });
  S.busy = false; S.sellConfirm = null;
  if (error) { toast(frError(error), "err"); renderCard(); return; }
  const before = balance();
  S.me = data; S.profiles.set(S.uid, data);
  S.owners.delete(c.gid);
  toast(`${c.name} est vendue : +${fmt(balance() - before)} ₵.`, "ok");
  renderAll();
};

/* ---------- Classement, portefeuille ---------- */
let lbOpen = true;
$("lb-toggle").onclick = () => { lbOpen = !lbOpen; $("lb").hidden = !lbOpen; $("lb-toggle").setAttribute("aria-expanded", lbOpen); };
function renderBoard() {
  const totals = new Map();
  for (const [, o] of S.owners) { const t = totals.get(o.o) || { value: 0, n: 0 }; t.value += investedOf(o, 0); t.n++; totals.set(o.o, t); }
  const rows = [...totals].sort((a, b) => b[1].value - a[1].value).slice(0, 8);
  const ol = $("lb"); ol.textContent = "";
  $("lb-count").textContent = totals.size ? `${totals.size} joueur${totals.size > 1 ? "s" : ""}` : "";
  rows.forEach(([uid, t], i) => {
    const li = document.createElement("li"); if (uid === S.uid) li.className = "me";
    li.innerHTML = '<span class="rk"></span><span class="sw"></span><span class="nm"></span><span class="sc"></span>';
    li.children[0].textContent = i + 1;
    li.children[1].style.background = colorFor(uid);
    li.children[2].textContent = nameFor(uid);
    li.children[3].textContent = `${t.n} · ${fmtShort(t.value)}`;
    ol.append(li);
  });
}
function renderWallet() {
  let n = 0; for (const [, o] of S.owners) if (o.o === S.uid) n++;
  if (!S.uid) { $("bal").textContent = "—"; $("inc").textContent = "—"; $("cnt").textContent = "—"; return; }
  $("bal").textContent = fmt(balance()) + " ₵";
  $("inc").textContent = "+" + fmt(Number(S.me?.rate) || 0) + " ₵/h";
  $("cnt").textContent = fmt(n);
}
function setStatus(kind, text) { const s = $("status"); s.className = "status " + kind; s.lastChild.textContent = text; }
function renderAll() { renderWallet(); renderBoard(); renderCard(); updateMarkers(); drawMine(); }
setInterval(() => { renderWallet(); if (S.selected && !S.owners.get(S.selected.gid)?.o) renderCard(); }, 1000);

/* ---------- Recherche ---------- */
const search = $("search"), results = $("results");
let searchT;
search.addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 160); });
function runSearch() {
  const q = slug(search.value);
  results.textContent = "";
  if (!q || !N.count) { results.hidden = true; return; }
  if (!N.slugs) N.slugs = N.name.map(slug);
  const starts = [], inside = [];
  for (let i = 0; i < N.count && starts.length < 8; i++) {
    const s = N.slugs[i];
    if (s.startsWith(q)) starts.push(i); else if (inside.length < 8 && s.includes(" " + q)) inside.push(i);
  }
  const hits = [...starts, ...inside].slice(0, 8);
  hits.forEach(i => {
    const b = document.createElement("button");
    b.innerHTML = "<span></span><span></span>";
    b.children[0].textContent = N.name[i];
    b.children[1].textContent = countryOf(N.cc[i]) + (N.pop[i] ? " · " + fmtPop(N.pop[i]) : "");
    b.onclick = () => { select(i, true); search.value = ""; results.hidden = true; };
    results.append(b);
  });
  results.hidden = !hits.length;
}
search.addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(searchT); runSearch(); results.querySelector("button")?.click(); } if (e.key === "Escape") { search.value = ""; results.hidden = true; } });

let toastT;
function toast(msg, kind) { const t = $("toast"); t.textContent = msg; t.className = "hud glass " + (kind || ""); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3800); }

/* ---------- Démarrage ---------- */
(async () => {
  renderWallet();
  const earth = setupEarth();
  setStatus("", "Chargement des communes du monde…");
  try {
    await loadCommunes(p => setStatus("", `Chargement des communes du monde… ${Math.round(p * 100)} %`));
  } catch (e) {
    setStatus("", "Les communes n'ont pas pu être chargées. Lancez le site avec un serveur local (voir LISEZ-MOI).");
    return;
  }
  search.placeholder = `Chercher parmi ${fmt(N.count)} communes…`;
  await earth;
  renderAll();
  initMultiplayer();
})();

/* ---------- Multijoueur : chargement et temps réel ---------- */
const rowToOwner = r => ({ o: r.owner, p: Number(r.price), t: Date.parse(r.bought_at), lv: r.level || 1, inv: Number(r.invested ?? r.price) });
async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function initMultiplayer() {
  renderAccount();
  if (!sb) { setStatus("", "Multijoueur non configuré : ajoutez vos clés Supabase dans js/config.js"); return; }
  setStatus("", "Connexion au serveur de jeu…");
  try {
    const [owned, profiles] = await Promise.all([
      fetchAll("owned_communes", "*"),
      fetchAll("profiles", "*"),
    ]);
    S.owners = new Map(owned.map(r => [r.gid, rowToOwner(r)]));
    S.profiles = new Map(profiles.map(p => [p.id, p]));
  } catch (e) {
    console.warn(e);
    setStatus("", "Le serveur de jeu ne répond pas. Vérifiez les clés Supabase et le fichier supabase/schema.sql.");
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  await setUser(session?.user || null);
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(async () => {   // hors du rappel, comme le recommande Supabase
      await setUser(session?.user || null);
      if (event === "PASSWORD_RECOVERY") { openProfile(); $("p-edit").open = true; $("p-new-pass").focus(); showMsg("p-msg", "Choisissez votre nouveau mot de passe.", true); }
    }, 0);
  });
  sb.channel("orbis-urbis")
    .on("postgres_changes", { event: "*", schema: "public", table: "owned_communes" }, ev => {
      if (ev.eventType === "DELETE") S.owners.delete(ev.old.gid);
      else S.owners.set(ev.new.gid, rowToOwner(ev.new));
      renderAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, ev => {
      if (ev.eventType === "DELETE") S.profiles.delete(ev.old.id);
      else { S.profiles.set(ev.new.id, ev.new); if (ev.new.id === S.uid) S.me = ev.new; }
      renderAll(); if (!$("profile").hidden) renderProfile();
    })
    .subscribe();
  setStatus("on", "En ligne · partie partagée entre tous les joueurs");
  renderAll();
}
async function setUser(user) {
  S.uid = user?.id || null;
  S.email = user?.email || "";
  S.me = S.uid ? S.profiles.get(S.uid) || null : null;
  if (S.uid && !S.me) {
    const { data } = await sb.from("profiles").select("*").eq("id", S.uid).maybeSingle();
    if (data) { S.me = data; S.profiles.set(data.id, data); }
  }
  renderAccount(); renderAll();
  if (!S.uid && !$("profile").hidden) closeModal("profile");
  maybeOfferPack();
  maybeWelcomeBack();
  heartbeat();
}

/* ---------- Bouton de compte ---------- */
function paintAvatar(el, id, pseudo) {
  el.textContent = (pseudo || "?").trim().charAt(0).toUpperCase() || "?";
  el.style.background = id ? `hsl(${hueOf(id)}, 65%, 66%)` : "";
}
function renderAccount() {
  if (S.uid) { paintAvatar($("acc-avatar"), S.uid, S.me?.pseudo); $("acc-name").textContent = S.me?.pseudo || "Mon profil"; }
  else { paintAvatar($("acc-avatar"), null, "?"); $("acc-name").textContent = sb ? "Se connecter" : "Comptes non configurés"; }
}
$("account-btn").onclick = () => {
  if (!sb) return toast("Ajoutez vos clés Supabase dans js/config.js pour activer les comptes.", "err");
  S.uid ? openProfile() : openAuth("login");
};

/* ---------- Fenêtres ---------- */
let lastFocus = null;
function openModal(id) { lastFocus = document.activeElement; $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; if (lastFocus?.focus) lastFocus.focus(); }
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m.id); });
});
addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal:not([hidden])").forEach(m => closeModal(m.id)); });
function showMsg(id, text, ok) { const el = $(id); el.textContent = text || ""; el.classList.toggle("ok", !!ok); }

// Traduit les messages d'erreur courants de Supabase
function frError(e) {
  const m = (e?.message || String(e || "")).toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou mot de passe incorrect.";
  if (m.includes("email not confirmed")) return "Confirmez d'abord votre adresse e-mail grâce au lien reçu par e-mail.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Un compte existe déjà avec cet e-mail.";
  if (m.includes("password") && (m.includes("at least") || m.includes("short") || m.includes("weak"))) return "Mot de passe trop faible : 6 caractères minimum.";
  if (m.includes("rate limit") || m.includes("too many")) return "Trop de tentatives. Réessayez dans quelques minutes.";
  if (m.includes("invalid") && m.includes("email")) return "Cette adresse e-mail n'est pas valide.";
  if (m.includes("duplicate") || m.includes("unique") || m.includes("23505")) return "Ce pseudo est déjà pris.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Impossible de joindre le serveur. Vérifiez votre connexion.";
  return e?.message || "Une erreur est survenue. Réessayez.";
}

/* ---------- Connexion et inscription ---------- */
let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("tab-login").classList.toggle("on", !signup); $("tab-login").setAttribute("aria-selected", !signup);
  $("tab-signup").classList.toggle("on", signup); $("tab-signup").setAttribute("aria-selected", signup);
  $("f-pseudo-wrap").hidden = !signup;
  $("f-pass").autocomplete = signup ? "new-password" : "current-password";
  $("auth-submit").textContent = signup ? "Créer mon compte" : "Se connecter";
  $("forgot").hidden = signup;
  showMsg("auth-msg", "");
}
function openAuth(mode) {
  setAuthMode(mode); openModal("auth");
  (mode === "signup" ? $("f-pseudo") : $("f-email")).focus();
}
$("tab-login").onclick = () => setAuthMode("login");
$("tab-signup").onclick = () => setAuthMode("signup");
const PSEUDO_RE = /^[\p{L}\p{N}_\- ]{3,20}$/u;
async function pseudoTaken(pseudo, exceptId) {
  const { data } = await sb.from("profiles").select("id").ilike("pseudo", pseudo.replace(/[\\%_]/g, "\\$&"));
  return (data || []).some(r => r.id !== exceptId);
}
$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("f-email").value.trim(), password = $("f-pass").value, pseudo = $("f-pseudo").value.trim();
  if (!email) return showMsg("auth-msg", "Indiquez votre adresse e-mail.");
  if (password.length < 6) return showMsg("auth-msg", "Le mot de passe doit faire au moins 6 caractères.");
  const btn = $("auth-submit"); btn.disabled = true; showMsg("auth-msg", "");
  try {
    if (authMode === "signup") {
      if (!PSEUDO_RE.test(pseudo)) throw new Error("Le pseudo doit faire de 3 à 20 caractères : lettres, chiffres, espaces, - ou _.");
      if (await pseudoTaken(pseudo)) throw new Error("Ce pseudo est déjà pris.");
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { pseudo }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) { setAuthMode("login"); showMsg("auth-msg", `Compte créé. Ouvrez le lien envoyé à ${email} pour l'activer, puis connectez-vous.`, true); return; }
      toast(`Bienvenue, ${pseudo} !`, "ok");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast("Vous êtes connecté.", "ok");
    }
    $("f-pass").value = "";
    closeModal("auth");
  } catch (err) {
    showMsg("auth-msg", frError(err));
  } finally { btn.disabled = false; }
});
$("forgot").onclick = async () => {
  const email = $("f-email").value.trim();
  if (!email) return showMsg("auth-msg", "Indiquez d'abord votre adresse e-mail.");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  showMsg("auth-msg", error ? frError(error) : `Un lien pour choisir un nouveau mot de passe a été envoyé à ${email}.`, !error);
};

/* ---------- Profil ---------- */
function myStats() {
  const mine = [];
  const totals = new Map();
  for (const [gid, o] of S.owners) {
    totals.set(o.o, (totals.get(o.o) || 0) + investedOf(o, 0));
    if (o.o === S.uid) { const i = N.byGid.get(gid); if (i !== undefined) mine.push({ i, p: investedOf(o, 0), lv: levelOf(o) }); }
  }
  const value = totals.get(S.uid) || 0;
  const rank = value ? [...totals.values()].filter(v => v > value).length + 1 : null;
  mine.sort((a, b) => b.p - a.p);
  return { mine, value, rank, players: totals.size };
}
function renderProfile() {
  if (!S.uid) return;
  const me = S.me || {}, st = myStats();
  paintAvatar($("p-avatar"), S.uid, me.pseudo);
  $("p-pseudo").textContent = me.pseudo || "Mon profil";
  const since = me.created_at ? new Date(me.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  $("p-sub").textContent = [S.email, since && `Membre depuis le ${since}`].filter(Boolean).join(" · ");
  $("p-bal").textContent = fmt(balance()) + " ₵";
  $("p-inc").textContent = "+" + fmt(Number(me.rate) || 0) + " ₵/h";
  $("p-cnt").textContent = fmt(st.mine.length);
  $("p-val").textContent = fmtShort(st.value);
  $("p-rank").textContent = st.rank ? `${st.rank}ᵉ sur ${st.players}` : "Pas encore classé";
  const list = $("p-list"); list.textContent = "";
  if (!st.mine.length) {
    const li = document.createElement("li"); li.className = "empty";
    li.textContent = "Vous n'avez encore aucune commune. Zoomez sur une ville et cliquez sur une commune libre pour l'acheter.";
    list.append(li);
  }
  for (const { i, p, lv } of st.mine.slice(0, 200)) {
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="sw"></span><span></span><span class="pr"></span>';
    b.children[1].textContent = `${N.name[i]} · ${countryOf(N.cc[i])}`;
    b.children[2].textContent = `Niv. ${lv} · ${fmtShort(p)}`;
    b.onclick = () => { closeModal("profile"); select(i, true); };
    li.append(b); list.append(li);
  }
}
function openProfile() {
  $("p-pack").hidden = !(S.me && S.me.pack_opened === false);
  $("p-new-pseudo").value = S.me?.pseudo || "";
  $("p-new-pass").value = "";
  $("del-confirm").hidden = true; $("del-pseudo").value = "";
  showMsg("p-msg", "");
  renderProfile(); openModal("profile");
}
$("rename-form").addEventListener("submit", async e => {
  e.preventDefault();
  const pseudo = $("p-new-pseudo").value.trim();
  if (!PSEUDO_RE.test(pseudo)) return showMsg("p-msg", "Le pseudo doit faire de 3 à 20 caractères : lettres, chiffres, espaces, - ou _.");
  if (pseudo === S.me?.pseudo) return showMsg("p-msg", "C'est déjà votre pseudo.");
  if (await pseudoTaken(pseudo, S.uid)) return showMsg("p-msg", "Ce pseudo est déjà pris.");
  const { data, error } = await sb.from("profiles").update({ pseudo }).eq("id", S.uid).select().single();
  if (error) return showMsg("p-msg", frError(error));
  S.me = data; S.profiles.set(S.uid, data);
  showMsg("p-msg", "Pseudo enregistré.", true);
  renderAccount(); renderProfile(); renderBoard();
});
$("pass-form").addEventListener("submit", async e => {
  e.preventDefault();
  const password = $("p-new-pass").value;
  if (password.length < 6) return showMsg("p-msg", "Le mot de passe doit faire au moins 6 caractères.");
  const { error } = await sb.auth.updateUser({ password });
  if (error) return showMsg("p-msg", frError(error));
  $("p-new-pass").value = "";
  showMsg("p-msg", "Mot de passe changé.", true);
});
$("logout").onclick = async () => { await sb.auth.signOut(); closeModal("profile"); toast("Vous êtes déconnecté.", "ok"); };
$("del-start").onclick = () => { $("del-confirm").hidden = false; $("del-pseudo").focus(); };
$("del-go").onclick = async () => {
  if ($("del-pseudo").value.trim() !== (S.me?.pseudo || "")) return showMsg("p-msg", "Le pseudo tapé ne correspond pas : le compte n'a pas été supprimé.");
  const { error } = await sb.rpc("delete_my_account");
  if (error) return showMsg("p-msg", frError(error));
  await sb.auth.signOut();
  closeModal("profile");
  toast("Votre compte a été supprimé.", "ok");
};

/* ---------- Pack de bienvenue : une commune libre tirée au sort par le serveur ---------- */
const TIERS = {
  capitale:  { label: "Capitale",     odds: "0,0001 %", color: "#f2c14e" },
  metropole: { label: "Métropole",    odds: "0,01 %",   color: "#ff9f43" },
  grande:    { label: "Grande ville", odds: "0,5 %",    color: "#c38bff" },
  ville:     { label: "Ville",        odds: "4,49 %",   color: "#5ea8ff" },
  petite:    { label: "Petite ville", odds: "20 %",     color: "#6fd3c1" },
  village:   { label: "Village",      odds: "75 %",     color: "#b9cde2" },
};
(function fillOdds() {
  const ul = $("pack-odds");
  for (const [key, t] of Object.entries(TIERS)) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="sw"></span><span></span><span class="pr"></span>';
    li.children[0].style.background = t.color;
    li.children[1].textContent = t.label;
    li.children[2].textContent = t.odds;
    li.dataset.tier = key;
    ul.append(li);
  }
})();
let packOffered = false, packResult = null;
function maybeOfferPack() {
  if (packOffered || !S.me || S.me.pack_opened !== false) return;
  packOffered = true;
  openPack();
}
function openPack() {
  packResult = null;
  $("pack-card").className = "pack-card";
  $("pack-open").hidden = false; $("pack-open").disabled = false;
  $("pack-go").hidden = true;
  $("pack-odds").querySelectorAll("li").forEach(li => li.classList.remove("hit"));
  showMsg("pack-msg", "");
  openModal("pack");
  $("pack-open").focus();
}
$("p-pack").onclick = () => { closeModal("profile"); openPack(); };
$("pack-open").onclick = async () => {
  const btn = $("pack-open"); btn.disabled = true; showMsg("pack-msg", "");
  const card = $("pack-card");
  card.classList.add("shaking");
  const wait = new Promise(r => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : 1800));
  const [{ data, error }] = await Promise.all([sb.rpc("open_welcome_pack"), wait]);
  card.classList.remove("shaking");
  if (error) { btn.disabled = false; showMsg("pack-msg", frError(error)); return; }
  const row = Array.isArray(data) ? data[0] : data;
  const i = N.byGid.get(row.gid);
  const t = TIERS[row.tier] || TIERS.village;
  packResult = { i, row };
  $("pack-tier").textContent = t.label;
  $("pack-name").textContent = i !== undefined ? N.name[i] : "Commune n°" + row.gid;
  $("pack-country").textContent = i !== undefined ? countryOf(N.cc[i]) : "";
  $("pack-meta").textContent = `${i !== undefined ? fmtPop(N.pop[i]) + " habitants · " : ""}valeur ${fmtShort(Number(row.price))} · +${fmt(Number(row.price) * YIELD)} ₵/h`;
  card.style.setProperty("--tier", t.color);
  card.classList.add("revealed", "tier-" + row.tier);
  $("pack-odds").querySelector(`[data-tier="${row.tier}"]`)?.classList.add("hit");
  btn.hidden = true; $("pack-go").hidden = false; $("pack-go").focus();
  // Mise à jour immédiate (le temps réel confirmera)
  S.owners.set(row.gid, { o: S.uid, p: Number(row.price), t: Date.now(), lv: 1, inv: Number(row.price) });
  const { data: me } = await sb.from("profiles").select("*").eq("id", S.uid).maybeSingle();
  if (me) { S.me = me; S.profiles.set(me.id, me); }
  renderAll();
};
$("pack-go").onclick = () => {
  closeModal("pack");
  if (packResult?.i !== undefined) select(packResult.i, true);
};

/* ---------- « Pendant ton absence » : résumé au retour du joueur ---------- */
// La dernière visite est retenue par ce navigateur, pour chaque compte.
const AWAY_MIN_MS = 10 * 60 * 1000;          // pas de résumé pour une absence de moins de 10 minutes
const seenKey = uid => "orbis-urbis-vu:" + uid;
let welcomeShown = false, wbAction = null;
function readSeen(uid) { try { return Number(localStorage.getItem(seenKey(uid))) || 0; } catch (e) { return 0; } }
function markSeen() { if (S.uid) try { localStorage.setItem(seenKey(S.uid), String(Date.now())); } catch (e) {} }
setInterval(() => { if (!document.hidden) markSeen(); }, 60000);
addEventListener("pagehide", markSeen);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { markSeen(); welcomeShown = false; } else maybeWelcomeBack();
});
function fmtDuration(ms) {
  const min = Math.round(ms / 60000), d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} j${h ? " " + h + " h" : ""}`;
  if (h) return `${h} h${m ? " " + String(m).padStart(2, "0") : ""}`;
  return `${m} min`;
}
// L'amélioration la moins chère parmi mes communes
function cheapestUpgrade() {
  let best = null;
  for (const [gid, o] of S.owners) {
    if (o.o !== S.uid) continue;
    const lv = levelOf(o), i = N.byGid.get(gid);
    if (lv >= 5 || i === undefined) continue;
    const cost = Math.ceil(o.p * LEVELS[lv + 1].cost);
    if (!best || cost < best.cost) best = { i, cost, next: LEVELS[lv + 1].name };
  }
  return best;
}
function maybeWelcomeBack() {
  if (!S.uid || !S.me || welcomeShown || S.me.pack_opened === false || !N.count) return;
  const last = readSeen(S.uid), away = Date.now() - last;
  markSeen();
  if (!last || away < AWAY_MIN_MS) return;
  const rate = Number(S.me.rate) || 0, earned = rate * away / 3.6e6;
  if (earned < 1) return;
  welcomeShown = true;
  const pseudo = S.me.pseudo ? `, ${S.me.pseudo}` : "";
  $("wb-title").textContent = `Bon retour${pseudo}\u00a0!`;
  $("wb-away").textContent = `Pendant ton absence (${fmtDuration(away)}), tes communes t'ont rapporté`;
  $("wb-bal").textContent = fmt(balance()) + " ₵";
  $("wb-inc").textContent = "+" + fmt(rate) + " ₵/h";
  const up = cheapestUpgrade(), bal = balance();
  if (up && bal >= up.cost) {
    $("wb-next").textContent = `Tu peux maintenant construire : ${up.next} à ${N.name[up.i]} (${fmt(up.cost)} ₵).`;
    $("wb-go").textContent = `Aller à ${N.name[up.i]}`; wbAction = () => select(up.i, true);
  } else if (up) {
    $("wb-next").textContent = `Encore ${fmt(up.cost - bal)} ₵, environ ${fmtDuration((up.cost - bal) / rate * 3.6e6)}, pour construire : ${up.next} à ${N.name[up.i]}.`;
    $("wb-go").textContent = `Voir ${N.name[up.i]}`; wbAction = () => select(up.i, true);
  } else {
    $("wb-next").textContent = "Toutes tes communes sont au niveau maximum. De quoi en acheter une nouvelle ?";
    $("wb-go").textContent = "Continuer"; wbAction = null;
  }
  openModal("welcome");
  // Le montant défile jusqu'au total gagné
  const el = $("wb-amount"), t0 = performance.now(), dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200;
  const tick = now => {
    const k = dur ? Math.min(1, (now - t0) / dur) : 1;
    el.textContent = "+" + fmt(earned * (1 - Math.pow(1 - k, 3))) + " ₵";
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  $("wb-go").focus();
}
$("wb-go").onclick = () => { closeModal("welcome"); if (wbAction) wbAction(); };

/* ---------- Défis du jour : jouer 10 min, 30 min, 1 h d'affilée ---------- */
// Le serveur mesure la série (supabase/05_defis.sql) : le jeu lui envoie un signal par minute
// tant que le joueur est actif. Identique aux montants du fichier SQL.
// Un seul défi de temps, qui monte d'étape chaque jour (5 min → 10 min → 30 min → 1 h)
const CHALLENGES = [
  { tier: 1, bit: 1, min: 5, reward: 100 },
  { tier: 2, bit: 2, min: 10, reward: 300 },
  { tier: 3, bit: 4, min: 30, reward: 1000 },
  { tier: 4, bit: 8, min: 60, reward: 3000 },
];
// Défi de collection, une seule fois par compte (supabase/06_defis_progressifs.sql)
const OWN_CHALLENGES = [
  { tier: 1, bit: 1, target: 1, reward: 500 },
  { tier: 2, bit: 2, target: 2, reward: 1000 },
  { tier: 3, bit: 4, target: 5, reward: 3000 },
  { tier: 4, bit: 8, target: 10, reward: 10000 },
];
const IDLE_MS = 170000;   // un peu moins de 3 minutes, la limite du serveur
const CLAIM_MARGIN_MIN = 0.25;   // 15 s de marge : l'horloge du serveur peut avoir quelques secondes de retard
const PLAY = { startLocal: null, claimed: 0, lastActivity: Date.now(), available: false, busy: false };
["pointerdown", "pointermove", "wheel", "keydown", "touchstart"].forEach(ev =>
  addEventListener(ev, () => { PLAY.lastActivity = Date.now(); }, { passive: true, capture: true }));
const idle = () => document.hidden || Date.now() - PLAY.lastActivity > IDLE_MS;
async function heartbeat() {
  if (!sb || !S.uid) { PLAY.available = false; renderQuests(); return; }
  if (idle()) { renderQuests(); return; }
  const { data, error } = await sb.rpc("play_heartbeat");
  if (error) { PLAY.available = false; renderQuests(); return; }   // fichier 05_defis.sql pas encore installé
  const row = Array.isArray(data) ? data[0] : data;
  PLAY.available = true;
  PLAY.startLocal = Date.now() - row.session_seconds * 1000;
  PLAY.claimed = row.claimed || 0;
  renderQuests();
}
setInterval(heartbeat, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { PLAY.lastActivity = Date.now(); heartbeat(); } });
setInterval(() => renderQuests(), 1000);

let questsOpen = (() => { try { const v = localStorage.getItem("orbis-urbis-defis-ouverts"); return v === null ? innerWidth > 720 : v === "1"; } catch (e) { return true; } })();
$("q-toggle").onclick = () => {
  questsOpen = !questsOpen;
  try { localStorage.setItem("orbis-urbis-defis-ouverts", questsOpen ? "1" : "0"); } catch (e) {}
  renderQuests();
};
function myCommuneCount() { let n = 0; for (const [, o] of S.owners) if (o.o === S.uid) n++; return n; }
function questRow(li, { label, reward, pct, ready, doneText }) {
  li.querySelector(".q-label").textContent = label;
  li.querySelector(".q-reward").textContent = doneText || `+${fmt(reward)} ₵`;
  li.className = doneText ? "claimed" : ready ? "ready" : "";
  li.querySelector(".q-bar i").style.width = Math.min(100, pct) + "%";
  const btn = li.querySelector(".q-claim");
  btn.hidden = !ready; btn.disabled = PLAY.busy;
}
function renderQuests() {
  const box = $("quests");
  box.hidden = !(S.uid && PLAY.available);
  if (box.hidden) return;
  $("q-body").hidden = !questsOpen;
  $("q-toggle").setAttribute("aria-expanded", questsOpen);
  const elapsed = PLAY.startLocal ? (Date.now() - PLAY.startLocal) / 60000 : 0;
  const paused = idle();
  $("q-session").textContent = paused ? "en pause" : `${Math.floor(elapsed)} min de jeu`;
  if (!questsOpen) return;
  const ul = $("q-list");
  if (ul.children.length !== 2) {
    ul.textContent = "";
    ["time", "own"].forEach(kind => {
      const li = document.createElement("li");
      li.innerHTML = '<div class="q-row"><span class="q-label"></span><span class="q-reward"></span></div><div class="q-bar"><i></i></div><button class="q-claim" type="button" hidden>Réclamer</button>';
      li.querySelector(".q-claim").onclick = () => kind === "time" ? claimTime(false) : claimOwned();
      ul.append(li);
    });
  }
  // Défi de temps : la première étape pas encore réclamée aujourd'hui
  const t = CHALLENGES.find(c => !(PLAY.claimed & c.bit));
  if (t) questRow(ul.children[0], {
    label: t.min < 60 ? `Jouer ${t.min} min d'affilée` : "Jouer 1 h d'affilée",
    reward: t.reward, pct: elapsed / t.min * 100, ready: elapsed >= t.min + CLAIM_MARGIN_MIN && !paused,
  });
  else questRow(ul.children[0], { label: "Jouer 1 h d'affilée", pct: 100, doneText: "Fait ✓ · demain" });
  // Défi de collection : la première étape pas encore réclamée
  const claimedOwn = Number(S.me?.owned_claimed) || 0, count = myCommuneCount();
  const o = OWN_CHALLENGES.find(c => !(claimedOwn & c.bit));
  if (o) questRow(ul.children[1], {
    label: `Posséder ${o.target} commune${o.target > 1 ? "s" : ""} (${Math.min(count, o.target)}/${o.target})`,
    reward: o.reward, pct: count / o.target * 100, ready: count >= o.target,
  });
  else questRow(ul.children[1], { label: "Posséder 10 communes", pct: 100, doneText: "Terminé ✓" });
}
async function claimTime(retry) {
  const c = CHALLENGES.find(x => !(PLAY.claimed & x.bit));
  if (!c || PLAY.busy) return;
  PLAY.busy = true; renderQuests();
  const { data, error } = await sb.rpc("play_claim", { p_tier: c.tier });
  PLAY.busy = false;
  if (error && /patience/i.test(error.message || "") && !retry) {
    // Le serveur n'a pas encore compté tout le temps : on se recale et on réessaie une fois
    toast("Encore quelques secondes…", "ok");
    await heartbeat();
    setTimeout(() => claimTime(true), 20000);
    return;
  }
  if (error) { toast(frError(error), "err"); heartbeat(); return; }
  S.me = data; S.profiles.set(S.uid, data);
  PLAY.claimed |= c.bit;
  const next = CHALLENGES.find(x => !(PLAY.claimed & x.bit));
  toast(`Défi réussi : +${fmt(c.reward)} ₵ !${next ? ` Prochaine étape : ${next.min < 60 ? next.min + " min" : "1 h"}.` : ""}`, "ok");
  renderAll(); renderQuests();
}
async function claimOwned() {
  const claimedOwn = Number(S.me?.owned_claimed) || 0;
  const c = OWN_CHALLENGES.find(x => !(claimedOwn & x.bit));
  if (!c || PLAY.busy) return;
  PLAY.busy = true; renderQuests();
  const { data, error } = await sb.rpc("claim_owned", { p_tier: c.tier });
  PLAY.busy = false;
  if (error) { toast(frError(error), "err"); renderQuests(); return; }
  S.me = data; S.profiles.set(S.uid, data);
  toast(`Défi réussi : +${fmt(c.reward)} ₵ !`, "ok");
  renderAll(); renderQuests();
}

window.orbis = { viewer, N, S, drawMine, select, renderCard, maybeWelcomeBack, PLAY, renderQuests };   // pour le débogage dans la console
