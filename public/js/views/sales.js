'use strict';

/** מכירות — sell animals; marks them sold and books revenue. */
const SalesView = (() => {
  const e = UI.esc;
  let page = 1;

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:140px"></div>`;
    const [stats, list] = await Promise.all([
      API.get('/api/sales/stats'),
      API.get('/api/sales', { page, limit: 20 }),
    ]);

    main.innerHTML = `
      <div class="page-head">
        <div><h1>מכירות</h1><p>עונת ${e(stats.season)} · ${UI.num(stats.count)} עסקאות · ${UI.num(stats.heads)} ראשים</p></div>
        <div class="actions">${App.canWrite() ? '<button class="btn btn-primary" id="add">+ רישום מכירה</button>' : ''}</div>
      </div>

      <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="tile static"><div class="lbl">הכנסות</div><div class="val">${UI.num(stats.revenue)} <small style="font-size:13px">₪</small></div><div class="pct">מתחילת העונה</div></div>
        <div class="tile static"><div class="lbl">ראשים שנמכרו</div><div class="val">${UI.num(stats.heads)}</div><div class="pct">${UI.num(stats.kg)} ק״ג</div></div>
        <div class="tile static"><div class="lbl">מחיר לראש</div><div class="val">${UI.num(stats.avgPerHead)} <small style="font-size:13px">₪</small></div><div class="pct">ממוצע</div></div>
        <div class="tile static"><div class="lbl">מחיר לק״ג</div><div class="val">${UI.num(stats.avgPerKg, 2)} <small style="font-size:13px">₪</small></div><div class="pct">ממוצע</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>מכירות אחרונות</h2><span class="sub">${UI.num(list.total)} בעונה</span></div>
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>תאריך</th><th>קונה</th><th>ראשים</th><th>משקל (ק״ג)</th><th>סכום (₪)</th><th></th></tr></thead>
            <tbody id="body"></tbody>
          </table>
        </div>
        <div class="tbl-foot" id="foot"></div>
      </div>`;

    document.getElementById('add') && document.getElementById('add').addEventListener('click', form);
    paint(list);
  }

  function paint(list) {
    const body = document.getElementById('body');
    if (!list.items.length) { body.innerHTML = `<tr><td colspan="6">${UI.empty('💰', 'אין מכירות בעונה זו')}</td></tr>`; document.getElementById('foot').innerHTML = ''; return; }
    body.innerHTML = list.items.map(s => {
      const heads = (s.animalTags || []).length + (s.extraHeads || 0);
      return `<tr>
        <td>${UI.fmtShort(s.date)}</td>
        <td><b>${e(s.buyer || '—')}</b></td>
        <td>${heads}${s.animalTags && s.animalTags.length ? ` · ${e(s.animalTags.slice(0, 3).join(', '))}${s.animalTags.length > 3 ? '…' : ''}` : ''}</td>
        <td class="num">${s.totalWeightKg ? UI.num(s.totalWeightKg) : '—'}</td>
        <td class="num"><b>${UI.num(s.total)}</b></td>
        <td style="text-align:left">${App.canWrite() ? `<button class="pill-link" data-del="${e(s._id)}">ביטול</button>` : ''}</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirmDialog('ביטול מכירה', 'לבטל את המכירה? החיות יחזרו לסטטוס פעיל בספר העדר.')) return;
      await API.del(`/api/sales/${b.dataset.del}`); UI.closeModal(); UI.toast('המכירה בוטלה'); App.go('sales');
    }));
    document.getElementById('foot').innerHTML =
      `<span>מציג ${list.items.length} מתוך ${UI.num(list.total)}</span>${UI.pager(list.page, list.pages, 'SalesView.goPage')}`;
  }

  function form() {
    UI.openModal({
      title: 'רישום מכירה',
      wide: true,
      submitLabel: 'רישום',
      body: `<div class="form-grid">
        ${UI.field('buyer', 'קונה', { cls: 'full' })}
        ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
        ${UI.field('animalTags', 'מספרי חיות (מופרד בפסיק)', { cls: 'full', hint: 'החיות יסומנו כנמכרו בספר העדר' })}
        ${UI.field('extraHeads', 'ראשים ללא מספור', { type: 'number', attrs: 'min="0"' })}
        ${UI.field('totalWeightKg', 'משקל כולל (ק״ג)', { type: 'number', attrs: 'min="0" step="0.1"' })}
        ${UI.field('pricePerKg', 'מחיר לק״ג (₪)', { type: 'number', attrs: 'min="0" step="0.01"' })}
        ${UI.field('pricePerHead', 'מחיר לראש (₪)', { type: 'number', attrs: 'min="0" step="0.01"' })}
        ${UI.field('total', 'סכום כולל (₪)', { type: 'number', attrs: 'min="0" step="0.01"', hint: 'ריק = חישוב אוטומטי ממחיר×כמות' })}
        ${UI.textarea('notes', 'הערות', '')}
      </div>`,
      onSubmit: async f => {
        const data = UI.formData(f);
        data.animalTags = (data.animalTags || '').split(',').map(s => s.trim()).filter(Boolean);
        await API.post('/api/sales', data);
        UI.toast('המכירה נרשמה'); App.go('sales');
      },
    });
  }

  function goPage(p) { page = p; App.go('sales'); }

  return { render, goPage };
})();
