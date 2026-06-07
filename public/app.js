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
    pack_voltage: 'Packspanning',
    cell_high: 'Hoogste celspanning',
    cell_low: 'Laagste celspanning',
    cell_diff: 'Celverschil',
    vin: 'VIN',
    raw_7c3: 'Ruw signaal 7C3',
    raw_7c1: 'Ruw signaal 7C1',
  };

  /* ---- lijst-status --------------------------------------------------------- */
  const PAGE_SIZE = 25;
  const listState = { search: '', month: '', sort: 'date_desc', page: 1, all: [] };

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

  /* ---- opgeslagen records (zoeken / sorteren / filteren / paginering) -------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function recVin(r) {
    const v = r.decoded && r.decoded.vin;
    return v && v.value ? v.value : '';
  }
  function recMonth(r) { return (r.uploaded_at || '').slice(0, 7); } // YYYY-MM

  function applyFilters() {
    const q = listState.search.trim().toLowerCase();
    let list = listState.all.filter((r) => {
      if (listState.month && recMonth(r) !== listState.month) return false;
      if (!q) return true;
      const hay = [r.vehicle, r.source_filename, recVin(r)].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const cmp = {
      date_desc: (a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''),
      date_asc: (a, b) => (a.uploaded_at || '').localeCompare(b.uploaded_at || ''),
      vehicle_asc: (a, b) => (a.vehicle || '').localeCompare(b.vehicle || ''),
      frames_desc: (a, b) => (b.raw_stats.frame_count || 0) - (a.raw_stats.frame_count || 0),
    }[listState.sort];
    list.sort(cmp);
    return list;
  }

  function populateMonths() {
    const sel = $('monthFilter');
    const months = [...new Set(listState.all.map(recMonth).filter(Boolean))].sort().reverse();
    const cur = listState.month;
    sel.innerHTML = '<option value="">Alle maanden</option>' +
      months.map((m) => {
        const [y, mo] = m.split('-');
        const label = new Date(y, mo - 1, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
        return `<option value="${m}" ${m === cur ? 'selected' : ''}>${label}</option>`;
      }).join('');
  }

  function renderList() {
    const wrap = $('records');
    const pager = $('pager');
    const filtered = applyFilters();
    $('recCount').textContent = listState.all.length;

    if (!listState.all.length) {
      wrap.innerHTML = '<p class="muted">Nog niets opgeslagen.</p>';
      pager.innerHTML = '';
      return;
    }
    if (!filtered.length) {
      wrap.innerHTML = '<p class="muted">Geen metingen gevonden voor deze zoekopdracht.</p>';
      pager.innerHTML = '';
      return;
    }

    const pages = Math.ceil(filtered.length / PAGE_SIZE);
    if (listState.page > pages) listState.page = pages;
    const start = (listState.page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    wrap.innerHTML = '';
    for (const r of slice) {
      const sohF = r.decoded && r.decoded.soh;
      const known = sohF && sohF.value !== null;
      const soh = known ? sohF.value + '%' : 'onbekend';
      const sohCls = known ? (sohF.value >= 80 ? 'stat-good' : sohF.value >= 60 ? 'stat-warn' : 'stat-bad') : 'stat-unknown';
      const div = document.createElement('div');
      div.className = 'record';
      div.dataset.id = r.id;
      div.innerHTML =
        `<div><div class="r-main">${esc(r.vehicle || 'Onbekend')}` +
        (recVin(r) ? ` · ${esc(recVin(r))}` : '') + `</div>` +
        `<div class="r-meta">${esc(r.source_filename || '—')} · ${r.raw_stats.frame_count} frames · ` +
        `${new Date(r.uploaded_at).toLocaleString('nl-NL')}</div></div>` +
        `<div class="r-right"><span class="r-soh ${sohCls}">${soh} SOH</span>` +
        `<button class="r-del" data-del="${r.id}" title="Verwijderen">verwijderen</button></div>`;
      wrap.appendChild(div);
    }

    // klik op record -> detail tonen; klik op verwijderen -> verwijderen
    wrap.querySelectorAll('.record').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.dataset.del) return;
        const rec = listState.all.find((x) => x.id === el.dataset.id);
        if (rec) { current = rec; render(rec); }
      });
    });
    wrap.querySelectorAll('.r-del').forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.Storage.remove(b.dataset.del);
        await refreshRecords();
      })
    );

    // pager
    pager.innerHTML = '';
    if (pages > 1) {
      const mk = (label, page, opts = {}) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        if (opts.active) btn.classList.add('active');
        if (opts.disabled) btn.disabled = true;
        btn.addEventListener('click', () => { listState.page = page; renderList(); });
        return btn;
      };
      pager.appendChild(mk('‹', listState.page - 1, { disabled: listState.page === 1 }));
      const span = document.createElement('span');
      span.className = 'pinfo';
      span.textContent = `pagina ${listState.page} / ${pages} · ${filtered.length} metingen`;
      pager.appendChild(span);
      pager.appendChild(mk('›', listState.page + 1, { disabled: listState.page === pages }));
    }
  }

  async function refreshRecords() {
    listState.all = await window.Storage.list();
    populateMonths();
    renderList();
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
      listState.page = 1;
      refreshRecords();
    });

    // lijst-besturing
    let searchTimer;
    $('searchBox').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        listState.search = e.target.value; listState.page = 1; renderList();
      }, 150);
    });
    $('monthFilter').addEventListener('change', (e) => {
      listState.month = e.target.value; listState.page = 1; renderList();
    });
    $('sortBy').addEventListener('change', (e) => {
      listState.sort = e.target.value; listState.page = 1; renderList();
    });

    refreshRecords();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
