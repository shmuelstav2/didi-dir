'use strict';

/** קניה — buy animals; registers them in the flock and books the cost. */
const PurchasesView = (() => {
  const e = UI.esc;
  let page = 1;

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:140px"></div>`;
    const [stats, list] = await Promise.all([
      API.get('/api/purchases/stats'),
      API.get('/api/purchases', { page, limit: 20 }),
    ]);

    main.innerHTML = `
      <div class="page-head">
        <div><h1>קניה</h1><p>עונת ${e(stats.season)} · ${UI.num(stats.count)} קניות · ${UI.num(stats.heads)} ראשים</p></div>
        <div class="actions">${App.canWrite() ? '<button class="btn btn-primary" id="add">+ רישום קנייה</button>' : ''}</div>
      </div>

      <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
        <div class="tile static"><div class="lbl">עלות קניות</div><div class="val">${UI.num(stats.cost)} <small style="font-size:13px">₪</small></div><div class="pct">מתחילת העונה</div></div>
        <div class="tile static"><div class="lbl">ראשים שנקנו</div><div class="val">${UI.num(stats.heads)}</div><div class="pct">נוספו לספר העדר</div></div>
        <div class="tile static"><div class="lbl">מחיר לראש</div><div class="val">${UI.num(stats.avgPerHead)} <small style="font-size:13px">₪</small></div><div class="pct">ממוצע</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>קניות אחרונות</h2><span class="sub">${UI.num(list.total)} בעונה</span></div>
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>תאריך</th><th>מוכר</th><th>ראשים</th><th>עלות (₪)</th><th></th></tr></thead>
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
    if (!list.items.length) { body.innerHTML = `<tr><td colspan="5">${UI.empty('🛒', 'אין קניות בעונה זו')}</td></tr>`; document.getElementById('foot').innerHTML = ''; return; }
    body.innerHTML = list.items.map(p => {
      const heads = (p.newAnimals || []).length + (p.extraHeads || 0);
      return `<tr>
        <td>${UI.fmtShort(p.date)}</td>
        <td><b>${e(p.seller || '—')}</b></td>
        <td>${heads}${p.newAnimals && p.newAnimals.length ? ` · ${e(p.newAnimals.slice(0, 3).join(', '))}${p.newAnimals.length > 3 ? '…' : ''}` : ''}</td>
        <td class="num"><b>${UI.num(p.total)}</b></td>
        <td style="text-align:left">${App.canWrite() ? `<button class="pill-link" data-del="${e(p._id)}">ביטול</button>` : ''}</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirmDialog('ביטול קנייה', 'לבטל את הקנייה? החיות שנוצרו בה יימחקו מספר העדר.')) return;
      await API.del(`/api/purchases/${b.dataset.del}`); UI.closeModal(); UI.toast('הקנייה בוטלה'); App.go('purchases');
    }));
    document.getElementById('foot').innerHTML =
      `<span>מציג ${list.items.length} מתוך ${UI.num(list.total)}</span>${UI.pager(list.page, list.pages, 'PurchasesView.goPage')}`;
  }

  function animalRow(i) {
    return `<div class="off-row" data-row data-idx="${i}">
      ${UI.field(`a_tag_${i}`, 'מס׳ חיה', {})}
      ${UI.select(`a_sex_${i}`, 'מין', [{ value: 'F', label: 'נקבה' }, { value: 'M', label: 'זכר' }], 'F')}
      ${UI.field(`a_w_${i}`, 'משקל', { type: 'number', attrs: 'step="0.1" min="0"' })}
      ${UI.field(`a_breed_${i}`, 'גזע', { value: 'אסף' })}
      <button type="button" class="rm" title="הסרה">×</button>
    </div>`;
  }

  function form() {
    UI.openModal({
      title: 'רישום קנייה',
      wide: true,
      submitLabel: 'רישום',
      body: `<div class="form-grid">
          ${UI.field('seller', 'מוכר', {})}
          ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
          ${UI.field('total', 'סכום כולל (₪)', { type: 'number', required: true, attrs: 'min="0" step="0.01"' })}
          ${UI.field('extraHeads', 'ראשים ללא מספור', { type: 'number', attrs: 'min="0"' })}
        </div>
        <div style="margin:16px 0 8px;font-size:12.5px;font-weight:800;color:var(--ink-2)">חיות (נוספות לספר העדר)</div>
        <div id="rows">${animalRow(0)}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-row">+ הוספת חיה</button>
        ${UI.textarea('notes', 'הערות', '')}`,
      onSubmit: async f => {
        const data = UI.formData(f);
        const animals = [];
        document.querySelectorAll('#rows [data-row]').forEach(row => {
          const i = row.dataset.idx;
          const tag = (data[`a_tag_${i}`] || '').trim();
          if (!tag) return;
          animals.push({ tag, sex: data[`a_sex_${i}`], weightKg: data[`a_w_${i}`], breed: data[`a_breed_${i}`] });
        });
        await API.post('/api/purchases', { seller: data.seller, date: data.date, total: data.total, extraHeads: data.extraHeads, notes: data.notes, animals });
        UI.toast('הקנייה נרשמה והחיות נוספו לספר העדר'); App.go('purchases');
      },
    });

    let idx = 0;
    const wire = row => row.querySelector('.rm').addEventListener('click', () => {
      if (document.querySelectorAll('#rows [data-row]').length > 1) row.remove();
    });
    wire(document.querySelector('#rows [data-row]'));
    document.getElementById('add-row').addEventListener('click', () => {
      idx++;
      const box = document.getElementById('rows');
      box.insertAdjacentHTML('beforeend', animalRow(idx));
      wire(box.lastElementChild);
    });
  }

  function goPage(p) { page = p; App.go('purchases'); }

  return { render, goPage };
})();
