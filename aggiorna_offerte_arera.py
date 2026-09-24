from __future__ import annotations

import csv
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path
from urllib.error import URLError

BASE = "https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv/offerteML"
STORICI = "https://www.ilportaleofferte.it/portaleOfferte/resources/cms/documents/5d6f1085b4d5f20821af55764e647671.csv"
NS = {"n": "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"}
UM_ENERGIA = {"E": "03", "G": "04"}
FASCIA_MAP = {"01": ("f1",), "02": ("f2",), "03": ("f3",), "91": ("f2", "f3"), "07": ("f1",), "08": ("f2", "f3")}
TIMEOUT = 120


def scarica(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "confronta-bollette/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r, dest.open("wb") as f:
            f.write(r.read())
        return True
    except (URLError, OSError) as e:
        print(f"[!] download fallito {url}: {e}", file=sys.stderr)
        return False


def trova_file(commodity: str, tmp: Path) -> tuple[Path, str] | None:
    for i in range(12):
        d = date.today() - timedelta(days=i)
        url = f"{BASE}/{d.year}_{d.month}/PO_Offerte_{commodity}_MLIBERO_{d:%Y%m%d}.xml"
        dest = tmp / f"po_{commodity}_{d:%Y%m%d}.xml"
        if scarica(url, dest) and dest.stat().st_size > 1000:
            return dest, d.isoformat()
    return None


VERDE_RE = re.compile(r"green|rinnovab|fotovoltaico|100\s*%\s*rinnovab|energia\s+verde", re.IGNORECASE)
DEPOSITO_RE = re.compile(r"deposito\s+cauzional|fideiussion|garanzia\s+(?:bancaria|dei\s+pagamenti)", re.IGNORECASE)
NEGAZIONE_RE = re.compile(r"nessun|non\s+(?:prevede|richiede|richiest|è\s+richiest|e\s+richiest)|senza|non\s+dovut|esclus[oa]|azzerat|pari\s+a\s+(?:zero|0)", re.IGNORECASE)


def senza_deposito(testo: str | None) -> bool:
    if not testo or not testo.strip() or testo.strip() in ("-", ""):
        return True
    t = testo.strip()
    if not DEPOSITO_RE.search(t):
        return True
    return bool(NEGAZIONE_RE.search(t))


def dominio(url: str | None) -> str:
    if not url:
        return "sconosciuto"
    u = url.strip().lower().removeprefix("http://").removeprefix("https://").removeprefix("www.")
    return u.split("/")[0] or "sconosciuto"


def parse_data(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date(int(s[6:10]), int(s[3:5]), int(s[0:2]))
    except (ValueError, IndexError):
        return None


def componenti(offerta: ET.Element, um: str) -> dict[str, float]:
    tot: dict[str, float] = {}
    parti: dict[str, float] = {}
    ha_totale = False
    for comp in offerta.findall("n:ComponenteImpresa", NS):
        nome = (comp.findtext("n:NOME", namespaces=NS) or "").lower()
        for ip in comp.findall("n:IntervalloPrezzi", NS):
            if ip.findtext("n:UNITA_MISURA", namespaces=NS) != um:
                continue
            try:
                prezzo = float(ip.findtext("n:PREZZO", namespaces=NS))
            except (TypeError, ValueError):
                continue
            fascia = ip.findtext("n:FASCIA_COMPONENTE", namespaces=NS) or "01"
            if "totale" in nome:
                ha_totale = True
                tot[fascia] = prezzo
            else:
                parti[fascia] = parti.get(fascia, 0.0) + prezzo
    return tot if ha_totale else parti


def parse_xml(path: Path, commodity: str) -> tuple[list[dict], int]:
    root = ET.parse(path).getroot()
    offerte: list[dict] = []
    scadute = 0
    oggi = date.today()
    for o in root.findall("n:offerta", NS):
        det = o.find("n:DettaglioOfferta", NS)
        if det is None or det.findtext("n:TIPO_CLIENTE", namespaces=NS) != "01":
            continue
        fine = parse_data(o.findtext("n:ValiditaOfferta/n:DATA_FINE", namespaces=NS))
        if fine and fine < oggi:
            scadute += 1
            continue
        energia = componenti(o, UM_ENERGIA[commodity])
        quota = componenti(o, "01")
        if not energia:
            continue
        sito = det.findtext("n:Contatti/n:URL_SITO_VENDITORE", namespaces=NS)
        tipo = "fisso" if det.findtext("n:TIPO_OFFERTA", namespaces=NS) == "01" else "indicizzato"
        nome = (det.findtext("n:NOME_OFFERTA", namespaces=NS) or "").strip()
        rec: dict = {
            "venditore": dominio(sito),
            "nome": nome,
            "cod_offerta": o.findtext("n:IdentificativiOfferta/n:COD_OFFERTA", namespaces=NS),
            "tipo_prezzo": tipo,
            "quota_fissa_annua": round(sum(quota.values()), 2),
            "url": det.findtext("n:Contatti/n:URL_OFFERTA", namespaces=NS) or (f"https://{sito}" if sito else ""),
            "scadenza": fine.isoformat() if fine else "",
            "senza_deposito": senza_deposito(det.findtext("n:GARANZIE", namespaces=NS)),
            "verde_nome": bool(VERDE_RE.search(nome)),
        }
        mappati: dict[str, float] = {}
        for codice, prezzo in energia.items():
            for chiave in FASCIA_MAP.get(codice, ()):
                mappati.setdefault(chiave, prezzo)
        if not mappati:
            continue
        if commodity == "E" and ("f2" in mappati or "f3" in mappati):
            rec["fascia"] = "fasce"
            rec["f1"] = round(mappati.get("f1", mappati.get("f2", 0.0)), 6)
            rec["f2"] = round(mappati.get("f2", rec["f1"]), 6)
            rec["f3"] = round(mappati.get("f3", rec["f2"]), 6)
            rec["prezzo_kwh"] = round((rec["f1"] + rec["f2"] + rec["f3"]) / 3, 6)
        else:
            rec["fascia"] = "mono"
            rec["prezzo_kwh" if commodity == "E" else "prezzo_smc"] = round(next(iter(mappati.values()), 0.0), 6)
        offerte.append(rec)
    return offerte, scadute


def scarica_testo(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "confronta-bollette/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("cp1252", errors="replace")
    except (URLError, OSError) as e:
        print(f"[!] download fallito {url}: {e}", file=sys.stderr)
        return None


def ultimi_indici() -> tuple[float, float]:
    try:
        testo = scarica_testo(STORICI)
        if not testo:
            raise ValueError("storici non scaricati")
        righe = testo.splitlines()
        ultima = [x for x in csv.reader(righe[1:], delimiter=";") if len(x) >= 3][-1]
        return float(ultima[1].replace(",", ".")), float(ultima[2].replace(",", "."))
    except (URLError, OSError, KeyError, ValueError, IndexError) as e:
        print(f"[!] indici storici non letti ({e}), uso default 0.18/0.6876", file=sys.stderr)
        return 0.18, 0.6876


def scarica_parametri(commodity: str) -> dict[str, float]:
    for i in range(12):
        d = date.today() - timedelta(days=i)
        url = f"{BASE.replace('/offerteML', '/parametriML')}/{d.year}_{d.month}/PO_Parametri_Mercato_Libero_{commodity}_{d:%Y%m%d}.csv"
        testo = scarica_testo(url)
        if not testo or "nome_parametro" not in testo.splitlines()[0]:
            continue
        out: dict[str, float] = {}
        for r in csv.reader(testo.splitlines()[1:], delimiter=","):
            if len(r) >= 2:
                try:
                    out[r[0].strip()] = float(r[1].replace(",", "."))
                except ValueError:
                    continue
        if out:
            return out
    print(f"[!] parametri {commodity} non trovati", file=sys.stderr)
    return {}


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Scarica open data ARERA e genera offerte_arera.json")
    ap.add_argument("--inline", default="", help="Genera anche file JS con dati incorporati (es. arera_data.js)")
    args = ap.parse_args()
    base = Path(__file__).resolve().parent
    tmp = base / ".tmp_arera"
    tmp.mkdir(exist_ok=True)
    pun, psv = ultimi_indici()
    out: dict = {"generato": date.today().isoformat(), "pun_rif": pun, "psv_rif": psv, "fonte": "Portale Offerte ARERA open data (CC-BY)",
                 "parametri": {"E": scarica_parametri("E"), "G": scarica_parametri("G")}}
    for commodity, chiave in (("E", "luce"), ("G", "gas")):
        trovato = trova_file(commodity, tmp)
        if not trovato:
            print(f"[!] nessun file {commodity} degli ultimi 12 giorni", file=sys.stderr)
            return 1
        path, data_rif = trovato
        offerte, scadute = parse_xml(path, commodity)
        for o in offerte:
            if o["tipo_prezzo"] == "indicizzato":
                if chiave == "luce":
                    o["spread_kwh"] = o["prezzo_kwh"]
                    o["prezzo_kwh"] = round(pun + o["spread_kwh"], 6)
                    if o.get("fascia") == "fasce":
                        for k in ("f1", "f2", "f3"):
                            o[f"spread_{k}"] = o[k]
                            o[k] = round(pun + o[k], 6)
                else:
                    o["spread_smc"] = o["prezzo_smc"]
                    o["prezzo_smc"] = round(psv + o["spread_smc"], 6)
        out[chiave] = offerte
        out[f"data_{chiave}"] = data_rif
        print(f"[OK] {chiave}: {len(offerte)} offerte domestiche valide al {data_rif} (scadute scartate: {scadute})")
    out_path = base / "offerte_arera.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Scritto {out_path} ({out_path.stat().st_size // 1024} KB)")
    if args.inline:
        js_path = base / args.inline
        js_path.write_text("window.ARERA_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
        print(f"Scritto {js_path} ({js_path.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
