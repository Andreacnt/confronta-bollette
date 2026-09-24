from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Bolletta:
    file: str
    tipo: str
    fornitore: str
    consumo: float
    unita: str
    totale_euro: float
    giorni: int
    consumo_annuo: float = 0.0
    spesa_annua: float = 0.0
    fascia_f1: float = 0.0
    fascia_f2: float = 0.0
    fascia_f3: float = 0.0

    def __post_init__(self) -> None:
        if self.consumo_annuo <= 0:
            if self.giorni > 0:
                self.consumo_annuo = round(self.consumo / self.giorni * 365, 1)
            else:
                self.consumo_annuo = self.consumo
        if self.spesa_annua <= 0:
            if self.giorni > 0:
                self.spesa_annua = round(self.totale_euro / self.giorni * 365, 2)
            else:
                self.spesa_annua = self.totale_euro


@dataclass
class Offerta:
    nome: str
    prezzo_kwh: float = 0.0
    fisso_luce_annuo: float = 0.0
    prezzo_smc: float = 0.0
    fisso_gas_annuo: float = 0.0
    costo_simulato: float = field(default=0.0, compare=False)
    risparmio: float = field(default=0.0, compare=False)


FORNITORI_NOTI = [
    "Enel", "Eni", "A2A", "Edison", "Sorgenia", "Hera",
    "Iren", "Acea", "E.On", "Engie", "Alergia", "Pulsee",
    "Illumia", "Dolomiti", "Estra", "Duferco", "Octopus",
]


def parse_numero_it(s: str) -> float | None:
    s = s.strip().replace(" ", "")
    try:
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        elif "," in s:
            s = s.replace(",", ".")
        return float(s)
    except ValueError:
        return None


def estrai_testo_pdf(path: Path) -> str:
    try:
        import pdfplumber  # type: ignore

        with pdfplumber.open(str(path)) as pdf:
            return "\n".join((p.extract_text() or "") for p in pdf.pages)
    except ImportError:
        pass
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception as e:
        raise RuntimeError(f"Impossibile leggere {path.name}: {e}. Installa con: pip install pdfplumber pypdf")


def rileva_tipo(testo: str, nome_file: str) -> str:
    n = nome_file.lower()
    if "gas" in n:
        return "gas"
    if "luce" in n or "elettr" in n or "kwh" in n:
        return "luce"
    t = testo.lower()
    score_gas = len(re.findall(r"smc|\bmc\b|gas naturale|pcs|potere calorifico", t))
    score_luce = len(re.findall(r"kwh|energia elettrica|potenza impegnata|kw\b|fasce f1|f2|f3", t))
    return "gas" if score_gas > score_luce else "luce"


def rileva_fornitore(testo: str) -> str:
    for f in FORNITORI_NOTI:
        if re.search(rf"\b{re.escape(f)}\b", testo, re.IGNORECASE):
            return f
    righe = [r.strip() for r in testo.splitlines() if r.strip()]
    return righe[0][:40] if righe else "Sconosciuto"


def cerca_consumo(testo: str, tipo: str) -> float | None:
    if tipo == "luce":
        patterns = [
            r"consumo\s*(?:totale|fatturato|di energia)?\s*:?\s*([\d\.\,]+)\s*kWh",
            r"energia\s*(?:attiva|consumata)?\s*:?\s*([\d\.\,]+)\s*kWh",
            r"totale\s*kWh\s*:?\s*([\d\.\,]+)",
            r"([\d\.\,]+)\s*kWh",
        ]
    else:
        patterns = [
            r"consumo\s*(?:totale|fatturato|di gas)?\s*:?\s*([\d\.\,]+)\s*(?:Smc|mc|m3|m³)",
            r"gas\s*(?:consumato|fatturato)?\s*:?\s*([\d\.\,]+)\s*(?:Smc|mc|m3|m³)",
            r"([\d\.\,]+)\s*(?:Smc)\b",
        ]
    for p in patterns:
        m = re.search(p, testo, re.IGNORECASE)
        if m:
            v = parse_numero_it(m.group(1))
            if v and v > 0:
                return v
    return None


def cerca_totale(testo: str) -> float | None:
    m = re.search(r"totale\s+bolletta\s+([\d\.\,]+\s*,\d{2})", testo, re.IGNORECASE)
    if m:
        v = parse_numero_it(m.group(1))
        if v and v > 0:
            return v
    patterns = [
        r"totale\s*(?:fattura|documento)?\s*:?\s*(?:€|euro)?\s*([\d\.\,]+\s*,\d{2})",
        r"importo\s*(?:totale|da pagare|fattura)?\s*:?\s*(?:€|euro)?\s*([\d\.\,]+\s*,\d{2})",
        r"da pagare\s*:?\s*(?:€)?\s*([\d\.\,]+)",
    ]
    candidati: list[float] = []
    for p in patterns:
        for m in re.finditer(p, testo, re.IGNORECASE):
            v = parse_numero_it(m.group(1))
            if v and v > 0:
                candidati.append(v)
    if not candidati:
        return None
    return max(candidati)


def cerca_consumo_annuo(testo: str, tipo: str) -> float | None:
    unit = "kWh" if tipo == "luce" else "Smc"
    m = re.search(rf"([\d\.\,]+)\s*{unit}\s*/\s*anno", testo, re.IGNORECASE)
    if m:
        v = parse_numero_it(m.group(1))
        if v and v > 0:
            return v
    return None


def cerca_spesa_annua(testo: str) -> float | None:
    m = re.search(r"spesa\s+annua.*?([\d\.\,]+\s*,\d{2})\s*€?", testo, re.IGNORECASE | re.DOTALL)
    if m:
        v = parse_numero_it(m.group(1))
        if v and v > 0 and v < 100000:
            return v
    return None


def cerca_fasce(testo: str) -> tuple[float, float, float] | None:
    righe: list[tuple[float, float, float]] = []
    for m in re.finditer(r"(\d{2}[/\.\-]\d{2}[/\.\-]\d{2,4})\s+(\d+)\s+(\d+)\s+(\d+)\s+\w+", testo):
        try:
            righe.append((float(m.group(2)), float(m.group(3)), float(m.group(4))))
        except ValueError:
            continue
    if len(righe) < 2:
        return None
    for a, b in ((righe[-2], righe[-1]), (righe[-1], righe[-2])):
        delta = [x - y for x, y in zip(a, b)]
        if all(v >= 0 for v in delta) and sum(delta) > 0:
            tot = sum(delta)
            return (round(delta[0] / tot * 100, 1), round(delta[1] / tot * 100, 1), round(delta[2] / tot * 100, 1))
    return None


def cerca_giorni(testo: str) -> int:
    from datetime import datetime

    pulito = re.sub(r"ultimi\s+\d+\s+giorni.*", " ", testo, flags=re.IGNORECASE)
    pulito = re.sub(r"autolettura.*", " ", pulito, flags=re.IGNORECASE | re.DOTALL)
    m = re.search(
        r"periodo\s+di\s+riferimento\s*:\s*dal\s*(\d{1,2}[/\.\-]\d{1,2}[/\.\-]\d{2,4})\s*al\s*(\d{1,2}[/\.\-]\d{1,2}[/\.\-]\d{2,4})",
        pulito, re.IGNORECASE,
    )
    if not m:
        m = re.search(
            r"dal\s*(\d{1,2}[/\.\-]\d{1,2}[/\.\-]\d{2,4})\s*al\s*(\d{1,2}[/\.\-]\d{1,2}[/\.\-]\d{2,4})",
            pulito, re.IGNORECASE,
        )
    if m:
        try:
            fmts = ("%d/%m/%Y", "%d/%m/%y", "%d.%m.%Y", "%d-%m-%Y")
            for f in fmts:
                try:
                    d0 = datetime.strptime(m.group(1).replace(".", "/").replace("-", "/"), f)
                    d1 = datetime.strptime(m.group(2).replace(".", "/").replace("-", "/"), f)
                    return max(1, (d1 - d0).days + 1)
                except ValueError:
                    continue
        except (IndexError, ValueError):
            pass
    m = re.search(r"(\d{1,3})\s*gg\s*x", pulito, re.IGNORECASE)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    m = re.search(r"(\d{1,3})\s*giorni\s*(?:di fornitura|fatturat|di fatturazione|di fattura)", pulito, re.IGNORECASE)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    return 0


def analizza_pdf(path: Path) -> Bolletta | None:
    try:
        testo = estrai_testo_pdf(path)
    except RuntimeError as e:
        print(f"[!] {e}", file=sys.stderr)
        return None
    if not testo.strip():
        print(f"[!] {path.name}: PDF senza testo estraibile (scansione?). Convertilo o inseriscilo in manuale.csv", file=sys.stderr)
        return None
    tipo = rileva_tipo(testo, path.name)
    consumo = cerca_consumo(testo, tipo)
    totale = cerca_totale(testo)
    if consumo is None or totale is None:
        print(f"[!] {path.name}: dati incompleti (consumo={consumo}, totale={totale}). Aggiungilo a manuale.csv", file=sys.stderr)
        return None
    giorni = cerca_giorni(testo)
    fasce = cerca_fasce(testo) if tipo == "luce" else None
    return Bolletta(
        file=path.name,
        tipo=tipo,
        fornitore=rileva_fornitore(testo),
        consumo=consumo,
        unita="kWh" if tipo == "luce" else "Smc",
        totale_euro=round(totale, 2),
        giorni=giorni,
        consumo_annuo=cerca_consumo_annuo(testo, tipo) or 0.0,
        spesa_annua=cerca_spesa_annua(testo) or 0.0,
        fascia_f1=fasce[0] if fasce else 0.0,
        fascia_f2=fasce[1] if fasce else 0.0,
        fascia_f3=fasce[2] if fasce else 0.0,
    )


def carica_manuale(path: Path) -> list[Bolletta]:
    out: list[Bolletta] = []
    if not path.exists():
        return out
    with path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                tipo = row["tipo"].strip().lower()
                assert tipo in ("luce", "gas")
                consumo = float(row["consumo"].replace(",", "."))
                totale = float(row["totale_euro"].replace(",", "."))
                giorni = int(row.get("giorni", 0) or 0)
                out.append(Bolletta(
                    file="manuale.csv",
                    tipo=tipo,
                    fornitore=row.get("fornitore", "Manuale").strip() or "Manuale",
                    consumo=consumo,
                    unita="kWh" if tipo == "luce" else "Smc",
                    totale_euro=totale,
                    giorni=giorni,
                ))
            except (KeyError, ValueError, AssertionError) as e:
                print(f"[!] Riga manuale.csv scartata {row}: {e}", file=sys.stderr)
    return out


def carica_offerte(path: Path) -> list[Offerta]:
    if not path.exists():
        raise FileNotFoundError(f"File offerte non trovato: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    offerte: list[Offerta] = []
    for o in data if isinstance(data, list) else data.get("offerte", []):
        offerte.append(Offerta(
            nome=str(o["nome"]),
            prezzo_kwh=float(o.get("prezzo_kwh", 0) or 0),
            fisso_luce_annuo=float(o.get("fisso_luce_annuo", 0) or 0),
            prezzo_smc=float(o.get("prezzo_smc", 0) or 0),
            fisso_gas_annuo=float(o.get("fisso_gas_annuo", 0) or 0),
        ))
    if not offerte:
        raise ValueError("Nessuna offerta in offerte.json")
    return offerte


SCAGLIONI_GAS = [120, 480, 1560, 5000, 80000, float("inf")]
ACCISE_GAS = [0.0444, 0.175, 0.17, 0.186, 0.186, 0.186]


def quota_scaglioni(cons: float, valori: list[float]) -> float:
    tot, prec = 0.0, 0.0
    for limite, v in zip(SCAGLIONI_GAS, valori):
        quota = max(0.0, min(cons, limite) - prec)
        tot += quota * v
        prec = limite
    return tot


def stima_totale_luce(pk: float, quota: float, cons: float, p: dict) -> float:
    oneri_var = sum(p.get(k, 0) for k in ("asos_dr", "arim_dr", "tras", "sigma3", "msd", "terna"))
    fisso_rete = sum(p.get(k, 0) for k in ("dispbt_d", "sigma1", "sigma2"))
    accisa = max(0.0, cons - 1800) * 0.0227
    return round((cons * (pk + oneri_var) + quota + fisso_rete + accisa) * 1.10, 2)


def stima_totale_gas(pg: float, quota: float, cons: float, p: dict, ambito: str = "a2") -> float:
    tau3 = [p.get(f"tau3_f{i}_{ambito}", 0) for i in range(1, 7)]
    rete_var = p.get("qt", 0) + p.get("qvd_v_d", 0)
    fisso = quota + p.get(f"tau1_cc1_{ambito}", 0) + p.get("qvd_f_d", 0)
    imp = cons * (pg + rete_var) + quota_scaglioni(cons, tau3) + fisso + quota_scaglioni(cons, ACCISE_GAS)
    q10 = min(cons, 480) / cons if cons else 1.0
    return round(imp * q10 * 1.10 + imp * (1 - q10) * 1.22, 2)


def main() -> int:
    base = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Confronta bollette luce/gas e classifica offerte")
    ap.add_argument("--cartella", default=str(base / "bollette"), help="Cartella con i PDF")
    ap.add_argument("--offerte", default=str(base / "offerte.json"), help="File offerte JSON")
    ap.add_argument("--manuale", default=str(base / "manuale.csv"), help="CSV per inserimento manuale")
    ap.add_argument("--output", default=str(base / "report.csv"), help="Report CSV in uscita")
    ap.add_argument("--arera", choices=["luce", "gas"], default=None, help="Classifica tutte le offerte ARERA per commodity")
    ap.add_argument("--top", type=int, default=10, help="Righe da mostrare in modo --arera")
    ap.add_argument("--tipo", choices=["tutte", "fisso", "indicizzato"], default="tutte")
    ap.add_argument("--fasce", default="", help="Pesi F1,F2,F3 es. 20,35,45 (default: auto da bolletta o media)")
    ap.add_argument("--totale", action="store_true", help="Mostra anche stima bolletta totale (oneri+accise+IVA)")
    ap.add_argument("--ambito", default="a2", help="Ambito gas ARERA (a1..a6, default a2 nord-orientale)")
    ap.add_argument("--no-deposito", action="store_true", help="Solo offerte senza deposito (euristica)")
    ap.add_argument("--verde", action="store_true", help="Solo offerte con nome verde (euristica)")
    args = ap.parse_args()

    cartella = Path(args.cartella)
    if not cartella.exists():
        print(f"Cartella non trovata: {cartella}. Crea la cartella e mettici i PDF.", file=sys.stderr)
        return 1

    bollette: list[Bolletta] = []
    visti: set[str] = set()
    pdfs: list[Path] = []
    for p in sorted(cartella.glob("*.pdf")) + sorted(cartella.glob("*.PDF")):
        key = str(p.resolve()).lower()
        if key not in visti:
            visti.add(key)
            pdfs.append(p)
    if not pdfs:
        print(f"Nessun PDF in {cartella}. Metti le bollette lì oppure usa manuale.csv.", file=sys.stderr)
    for p in pdfs:
        b = analizza_pdf(p)
        if b:
            bollette.append(b)
            costo_unit = b.totale_euro / b.consumo if b.consumo else 0
            extra = f" | fasce {b.fascia_f1:.0f}/{b.fascia_f2:.0f}/{b.fascia_f3:.0f}" if b.fascia_f1 else ""
            print(f"[OK] {b.file} | {b.tipo} | {b.fornitore} | {b.consumo} {b.unita} | €{b.totale_euro:.2f} | {b.giorni}gg | {costo_unit:.4f} €/{b.unita} | annuo {b.consumo_annuo} {b.unita}{extra}")

    bollette += carica_manuale(Path(args.manuale))
    if not bollette:
        print("Nessuna bolletta valida. Compila manuale.csv (vedi manuale_esempio.csv).", file=sys.stderr)
        return 1

    def media_annua(items: list[Bolletta], campo: str) -> float:
        if not items:
            return 0.0
        return round(sum(getattr(b, campo) for b in items) / len(items), 2)

    def pesi_fasce(items: list[Bolletta]) -> tuple[float, float, float]:
        if args.fasce:
            try:
                w = tuple(float(x) for x in args.fasce.split(","))
                assert len(w) == 3 and abs(sum(w) - 100) < 1
                return (w[0] / 100, w[1] / 100, w[2] / 100)
            except (ValueError, AssertionError):
                print("[!] --fasce non valido (es. 20,35,45), uso default", file=sys.stderr)
        auto = [b for b in items if b.fascia_f1 > 0]
        if auto:
            b = auto[0]
            return (b.fascia_f1 / 100, b.fascia_f2 / 100, b.fascia_f3 / 100)
        return (0.33, 0.33, 0.34)

    def avviso_scadenza(offerte_json: list[dict]) -> None:
        from datetime import date as _date

        for o in offerte_json:
            sc = o.get("scadenza_offerta")
            if not sc:
                continue
            try:
                gg = (_date.fromisoformat(sc) - _date.today()).days
            except ValueError:
                continue
            stato = "SCADUTA" if gg < 0 else (f"scade tra {gg} giorni!" if gg < 60 else f"scade tra {gg} giorni")
            print(f"[{'!' if gg < 60 else '*'}] {o.get('nome')}: {stato} ({sc})")

    if args.arera:
        arera_path = base / "offerte_arera.json"
        if not arera_path.exists():
            print("offerte_arera.json mancante: esegui python aggiorna_offerte_arera.py", file=sys.stderr)
            return 1
        db = json.loads(arera_path.read_text(encoding="utf-8"))
        items = [b for b in bollette if b.tipo == args.arera]
        if not items:
            print(f"Nessuna bolletta {args.arera} caricata.", file=sys.stderr)
            return 1
        cons = media_annua(items, "consumo_annuo")
        spesa = media_annua(items, "spesa_annua")
        chiave = "prezzo_kwh" if args.arera == "luce" else "prezzo_smc"
        unita = "kWh" if args.arera == "luce" else "Smc"
        w1, w2, w3 = pesi_fasce(items)
        params = db.get("parametri", {}).get("E" if args.arera == "luce" else "G", {})
        righe = []
        for o in db.get(args.arera, []):
            if args.tipo != "tutte" and o.get("tipo_prezzo") != args.tipo:
                continue
            if args.no_deposito and not o.get("senza_deposito", True):
                continue
            if args.verde and not o.get("verde_nome", False):
                continue
            if args.arera == "luce" and o.get("fascia") == "fasce":
                p = (o.get("f1", 0) or 0) * w1 + (o.get("f2", 0) or 0) * w2 + (o.get("f3", 0) or 0) * w3
            else:
                p = o.get(chiave)
            if not p:
                continue
            quota = o.get("quota_fissa_annua", 0)
            costo = round(cons * p + quota, 2)
            tot = None
            if args.totale:
                tot = stima_totale_luce(p, quota, cons, params) if args.arera == "luce" else stima_totale_gas(p, quota, cons, params, args.ambito)
            righe.append((costo, tot, o))
        righe.sort(key=lambda x: x[0])
        print(f"\n=== ARERA {args.arera} ({len(righe)} offerte, consumo {cons} {unita}, spesa attuale €{spesa:.2f}, fasce {w1:.0%}/{w2:.0%}/{w3:.0%}) ===")
        for i, (costo, tot, o) in enumerate(righe[: args.top], 1):
            extra = f" | tot~€{tot:.2f}" if tot else ""
            print(f"{i:<3} {o['venditore']:<28} {o['nome'][:34]:<34} {o['tipo_prezzo']:<11} €{costo:<10.2f} €{spesa - costo:.2f}{extra}")
        if args.totale:
            print("Stima totale: oneri+accise+IVA da parametri ARERA; escluse quota potenza rete luce e ST/VR/UG2 gas (uguali per tutti).")
        return 0

    luce = [b for b in bollette if b.tipo == "luce"]
    gas = [b for b in bollette if b.tipo == "gas"]
    cons_luce = media_annua(luce, "consumo_annuo")
    cons_gas = media_annua(gas, "consumo_annuo")
    spesa_luce = media_annua(luce, "spesa_annua")
    spesa_gas = media_annua(gas, "spesa_annua")
    spesa_attuale = round(spesa_luce + spesa_gas, 2)

    print(f"\nConsumo annuo stimato: luce {cons_luce} kWh | gas {cons_gas} Smc")
    print(f"Spesa annua attuale stimata: €{spesa_attuale:.2f} (luce €{spesa_luce:.2f} + gas €{spesa_gas:.2f})")

    try:
        offerte = carica_offerte(Path(args.offerte))
        mie = base / "mie_offerte.json"
        if mie.exists():
            offerte += carica_offerte(mie)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        print(f"[!] Offerte non caricate: {e}", file=sys.stderr)
        return 1
    grezzo: list[dict] = []
    for f in (Path(args.offerte), base / "mie_offerte.json"):
        if f.exists():
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                grezzo += d if isinstance(d, list) else d.get("offerte", [])
            except json.JSONDecodeError:
                pass
    avviso_scadenza(grezzo)

    for o in offerte:
        o.costo_simulato = round(cons_luce * o.prezzo_kwh + o.fisso_luce_annuo + cons_gas * o.prezzo_smc + o.fisso_gas_annuo, 2)
        o.risparmio = round(spesa_attuale - o.costo_simulato, 2)
    offerte.sort(key=lambda x: x.costo_simulato)

    print("\n=== CLASSIFICA OFFERTE (più conveniente prima) ===")
    print(f"{'#':<3} {'Offerta':<28} {'Costo/anno':<12} {'Risparmio':<12}")
    for i, o in enumerate(offerte, 1):
        segno = "+" if o.risparmio < 0 else ""
        print(f"{i:<3} {o.nome:<28} €{o.costo_simulato:<11.2f} {segno}€{o.risparmio:<11.2f}")

    with Path(args.output).open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["posizione", "offerta", "costo_annuo_euro", "risparmio_vs_attuale_euro", "consumo_luce_kwh", "consumo_gas_smc"])
        for i, o in enumerate(offerte, 1):
            w.writerow([i, o.nome, f"{o.costo_simulato:.2f}", f"{o.risparmio:.2f}", cons_luce, cons_gas])
    print(f"\nReport salvato in {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
