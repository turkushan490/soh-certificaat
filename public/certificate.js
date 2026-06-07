/* =============================================================================
 * certificate.js — genereert een uitprintbaar batterijcertificaat (PDF via print)
 * -----------------------------------------------------------------------------
 * Opent een nieuw venster met een nette, printvriendelijke certificaat-lay-out
 * en roept window.print() aan -> de gebruiker kiest "Opslaan als PDF" of print.
 * Werkt volledig offline, zonder externe bibliotheken.
 * ========================================================================== */
(function (global) {
  'use strict';

  function val(rec, key) {
    const f = rec.decoded && rec.decoded[key];
    return f && f.value !== null && f.value !== undefined
      ? (f.unit ? `${f.value} ${f.unit}` : `${f.value}`)
      : 'onbekend';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('nl-NL'); } catch (e) { return iso; }
  }

  function sohValue(rec) {
    // handmatige SOH heeft voorrang, anders gedecodeerd
    if (rec.manual && rec.manual.soh != null && rec.manual.soh !== '')
      return Number(rec.manual.soh);
    const f = rec.decoded && rec.decoded.soh;
    return f && f.value !== null ? f.value : null;
  }

  function buildHtml(rec) {
    const s = rec.raw_stats || {};
    const soh = sohValue(rec);
    const sohTxt = soh === null ? 'onbekend' : soh + ' %';
    const sohColor = soh === null ? '#888' : soh >= 80 ? '#1a7f37' : soh >= 60 ? '#bf6a02' : '#cf222e';
    const kenteken = rec.kenteken || '—';
    const vehicle = rec.vehicle || 'Onbekend';
    const mileage = rec.mileage ? Number(rec.mileage).toLocaleString('nl-NL') + ' km' : '—';
    const vin = (rec.decoded && rec.decoded.vin && rec.decoded.vin.value) || '—';
    const note = rec.note || '';

    return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<title>Batterijcertificaat ${kenteken}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a;
         background: #fff; padding: 32px 40px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 3px solid #1f3a52; padding-bottom: 14px; margin-bottom: 20px; }
  .head h1 { font-size: 22px; color: #1f3a52; }
  .head .sub { color: #666; font-size: 12px; margin-top: 3px; }
  .head .kenteken { background: #ffcc00; border: 2px solid #1a1a1a; border-radius: 6px;
                    padding: 6px 14px; font-weight: 700; font-size: 18px; letter-spacing: 1px; }
  .soh-block { display: flex; align-items: center; gap: 20px; background: #f6f8fa;
               border: 1px solid #d0d7de; border-radius: 10px; padding: 18px 22px; margin-bottom: 20px; }
  .soh-big { font-size: 46px; font-weight: 700; line-height: 1; }
  .soh-label { font-size: 13px; color: #555; text-transform: uppercase; letter-spacing: .5px; }
  h2 { font-size: 14px; color: #1f3a52; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d0d7de; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.k { color: #666; width: 42%; }
  td.v { font-weight: 600; }
  .note { background: #fff8e1; border-left: 3px solid #ffcc00; padding: 8px 12px; margin-top: 8px; font-size: 12px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #d0d7de; color: #888; font-size: 11px; }
  .disc { color:#999; font-size: 10px; margin-top: 6px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .noprint { text-align: center; margin-bottom: 16px; }
  .btn { background: #1f3a52; color: #fff; border: none; border-radius: 6px; padding: 9px 18px;
         font-size: 14px; cursor: pointer; }
</style></head><body>
<div class="noprint"><button class="btn" onclick="window.print()">🖨️ Printen / Opslaan als PDF</button></div>

<div class="head">
  <div>
    <h1>🔋 Batterijcertificaat</h1>
    <div class="sub">Geüpload / gescand: ${fmtDate(rec.uploaded_at)}</div>
    <div class="sub">Bronbestand: ${rec.source_filename || '—'}</div>
  </div>
  <div class="kenteken">${kenteken}</div>
</div>

<div class="soh-block">
  <div class="soh-big" style="color:${sohColor}">${sohTxt}</div>
  <div><div class="soh-label">Status van de gezondheid (SOH)</div>
       <div style="color:#666;font-size:12px;margin-top:4px">
       ${soh === null ? 'Niet uit logbestand af te leiden — vul handmatig in.' : 'Opgegeven/afgeleide waarde.'}</div></div>
</div>

<h2>Voertuig</h2>
<table>
  <tr><td class="k">Merk &amp; model</td><td class="v">${vehicle}</td></tr>
  <tr><td class="k">Kenteken</td><td class="v">${kenteken}</td></tr>
  <tr><td class="k">VIN</td><td class="v">${vin}</td></tr>
  <tr><td class="k">Kilometerstand</td><td class="v">${mileage}</td></tr>
</table>

<h2>Hoogspanningsbatterij</h2>
<table>
  <tr><td class="k">Packspanning</td><td class="v">${val(rec, 'pack_voltage')}</td></tr>
  <tr><td class="k">Hoogste celspanning</td><td class="v">${val(rec, 'cell_high')}</td></tr>
  <tr><td class="k">Laagste celspanning</td><td class="v">${val(rec, 'cell_low')}</td></tr>
  <tr><td class="k">Maximaal celverschil</td><td class="v">${val(rec, 'cell_diff')}</td></tr>
</table>

<h2>Bronbestand (CAN-log)</h2>
<table>
  <tr><td class="k">Aantal frames</td><td class="v">${s.frame_count ?? '—'}</td></tr>
  <tr><td class="k">Unieke CAN-ID's</td><td class="v">${(s.can_ids || []).join(', ') || '—'}</td></tr>
  <tr><td class="k">Opnameduur</td><td class="v">${s.duration_s ?? '—'} s</td></tr>
  <tr><td class="k">Tijdspanne</td><td class="v">${s.t_start || '—'} → ${s.t_end || '—'}</td></tr>
  <tr><td class="k">Decoder</td><td class="v">${rec.decoder_id || '—'}</td></tr>
</table>

${note ? `<div class="note"><strong>Notitie:</strong> ${note}</div>` : ''}

<footer>
  SOH Batterij-certificaat · gegenereerd ${fmtDate(new Date().toISOString())}
  <div class="disc">Waarden gemarkeerd als "onbekend" konden niet uit de passieve CAN-opname
  worden afgeleid. SOH/celgegevens vereisen een actieve diagnose-opname of handmatige invoer.</div>
</footer>
</body></html>`;
  }

  function openCertificate(rec) {
    const win = global.open('', '_blank');
    if (!win) { alert('Pop-up geblokkeerd. Sta pop-ups toe om de PDF te maken.'); return; }
    win.document.open();
    win.document.write(buildHtml(rec));
    win.document.close();
  }

  global.Certificate = { openCertificate, buildHtml };
})(typeof window !== 'undefined' ? window : globalThis);
