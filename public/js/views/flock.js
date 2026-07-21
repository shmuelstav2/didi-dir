'use strict';

/** ספר עדר — searchable, filterable, paginated flock book with full CRUD. */
const FlockView = (() => {
  const e = UI.esc;
  let state = { q: '', status: 'active', group: '', repro: '', sex: '', page: 1, sort: 'tag', dir: 'asc' };
  let groups = [];

  async function render(main) {
    main.innerHTML = `
      <div class="page-head">
        <div>
          <h1>ספר עדר</h1>
          <p id="flock-sub">טוען…</p>
        </div>
        <div class="actions">
          <button class="btn btn-ghost" id="export-csv">ייצוא CSV</button>
          ${App.canWrite() ? '<button class="btn btn-primary" id="add-animal">+ חיה חדשה</button>' : ''}
        </div>
      </div>

      <div class="toolbar">
        <div class="search-in">
          🔍<input id="q" placeholder="חיפוש לפי מספר, שם או מס׳ משרד" value="${e(state.q)}">
        </div>
        <div class="chips" id="status-chips"></div>
        <select id="group-filter" style="border:1px solid var(--hairline);border-radius:99px;padding:7px 14px;font-family:inherit;font-size:12.5px;background:var(--surface);color:var(--ink-2)"></select>
        <select id="repro-filter" style="border:1px solid var(--hairline);border-radius:99px;padding:7px 14px;font-family:inherit;font-size:12.5px;background:var(--surface);color:var(--ink-2)"></select>
      </div>

      <div class="card">
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th data-sort="tag">מס׳ חיה</th>
              <th data-sort="groupName">קבוצה</th>
              <th>מין</th>
              <th data-sort="birthDate">גיל</th>
              <th data-sort="lastWeightKg">משקל</th>
              <th>המלטה אחרונה / צפי</th>
              <th>סטטוס</th>
              <th></th>
            </tr></thead>
            <tbody id="flock-body"><tr class="loading-row"><td colspan="8">טוען…</td></tr></tbody>
          </table>
        </div>
        <div class="tbl-foot" id="flock-foot"></div>
      </div>`;

    document.getElementById('q').addEventListener('input', debounce(ev => {
      state.q = ev.target.value; state.page = 1; load();
    }, 300));
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        state.dir = state.sort === k && state.dir === 'asc' ? 'desc' : 'asc';
        state.sort = k; load();
      });
    });
    const addBtn = document.getElementById('add-animal');
    if (addBtn) addBtn.addEventListener('click', () => openForm());
    document.getElementById('export-csv').addEventListener('click', exportCsv);

    renderChips();
    const g = await API.get('/api/animals/groups');
    groups = g.groups;
    renderSelects();
    load();
  }

  function renderChips() {
    const chips = [
      { v: 'active', l: 'פעילים' }, { v: '', l: 'הכל' },
      { v: 'sold', l: 'נמכרו' }, { v: 'dead', l: 'תמותה' },
    ];
    document.getElementById('status-chips').innerHTML = chips.map(c =>
      `<button class="chip-f ${state.status === c.v ? 'active' : ''}" data-v="${e(c.v)}">${e(c.l)}</button>`).join('');
    document.querySelectorAll('#status-chips .chip-f').forEach(b =>
      b.addEventListener('click', () => { state.status = b.dataset.v; state.page = 1; renderChips(); load(); }));
  }

  function renderSelects() {
    const gf = document.getElementById('group-filter');
    gf.innerHTML = `<option value="">כל הקבוצות</option>` +
      groups.map(g => `<option value="${e(g)}" ${state.group === g ? 'selected' : ''}>${e(g)}</option>`).join('');
    gf.onchange = () => { state.group = gf.value; state.page = 1; load(); };

    const rf = document.getElementById('repro-filter');
    const opts = [['', 'כל הסטטוסים'], ['pregnant', 'בהריון'], ['lactating', 'אחרי המלטה'], ['open', 'ריקות'], ['lamb', 'טלאים'], ['ram', 'אילים']];
    rf.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${state.repro === v ? 'selected' : ''}>${l}</option>`).join('');
    rf.onchange = () => { state.repro = rf.value; state.page = 1; load(); };
  }

  async function load() {
    const body = document.getElementById('flock-body');
    if (!body) return;
    body.innerHTML = `<tr class="loading-row"><td colspan="8">טוען…</td></tr>`;
    const data = await API.get('/api/animals', { ...state, limit: 25 });

    document.getElementById('flock-sub').textContent =
      `${UI.num(data.total)} ראשים · עודכן ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;

    if (!data.items.length) {
      body.innerHTML = `<tr><td colspan="8">${UI.empty('🐑', 'לא נמצאו חיות בסינון הנוכחי')}</td></tr>`;
      document.getElementById('flock-foot').innerHTML = '';
      return;
    }

    body.innerHTML = data.items.map(a => `
      <tr data-tag="${e(a.tag)}">
        <td class="tag-mono">${e(a.tag)}${a.name ? ` · ${e(a.name)}` : ''}</td>
        <td>${e(a.groupName || '—')}</td>
        <td>${e(UI.SEX_LABEL[a.sex])}</td>
        <td>${a.ageYears !== null ? `${UI.num(a.ageYears, 1)} ש׳` : '—'}</td>
        <td class="num">${a.lastWeightKg ? `${UI.num(a.lastWeightKg, 1)} ק״ג` : '—'}</td>
        <td>${a.expectedLambingDate
          ? `צפי ${UI.fmtShort(a.expectedLambingDate)}${a.daysToLambing !== null ? ` · ${a.daysToLambing} יום` : ''}`
          : (a.lastLambingDate ? UI.fmtShort(a.lastLambingDate) : '—')}</td>
        <td>${UI.reproBadge(a.reproStatus)}</td>
        <td style="text-align:left">
          ${App.canWrite() ? `<button class="pill-link" data-edit="${e(a.tag)}">עריכה</button>` : ''}
        </td>
      </tr>`).join('');

    body.querySelectorAll('tr[data-tag]').forEach(tr => {
      tr.addEventListener('click', ev => {
        if (ev.target.dataset.edit) return;
        App.go('animal', { tag: tr.dataset.tag });
      });
    });
    body.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', async ev => {
        ev.stopPropagation();
        const { animal } = await API.get(`/api/animals/${encodeURIComponent(b.dataset.edit)}`);
        openForm(animal);
      }));

    document.getElementById('flock-foot').innerHTML =
      `<span>מציג ${data.items.length} מתוך ${UI.num(data.total)}</span>${UI.pager(data.page, data.pages, 'FlockView.goPage')}`;
  }

  function goPage(p) { state.page = p; load(); }

  function openForm(animal = null) {
    const isEdit = !!animal;
    const a = animal || {};
    UI.openModal({
      title: isEdit ? `עריכת חיה ${a.tag}` : 'חיה חדשה',
      wide: true,
      submitLabel: isEdit ? 'עדכון' : 'הוספה',
      body: `<div class="form-grid">
        ${UI.field('tag', 'מספר חיה', { value: a.tag || '', required: true, attrs: isEdit ? 'readonly' : '' })}
        ${UI.field('name', 'שם / כינוי', { value: a.name || '' })}
        ${UI.select('sex', 'מין', [{ value: 'F', label: 'נקבה' }, { value: 'M', label: 'זכר' }], a.sex || 'F')}
        ${UI.field('birthDate', 'תאריך לידה', { type: 'date', value: UI.inputDate(a.birthDate) })}
        ${UI.field('breed', 'גזע', { value: a.breed || 'אסף' })}
        ${UI.field('groupName', 'קבוצה', { value: a.groupName || '' })}
        ${UI.select('reproStatus', 'סטטוס רבייה', [
          { value: 'open', label: 'ריקה' }, { value: 'pregnant', label: 'בהריון' },
          { value: 'lactating', label: 'אחרי המלטה' }, { value: 'lamb', label: 'טלה' }, { value: 'ram', label: 'איל' },
        ], a.reproStatus || 'open')}
        ${UI.select('status', 'סטטוס', [
          { value: 'active', label: 'פעיל' }, { value: 'sold', label: 'נמכר' },
          { value: 'dead', label: 'מת' }, { value: 'culled', label: 'הוצא' },
        ], a.status || 'active')}
        ${UI.field('ministryId', 'מס׳ משרד החקלאות', { value: a.ministryId || '' })}
        ${UI.select('origin', 'מקור', [{ value: 'own', label: 'גידול עצמי' }, { value: 'purchased', label: 'נרכשה' }], a.origin || 'own')}
        ${UI.field('motherTag', 'מס׳ אם', { value: a.motherTag || '' })}
        ${UI.field('fatherTag', 'מס׳ אב', { value: a.fatherTag || '' })}
        ${UI.field('lastWeightKg', 'משקל אחרון (ק״ג)', { type: 'number', value: a.lastWeightKg ?? '', attrs: 'step="0.1" min="0"' })}
        ${UI.field('expectedLambingDate', 'צפי המלטה', { type: 'date', value: UI.inputDate(a.expectedLambingDate) })}
        ${UI.textarea('notes', 'הערות', a.notes || '')}
      </div>`,
      extraFoot: isEdit ? `<button type="button" class="btn btn-danger spacer" id="del-animal">מחיקה</button>` : '',
      onSubmit: async form => {
        const payload = UI.formData(form);
        if (isEdit) await API.put(`/api/animals/${encodeURIComponent(a.tag)}`, payload);
        else await API.post('/api/animals', payload);
        UI.toast(isEdit ? 'החיה עודכנה' : 'החיה נוספה לספר העדר');
        load();
      },
    });

    const del = document.getElementById('del-animal');
    if (del) del.addEventListener('click', async () => {
      UI.closeModal();
      if (!await UI.confirmDialog('מחיקת חיה', `למחוק את ${a.tag} וכל האירועים שלה? הפעולה אינה הפיכה.`)) return;
      await API.del(`/api/animals/${encodeURIComponent(a.tag)}`);
      UI.closeModal();
      UI.toast('החיה נמחקה');
      load();
    });
  }

  async function exportCsv() {
    const data = await API.get('/api/animals', { ...state, limit: 200, page: 1 });
    const head = ['מס׳ חיה', 'שם', 'מין', 'גזע', 'קבוצה', 'תאריך לידה', 'גיל', 'משקל', 'סטטוס רבייה', 'סטטוס', 'אם', 'אב'];
    const rows = data.items.map(a => [
      a.tag, a.name, UI.SEX_LABEL[a.sex], a.breed, a.groupName, UI.fmtDate(a.birthDate),
      a.ageYears ?? '', a.lastWeightKg ?? '', UI.REPRO_LABEL[a.reproStatus] || '', UI.STATUS_LABEL[a.status] || '',
      a.motherTag, a.fatherTag,
    ]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `flock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast(`יוצאו ${rows.length} שורות`);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  return { render, goPage };
})();
