"""Fabrique data/communes.txt (pour le jeu) et supabase/communes.csv (pour le serveur)
à partir de cities500.txt (GeoNames, https://download.geonames.org/export/dump/cities500.zip).

On garde les lieux habités, sans les quartiers (PPLX) ni les arrondissements.
En France, un seul lieu par code commune INSEE (colonne admin4) : la commune elle-même,
ce qui retire les quartiers comme « Salpêtrière » ou « Maison Blanche » à Paris.

Chaque commune reçoit son prix et sa catégorie pour le pack de bienvenue :
capitale, metropole (1 M hab. et plus), grande (100 000 à 1 M), ville (20 000 à 100 000),
petite (5 000 à 20 000), village (moins de 5 000).

Usage : python3 tools/build_communes.py cities500.txt data/communes.txt supabase/communes.csv"""
import csv, re, sys

src, out = sys.argv[1], sys.argv[2]
csv_out = sys.argv[3] if len(sys.argv) > 3 else None

BASE_PRICE, PER_HAB = 1000, 0.5   # doit rester identique à js/game.js
ARR = re.compile(r"^(Paris|Lyon|Marseille) \d{1,2}\b")
RANK = {"PPLC": 0, "PPLA": 1, "PPLA2": 2, "PPLA3": 3, "PPLA4": 4}


def tier(pop, code):
    if code == "PPLC":
        return "capitale"
    if pop >= 1_000_000:
        return "metropole"
    if pop >= 100_000:
        return "grande"
    if pop >= 20_000:
        return "ville"
    if pop >= 5_000:
        return "petite"
    return "village"


rows, dropped, by_commune = [], 0, {}
for line in open(src, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) < 15:
        continue
    name, code, cc, insee = f[1].replace("\t", " "), f[7], f[8], f[13]
    if code == "PPLX" or (cc == "FR" and ARR.match(name)):
        dropped += 1
        continue
    try:
        pop = int(f[14] or 0)
    except ValueError:
        pop = 0
    row = (pop, f[0], name, cc, round(float(f[4]), 3), round(float(f[5]), 3), code)
    if cc == "FR" and insee:
        key = (RANK.get(code, 9), -pop)
        best = by_commune.get(insee)
        if best is None or key < best[0]:
            if best is not None:
                dropped += 1
            by_commune[insee] = (key, row)
        else:
            dropped += 1
        continue
    rows.append(row)
rows += [r for _, r in by_commune.values()]
rows.sort(key=lambda r: -r[0])

with open(out, "w", encoding="utf-8") as o:
    for pop, gid, name, cc, lat, lng, code in rows:
        o.write(f"{gid}\t{name}\t{cc}\t{lat:g}\t{lng:g}\t{pop}\n")

counts = {}
if csv_out:
    with open(csv_out, "w", encoding="utf-8", newline="") as o:
        w = csv.writer(o)
        w.writerow(["gid", "name", "cc", "pop", "price", "tier"])
        for pop, gid, name, cc, lat, lng, code in rows:
            t = tier(pop, code)
            counts[t] = counts.get(t, 0) + 1
            w.writerow([gid, name, cc, pop, round(BASE_PRICE + pop * PER_HAB), t])

print(len(rows), "communes gardées,", dropped, "quartiers, arrondissements et doublons retirés")
if counts:
    print("catégories :", counts)
