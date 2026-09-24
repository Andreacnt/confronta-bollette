const $ = (id) => document.getElementById(id);
const offerte = [];
const bollette = [];
const FALLBACK = [
  {"nome": "Octopus Fissa 12M set-2026", "fornitore": "Octopus", "tipo_prezzo": "fisso", "durata_mesi": 12, "aggiornato": "2026-09-16", "fonte": "bolletta-energia.it 16/09/2026", "nota": "", "prezzo_kwh": 0.1386, "fisso_luce_annuo": 72, "prezzo_smc": 0.573, "fisso_gas_annuo": 84},
  {"nome": "Octopus Flex stimata (PUN+PSV ago-26)", "fornitore": "Octopus", "tipo_prezzo": "indicizzato", "durata_mesi": 12, "aggiornato": "2026-09-16", "fonte": "Spread Octopus + PUN 0,18 PSV 0,6876", "nota": "", "prezzo_kwh": 0.1888, "spread_kwh": 0.0088, "fisso_luce_annuo": 72, "prezzo_smc": 0.7476, "spread_smc": 0.06, "fisso_gas_annuo": 84},
  {"nome": "Engie PuntoFisso 12M", "fornitore": "Engie", "tipo_prezzo": "fisso", "durata_mesi": 12, "aggiornato": "2026-09-02", "fonte": "engie.it", "nota": "Fasce F1 0,1416 F2 0,1569 F3 0,1278.", "prezzo_kwh": 0.1409, "f1": 0.1416, "f2": 0.1569, "f3": 0.1278, "fisso_luce_annuo": 72, "prezzo_smc": 0.599, "fisso_gas_annuo": 84},
  {"nome": "Edison Dynamic stimata", "fornitore": "Edison", "tipo_prezzo": "indicizzato", "durata_mesi": 12, "aggiornato": "2026-09-04", "fonte": "luce-gas.it/ameconviene", "nota": "", "prezzo_kwh": 0.192, "spread_kwh": 0.012, "fisso_luce_annuo": 99, "prezzo_smc": 0.7276, "spread_smc": 0.04, "fisso_gas_annuo": 99},
  {"nome": "Sorgenia Next PUNtuale stimata", "fornitore": "Sorgenia", "tipo_prezzo": "indicizzato", "durata_mesi": 12, "aggiornato": "2026-09-04", "fonte": "luce-gas.it", "nota": "", "prezzo_kwh": 0.187, "spread_kwh": 0.007, "fisso_luce_annuo": 68.4, "prezzo_smc": 0.7376, "spread_smc": 0.05, "fisso_gas_annuo": 68.4},
  {"nome": "Acea Fix set-2026", "fornitore": "Acea", "tipo_prezzo": "fisso", "durata_mesi": 12, "aggiornato": "2026-09-04", "fonte": "ameconviene.it", "nota": "", "prezzo_kwh": 0.126, "fisso_luce_annuo": 144, "prezzo_smc": 0.58, "fisso_gas_annuo": 144},
  {"nome": "Dolomiti Fisso 36 Web", "fornitore": "Dolomiti", "tipo_prezzo": "fisso", "durata_mesi": 36, "aggiornato": "2026-04-17", "fonte": "switcho.it + dolomitienergia.it", "nota": "Verifica prezzo attuale.", "prezzo_kwh": 0.127, "fisso_luce_annuo": 72, "prezzo_smc": 0.5235, "fisso_gas_annuo": 72},
  {"nome": "A2A Ready 12", "fornitore": "A2A", "tipo_prezzo": "fisso", "durata_mesi": 12, "aggiornato": "2026-09-09", "fonte": "puntienergia.com/Selectra", "nota": "", "prezzo_kwh": 0.1488, "fisso_luce_annuo": 102, "prezzo_smc": 0.58, "fisso_gas_annuo": 108}
];

function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, "");
  if (!s) return null;
  const n = s.includes(",") && s.includes(".")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function media(items, k) {
  if (!items.length) return 0;
  return items.reduce((a, b) => a + b[k], 0) / items.length;
}

async function testoPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let t = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
    const p = await pdf.getPage(i);
    const c = await p.getTextContent();
    t += c.items.map((x) => x.str).join(" ") + "\n";
  }
  return t;
}

function minus(a, b) {
  if (!a || !b) return null;
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cerca(testo, tipo) {
  const consumo = (() => {
    const u = tipo === "luce" ? "kWh" : "(?:Smc|mc|m3)";
    const m = testo.match(new RegExp("CONSUMO FATTURATO:\\s*([\\d\\.,]+)\\s*" + u, "i"))
      || testo.match(new RegExp("([\\d\\.,]+)\\s*" + u, "i"));
    return m ? num(m[1]) : null;
  })();
  const tot = (() => {
    const m = testo.match(/TOTALE BOLLETTA\s*([\d\.,]+\s*,\d{2})/i)
      || testo.match(/TOTALE DA PAGARE\s*([\d\.,]+)/i);
    return m ? num(m[1]) : null;
  })();
  const gg = (() => {
    const m = testo.match(/PERIODO DI RIFERIMENTO:\s*dal\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*al\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i)
      || testo.match(/dal\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*al\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
    if (!m) return 0;
    const p = (s) => { const [d, mo, y] = s.replace(/\./g, "/").replace(/-/g, "/").split("/"); return new Date(+("20" + y.slice(-2)).slice(-4), +mo - 1, +d); };
    try { return Math.max(1, Math.round((p(m[2]) - p(m[1])) / 864e5) + 1); } catch { return 0; }
  })();
  const u = tipo === "luce" ? "kWh" : "Smc";
  const mA = testo.match(new RegExp("([\\d\\.,]+)\\s*" + u + "\\s*/\\s*anno", "i"));
  const mS = testo.match(/SPESA\s+ANNUA[\s\S]{0,300}?([\d\.,]+\s*,\d{2})/i);
  const consumo_annuo = (mA && num(mA[1])) || (gg ? +(consumo / gg * 365).toFixed(1) : consumo);
  const spesa_annua = (mS && num(mS[1]) && num(mS[1]) < 100000 ? num(mS[1]) : null)
    || (gg ? +(tot / gg * 365).toFixed(2) : tot);
  let fasce = null;
  if (tipo === "luce") {
    const righe = [];
    const re = /(\d{2}[\/.\-]\d{2}[\/.\-]\d{2,4})\s+(\d+)\s+(\d+)\s+(\d+)\s+\w+/g;
    let m;
    while ((m = re.exec(testo))) righe.push([+m[2], +m[3], +m[4]]);
    const cand = [minus(righe[righe.length - 2], righe[righe.length - 1]), minus(righe[righe.length - 1], righe[righe.length - 2])].find((d) => d && d.every((v) => v >= 0) && d.reduce((a, b) => a + b, 0) > 0);
    if (cand) {
      const tot = cand.reduce((a, b) => a + b, 0);
      fasce = cand.map((v) => +(v / tot * 100).toFixed(1));
    }
  }
  let mese = "";
  const mp = testo.match(/PERIODO DI RIFERIMENTO:\s*dal\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})/i)
    || testo.match(/dal\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})/i);
  if (mp) {
    let y = mp[3];
    if (y.length === 2) y = "20" + y;
    mese = mp[2] + "/" + y;
  }
  let scadenza = "";
  const mSc = testo.match(/DATA DI SCADENZA DELL['\s]OFFERTA:\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})/i)
    || testo.match(/SCADENZA\s*(DELL['\s]OFFERTA|OFFERTA)?\s*:?\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})/i);
  if (mSc) {
    const g = mSc.slice(-3);
    let y = g[2];
    if (y.length === 2) y = "20" + y;
    scadenza = `${y}-${g[1]}-${g[0]}`;
  }
  return { consumo, totale: tot, giorni: gg, consumo_annuo, spesa_annua, fasce, mese, consumo_mese: consumo, scadenza };
}

function tipoDaTesto(t, nome) {
  const n = nome.toLowerCase();
  if (n.includes("gas")) return "gas";
  if (n.includes("luce")) return "luce";
  const g = (t.match(/smc|gas naturale|potere calorifico/gi) || []).length;
  const l = (t.match(/kwh|energia elettrica|potenza impegnata/gi) || []).length;
  return g > l ? "gas" : "luce";
}

function renderBollette() {
  const tb = $("tab-bollette");
  const b = tb.querySelector("tbody");
  b.innerHTML = "";
  bollette.forEach((x, i) => {
    const tr = document.createElement("tr");
    const gg = ggScadenza(x.scadenza);
    const sc = !x.scadenza ? "—" : gg != null && gg < 60 ? `<b class="warn">${dataIt(x.scadenza)}</b>` : dataIt(x.scadenza);
    tr.innerHTML = `<td>${x.file}</td><td>${x.tipo}</td><td>${x.consumo_annuo} ${x.tipo === "luce" ? "kWh" : "Smc"}</td><td>€${x.spesa_annua.toFixed(2)}</td><td>${sc}</td>`;
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.className = "ghost";
    btn.onclick = () => { bollette.splice(i, 1); renderBollette(); };
    td.appendChild(btn);
    tr.appendChild(td);
    b.appendChild(tr);
  });
  tb.hidden = !bollette.length;
  const l = bollette.filter((x) => x.tipo === "luce");
  const g = bollette.filter((x) => x.tipo === "gas");
  const fn = $("riepilogo").dataset.fasce;
  const tot = media(l, "spesa_annua") + media(g, "spesa_annua");
  $("riepilogo").textContent = bollette.length
    ? `Consumi circa ${media(l, "consumo_annuo").toFixed(0)} kWh di luce e ${media(g, "consumo_annuo").toFixed(0)} Smc di gas all'anno. Oggi spendi circa €${tot.toFixed(0)} all'anno.${fn ? " " + fn + "." : ""}`
    : "Nessuna bolletta: carica i PDF oppure prova con consumi di esempio.";
  renderStorico();
}

function renderStorico() {
  const el = $("storico");
  el.innerHTML = "";
  ["luce", "gas"].forEach((tipo) => {
    const punti = bollette.filter((x) => x.tipo === tipo && x.mese && x.consumo_mese).sort((a, b) => (a.mese < b.mese ? -1 : 1));
    if (!punti.length) return;
    const mx = Math.max(...punti.map((x) => x.consumo_mese));
    const u = tipo === "luce" ? "kWh" : "Smc";
    const h = document.createElement("p");
    h.className = "mut";
    h.textContent = `Storico ${tipo} (dal PDF):`;
    el.appendChild(h);
    punti.forEach((x) => {
      const r = document.createElement("div");
      r.innerHTML = `<span class="mut">${x.mese}</span> <div style="display:inline-block;background:#2a3445;border-radius:6px;height:12px;width:60%"><div style="width:${Math.max(2, Math.round((x.consumo_mese / mx) * 100))}%;background:#4cc38a;height:12px;border-radius:6px"></div></div> <span>${x.consumo_mese} ${u}</span>`;
      el.appendChild(r);
    });
  });
}

function prezzoLuce(o, mode, p1, p2, p3, pun) {
  let base = o.prezzo_kwh || 0;
  if (o.tipo_prezzo === "indicizzato" && o.spread_kwh != null && Number.isFinite(pun)) base = pun + o.spread_kwh;
  if (mode === "fasce" && o.f1 != null) {
    const tot = p1 + p2 + p3 || 1;
    return (o.f1 * p1 + o.f2 * p2 + o.f3 * p3) / tot;
  }
  return base;
}

function prezzoGas(o, psv) {
  if (o.tipo_prezzo === "indicizzato" && o.spread_smc != null && Number.isFinite(psv)) return psv + o.spread_smc;
  return o.prezzo_smc || 0;
}

let ultimo = [];

function confronta() {
  if (!offerte.length) { $("out").textContent = "DB offerte non caricato: ricarica la pagina."; return; }
  if (!bollette.length) { $("out").textContent = "Carica almeno una bolletta al punto 1."; return; }
  const ut = $("utenza").value;
  if ((ut === "luce" && !bollette.some((x) => x.tipo === "luce")) || (ut === "gas" && !bollette.some((x) => x.tipo === "gas"))) {
    $("out").textContent = "Carica una bolletta del tipo selezionato al punto 1.";
    return;
  }
  const mode = $("tariffa").value;
  const p1 = +$("p-f1").value || 0, p2 = +$("p-f2").value || 0, p3 = +$("p-f3").value || 0;
  const pun = num($("pun").value), psv = num($("psv").value);
  const l = bollette.filter((x) => x.tipo === "luce");
  const g = bollette.filter((x) => x.tipo === "gas");
  const cl = ut === "gas" ? 0 : media(l, "consumo_annuo");
  const cg = ut === "luce" ? 0 : media(g, "consumo_annuo");
  const sl = ut === "gas" ? 0 : media(l, "spesa_annua");
  const sg = ut === "luce" ? 0 : media(g, "spesa_annua");
  const spesa = sl + sg;
  const righe = offerte.map((o) => {
    const pk = ut === "gas" ? 0 : prezzoLuce(o, mode, p1, p2, p3, pun);
    const pg = ut === "luce" ? 0 : prezzoGas(o, psv);
    const fl = ut === "gas" ? 0 : (o.fisso_luce_annuo || 0);
    const fg = ut === "luce" ? 0 : (o.fisso_gas_annuo || 0);
    const costo = +(cl * pk + fl + cg * pg + fg).toFixed(2);
    return { o, pk, pg, fl, fg, costo, risp: +(spesa - costo).toFixed(2) };
  }).sort((a, b) => a.costo - b.costo);
  ultimo = righe.slice(0, 5);
  const el = $("out");
  el.innerHTML = "";
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr><th>#</th><th>Offerta</th><th class="opt">Prezzo luce</th><th class="opt">Prezzo gas</th><th class="opt">Quota fissa/anno</th><th>Costo energia/anno</th><th>Risparmio</th></tr></thead>`;
  const tb = document.createElement("tbody");
  ultimo.forEach((r, i) => {
    const tr = document.createElement("tr");
    const mat_l = ut === "gas" ? "—" : `€${r.pk.toFixed(4)}/kWh${r.o.tipo_prezzo === "indicizzato" ? " <span class='mut'>(PUN+spread)</span>" : ""}`;
    const mat_g = ut === "luce" ? "—" : `€${r.pg.toFixed(4)}/Smc${r.o.tipo_prezzo === "indicizzato" ? " <span class='mut'>(PSV+spread)</span>" : ""}`;
    tr.innerHTML = `<td class="${i === 0 ? "best" : ""}">${i + 1}</td>
      <td><b>${r.o.nome}</b><br><span class="mut">${r.o.fornitore || ""} · ${r.o.tipo_prezzo || ""} · ${r.o.durata_mesi ? r.o.durata_mesi + " mesi" : ""} · agg. ${r.o.aggiornato || "—"}</span></td>
      <td class="opt">${mat_l}</td><td class="opt">${mat_g}</td>
      <td class="opt">€${r.fl.toFixed(0)} + €${r.fg.toFixed(0)}</td>
      <td class="${i === 0 ? "best" : ""}">€${r.costo.toFixed(2)}</td>
      <td>€${r.risp.toFixed(2)}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  el.appendChild(t);
  const p = document.createElement("p");
  p.className = "mut";
  p.textContent = `*Solo materia prima + commercializzazione su ${cl.toFixed(0)} kWh + ${cg.toFixed(0)} Smc. Oneri, rete, accise e IVA sono uguali per tutti e quindi esclusi dal ranking. Spesa attuale da bollette: €${spesa.toFixed(2)}. Fonti nelle note del DB.`;
  el.appendChild(p);
}

function renderDb() {
  const el = $("db");
  el.innerHTML = "";
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr><th>Offerta</th><th>Luce</th><th>Gas</th><th>Fisso/anno</th><th>Fonte</th></tr></thead>`;
  const tb = document.createElement("tbody");
  offerte.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><b>${o.nome}</b><br><span class="mut">${o.tipo_prezzo || ""} · ${o.durata_mesi || "?"} mesi · ${o.nota || ""}</span></td>
      <td>€${(o.prezzo_kwh || 0).toFixed(4)}/kWh${o.spread_kwh != null ? `<br><span class="mut">spread +${o.spread_kwh}</span>` : ""}${o.f1 != null ? `<br><span class="mut">F1 ${o.f1} F2 ${o.f2} F3 ${o.f3}</span>` : ""}</td>
      <td>€${(o.prezzo_smc || 0).toFixed(4)}/Smc${o.spread_smc != null ? `<br><span class="mut">spread +${o.spread_smc}</span>` : ""}</td>
      <td>€${(o.fisso_luce_annuo || 0).toFixed(0)} + €${(o.fisso_gas_annuo || 0).toFixed(0)}</td>
      <td class="mut">${o.fonte || ""} (${o.aggiornato || ""})</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  el.appendChild(t);
}

const arera = { luce: [], gas: [], pun_rif: 0, psv_rif: 0, data: "", parametri: { E: {}, G: {} } };
const SCAG = [120, 480, 1560, 5000, 80000, Infinity];
const ACCISE_GAS = [0.0444, 0.175, 0.17, 0.186, 0.186, 0.186];

function perScaglioni(cons, valori) {
  let tot = 0, prec = 0;
  for (let i = 0; i < SCAG.length; i++) {
    tot += Math.max(0, Math.min(cons, SCAG[i]) - prec) * (valori[i] || 0);
    prec = SCAG[i];
  }
  return tot;
}

function totaleLuce(pk, quota, cons) {
  const P = arera.parametri.E || {};
  const v = (["asos_dr", "arim_dr", "tras", "sigma3", "msd", "terna"]).reduce((a, k) => a + (P[k] || 0), 0);
  const f = quota + (["dispbt_d", "sigma1", "sigma2"]).reduce((a, k) => a + (P[k] || 0), 0);
  return +((cons * (pk + v) + f + Math.max(0, cons - 1800) * 0.0227) * 1.10).toFixed(2);
}

function totaleGas(pg, quota, cons, ambito) {
  const P = arera.parametri.G || {};
  const tau3 = [1, 2, 3, 4, 5, 6].map((i) => P[`tau3_f${i}_${ambito}`] || 0);
  const imp = cons * (pg + (P.qt || 0) + (P.qvd_v_d || 0))
    + perScaglioni(cons, tau3) + quota + (P[`tau1_cc1_${ambito}`] || 0) + (P.qvd_f_d || 0)
    + perScaglioni(cons, ACCISE_GAS);
  const q10 = cons ? Math.min(cons, 480) / cons : 1;
  return +(imp * q10 * 1.10 + imp * (1 - q10) * 1.22).toFixed(2);
}

function pkArera(o, mode, p1, p2, p3, pun) {
  if (o.tipo_prezzo === "indicizzato") {
    const s = (k) => (o[k] != null ? pun + o[k] : null);
    if (mode === "fasce" && o.fascia === "fasce") {
      const tot = p1 + p2 + p3 || 1;
      return (s("spread_f1") * p1 + s("spread_f2") * p2 + s("spread_f3") * p3) / tot;
    }
    return s("spread_kwh");
  }
  if (mode === "fasce" && o.fascia === "fasce") {
    const tot = p1 + p2 + p3 || 1;
    return (o.f1 * p1 + o.f2 * p2 + o.f3 * p3) / tot;
  }
  return o.prezzo_kwh;
}

function pgArera(o, psv) {
  if (o.tipo_prezzo === "indicizzato" && o.spread_smc != null) return psv + o.spread_smc;
  return o.prezzo_smc;
}

function dataIt(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function tabellaArera(el, righe, unita, conTotale) {
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr><th>#</th><th>Venditore e offerta</th><th class="opt">Prezzo energia</th><th class="opt">Quota fissa/anno</th><th>Costo energia/anno</th>${conTotale ? "<th>Bolletta stimata/anno</th>" : ""}<th>Risparmio</th></tr></thead>`;
  const tb = document.createElement("tbody");
  righe.forEach((r, i) => {
    const tr = document.createElement("tr");
    const flags = [r.o.senza_deposito ? "no-deposito" : "", r.o.verde_nome ? "verde" : ""].filter(Boolean).join(" · ");
    const gg = ggScadenza(r.o.scadenza);
    const avviso = gg == null ? "" : gg < 0 ? ` · <b class="warn">scaduta</b>` : gg <= 7 ? ` · <b class="warn">scade tra ${gg} gg!</b>` : "";
    tr.innerHTML = `<td class="${i === 0 ? "best" : ""}">${i + 1}</td>
      <td><b>${r.o.venditore}</b> · ${r.o.nome}<br><span class="mut">${r.o.tipo_prezzo} · ${r.o.fascia === "fasce" ? "a fasce" : "prezzo unico"}${r.o.scadenza ? " · valida fino al " + dataIt(r.o.scadenza) : ""}${avviso}${flags ? " · " + flags : ""} · <a href="${r.o.url}" target="_blank" rel="noopener">scheda e contratto</a></span></td>
      <td class="opt">€${r.p.toFixed(4)}/${unita}</td><td class="opt">€${r.o.quota_fissa_annua.toFixed(0)}</td>
      <td class="${i === 0 ? "best" : ""}">€${r.costo.toFixed(2)}</td>${conTotale ? `<td>€${r.tot.toFixed(2)}</td>` : ""}
      <td>${r.risp == null ? "—" : "€" + r.risp.toFixed(2)}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  el.appendChild(t);
}

function barre(oggi, domani) {
  const mx = Math.max(oggi, domani, 1);
  const w = (v) => Math.max(2, Math.round((v / mx) * 100));
  return `<div style="margin-top:10px">
    <div>Oggi: <b>€${Math.round(oggi)}/anno</b></div>
    <div style="background:#2a3445;border-radius:6px;height:14px"><div style="width:${w(oggi)}%;background:#ffb454;height:14px;border-radius:6px"></div></div>
    <div style="margin-top:6px">Domani: <b>€${Math.round(domani)}/anno</b></div>
    <div style="background:#2a3445;border-radius:6px;height:14px"><div style="width:${w(domani)}%;background:#4cc38a;height:14px;border-radius:6px"></div></div></div>`;
}

function ggScadenza(s) {
  if (!s) return null;
  return Math.round((new Date(s) - new Date()) / 864e5);
}

const GRANDI = ["enel", "eni", "plenitude", "edison", "a2a", "hera", "acea", "engie", "eon", "sorgenia", "octopus", "dolomiti", "iren"];

function verdetto(bestL, bestG) {
  const el = $("verdetto");
  const l = bollette.filter((x) => x.tipo === "luce");
  const g = bollette.filter((x) => x.tipo === "gas");
  const spesa = media(l, "spesa_annua") + media(g, "spesa_annua");
  if (!spesa) { el.textContent = "Carica prima le bollette al punto 1."; return; }
  const val = (b) => (b ? (arera.conTot === false ? b.costo : b.tot) : 0);
  const totL = val(bestL), totG = val(bestG);
  if ((!totL && !totG) || (!bestL && !bestG)) { el.textContent = "Nessuna offerta trovata con questi filtri: allarga la ricerca."; return; }
  const stima = totL + totG;
  const risp = Math.round(spesa - stima);
  el.classList.remove("mut");
  if (risp > 50) {
    const stesso = bestL && bestG && (bestL.o.venditore || "").toLowerCase() === (bestG.o.venditore || "").toLowerCase();
    const nomi = stesso ? `${bestL.o.venditore} per luce e gas`
      : [bestL && `luce con ${bestL.o.venditore} (${bestL.o.nome})`, bestG && `gas con ${bestG.o.venditore} (${bestG.o.nome})`].filter(Boolean).join(" e ");
    const nota = arera.conTot === false ? " (confronto sulla sola energia, senza oneri e IVA)" : "";
    el.innerHTML = `💡 <b>Ti conviene cambiare.</b> Passando a ${nomi} spenderesti circa <b>€${Math.round(stima)}/anno</b> invece di €${Math.round(spesa)}: <b class="best">risparmi circa €${risp} all'anno</b>${nota}.${barre(spesa, stima)}`;
  } else if (risp >= 0) {
    el.innerHTML = `👍 <b>Resta dove sei.</b> La tua spesa (€${Math.round(spesa)}/anno) è già in linea con le migliori offerte (migliore stima: €${Math.round(stima)}/anno). Ricontrolla quando la tua offerta scade.${barre(spesa, stima)}`;
  } else {
    el.innerHTML = `👍 <b>Resta dove sei.</b> Oggi spendi €${Math.round(spesa)}/anno e le alternative costano di più (da €${Math.round(stima)}/anno). La tua offerta attuale è ottima.${barre(spesa, stima)}`;
  }
}

function classificaArera() {
  const el = $("arera-out");
  el.innerHTML = "";
  if (!bollette.length) { el.textContent = "Carica prima le bollette al punto 1."; return; }
  if (!arera.luce.length && !arera.gas.length) { el.textContent = "offerte_arera.json non caricato."; return; }
  const ut = $("utenza").value;
  const mode = $("tariffa").value;
  const p1 = +$("p-f1").value || 0, p2 = +$("p-f2").value || 0, p3 = +$("p-f3").value || 0;
  const pun = num($("pun").value) ?? arera.pun_rif, psv = num($("psv").value) ?? arera.psv_rif;
  const ft = $("arera-tipo").value, q = $("arera-q").value.trim().toLowerCase();
  const n = +$("arera-top").value || 10;
  const noDep = $("arera-nodep").checked, verde = $("arera-verde").checked;
  const noti = $("arera-noti").checked;
  const eGrande = (o) => GRANDI.some((g) => (o.venditore || "").toLowerCase().includes(g));
  const ambito = $("arera-ambito").value || "a2";
  const conTot = !!(arera.parametri.E && Object.keys(arera.parametri.E).length);
  arera.conTot = conTot;
  const filtra = (o) => (ft === "tutte" || o.tipo_prezzo === ft)
    && (!q || (o.venditore + " " + o.nome).toLowerCase().includes(q))
    && (!noDep || o.senza_deposito) && (!verde || o.verde_nome)
    && (!noti || eGrande(o));
  const rank = (lista, prezzo, cons, spesa, totFn) => lista.filter(filtra)
    .map((o) => { const p = prezzo(o); return p == null ? null : { o, p, costo: +(cons * p + o.quota_fissa_annua).toFixed(2) }; })
    .filter(Boolean).map((r) => ({ ...r, tot: totFn ? totFn(r.p, r.o.quota_fissa_annua) : 0, risp: +(spesa - r.costo).toFixed(2) }))
    .sort((a, b) => a.costo - b.costo);
  let bestL = [], bestG = [];
  const haL = (ut === "luce" || ut === "dual") && bollette.some((x) => x.tipo === "luce");
  const haG = (ut === "gas" || ut === "dual") && bollette.some((x) => x.tipo === "gas");
  if (!haL && !haG) { el.textContent = "Carica una bolletta del tipo selezionato al punto 1."; return; }
  const full = $("arera-full");
  full.innerHTML = "";
  const notaHtml = `⚠ <b>Prima di firmare verifica sempre prezzo e condizioni sul sito del gestore</b> (clicca «scheda e contratto»): le offerte scadono in pochi giorni e i prezzi cambiano spesso.`;
  if (haL) {
    const l = bollette.filter((x) => x.tipo === "luce");
    const cl = media(l, "consumo_annuo"), sl = media(l, "spesa_annua");
    bestL = rank(arera.luce, (o) => pkArera(o, mode, p1, p2, p3, pun), cl, sl, conTot ? (p, qu) => totaleLuce(p, qu, cl) : null);
    const h = document.createElement("h2"); h.textContent = "Le 3 migliori per la luce";
    el.appendChild(h);
    tabellaArera(el, bestL.slice(0, 3), "kWh", conTot);
    const hf = document.createElement("h2"); hf.textContent = `Tutta la luce — ${bestL.length} offerte`;
    full.appendChild(hf);
    tabellaArera(full, bestL.slice(0, n), "kWh", conTot);
  }
  if (haG) {
    const g = bollette.filter((x) => x.tipo === "gas");
    const cg = media(g, "consumo_annuo"), sg = media(g, "spesa_annua");
    bestG = rank(arera.gas, (o) => pgArera(o, psv), cg, sg, conTot ? (p, qu) => totaleGas(p, qu, cg, ambito) : null);
    const h = document.createElement("h2"); h.textContent = "Le 3 migliori per il gas";
    el.appendChild(h);
    tabellaArera(el, bestG.slice(0, 3), "Smc", conTot);
    const hf = document.createElement("h2"); hf.textContent = `Tutto il gas — ${bestG.length} offerte`;
    full.appendChild(hf);
    tabellaArera(full, bestG.slice(0, n), "Smc", conTot);
  }
  if (ut === "dual" && bestL.length && bestG.length) classificaFinale(el, bestL, bestG, conTot);
  const rinnovo = offerte.find((o) => /octopus fissa 12m set/i.test(o.nome || ""));
  if (rinnovo && (bestL.length || bestG.length)) {
    const l = bollette.filter((x) => x.tipo === "luce");
    const g = bollette.filter((x) => x.tipo === "gas");
    const cl = ut === "gas" ? 0 : media(l, "consumo_annuo");
    const cg = ut === "luce" ? 0 : media(g, "consumo_annuo");
    const c = cl * (rinnovo.prezzo_kwh || 0) + (ut === "gas" ? 0 : (rinnovo.fisso_luce_annuo || 0))
      + cg * (rinnovo.prezzo_smc || 0) + (ut === "luce" ? 0 : (rinnovo.fisso_gas_annuo || 0));
    const t = conTot ? (ut === "gas" ? totaleGas(rinnovo.prezzo_smc, rinnovo.fisso_gas_annuo, cg, ambito)
      : ut === "luce" ? totaleLuce(rinnovo.prezzo_kwh, rinnovo.fisso_luce_annuo, cl)
      : totaleLuce(rinnovo.prezzo_kwh, rinnovo.fisso_luce_annuo, cl) + totaleGas(rinnovo.prezzo_smc, rinnovo.fisso_gas_annuo, cg, ambito)) : c;
    const pr = document.createElement("p");
    pr.innerHTML = `🔁 <b>Se resti con Octopus</b> al prezzo di oggi (Fissa 12M): bolletta stimata <b>€${Math.round(t)}/anno</b>.`;
    el.appendChild(pr);
  }
  verdetto(bestL[0], bestG[0]);
  [el, full].forEach((cont) => {
    const av = document.createElement("p");
    av.className = "mut";
    av.innerHTML = notaHtml;
    cont.appendChild(av);
  });
  const p = document.createElement("p");
  p.className = "mut";
  p.textContent = `Bolletta stimata = energia + quota + oneri di rete, accise e IVA (parametri ufficiali ARERA del ${arera.data}). Il confronto tra offerte usa solo la parte che cambia (energia + quota).`;
  full.appendChild(p);
}

const PROFILI = {
  single: { luce: 1400, gas: 400 },
  coppia: { luce: 2000, gas: 800 },
  famiglia: { luce: 2700, gas: 1400 },
};

function classificaMercato() {
  const el = $("mercato-out");
  if (!arera.luce.length && !arera.gas.length) { el.innerHTML = '<p class="mut">Dati in caricamento…</p>'; return; }
  const pr = PROFILI[$("mercato-profilo").value] || PROFILI.famiglia;
  const pun = num($("pun").value) ?? arera.pun_rif, psv = num($("psv").value) ?? arera.psv_rif;
  const ft = $("arera-tipo").value, q = $("arera-q").value.trim().toLowerCase();
  const noDep = $("arera-nodep").checked, verde = $("arera-verde").checked;
  const noti = $("arera-noti").checked, ambito = $("arera-ambito").value || "a2";
  const conTot = !!(arera.parametri.E && Object.keys(arera.parametri.E).length);
  const eGrande = (o) => GRANDI.some((g) => (o.venditore || "").toLowerCase().includes(g));
  const filtra = (o) => (ft === "tutte" || o.tipo_prezzo === ft)
    && (!q || (o.venditore + " " + o.nome).toLowerCase().includes(q))
    && (!noDep || o.senza_deposito) && (!verde || o.verde_nome)
    && (!noti || eGrande(o));
  const rank = (lista, prezzo, cons, totFn) => lista.filter(filtra)
    .map((o) => { const p = prezzo(o); return p == null ? null : { o, p, costo: +(cons * p + o.quota_fissa_annua).toFixed(2) }; })
    .filter(Boolean).map((r) => ({ ...r, tot: totFn ? totFn(r.p, r.o.quota_fissa_annua) : 0 }))
    .sort((a, b) => a.costo - b.costo).slice(0, 3);
  el.innerHTML = "";
  const h1 = document.createElement("h2");
  h1.textContent = `Luce (${pr.luce} kWh/anno)`;
  el.appendChild(h1);
  tabellaArera(el, rank(arera.luce, (o) => pkArera(o, "fasce", 33, 31, 36, pun), pr.luce, (p, qu) => totaleLuce(p, qu, pr.luce)), "kWh", conTot);
  const h2 = document.createElement("h2");
  h2.textContent = `Gas (${pr.gas} Smc/anno)`;
  el.appendChild(h2);
  tabellaArera(el, rank(arera.gas, (o) => pgArera(o, psv), pr.gas, (p, qu) => totaleGas(p, qu, pr.gas, ambito)), "Smc", conTot);
}

function aggiornaBarraDb(extra) {
  const b = $("dbbar");
  if (!b) return;
  b.textContent = arera.luce.length
    ? `Database ARERA aggiornato al ${dataIt(arera.data)} (${arera.luce.length + arera.gas.length} offerte)${extra || ""}`
    : "Database ARERA non caricato.";
}

async function verificaAggiornamenti() {
  const b = $("dbbar");
  const istr = "Per aggiornare, da PC esegui: python aggiorna_offerte_arera.py --inline arera_data.js e ricarica la pagina.";
  try {
    const r = await fetch("https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page", { cache: "no-store" });
    if (!r.ok) throw 0;
    const t = await r.text();
    let max = "";
    const re = /PO_Offerte_[EG]_MLIBERO_(\d{8})/g;
    let m;
    while ((m = re.exec(t))) if (m[1] > max) max = m[1];
    if (!max) throw 0;
    const mia = (arera.data || "").replaceAll("-", "");
    if (max > mia) {
      b.textContent = `C'è un aggiornamento! Dati online al ${max.slice(6)}/${max.slice(4, 6)}/${max.slice(0, 4)}, tu hai quelli del ${dataIt(arera.data)}. ${istr}`;
    } else {
      b.textContent = `Hai già gli ultimi dati ARERA (${dataIt(arera.data)}). Ricontrolla tra qualche giorno.`;
    }
  } catch {
    b.textContent = `Controllo non riuscito dal browser (serve connessione al Portale Offerte). ${istr}`;
  }
}

function classificaFinale(el, bestL, bestG, conTot) {
  const val = (r) => (arera.conTot === false ? r.costo : r.tot);
  const col = conTot ? "Bolletta stimata/anno" : "Costo energia/anno";
  const perVend = {};
  bestL.forEach((r) => {
    const k = (r.o.venditore || "").toLowerCase();
    if (!perVend[k]) perVend[k] = {};
    if (!perVend[k].l) perVend[k].l = r;
  });
  bestG.forEach((r) => {
    const k = (r.o.venditore || "").toLowerCase();
    if (!perVend[k]) perVend[k] = {};
    if (!perVend[k].g) perVend[k].g = r;
  });
  const singoli = Object.values(perVend).filter((v) => v.l && v.g)
    .map((v) => ({ vend: v.l.o.venditore, nl: v.l.o.nome, ng: v.g.o.nome, tot: val(v.l) + val(v.g) }))
    .sort((a, b) => a.tot - b.tot).slice(0, 3);
  const combos = [];
  bestL.slice(0, 3).forEach((l) => bestG.slice(0, 3).forEach((g) => {
    if ((l.o.venditore || "").toLowerCase() === (g.o.venditore || "").toLowerCase()) return;
    combos.push({ a: `${l.o.venditore} (${l.o.nome})`, b: `${g.o.venditore} (${g.o.nome})`, tot: val(l) + val(g) });
  }));
  combos.sort((a, b) => a.tot - b.tot);
  const h1 = document.createElement("h2");
  h1.textContent = "Finale: luce e gas con un solo gestore";
  el.appendChild(h1);
  const t1 = document.createElement("table");
  const r1 = document.createElement("tbody");
  singoli.forEach((s, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="${i === 0 ? "best" : ""}">${i + 1}</td><td><b>${s.vend}</b><br><span class="mut">${s.nl} + ${s.ng}</span></td><td class="${i === 0 ? "best" : ""}">€${s.tot.toFixed(0)}</td>`;
    r1.appendChild(tr);
  });
  t1.innerHTML = `<thead><tr><th>#</th><th>Gestore unico</th><th>${col}</th></tr></thead>`;
  t1.appendChild(r1);
  el.appendChild(t1);
  const h2 = document.createElement("h2");
  h2.textContent = "Finale: luce e gas con due gestori (mix)";
  el.appendChild(h2);
  const t2 = document.createElement("table");
  const r2 = document.createElement("tbody");
  combos.slice(0, 3).forEach((s, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="${i === 0 ? "best" : ""}">${i + 1}</td><td>Luce: ${s.a}<br>Gas: ${s.b}</td><td class="${i === 0 ? "best" : ""}">€${s.tot.toFixed(0)}</td>`;
    r2.appendChild(tr);
  });
  t2.innerHTML = `<thead><tr><th>#</th><th>Combinazione</th><th>${col}</th></tr></thead>`;
  t2.appendChild(r2);
  el.appendChild(t2);
  const p = document.createElement("p");
  p.className = "mut";
  p.textContent = "Un solo gestore = una bolletta e un'assistenza; due gestori = massimo risparmio ma due contratti.";
  el.appendChild(p);
}

function mostraScadenza() {
  const a = $("alert");
  const trovate = [];
  ["luce", "gas"].forEach((tipo) => {
    const b = bollette.filter((x) => x.tipo === tipo && x.scadenza).sort((x, y) => (x.scadenza < y.scadenza ? -1 : 1))[0];
    if (b) trovate.push({ etichetta: `offerta ${tipo}`, sc: b.scadenza });
  });
  const manuale = ($("mia-scadenza") || {}).value || "";
  if (!trovate.length && manuale) trovate.push({ etichetta: "offerta attuale", sc: manuale });
  if (!trovate.length) { a.hidden = true; return; }
  a.hidden = false;
  a.innerHTML = trovate.map(({ etichetta, sc }) => {
    const gg = Math.round((new Date(sc) - new Date()) / 864e5);
    if (!Number.isFinite(gg)) return `La tua ${etichetta} scade il ${dataIt(sc)}.`;
    return gg < 0 ? `<b class="warn">⚠ La tua ${etichetta} è SCADUTA il ${dataIt(sc)}.</b>`
      : gg < 60 ? `<b class="warn">⚠ La tua ${etichetta} scade tra ${gg} giorni (${dataIt(sc)}): confronta ora le alternative.</b>`
      : `La tua ${etichetta} scade tra ${gg} giorni (${dataIt(sc)}).`;
  }).join("<br>");
}

async function init() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  let viaFile = false;
  try {
    const r = await fetch("offerte.json", { cache: "no-store" });
    if (!r.ok) throw 0;
    const j = await r.json();
    (Array.isArray(j) ? j : j.offerte || []).forEach((o) => offerte.push(o));
  } catch { FALLBACK.forEach((o) => offerte.push(o)); viaFile = true; }
  renderDb();
  const applicaArera = (j2, fonte) => {
    arera.luce = j2.luce || []; arera.gas = j2.gas || [];
    arera.pun_rif = j2.pun_rif || 0; arera.psv_rif = j2.psv_rif || 0; arera.data = j2.generato || "";
    arera.parametri = j2.parametri || { E: {}, G: {} };
    if (arera.pun_rif) $("pun").value = arera.pun_rif;
    if (arera.psv_rif) $("psv").value = arera.psv_rif;
    $("stato-arera").textContent = `${arera.luce.length + arera.gas.length} offerte del ${arera.data}${fonte}`;
    aggiornaBarraDb(fonte);
    classificaMercato();
  };
  try {
    const r2 = await fetch("offerte_arera.json", { cache: "no-store" });
    if (!r2.ok) throw 0;
    applicaArera(await r2.json(), viaFile ? " (offline)" : "");
    mostraScadenza();
    $("arera-out").textContent = "Dati pronti: carica le bollette al punto 1.";
  } catch {
    if (window.ARERA_DATA && window.ARERA_DATA.luce) {
      applicaArera(window.ARERA_DATA, " (inclusi)");
      mostraScadenza();
      $("arera-out").textContent = "Dati pronti: carica le bollette al punto 1.";
    } else {
      $("stato-arera").textContent = "dati mancanti: esegui aggiorna_offerte_arera.py --inline";
    }
  }
  const ricalcola = () => { classificaMercato(); if (bollette.length) { confronta(); classificaArera(); } };
  $("mercato-profilo").addEventListener("change", classificaMercato);
  ["utenza", "tariffa", "p-f1", "p-f2", "p-f3", "arera-top", "arera-tipo", "arera-ambito", "pun", "psv"].forEach((id) => {
    $(id).addEventListener("change", ricalcola);
  });
  ["arera-nodep", "arera-verde", "arera-noti"].forEach((id) => {
    $(id).addEventListener("change", ricalcola);
  });
  $("mia-scadenza").addEventListener("change", mostraScadenza);
  let cercaTimer = null;
  $("arera-q").addEventListener("input", () => {
    clearTimeout(cercaTimer);
    cercaTimer = setTimeout(ricalcola, 400);
  });

  $("pdf").addEventListener("change", async (e) => {
    for (const f of e.target.files) {
      try {
        const t = await testoPdf(f);
        const tipo = tipoDaTesto(t, f.name);
        const r = cerca(t, tipo);
        if (r.consumo_annuo && r.spesa_annua) {
          bollette.push({ file: f.name, tipo, consumo_annuo: r.consumo_annuo, spesa_annua: r.spesa_annua, mese: r.mese, consumo_mese: r.consumo_mese, scadenza: r.scadenza });
          if (r.scadenza) mostraScadenza();
          if (r.fasce) {
            $("tariffa").value = "fasce";
            $("p-f1").value = r.fasce[0]; $("p-f2").value = r.fasce[1]; $("p-f3").value = r.fasce[2];
            $("riepilogo").dataset.fasce = `Fasce rilevate da ${f.name}: ${r.fasce.join("/")}`;
          }
        }
      } catch { /* file ignorato */ }
    }
    e.target.value = "";
    renderBollette();
    if (bollette.length) { confronta(); classificaArera(); }
  });

  $("salva").onclick = () => {
    const dati = {
      bollette, utenza: $("utenza").value, tariffa: $("tariffa").value,
      p1: $("p-f1").value, p2: $("p-f2").value, p3: $("p-f3").value,
      scadenza: $("mia-scadenza").value,
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dati)], { type: "application/json" }));
    a.download = "ricerca.json";
    a.click();
  };

  $("carica").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        bollette.length = 0;
        (d.bollette || []).forEach((b) => bollette.push(b));
        if (d.utenza) $("utenza").value = d.utenza;
        if (d.tariffa) $("tariffa").value = d.tariffa;
        if (d.p1) { $("p-f1").value = d.p1; $("p-f2").value = d.p2; $("p-f3").value = d.p3; }
        if (d.scadenza) { $("mia-scadenza").value = d.scadenza; mostraScadenza(); }
        renderBollette();
        if (bollette.length) { confronta(); classificaArera(); }
      } catch { /* file non valido */ }
    };
    rd.readAsText(f);
    e.target.value = "";
  });

  $("aggiungi").onclick = () => {
    const tipo = ($("m-tipo").value || "").toLowerCase().startsWith("g") ? "gas" : "luce";
    const c = +$("m-consumo").value, s = +$("m-spesa").value;
    if (c > 0 && s > 0) {
      bollette.push({ file: "manuale", tipo, consumo_annuo: c, spesa_annua: s });
      renderBollette();
      confronta(); classificaArera();
    }
  };

  $("reset").onclick = () => {
    bollette.length = 0;
    ultimo = [];
    $("pdf").value = "";
    $("mia-scadenza").value = "";
    $("alert").hidden = true;
    delete $("riepilogo").dataset.fasce;
    renderBollette();
    $("verdetto").classList.add("mut");
    $("verdetto").textContent = "Qui comparirà la risposta: quale offerta ti conviene e quanto risparmi.";
    $("arera-out").innerHTML = "";
    $("arera-full").innerHTML = '<p class="mut">Carica le bollette al punto 1 e il confronto appare da solo.</p>';
    $("out").textContent = "Verrà compilata insieme al risultato.";
  };

  $("demo").onclick = () => {
    bollette.length = 0;
    bollette.push({ file: "demo", tipo: "luce", consumo_annuo: 2519, spesa_annua: 685.09, scadenza: "2026-10-31" });
    bollette.push({ file: "demo", tipo: "gas", consumo_annuo: 801, spesa_annua: 902.86, scadenza: "2026-10-31" });
    $("tariffa").value = "fasce";
    $("p-f1").value = 20; $("p-f2").value = 34; $("p-f3").value = 45;
    $("riepilogo").dataset.fasce = "Ripartizione fasce 20/34/45 dalle tue letture";
    renderBollette();
    mostraScadenza();
    confronta(); classificaArera();
  };

  $("stampa").onclick = () => window.print();
  $("aggiorna-db").onclick = verificaAggiornamenti;
  $("csv").onclick = () => {
    if (!ultimo.length) return;
    const rows = [["pos", "offerta", "materia_luce", "materia_gas", "fisso_luce", "fisso_gas", "costo_annuo", "risparmio"]];
    ultimo.forEach((r, i) => rows.push([i + 1, r.o.nome, r.pk.toFixed(4), r.pg.toFixed(4), r.fl, r.fg, r.costo.toFixed(2), r.risp.toFixed(2)]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((x) => x.join(",")).join("\n")], { type: "text/csv" }));
    a.download = "top-offerte.csv";
    a.click();
  };
  renderBollette();
}

init();
