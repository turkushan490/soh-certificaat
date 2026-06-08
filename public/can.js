/* =============================================================================
 * can.js — CAN-bus logbestand parser + batterij-decoder
 * -----------------------------------------------------------------------------
 * Alle gegevens worden UITSLUITEND uit het .txt-bestand afgeleid.
 *
 * Eerlijkheid boven mooidoenerij:
 *  - "raw_stats"  = 100% betrouwbaar, direct uit het bestand geteld.
 *  - "decoded"    = experimentele afleidingen met een confidence-label.
 *                   Velden die niet betrouwbaar af te leiden zijn -> null
 *                   (de GUI toont die als "onbekend / niet in logbestand").
 *
 * Onderzoek (BMW 3-serie 330e, bestand bmw-3-serie-330e-2021.txt):
 *  Het bestand is een PASSIEVE opname (broadcast). De certificaat-getallen
 *  (SOH 89%, packspanning 341,96V, cel 3,571/3,553V) staan er NIET letterlijk
 *  in. Wel aanwezige ID's: 130, 3C, 799, 7C1, 7C3, 7C7, 7C8, 7C9, 7D3.
 *  Kandidaat-signalen (lage zekerheid) zijn gedocumenteerd in de decoder
 *  hieronder, met bron-byte erbij zodat ze later te verifiëren zijn.
 * ========================================================================== */

(function (global) {
  'use strict';

  /* --------------------------------------------------------------------------
   * 1) PARSER
   * Regelformaat (kolommen, whitespace-gescheiden):
   *   HH:MM:SS.mmmm   <dlc>   <CAN-ID hex>   <byte0..byteN hex>   <ascii>
   * Voorbeeld:
   *   20:42:56.7177    8    3C    63 5E 01 02 00 00 E5 FF    c^....åÿ
   * ------------------------------------------------------------------------ */
  const HEX_BYTE = /^[0-9A-Fa-f]{2}$/;
  const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d+)$/;
  const ID_RE = /^(0x)?[0-9A-Fa-f]{1,8}$/;

  function parseTimeToSeconds(tok) {
    if (tok == null) return null;
    const m = TIME_RE.exec(tok);
    if (m) {
      const frac = parseFloat('0.' + m[4]);
      return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + frac;
    }
    if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok); // kale seconden
    return null;
  }

  const normId = (s) => s.replace(/^0x/i, '').toUpperCase();
  const isInt08 = (s) => /^\d+$/.test(s) && +s >= 0 && +s <= 8;

  // Strategie 1: DLC-verankerd "… [tijd] <DLC> <ID> <byte0..byteN> [ascii]"
  // Werkt ook met extra kolommen ervoor (regelnummer, kanaal, Rx/Tx, enz.)
  function parseDlcAnchored(tokens) {
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (!isInt08(tokens[i])) continue;
      const dlc = +tokens[i];
      if (dlc < 1) continue;
      const idTok = tokens[i + 1];
      if (!ID_RE.test(idTok)) continue;
      const data = tokens.slice(i + 2, i + 2 + dlc);
      if (data.length !== dlc || !data.every((b) => HEX_BYTE.test(b))) continue;
      const tSec = i >= 1 ? parseTimeToSeconds(tokens[i - 1]) : null;
      return { t: i >= 1 ? tokens[i - 1] : '', tSec, id: normId(idTok), dlc,
        bytes: data.map((b) => parseInt(b, 16)) };
    }
    return null;
  }

  // Strategie 2: candump-stijl "… <ID>#<HEXDATA>"
  function parseCandump(tokens, line) {
    const m = /(^|[\s(])((?:0x)?[0-9A-Fa-f]{1,8})#([0-9A-Fa-f]*)/.exec(line);
    if (!m) return null;
    const hex = m[3];
    if (hex.length % 2 !== 0) return null;
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    const tSec = parseTimeToSeconds(tokens[0]);
    return { t: tSec !== null ? tokens[0] : '', tSec, id: normId(m[2]), dlc: bytes.length, bytes };
  }

  // Strategie 3 (laatste redmiddel): langste rij van 2-hex tokens = data,
  // het token ervoor = ID.
  function parseGeneric(tokens) {
    let best = null;
    for (let i = 0; i < tokens.length; i++) {
      if (!HEX_BYTE.test(tokens[i])) continue;
      let j = i;
      while (j < tokens.length && HEX_BYTE.test(tokens[j])) j++;
      if (!best || j - i > best.len) best = { start: i, len: j - i };
      i = j;
    }
    if (!best || best.len < 2) return null;
    const idIdx = best.start - 1;
    if (idIdx < 0 || !ID_RE.test(tokens[idIdx])) return null;
    const data = tokens.slice(best.start, best.start + best.len);
    const tSec = idIdx >= 1 ? parseTimeToSeconds(tokens[idIdx - 1]) : null;
    return { t: idIdx >= 1 ? tokens[idIdx - 1] : '', tSec, id: normId(tokens[idIdx]),
      dlc: data.length, bytes: data.map((b) => parseInt(b, 16)) };
  }

  /**
   * Parse ruwe logtekst -> { frames, errors, lineCount, format }
   * Probeert meerdere veelgebruikte CAN-logformaten.
   */
  function parseLog(text) {
    const frames = [];
    let errors = 0;
    const lines = text.split(/\r?\n/);
    const counts = { dlc: 0, candump: 0, generic: 0 };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const tokens = line.split(/\s+/);
      let fr = parseDlcAnchored(tokens);
      if (fr) counts.dlc++;
      if (!fr) { fr = parseCandump(tokens, line); if (fr) counts.candump++; }
      if (!fr) { fr = parseGeneric(tokens); if (fr) counts.generic++; }
      if (fr) frames.push(fr);
      else errors++;
    }
    const format = counts.candump > counts.dlc && counts.candump > counts.generic
      ? 'candump' : counts.generic > counts.dlc ? 'generiek' : 'standaard';
    return { frames, errors, lineCount: lines.length, format };
  }

  /* --------------------------------------------------------------------------
   * 2) RAW STATS (betrouwbaar)
   * ------------------------------------------------------------------------ */
  function rawStats(parsed) {
    const frames = parsed.frames;
    const byId = {};
    let tMin = Infinity, tMax = -Infinity;
    for (const f of frames) {
      byId[f.id] = (byId[f.id] || 0) + 1;
      if (f.tSec < tMin) tMin = f.tSec;
      if (f.tSec > tMax) tMax = f.tSec;
    }
    const ids = Object.keys(byId).sort();
    const duration = frames.length ? +(tMax - tMin).toFixed(3) : 0;
    return {
      frame_count: frames.length,
      parse_errors: parsed.errors,
      can_ids: ids,
      can_id_counts: byId,
      duration_s: duration,
      t_start: frames.length ? frames[0].t : null,
      t_end: frames.length ? frames[frames.length - 1].t : null,
      format: parsed.format || 'standaard',
    };
  }

  /* --------------------------------------------------------------------------
   * 3) DECODER-REGISTER (uitbreidbaar per automodel)
   *    Elke decoder krijgt de geparste frames + raw stats en geeft:
   *      { model, fields: { <key>: {value, unit, confidence, source, note} } }
   * ------------------------------------------------------------------------ */
  const decoders = [];
  function registerDecoder(d) { decoders.push(d); }

  // helper: laatste / gemiddelde waarde van een byte op positie i voor een ID
  function framesFor(parsed, id) { return parsed.frames.filter(f => f.id === id); }
  function field(value, unit, confidence, source, note) {
    return { value: value === undefined ? null : value, unit: unit || '', confidence, source: source || '', note: note || '' };
  }

  /* ---- Model: BMW G20/G21 330e PHEV (en aanverwant) -------------------------
   * Herkenning: aanwezigheid van de diagnostische broadcast-ID's 7C1/7C3/7C7.
   * LET OP: confidences zijn bewust laag/experimenteel. Pas de mapping aan
   * zodra er logs met diagnose-vraag/antwoord of meer modellen zijn.
   * ------------------------------------------------------------------------ */
  registerDecoder({
    id: 'bmw_g20_phev',
    label: 'BMW 3-serie 330e (PHEV)',
    matches(parsed, stats) {
      // Alleen een PASSIEVE opname: 7Cx-broadcasts aanwezig, maar GEEN actieve
      // UDS-diagnose (6F1). Bestanden met 6F1 horen bij bmw_uds.
      if (stats.can_ids.includes('6F1')) return false;
      const need = ['7C1', '7C3', '7C7'];
      return need.every(id => stats.can_ids.includes(id));
    },
    decode(parsed /*, stats */) {
      const fields = {};

      // -- Stabiele waarde uit 7C3 b2:b3 (BE) ~3181-3182. Betekenis ONBEVESTIGD.
      //    (Eerder als "packspanning ÷10" gelezen, maar dat is niet te valideren
      //     tegen het certificaat; daarom nu neutraal als ruw signaal getoond.)
      const f7c3 = framesFor(parsed, '7C3');
      if (f7c3.length) {
        const raw = f7c3.map(f => (f.bytes[2] << 8) | f.bytes[3]);
        const avg = Math.round(raw.reduce((a, b) => a + b, 0) / raw.length);
        fields.raw_7c3 = field(avg, '', 'zeer laag', '7C3 b2:b3 (BE)',
          'Stabiele ruwe waarde, grootheid onbevestigd (mogelijk een spanning/temperatuur).');
      }

      // -- Ruw signaal uit 7C1 b6 (0x63=99 / 0x43-44). Betekenis ONBEVESTIGD.
      const f7c1 = framesFor(parsed, '7C1');
      if (f7c1.length) {
        const last = f7c1[f7c1.length - 1].bytes[6];
        fields.raw_7c1 = field(last, '', 'zeer laag', '7C1 b6',
          'Ruw signaal; betekenis onbevestigd.');
      }

      // -- Velden die NIET uit een passieve opname af te leiden zijn -> onbekend.
      //    Deze komen normaal uit een actieve diagnose (UDS request/response).
      const note = 'Niet aanwezig in passieve CAN-opname; vereist een diagnose-log (UDS).';
      fields.soh = field(null, '%', 'n.v.t.', '—', note);
      fields.pack_voltage = field(null, 'V', 'n.v.t.', '—', note);
      fields.cell_high = field(null, 'V', 'n.v.t.', '—', note);
      fields.cell_low = field(null, 'V', 'n.v.t.', '—', note);
      fields.cell_diff = field(null, 'mV', 'n.v.t.', '—', note);
      fields.vin = field(null, '', 'n.v.t.', '—', note);

      return { model: 'BMW 3-serie 330e (PHEV)', fields };
    },
  });

  /* ---- BMW UDS-diagnose decoder (rijk bestand met 6F1 + 6xx) ----------------
   * Herkent een actieve diagnose-uitlezing: tester 6F1 vraagt DID's op
   * (22 <DID>), ECU's antwoorden op 0x6xx met (62 <DID> <data>), vaak in
   * meerdere ISO-TP frames. We zetten die weer samen en lezen de parameters.
   * ------------------------------------------------------------------------ */
  const h2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

  // Zoek in de DID-responses een volledige cel-array (N cellen × 2 bytes in mV).
  // Geeft {hi, lo, n, cells} in mV, of null.
  function detectCellArray(dids) {
    for (const k in dids) {
      const pl = dids[k];
      if (pl.length < 40 || pl.length % 2) continue;
      const vals = [];
      for (let i = 0; i < pl.length; i += 2) vals.push((pl[i] << 8) | pl[i + 1]);
      const inRange = vals.filter((v) => v >= 2500 && v <= 4300);
      if (inRange.length < 20 || inRange.length < vals.length * 0.6) continue;
      // Echte cellen liggen dicht bij elkaar -> filter naar de hoofd-cluster
      // (sommige DID's bevatten ook opvul-/historie-waarden die geen cel zijn).
      const sorted = [...inRange].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const cells = inRange.filter((v) => Math.abs(v - median) <= 150);
      if (cells.length < 20) continue;
      return { hi: Math.max(...cells), lo: Math.min(...cells), n: cells.length, cells };
    }
    return null;
  }

  // Merk/model afleiden uit de VIN (WMI = wereldfabrikant-code).
  // Brede dekking voor grote EV/hybride-merken. 3-tekens WMI; anders 2-tekens fallback.
  const WMI_MAP = {
    // BMW / Mini
    WBY: 'BMW i3', WBA: 'BMW', WBS: 'BMW M', WBX: 'BMW X', WBN: 'BMW',
    WB1: 'BMW', '4US': 'BMW', '5UX': 'BMW X', WMW: 'Mini Cooper',
    // Volvo / Polestar
    YV1: 'Volvo', YV4: 'Volvo XC', LYV: 'Volvo', YV2: 'Volvo', LPS: 'Polestar', YSM: 'Polestar',
    // Tesla
    '5YJ': 'Tesla', '7SA': 'Tesla', LRW: 'Tesla', XP7: 'Tesla', '7G2': 'Tesla',
    // Nissan
    '1N4': 'Nissan', SJN: 'Nissan', JN1: 'Nissan', JN8: 'Nissan', '5N1': 'Nissan',
    // Hyundai / Kia / Genesis
    KMH: 'Hyundai', TMA: 'Hyundai', KM8: 'Hyundai', '5NM': 'Hyundai', NLH: 'Hyundai',
    KNA: 'Kia', KND: 'Kia', U5Y: 'Kia', '3KP': 'Kia', KNE: 'Kia', '5XY': 'Kia', KMU: 'Genesis',
    // VW-groep
    WVW: 'Volkswagen', WVG: 'Volkswagen', '1VW': 'Volkswagen', '3VW': 'Volkswagen', WV1: 'Volkswagen', WV2: 'Volkswagen',
    WAU: 'Audi', WA1: 'Audi', TRU: 'Audi', TMB: 'Škoda', TMP: 'Škoda', VSS: 'SEAT/Cupra', VSE: 'SEAT/Cupra',
    // Mercedes
    W1K: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz',
    '4JG': 'Mercedes-Benz', W1N: 'Mercedes-Benz', W1V: 'Mercedes-Benz', WME: 'Smart', W1A: 'Smart',
    // Stellantis (PSA/FCA)
    VF1: 'Renault', VF2: 'Renault', VF3: 'Peugeot', VR3: 'Peugeot', VF7: 'Citroën', VR7: 'Citroën',
    VR1: 'DS', W0L: 'Opel', W0V: 'Opel', ZFA: 'Fiat', ZAR: 'Alfa Romeo',
    // JLR
    SAD: 'Jaguar', SAJ: 'Jaguar', SAL: 'Land Rover',
    // Porsche
    WP0: 'Porsche', WP1: 'Porsche',
    // Japans / overig
    JTD: 'Toyota', JTM: 'Toyota', JTN: 'Toyota', '2T3': 'Toyota', '5TD': 'Toyota', NMT: 'Toyota',
    JTH: 'Lexus', '2T2': 'Lexus', JHM: 'Honda', SHH: 'Honda', '1HG': 'Honda', JHL: 'Honda',
    JM1: 'Mazda', JMZ: 'Mazda', JF1: 'Subaru', JF2: 'Subaru', JA3: 'Mitsubishi', JMB: 'Mitsubishi',
    LSJ: 'MG', LGX: 'BYD', LC0: 'BYD', '1FA': 'Ford', WF0: 'Ford', NM0: 'Ford',
    '1G1': 'Chevrolet', KL8: 'Chevrolet', '1G6': 'Cadillac',
  };
  // 2-tekens fallback voor merken met veel WMI-varianten
  const WMI2_MAP = { YV: 'Volvo', WB: 'BMW', WM: 'Mini', SA: 'Jaguar/Land Rover', WV: 'Volkswagen',
    WA: 'Audi', WD: 'Mercedes-Benz', W1: 'Mercedes-Benz', KM: 'Hyundai', KN: 'Kia', VF: 'Frans (PSA/Renault)',
    '5Y': 'Tesla', LR: 'Tesla', '1N': 'Nissan', JT: 'Toyota', ZF: 'Fiat' };

  function vinToVehicle(vin) {
    if (!vin || vin.length < 3) return null;
    const w3 = vin.slice(0, 3).toUpperCase();
    if (WMI_MAP[w3]) return WMI_MAP[w3];
    const w2 = vin.slice(0, 2).toUpperCase();
    return WMI2_MAP[w2] || 'Onbekend merk';
  }

  function reassembleUDS(parsed) {
    const state = {}; // per ECU-id: {buf, need}
    const dids = {};  // DID -> payload (eerste voorkomen)
    for (const f of parsed.frames) {
      const id = f.id;
      if (id === '6F1' || !/^6[0-9A-F]{2}$/.test(id)) continue;
      const b = f.bytes;
      if (b.length < 2) continue;
      const st = state[id] || (state[id] = { buf: null, need: 0 });
      const pci = b[1], hi = pci >> 4;
      let msg = null;
      if (hi === 0) {
        msg = b.slice(2, 2 + (pci & 0x0F));
      } else if (hi === 1) {
        st.need = ((pci & 0x0F) << 8) | b[2];
        st.buf = b.slice(3);
        if (st.buf.length >= st.need) { msg = st.buf.slice(0, st.need); st.buf = null; }
      } else if (hi === 2 && st.buf) {
        st.buf = st.buf.concat(b.slice(2));
        if (st.buf.length >= st.need) { msg = st.buf.slice(0, st.need); st.buf = null; }
      }
      if (msg && msg.length >= 3 && msg[0] === 0x62) {
        const did = h2(msg[1]) + h2(msg[2]);
        if (!(did in dids)) dids[did] = msg.slice(3);
      }
    }
    return dids;
  }

  registerDecoder({
    id: 'bmw_uds',
    label: 'BMW UDS-diagnose',
    matches(parsed, stats) {
      return stats.can_ids.includes('6F1');
    },
    decode(parsed) {
      const dids = reassembleUDS(parsed);
      const fields = {};
      const asciiOf = (bs) => bs.map((x) => (x >= 32 && x < 127) ? String.fromCharCode(x) : '').join('');

      // VIN (standaard DID F190)
      if (dids.F190) {
        const vin = asciiOf(dids.F190).replace(/[^A-HJ-NPR-Z0-9]/g, '');
        if (vin.length >= 11) fields.vin = field(vin, '', 'hoog', 'UDS DID F190', 'Uit diagnose (VIN).');
      }

      // Celspanningen: eerst een volledige cel-array (bv. DFA5 = 96 slots, ~80 cellen),
      // anders DID DDBF (twee 16-bit min/max waarden in mV).
      const cellsArr = detectCellArray(dids);
      if (cellsArr) {
        fields.cell_high = field(+(cellsArr.hi / 1000).toFixed(3), 'V', 'hoog', 'UDS cel-array', `${cellsArr.n} cellen.`);
        fields.cell_low = field(+(cellsArr.lo / 1000).toFixed(3), 'V', 'hoog', 'UDS cel-array', `${cellsArr.n} cellen.`);
        fields.cell_diff = field(cellsArr.hi - cellsArr.lo, 'mV', 'hoog', 'UDS cel-array', 'Berekend uit cellen.');
        // packspanning = som van de cellen (komt overeen met Autel "totale spanning")
        fields.pack_voltage = field(+(cellsArr.cells.reduce((a, b) => a + b, 0) / 1000).toFixed(2),
          'V', 'hoog', 'UDS cel-array (som)', `Som van ${cellsArr.n} cellen.`);
      } else if (dids.DDBF && dids.DDBF.length >= 4) {
        const a = (dids.DDBF[0] << 8) | dids.DDBF[1];
        const b = (dids.DDBF[2] << 8) | dids.DDBF[3];
        const hi = Math.max(a, b), lo = Math.min(a, b);
        if (hi > 2000 && hi < 4500) {
          fields.cell_high = field(+(hi / 1000).toFixed(3), 'V', 'gemiddeld', 'UDS DID DDBF', 'Uit diagnose.');
          fields.cell_low = field(+(lo / 1000).toFixed(3), 'V', 'gemiddeld', 'UDS DID DDBF', 'Uit diagnose.');
          fields.cell_diff = field(hi - lo, 'mV', 'gemiddeld', 'UDS DID DDBF', 'Berekend uit cellen.');
        }
      }

      // Packspanning uit dedicated DID DD68/DDB4 (×0,01 V) als er geen cel-array is
      if (!fields.pack_voltage) {
        const pv = dids.DD68 || dids.DDB4;
        if (pv && pv.length >= 2) {
          const volts = +(((pv[0] << 8) | pv[1]) / 100).toFixed(2);
          if (volts > 100 && volts < 500) {
            fields.pack_voltage = field(volts, 'V', 'gemiddeld',
              'UDS DID ' + (dids.DD68 ? 'DD68' : 'DDB4') + ' ×0,01', 'Uit diagnose.');
          }
        }
      }

      // DID DDBC = [SOC, SOH(intern), …] ×10.
      // SOC = 1e waarde (laadstand), SOH = 2e waarde (BMW-interne capaciteit-SOH).
      if (dids.DDBC && dids.DDBC.length >= 4) {
        const soc = ((dids.DDBC[0] << 8) | dids.DDBC[1]) / 10;
        const soh = ((dids.DDBC[2] << 8) | dids.DDBC[3]) / 10;
        if (soc >= 0 && soc <= 100) {
          fields.soc = field(+soc.toFixed(1), '%', 'hoog', 'UDS DID DDBC (1e)', 'Laadstand (SOC).');
        }
        if (soh > 0 && soh <= 110) {
          fields.soh = field(+soh.toFixed(1), '%', 'gemiddeld', 'UDS DID DDBC (2e)',
            'BMW-interne SOH; kan afwijken van Autel-SOH (zie uitleg).');
        }
      }

      // Onbekende-tot-nu velden expliciet markeren
      const note = 'Parameter in diagnose aanwezig maar nog niet gekalibreerd.';
      if (!fields.soh) fields.soh = field(null, '%', 'n.v.t.', '—', note);
      if (!fields.pack_voltage) fields.pack_voltage = field(null, 'V', 'n.v.t.', '—', note);
      if (!fields.vin) fields.vin = field(null, '', 'n.v.t.', '—', 'VIN niet gevonden in diagnose.');

      // merk/model afleiden uit de VIN (WMI = eerste 3 tekens)
      const vinVal = fields.vin && fields.vin.value;
      const model = vinToVehicle(vinVal) || 'BMW/Mini (UDS-diagnose)';

      // alle ruwe DID's meegeven voor latere kalibratie
      const rawDids = {};
      for (const k in dids) rawDids[k] = dids[k].map(h2).join(' ');
      return { model, fields, raw_dids: rawDids };
    },
  });

  /* ---- Volvo UDS-diagnose decoder (extended CAN-ID's, standaard ISO-TP) ------
   * Volvo (bv. XC60 T8) gebruikt 29-bits ID's. De tester vraagt DID's op een
   * 1DD0xxxx-ID; de ECU antwoordt op een extended ID met (62 <DID> <data>).
   * ISO-TP is hier STANDAARD: de PCI staat in byte 0 (geen adresbyte).
   * DID 4806 = volledige cel-array (N cellen × 2 bytes in mV) -> hieruit halen
   * we hoogste/laagste cel, celverschil en packspanning (som).
   * ------------------------------------------------------------------------ */
  // Antwoord-ID's: extended (7-8 hex, bv. Volvo) of standaard OBD-II 7E8-7EF (Jaguar e.a.)
  const isStdRespId = (id) => /^[0-9A-F]{7,8}$/.test(id) || /^7E[89A-F]$/.test(id);

  function reassembleStdUDS(parsed) {
    const state = {};
    const msgs = [];
    for (const f of parsed.frames) {
      if (!isStdRespId(f.id)) continue;
      const b = f.bytes;
      if (!b.length) continue;
      const st = state[f.id] || (state[f.id] = { buf: null, need: 0 });
      const pci = b[0], hi = pci >> 4;
      let msg = null;
      if (hi === 0) {
        msg = b.slice(1, 1 + (pci & 0x0F));
      } else if (hi === 1) {
        st.need = ((pci & 0x0F) << 8) | b[1];
        st.buf = b.slice(2);
        if (st.buf.length >= st.need) { msg = st.buf.slice(0, st.need); st.buf = null; }
      } else if (hi === 2 && st.buf) {
        st.buf = st.buf.concat(b.slice(1));
        if (st.buf.length >= st.need) { msg = st.buf.slice(0, st.need); st.buf = null; }
      }
      if (msg && msg.length >= 2) msgs.push(msg);
    }
    return msgs;
  }

  registerDecoder({
    id: 'obd_uds',
    label: 'OBD-II / UDS-diagnose',
    matches(parsed, stats) {
      // geen BMW-tester (6F1); wel extended ID's of OBD-II 7E8-stijl antwoorden
      return !stats.can_ids.includes('6F1') && stats.can_ids.some(isStdRespId);
    },
    decode(parsed) {
      const msgs = reassembleStdUDS(parsed);
      const asciiOf = (bs) => bs.map((x) => (x >= 32 && x < 127) ? String.fromCharCode(x) : '').join('');
      const cleanVin = (s) => s.replace(/[^A-HJ-NPR-Z0-9]/g, '');

      // splits berichten: 0x62 = ReadDataByID-respons (DID's), 0x49 = OBD Mode 09
      const dids = {};
      let modeVin = null;
      for (const m of msgs) {
        if (m[0] === 0x62 && m.length >= 3) {
          const did = h2(m[1]) + h2(m[2]);
          if (!(did in dids)) dids[did] = m.slice(3);
        } else if (m[0] === 0x49 && m[1] === 0x02 && m.length > 3) {
          modeVin = cleanVin(asciiOf(m.slice(3))); // Mode 09 PID 02 = VIN
        }
      }

      const fields = {};

      // Cel-array (N cellen × 2 bytes in mV) -> hoogste/laagste + packspanning (som)
      const ca = detectCellArray(dids);
      if (ca) {
        const pack = ca.cells.reduce((a, b) => a + b, 0) / 1000;
        fields.cell_high = field(+(ca.hi / 1000).toFixed(3), 'V', 'hoog', 'UDS cel-array', `${ca.n} cellen.`);
        fields.cell_low = field(+(ca.lo / 1000).toFixed(3), 'V', 'hoog', 'UDS cel-array', `${ca.n} cellen.`);
        fields.cell_diff = field(ca.hi - ca.lo, 'mV', 'hoog', 'UDS cel-array', 'Berekend uit cellen.');
        fields.pack_voltage = field(+pack.toFixed(2), 'V', 'hoog', 'UDS cel-array (som)', `Som van ${ca.n} cellen.`);
      }

      // Capaciteit (Volvo: DID 4947/F442 ~ energie in Wh) — experimenteel, te bevestigen
      const capDid = dids['4947'] || dids['F442'];
      if (capDid && capDid.length >= 2) {
        const wh = (capDid[0] << 8) | capDid[1];
        if (wh > 3000 && wh < 200000) {
          fields.capacity = field(+(wh / 1000).toFixed(1), 'kWh', 'laag', 'UDS DID 4947', 'Experimenteel, te bevestigen.');
        }
      }

      // VIN: standaard DID F190 of OBD Mode 09
      let vin = null;
      if (dids.F190) vin = cleanVin(asciiOf(dids.F190));
      if ((!vin || vin.length < 11) && modeVin && modeVin.length >= 11) vin = modeVin;
      if (vin && vin.length >= 11) fields.vin = field(vin, '', 'hoog', 'OBD/UDS (VIN)', 'Uit diagnose.');

      if (!fields.soh) fields.soh = field(null, '%', 'n.v.t.', '—', 'SOH-parameter nog niet gekalibreerd voor dit merk.');
      if (!fields.vin) fields.vin = field(null, '', 'n.v.t.', '—', 'VIN niet in deze opname.');

      const rawDids = {};
      for (const k in dids) rawDids[k] = dids[k].length > 40 ? `(${dids[k].length} bytes)` : dids[k].map(h2).join(' ');
      // model: uit VIN; anders heuristiek (extended ID's = Volvo-stijl)
      const hasExt = parsed.frames.some((f) => /^[0-9A-F]{7,8}$/.test(f.id));
      const model = vin ? vinToVehicle(vin) : (hasExt ? 'Volvo (UDS-diagnose)' : 'OBD-II / UDS-diagnose');
      return { model, fields, raw_dids: rawDids };
    },
  });

  /* ---- Generieke fallback-decoder (onbekend model) ------------------------- */
  const genericDecoder = {
    id: 'generic',
    label: 'Onbekend model (generiek)',
    matches() { return true; },
    decode() {
      return {
        model: 'Onbekend model',
        fields: {
          soh: field(null, '%', 'n.v.t.', '—', 'Geen modelspecifieke decoder; SOH niet bepaald.'),
        },
      };
    },
  };

  function pickDecoder(parsed, stats) {
    for (const d of decoders) {
      try { if (d.matches(parsed, stats)) return d; } catch (e) { /* skip */ }
    }
    return genericDecoder;
  }

  /* --------------------------------------------------------------------------
   * 4) HOOFDFUNCTIE: analyseer logtekst -> volledig resultaat
   * ------------------------------------------------------------------------ */
  function analyze(text, filename) {
    const parsed = parseLog(text);
    const stats = rawStats(parsed);
    const decoder = pickDecoder(parsed, stats);
    const decoded = decoder.decode(parsed, stats);
    // eerste niet-lege regels bewaren voor diagnose bij een onbekend formaat
    const sampleLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
    return {
      source_filename: filename || null,
      analyzed_at: new Date().toISOString(),
      decoder_id: decoder.id,
      vehicle: decoded.model,
      raw_stats: stats,
      decoded: decoded.fields,
      raw_dids: decoded.raw_dids || null,
      sample_lines: sampleLines,
    };
  }

  const api = { parseLog, rawStats, analyze, registerDecoder, parseTimeToSeconds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.CAN = api;
})(typeof window !== 'undefined' ? window : globalThis);
