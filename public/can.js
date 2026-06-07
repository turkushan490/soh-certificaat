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

  function parseTimeToSeconds(tok) {
    const m = TIME_RE.exec(tok);
    if (!m) return null;
    const h = +m[1], min = +m[2], s = +m[3];
    const frac = parseFloat('0.' + m[4]);
    return h * 3600 + min * 60 + s + frac;
  }

  /**
   * Parse ruwe logtekst -> { frames:[{t,tSec,id,dlc,bytes}], errors, lineCount }
   */
  function parseLog(text) {
    const frames = [];
    let errors = 0;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const p = line.trim().split(/\s+/);
      if (p.length < 3) { continue; }
      const tSec = parseTimeToSeconds(p[0]);
      const dlc = parseInt(p[1], 10);
      if (tSec === null || !Number.isInteger(dlc) || dlc < 0 || dlc > 8) {
        errors++;
        continue;
      }
      const id = p[2].toUpperCase();
      // de eerstvolgende <dlc> tokens die geldige hex-bytes zijn
      const bytes = [];
      for (let i = 3; i < p.length && bytes.length < dlc; i++) {
        if (HEX_BYTE.test(p[i])) bytes.push(parseInt(p[i], 16));
        else break;
      }
      if (bytes.length !== dlc) { errors++; continue; }
      frames.push({ t: p[0], tSec, id, dlc, bytes });
    }
    return { frames, errors, lineCount: lines.length };
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
      const need = ['7C1', '7C3', '7C7'];
      return need.every(id => stats.can_ids.includes(id));
    },
    decode(parsed /*, stats */) {
      const fields = {};

      // -- Kandidaat live packspanning: ID 7C3, bytes b2:b3 (big-endian)
      //    Geobserveerd ~0x0C6D-0x0C6E = 3181-3182, stabiel.
      //    Hypothese: spanning in 0,1 V -> ~318,2 V (live, ander moment dan
      //    certificaat). LAGE zekerheid.
      const f7c3 = framesFor(parsed, '7C3');
      if (f7c3.length) {
        const raw = f7c3.map(f => (f.bytes[2] << 8) | f.bytes[3]);
        const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
        fields.pack_voltage = field(+(avg / 10).toFixed(1), 'V', 'laag',
          '7C3 b2:b3 (BE) ÷10',
          'Experimentele afleiding van live packspanning; niet de certificaatwaarde.');
      }

      // -- Kandidaat percentage (mogelijk SOC): ID 7C1 byte b6.
      //    Geobserveerd 0x63=99, 0x44=68, 0x43=67. LAGE zekerheid.
      const f7c1 = framesFor(parsed, '7C1');
      if (f7c1.length) {
        const last = f7c1[f7c1.length - 1].bytes[6];
        fields.percentage_7c1 = field(last, '%', 'zeer laag',
          '7C1 b6',
          'Mogelijk SOC of een ander percentage; niet bevestigd.');
      }

      // -- Kandidaat percentage 2: ID 799 byte b0 (0x31-0x35 = 49-53).
      const f799 = framesFor(parsed, '799');
      if (f799.length) {
        const vals = f799.map(f => f.bytes[0]);
        const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        fields.signal_799 = field(avg, '', 'zeer laag',
          '799 b0',
          'Stabiel rond 49-53; betekenis onbevestigd (temp/SOC?).');
      }

      // -- Velden die NIET uit dit bestand af te leiden zijn -> null/onbekend.
      fields.soh = field(null, '%', 'n.v.t.', '—',
        'Niet aanwezig in passieve CAN-opname.');
      fields.cell_high = field(null, 'V', 'n.v.t.', '—', 'Niet aanwezig in logbestand.');
      fields.cell_low = field(null, 'V', 'n.v.t.', '—', 'Niet aanwezig in logbestand.');
      fields.cell_diff = field(null, 'mV', 'n.v.t.', '—', 'Niet aanwezig in logbestand.');
      fields.vin = field(null, '', 'n.v.t.', '—', 'Niet aanwezig in deze opname.');

      return { model: 'BMW 3-serie 330e (PHEV)', fields };
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
    return {
      source_filename: filename || null,
      analyzed_at: new Date().toISOString(),
      decoder_id: decoder.id,
      vehicle: decoded.model,
      raw_stats: stats,
      decoded: decoded.fields,
    };
  }

  const api = { parseLog, rawStats, analyze, registerDecoder, parseTimeToSeconds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.CAN = api;
})(typeof window !== 'undefined' ? window : globalThis);
