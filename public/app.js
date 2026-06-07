/* =============================================================================
 * app.js — UI-logica: bestand inlezen, analyseren, tonen, opslaan, lijst.
 * ========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let current = null; // laatste analyse-resultaat

  /* ---- labels voor de afgeleide velden -------------------------------------- */
  const FIELD_LABELS = {
    soh: 'SOH (gezondheid)',
    pack_voltage: 'Packspanning (live)',
    cell_high: 'Hoogste celspanning',
    cell_low: 'Laagste celspanning',
    cell_diff: 'Celverschil',
    percentage_7c1: 'Percentage (kandidaat)',
    signal_799: 'Signaal 799',
    vin: 'VIN',
  };

  const confChipClass = (c) =>
    c === 'laag' ? 'laag' : c === 'zeer laag' ? 'zeer' : 'nvt';

  /* ---- render --------------------------------------------------------------- */
  function fmtVal(f) {
    if (f.value === null || f.value === undefined) return 'onbekend';
    return f.unit ? `${f.value} ${f.unit}` : `${f.value}`;
  }

  function render(res) {
    const s = res.raw_stats;
    const d = res.decoded;

    $('cVehicle').textContent = res.vehicle || 'Onbekend';
    $('cFile').textContent = res.source_filename || '—';
    $('cDecoder').textContent = res.decoder_id;
    $('cVin').textContent = d.vin && d.vin.value ? d.vin.value : 'onbekend';

    const soh = d.soh;
    if (soh && soh.value !== null) {
      $('cSohBig').textContent = soh.value + '%';
      $('cSohBig').classList.remove('unknown');
    } else {
      $('cSohBig').textContent = 'onbekend';
      $('cSohBig').classList.add('unknown');
    }

    $('sFrames').textContent = s.frame_count;
    $('sIds').textContent = s.can_ids.length + ' (' + s.can_ids.join(', ') + ')';
    $('sDur').textContent = s.duration_s + ' s';
    $('sSpan').textContent = (s.t_start || '—') + ' → ' + (s.t_end || '—');
    $('sErr').textContent = s.parse_errors;

    // velden-tabel
    const body = $('fieldsBody');
    body.innerHTML = '';
    for (const key of Object.keys(d)) {
      const f = d[key];
      const tr = document.createElement('tr');
      const known = f.value !== null && f.value !== undefined;
      tr.innerHTML =
        `<td><strong>${FIELD_LABELS[key] || key}</strong></td>` +
        `<td class="${known ? '' : 'stat-unknown'}">${fmtVal(f)}</td>` +
        `<td><code>${f.source || '—'}</code></td>` +
        `<td><span class="chip ${confChipClass(f.confidence)}">${f.confidence}</span></td>`;
      body.appendChild(tr);
    }

    $('result').classList.remove('hidden');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---- bestand verwerken ---------------------------------------------------- */
  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        current = window.CAN.analyze(e.target.result, file.name);
        render(current);
      } catch (err) {
        alert('Kon bestand niet verwerken: ' + err.message);
        console.error(err);
      }
    };
    // CAN-logs bevatten latin-1 tekens (åÿ) — lees als ISO-8859-1
    reader.readAsText(file, 'ISO-8859-1');
  }

  /* ---- opgeslagen records --------------------------------------------------- */
  async function refreshRecords() {
    const wrap = $('records');
    const recs = await window.Storage.list();
    if (!recs.length) {
      wrap.innerHTML = '<p class="muted">Nog niets opgeslagen.</p>';
      return;
    }
    wrap.innerHTML = '';
    for (const r of recs) {
      const sohF = r.decoded && r.decoded.soh;
      const soh = sohF && sohF.value !== null ? sohF.value + '% SOH' : 'SOH onbekend';
      const div = document.createElement('div');
      div.className = 'record';
      div.innerHTML =
        `<div><div class="r-main">${r.vehicle || 'Onbekend'} · ${soh}</div>` +
        `<div class="r-meta">${r.source_filename || '—'} · ${r.raw_stats.frame_count} frames · ` +
        `${new Date(r.uploaded_at).toLocaleString('nl-NL')}</div></div>` +
        `<button class="r-del" data-id="${r.id}">verwijderen</button>`;
      wrap.appendChild(div);
    }
    wrap.querySelectorAll('.r-del').forEach((b) =>
      b.addEventListener('click', async () => {
        await window.Storage.remove(b.dataset.id);
        refreshRecords();
      })
    );
  }

  /* ---- events --------------------------------------------------------------- */
  function init() {
    $('modeBadge').textContent =
      window.Storage.mode === 'firebase' ? 'online (Firebase)' : 'offline modus';

    const dz = $('dropzone');
    const input = $('fileInput');

    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleFile(input.files[0]));

    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); })
    );
    dz.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(file);
    });

    $('saveBtn').addEventListener('click', async () => {
      if (!current) return;
      await window.Storage.add(JSON.parse(JSON.stringify(current)));
      $('saveBtn').textContent = '✓ Opgeslagen';
      setTimeout(() => ($('saveBtn').textContent = '💾 Opslaan in database'), 1500);
      refreshRecords();
    });

    refreshRecords();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
