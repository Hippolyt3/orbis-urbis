// Réglages d'Orbis Urbis.
// Pour avoir la vraie Terre en 3D de Google Earth (bâtiments, relief), remplissez UNE des deux clés.
// Le fichier LISEZ-MOI.md explique comment les obtenir.
// Sans clé, le globe affiche l'imagerie satellite Esri (photo vue du dessus, sans bâtiments en 3D).
window.ORBIS_CONFIG = {
  // Clé Google Maps Platform avec l'API « Map Tiles » activée.
  googleMapsApiKey: "",

  // OU un jeton Cesium ion gratuit (donne aussi accès aux tuiles 3D de Google).
  cesiumIonToken: "",

  // Multijoueur, comptes et profils : votre projet Supabase (Settings > API).
  // L'adresse ressemble à https://abcdefgh.supabase.co ; la clé est la clé publique « anon » (ou « publishable »).
  // Ne mettez JAMAIS ici la clé « service_role » ou « secret ».
  supabaseUrl: "https://tbonzwmpsmmvomdiaqwk.supabase.co",
  supabaseAnonKey: "sb_publishable_fstKRQsnSL6kooaW8kbOyw_u6HBbWtx",
};
