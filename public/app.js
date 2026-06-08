/* =============================================================================
 * app.js — UI-logica: bestand inlezen, analyseren, tonen, opslaan, lijst.
 * ========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let current = null; // laatste analyse-resultaat

  /* ---- certificaat-velden (volgorde, label, eenheid) ------------------------ */
  const CERT_FIELDS = [
    ['soh', 'SOH (gezondheid)', '%'],
    ['soc', 'SOC (laadstand)', '%'],
    ['pack_voltage', 'Packspanning', 'V'],
    ['cell_high', 'Hoogste celspanning', 'V'],
    ['cell_low', 'Laagste celspanning', 'V'],
    ['cell_diff', 'Celverschil', 'mV'],
    ['capacity', 'Bruikbare capaciteit', 'kWh'],
    ['vin', 'VIN', ''],
  ];

  // effectieve waarde van een certificaat-veld: handmatig > gedecodeerd > null
  function effField(rec, key) {
    const m = rec.manual && rec.manual[key];
    if (m != null && m !== '') return { value: m, source: 'ingevuld' };
    const d = rec.decoded && rec.decoded[key];
    if (d && d.value != null) return { value: d.value, source: 'logbestand' };
    return { value: null, source: null };
  }

  /* ---- lijst-status --------------------------------------------------------- */
  const PAGE_SIZE = 25;
  const listState = { search: '', year: '', month: '', day: '', sort: 'date_desc', page: 1, all: [] };

  const confChipClass = (c) =>
    c === 'laag' ? 'laag' : c === 'zeer laag' ? 'zeer' : 'nvt';

  // SOH met voorrang voor handmatige invoer
  function effectiveSoh(rec) {
    if (rec.manual && rec.manual.soh != null && rec.manual.soh !== '')
      return Number(rec.manual.soh);
    const f = rec.decoded && rec.decoded.soh;
    return f && f.value !== null ? f.value : null;
  }

  const numOrNull = (id) => {
    const v = $(id).value.trim();
    return v === '' ? null : Number(v);
  };

  // lees de invoervelden en voeg ze samen in het huidige record
  function collectInputs(rec) {
    rec.kenteken = $('inpKenteken').value.trim().toUpperCase();
    const userVehicle = $('inpVehicle').value.trim();
    rec._userVehicle = userVehicle;
    if (userVehicle) rec.vehicle = userVehicle;
    rec.mileage = numOrNull('inpMileage');
    rec.note = $('inpNote').value.trim();

    const cellHi = numOrNull('inpCellHi');
    const cellLo = numOrNull('inpCellLo');
    let cellDiff = numOrNull('inpCellDiff');
    // celverschil automatisch berekenen uit hoog - laag (in mV)
    if (cellDiff == null && cellHi != null && cellLo != null) {
      cellDiff = Math.round((cellHi - cellLo) * 1000);
      $('inpCellDiff').value = cellDiff;
    }
    rec.manual = {
      soh: numOrNull('inpSoh'),
      pack_voltage: numOrNull('inpPackV'),
      cell_high: cellHi,
      cell_low: cellLo,
      cell_diff: cellDiff,
      capacity: numOrNull('inpCapacity'),
      vin: $('inpVin').value.trim().toUpperCase() || null,
    };
    return rec;
  }

  /* ---- render --------------------------------------------------------------- */
  function fmtVal(f) {
    if (f.value === null || f.value === undefined) return 'onbekend';
    return f.unit ? `${f.value} ${f.unit}` : `${f.value}`;
  }

  function render(res) {
    const s = res.raw_stats;
    const d = res.decoded;

    const m = res.manual || {};
    $('cVehicle').textContent = res.vehicle || 'Onbekend';
    $('cFile').textContent = res.source_filename || '—';
    $('cDecoder').textContent = res.decoder_id;
    $('cVin').textContent = effField(res, 'vin').value || 'onbekend';

    const sohVal = effectiveSoh(res);
    if (sohVal !== null) {
      $('cSohBig').textContent = sohVal + '%';
      $('cSohBig').classList.remove('unknown');
    } else {
      $('cSohBig').textContent = 'onbekend';
      $('cSohBig').classList.add('unknown');
    }

    // invoervelden vullen vanuit het record
    $('inpKenteken').value = res.kenteken || '';
    $('inpVehicle').value = res._userVehicle || '';
    $('inpVin').value = m.vin || '';
    $('inpMileage').value = res.mileage ?? '';
    $('inpNote').value = res.note || '';
    $('inpSoh').value = m.soh ?? '';
    $('inpPackV').value = m.pack_voltage ?? '';
    $('inpCellHi').value = m.cell_high ?? '';
    $('inpCellLo').value = m.cell_low ?? '';
    $('inpCellDiff').value = m.cell_diff ?? '';
    $('inpCapacity').value = m.capacity ?? '';

    $('sFrames').textContent = s.frame_count;
    $('sIds').textContent = s.can_ids.length + ' (' + s.can_ids.join(', ') + ')';
    $('sDur').textContent = s.duration_s + ' s';
    $('sSpan').textContent = (s.t_start || '—') + ' → ' + (s.t_end || '—');
    $('sErr').textContent = s.parse_errors;

    renderCertFields(res);

    // melding: bevat dit bestand diagnose-data of is het een passieve opname?
    const decodedFromFile = CERT_FIELDS.some(([k]) => effField(res, k).source === 'logbestand');
    const note = $('fileTypeNote');
    if (decodedFromFile) {
      note.className = 'callout good';
      note.innerHTML = '<div class="callout-title">✅ Diagnose-data gevonden</div>' +
        '<div class="callout-body">Dit is een volledige diagnose-opname. SOH, spanningen en VIN ' +
        'zijn automatisch uit het bestand gehaald (label "logbestand").</div>';
    } else {
      note.className = 'callout warn';
      note.innerHTML = '<div class="callout-title">⚠️ Geen batterijdata in dit bestand</div>' +
        '<div class="callout-body">Dit is een <strong>passieve opname</strong> — de SOH/celspanningen ' +
        'zitten er fysiek niet in. Gebruik een <strong>volledige diagnose-opname</strong> (zoals ' +
        '<code>CAN_500000…txt</code>) voor automatische waarden, of vul ze handmatig aan.</div>';
    }

    $('result').classList.remove('hidden');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // certificaat-velden-tabel + grote SOH + VIN (handmatig > gedecodeerd > onbekend)
  function renderCertFields(res) {
    const sohVal = effectiveSoh(res);
    $('cSohBig').textContent = sohVal !== null ? sohVal + '%' : 'onbekend';
    $('cSohBig').classList.toggle('unknown', sohVal === null);
    $('cVin').textContent = effField(res, 'vin').value || 'onbekend';

    const body = $('fieldsBody');
    body.innerHTML = '';
    for (const [key, label, unit] of CERT_FIELDS) {
      const ef = effField(res, key);
      const known = ef.value !== null && ef.value !== undefined && ef.value !== '';
      const shown = known ? (unit ? `${ef.value} ${unit}` : `${ef.value}`) : 'onbekend';
      const chip = ef.source === 'ingevuld'
        ? '<span class="chip ok">ingevuld</span>'
        : ef.source === 'logbestand'
        ? '<span class="chip laag">logbestand</span>'
        : '<span class="chip nvt">onbekend</span>';
      // kleurcodering: celverschil groen <50, oranje 50-99, rood >=100 mV
      let valCls = known ? '' : 'stat-unknown';
      if (key === 'cell_diff' && known) {
        const d = Number(ef.value);
        valCls = d < 50 ? 'stat-good' : d < 100 ? 'stat-warn' : 'stat-bad';
      }
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><strong>${label}</strong></td>` +
        `<td class="${valCls}">${shown}</td>` +
        `<td>${chip}</td>`;
      body.appendChild(tr);
    }
  }

  /* ---- bestand verwerken ---------------------------------------------------- */
  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const res = window.CAN.analyze(e.target.result, file.name);
        if (!res.raw_stats.frame_count) {
          // geen frames herkend -> toon duidelijke melding met voorbeeldregels
          $('parseSample').textContent = (res.sample_lines || []).join('\n') || '(bestand is leeg)';
          $('parseError').classList.remove('hidden');
          $('result').classList.add('hidden');
          $('parseError').scrollIntoView({ behavior: 'smooth', block: 'center' });
          current = null;
          return;
        }
        $('parseError').classList.add('hidden');
        current = res;
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
  // datumdelen van een record (lokale tijd)
  function recParts(r) {
    const d = new Date(r.uploaded_at);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), date: d };
  }
  const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  function applyFilters() {
    const q = listState.search.trim().toLowerCase();
    const fy = listState.year, fm = listState.month, fd = listState.day;
    let list = listState.all.filter((r) => {
      const p = recParts(r);
      if (fy && String(p.y) !== fy) return false;
      if (fm && String(p.m) !== fm) return false;
      if (fd && String(p.d) !== fd) return false;
      if (!q) return true;
      const hay = [r.vehicle, r.source_filename, recVin(r), r.kenteken, r.note].join(' ').toLowerCase();
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

  // kalenderfilters (jaar -> maand -> dag) cascaderend vullen op basis van data
  function populateCalendarFilters() {
    const all = listState.all.map(recParts);
    const opt = (v, label, sel) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${label}</option>`;

    // jaren
    const years = [...new Set(all.map((p) => p.y))].sort((a, b) => b - a);
    if (listState.year && !years.includes(+listState.year)) listState.year = '';
    $('yearFilter').innerHTML = '<option value="">Jaar</option>' +
      years.map((y) => opt(y, y, listState.year)).join('');

    // maanden binnen gekozen jaar (of alle)
    const inY = all.filter((p) => !listState.year || p.y === +listState.year);
    const months = [...new Set(inY.map((p) => p.m))].sort((a, b) => a - b);
    if (listState.month && !months.includes(+listState.month)) listState.month = '';
    $('monthFilter').innerHTML = '<option value="">Maand</option>' +
      months.map((m) => opt(m, MONTHS_NL[m - 1], listState.month)).join('');

    // dagen binnen gekozen jaar+maand
    const inM = inY.filter((p) => !listState.month || p.m === +listState.month);
    const days = [...new Set(inM.map((p) => p.d))].sort((a, b) => a - b);
    if (listState.day && !days.includes(+listState.day)) listState.day = '';
    $('dayFilter').innerHTML = '<option value="">Dag</option>' +
      days.map((d) => opt(d, d, listState.day)).join('');
  }

  function recordCard(r) {
    const sv = effectiveSoh(r);
    const known = sv !== null;
    const soh = known ? sv + '%' : '?';
    const sohCls = known ? (sv >= 80 ? 'stat-good' : sv >= 60 ? 'stat-warn' : 'stat-bad') : 'stat-unknown';
    const head = r.kenteken ? esc(r.kenteken) : esc(r.vehicle || 'Onbekend');
    const sub = r.kenteken ? esc(r.vehicle || '') : (recVin(r) ? esc(recVin(r)) : '');
    const t = new Date(r.uploaded_at);
    const time = t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'record';
    div.dataset.id = r.id;
    div.innerHTML =
      `<button class="r-del" data-del="${r.id}" title="Verwijderen">×</button>` +
      `<div class="r-main">${head}</div>` +
      (sub ? `<div class="r-sub">${sub}</div>` : '') +
      `<div class="r-meta"><span class="r-soh ${sohCls}">${soh} SOH</span> · ${time}` +
      (r.note ? ` · ${esc(r.note)}` : '') + `</div>`;
    return div;
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
      wrap.innerHTML = '<p class="muted">Geen metingen voor deze filters.</p>';
      pager.innerHTML = '';
      return;
    }

    const pages = Math.ceil(filtered.length / PAGE_SIZE);
    if (listState.page > pages) listState.page = pages;
    const start = (listState.page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    const byDate = listState.sort === 'date_desc' || listState.sort === 'date_asc';

    wrap.innerHTML = '';
    let lastDay = null;
    for (const r of slice) {
      if (byDate) {
        const p = recParts(r);
        const key = `${p.y}-${p.m}-${p.d}`;
        if (key !== lastDay) {
          lastDay = key;
          const h = document.createElement('div');
          h.className = 'date-header';
          h.textContent = `${p.d} ${MONTHS_NL[p.m - 1]} ${p.y}`;
          wrap.appendChild(h);
        }
      }
      wrap.appendChild(recordCard(r));
    }

    // klik op record -> detail; klik op × -> verwijderen
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
        if (opts.disabled) btn.disabled = true;
        btn.addEventListener('click', () => { listState.page = page; renderList(); });
        return btn;
      };
      pager.appendChild(mk('‹', listState.page - 1, { disabled: listState.page === 1 }));
      const span = document.createElement('span');
      span.className = 'pinfo';
      span.textContent = `${listState.page}/${pages}`;
      pager.appendChild(span);
      pager.appendChild(mk('›', listState.page + 1, { disabled: listState.page === pages }));
    }
  }

  async function refreshRecords() {
    listState.all = await window.Storage.list();
    populateCalendarFilters();
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

    // Highlight het dropvak bij slepen erboven
    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, () => dz.classList.add('drag'))
    );
    ['dragleave', 'dragend'].forEach((ev) =>
      dz.addEventListener(ev, () => dz.classList.remove('drag'))
    );

    // Accepteer een drop OVERAL op de pagina (en voorkom dat de browser het
    // bestand opent als je net naast het vak loslaat).
    ['dragenter', 'dragover'].forEach((ev) =>
      document.addEventListener(ev, (e) => { e.preventDefault(); })
    );
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    $('saveBtn').addEventListener('click', async () => {
      if (!current) return;
      collectInputs(current);
      await window.Storage.add(JSON.parse(JSON.stringify(current)));
      $('saveBtn').textContent = '✓ Opgeslagen';
      setTimeout(() => ($('saveBtn').textContent = '💾 Opslaan in database'), 1500);
      listState.page = 1;
      refreshRecords();
    });

    $('pdfBtn').addEventListener('click', () => {
      if (!current) return;
      collectInputs(current);
      window.Certificate.openCertificate(current);
    });

    // live bijwerken van het overzicht terwijl je de velden invult
    ['inpKenteken','inpVehicle','inpVin','inpMileage','inpNote','inpSoh','inpPackV',
     'inpCellHi','inpCellLo','inpCellDiff','inpCapacity'].forEach((id) =>
      $(id).addEventListener('input', () => {
        if (!current) return;
        collectInputs(current);
        renderCertFields(current);
        $('cVehicle').textContent = current.vehicle || 'Onbekend';
      })
    );

    // lijst-besturing (zoeken + kalenderfilters jaar/maand/dag + sortering)
    let searchTimer;
    $('searchBox').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        listState.search = e.target.value; listState.page = 1; renderList();
      }, 150);
    });
    $('yearFilter').addEventListener('change', (e) => {
      listState.year = e.target.value; listState.month = ''; listState.day = '';
      listState.page = 1; populateCalendarFilters(); renderList();
    });
    $('monthFilter').addEventListener('change', (e) => {
      listState.month = e.target.value; listState.day = '';
      listState.page = 1; populateCalendarFilters(); renderList();
    });
    $('dayFilter').addEventListener('change', (e) => {
      listState.day = e.target.value; listState.page = 1; renderList();
    });
    $('sortBy').addEventListener('change', (e) => {
      listState.sort = e.target.value; listState.page = 1; renderList();
    });
    $('clearFilters').addEventListener('click', () => {
      listState.search = ''; listState.year = ''; listState.month = ''; listState.day = '';
      listState.page = 1;
      $('searchBox').value = '';
      populateCalendarFilters(); renderList();
    });

    refreshRecords();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
