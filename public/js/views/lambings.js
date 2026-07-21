'use strict';

/** המלטות — season KPIs, monthly chart, recent lambings, registration form. */
const LambingsView = (() => {
  const e = UI.esc;
  let page = 1;

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:140px"></div>`;
    const [stats, list] = await Promise.all([
      API.get('/api/lambings/stats'),
      API.get('/api/lambings', { page, limit: 15 }),
    ]);

    main.innerHTML = `
      <div class="page-head">
        <div>
          <h1>המלטות</h1>
          <p>עונת ${e(stats.season)} · ${UI.num(stats.lambings)} המלטות · ${UI.num(stats.offspring)} ולדות</p>
        </div>
        <div class="actions">
          ${App.canWrite() ? '<button class="btn btn-primary" id="add-lambing">+ רישום המלטה</button>' : ''}
        </div>
      </div>

      <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="tile static"><div class="lbl">אחוז המלטה</div><div class="val">${UI.num(stats.lambingRate)}%</div>
          <div class="pct">${UI.num(stats.mothers)} מתוך ${UI.num(stats.bredFemales)} אמהות</div>
          <div class="bar"><i style="width:${Math.min(100, stats.lambingRate)}%;background:var(--brand-600)"></i></div></div>
        <div class="tile static"><div class="lbl">ולדות לאם</div><div class="val">${UI.num(stats.offspringPerMother, 2)}</div>
          <div class="pct">${UI.num(stats.offspring)} ולדות · ${UI.num(stats.twinRate)}% תאומים</div></div>
        <div class="tile static"><div class="lbl">משקל לידה ממוצע</div><div class="val">${UI.num(stats.avgBirthWeight, 1)} <small style="font-size:13px">ק״ג</small></div>
          <div class="pct">יעד: 4.0–4.5</div></div>
        <div class="tile static"><div class="lbl">תמותת ולדות</div><div class="val">${UI.num(stats.offspringMortality, 1)}%</div>
          <div class="pct">${UI.num(stats.deadOffspring)} מתוך ${UI.num(stats.offspring)}</div></div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-head"><h2>המלטות לפי חודש</h2><span class="sub">עונה נוכחית</span></div>
          ${chart(stats.byMonth)}
        </div>
        <div class="card">
          <div class="card-head"><h2>פילוח גודל המלטה</h2></div>
          <div class="meters" id="litter-mix"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>המלטות אחרונות</h2><span class="sub">${UI.num(list.total)} בעונה</span></div>
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>תאריך</th><th>אם</th><th>ולדות</th><th>איל</th><th>סטטוס</th><th></th></tr></thead>
            <tbody id="lamb-body"></tbody>
          </table>
        </div>
        <div class="tbl-foot" id="lamb-foot"></div>
      </div>`;

    const add = document.getElementById('add-lambing');
    if (add) add.addEventListener('click', openForm);

    paintRows(list);
    paintLitterMix(stats.litterMix, stats.lambings);
  }

  function paintRows(list) {
    const body = document.getElementById('lamb-body');
    if (!list.items.length) {
      body.innerHTML = `<tr><td colspan="6">${UI.empty('🐑', 'לא נרשמו המלטות בעונה זו')}</td></tr>`;
      document.getElementById('lamb-foot').innerHTML = '';
      return;
    }
    body.innerHTML = list.items.map(l => {
      const sexes = (l.offspring || []).map(o => o.sex === 'M' ? 'ז' : 'נ').join('+');
      return `<tr data-mother="${e(l.motherTag)}">
        <td>${UI.fmtShort(l.date)}</td>
        <td class="tag-mono">${e(l.motherTag)}</td>
        <td>${(l.offspring || []).length} · ${e(sexes)}</td>
        <td>${e(l.fatherTag || '—')}</td>
        <td>${UI.difficultyBadge(l.difficulty)}</td>
        <td style="text-align:left">${App.canWrite()
          ? `<button class="pill-link" data-del="${e(l._id)}">מחיקה</button>` : ''}</td>
      </tr>`;
    }).join('');

    body.querySelectorAll('tr[data-mother]').forEach(tr =>
      tr.addEventListener('click', ev => {
        if (ev.target.dataset.del) return;
        App.go('animal', { tag: tr.dataset.mother });
      }));
    body.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', async ev => {
        ev.stopPropagation();
        if (!await UI.confirmDialog('מחיקת המלטה', 'למחוק את רישום ההמלטה? הטלאים שנרשמו יישארו בספר העדר.')) return;
        await API.del(`/api/lambings/${b.dataset.del}`);
        UI.closeModal();
        UI.toast('הרישום נמחק');
        App.go('lambings');
      }));

    document.getElementById('lamb-foot').innerHTML =
      `<span>מציג ${list.items.length} מתוך ${UI.num(list.total)}</span>${UI.pager(list.page, list.pages, 'LambingsView.goPage')}`;
  }

  function paintLitterMix(mix, total) {
    const box = document.getElementById('litter-mix');
    const rows = [
      ['יחיד', mix.single], ['תאומים', mix.twins], ['שלישייה ומעלה', mix.triplets],
    ];
    const denom = total || 1;
    box.innerHTML = rows.map(([label, count]) => {
      const pct = Math.round(count / denom * 100);
      return `<div class="meter">
        <div class="row"><span>${label}</span><b>${UI.num(count)} · ${pct}%</b></div>
        <div class="track" style="background:var(--grid)"><i class="fill" style="display:block;width:${pct}%;background:var(--brand-600)"></i></div>
      </div>`;
    }).join('');
  }

  function chart(byMonth) {
    if (!byMonth || !byMonth.length) return `<div class="chart">${UI.empty('📊', 'אין נתונים')}</div>`;
    const max = Math.max(...byMonth.map(m => m.count), 1);
    return `<div class="chart">
      <div class="bars">
        <div class="gridline" style="top:0"></div><div class="gridline" style="top:50%"></div>
        ${byMonth.map(m => `<div class="bar-col"><div class="cbar" style="height:${Math.max(4, m.count / max * 100)}%">
          <span class="bar-lbl">${m.count}</span></div></div>`).join('')}
      </div>
      <div class="x-lbls">${byMonth.map(m => `<span>${e(UI.monthLabel(m.month))}</span>`).join('')}</div>
    </div>`;
  }

  function offspringRow(i) {
    return `<div class="off-row" data-row>
      ${UI.field(`o_tag_${i}`, 'מס׳ ולד', { hint: 'ריק = מספור אוטומטי' })}
      ${UI.select(`o_sex_${i}`, 'מין', [{ value: 'F', label: 'נקבה' }, { value: 'M', label: 'זכר' }], 'F')}
      ${UI.field(`o_w_${i}`, 'משקל', { type: 'number', attrs: 'step="0.1" min="0"' })}
      ${UI.select(`o_st_${i}`, 'מצב', [{ value: 'alive', label: 'חי' }, { value: 'dead', label: 'מת' }], 'alive')}
      <button type="button" class="rm" title="הסרה">×</button>
    </div>`;
  }

  function openForm() {
    UI.openModal({
      title: 'רישום המלטה',
      wide: true,
      submitLabel: 'רישום',
      body: `<div class="form-grid">
          ${UI.field('motherTag', 'מס׳ אם', { required: true })}
          ${UI.field('date', 'תאריך המלטה', { type: 'date', value: UI.inputDate(new Date()), required: true })}
          ${UI.field('fatherTag', 'מס׳ איל', {})}
          ${UI.select('difficulty', 'מהלך ההמלטה', [
            { value: 'normal', label: 'תקינה' }, { value: 'watch', label: 'מעקב' }, { value: 'hard', label: 'קשה' },
          ], 'normal')}
        </div>
        <div style="margin:16px 0 8px;font-size:12.5px;font-weight:800;color:var(--ink-2)">ולדות</div>
        <div id="off-rows">${offspringRow(0)}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-off">+ הוספת ולד</button>
        ${UI.textarea('notes', 'הערות', '')}`,
      onSubmit: async form => {
        const f = UI.formData(form);
        const offspring = [];
        document.querySelectorAll('#off-rows [data-row]').forEach((row, idx) => {
          const i = row.dataset.idx !== undefined ? row.dataset.idx : idx;
          const tag = (f[`o_tag_${i}`] || '').trim();
          const sex = f[`o_sex_${i}`] || 'F';
          const weightKg = f[`o_w_${i}`];
          const status = f[`o_st_${i}`] || 'alive';
          offspring.push({ tag, sex, weightKg, status });
        });
        if (!offspring.length) throw new Error('יש לרשום לפחות ולד אחד');
        await API.post('/api/lambings', {
          motherTag: f.motherTag, date: f.date, fatherTag: f.fatherTag,
          difficulty: f.difficulty, notes: f.notes, offspring,
        });
        UI.toast('ההמלטה נרשמה והטלאים נוספו לספר העדר');
        App.go('lambings');
      },
    });

    let idx = 0;
    document.querySelector('#off-rows [data-row]').dataset.idx = '0';
    const wire = row => row.querySelector('.rm').addEventListener('click', () => {
      if (document.querySelectorAll('#off-rows [data-row]').length > 1) row.remove();
    });
    wire(document.querySelector('#off-rows [data-row]'));

    document.getElementById('add-off').addEventListener('click', () => {
      idx++;
      const box = document.getElementById('off-rows');
      box.insertAdjacentHTML('beforeend', offspringRow(idx));
      const row = box.lastElementChild;
      row.dataset.idx = String(idx);
      wire(row);
    });
  }

  function goPage(p) { page = p; App.go('lambings'); }

  return { render, goPage };
})();
