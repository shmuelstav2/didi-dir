'use strict';

/** מזון — feed stock per type, deliveries in and consumption out. */
const FeedView = (() => {
  const e = UI.esc;
  let page = 1;

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:140px"></div>`;
    const [stock, list] = await Promise.all([
      API.get('/api/feed/stock'),
      API.get('/api/feed', { page, limit: 20 }),
    ]);

    main.innerHTML = `
      <div class="page-head">
        <div><h1>מזון</h1><p>מלאי ${UI.num(stock.totalStockKg)} ק״ג · עלות עונה ${UI.num(stock.seasonCost)} ₪</p></div>
        <div class="actions">${App.canWrite() ? `<button class="btn btn-ghost" id="add-out">− צריכה</button>
          <button class="btn btn-primary" id="add-in">+ קליטת מזון</button>` : ''}</div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>מלאי לפי סוג</h2><span class="sub">קליטה פחות צריכה</span></div>
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>סוג מזון</th><th>נקלט (ק״ג)</th><th>נצרך (ק״ג)</th><th>מלאי (ק״ג)</th><th>עלות (₪)</th></tr></thead>
            <tbody>${stock.stock.length ? stock.stock.map(s => `<tr>
              <td><b>${e(s.feedType)}</b></td>
              <td class="num">${UI.num(s.inKg)}</td>
              <td class="num">${UI.num(s.outKg)}</td>
              <td class="num" style="color:${s.stockKg < 0 ? 'var(--critical)' : 'var(--brand-700)'}">${UI.num(s.stockKg)}</td>
              <td class="num">${UI.num(s.cost)}</td>
            </tr>`).join('') : `<tr><td colspan="5">${UI.empty('🌾', 'אין נתוני מזון עדיין')}</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>תנועות אחרונות</h2><span class="sub">${UI.num(list.total)} רשומות</span></div>
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>תאריך</th><th>סוג</th><th>תנועה</th><th>כמות (ק״ג)</th><th>עלות (₪)</th><th>ספק / קבוצה</th><th></th></tr></thead>
            <tbody id="body"></tbody>
          </table>
        </div>
        <div class="tbl-foot" id="foot"></div>
      </div>`;

    document.getElementById('add-in') && document.getElementById('add-in').addEventListener('click', () => form('in'));
    document.getElementById('add-out') && document.getElementById('add-out').addEventListener('click', () => form('out'));
    paint(list);
  }

  function paint(list) {
    const body = document.getElementById('body');
    if (!list.items.length) { body.innerHTML = `<tr><td colspan="7">${UI.empty('🌾', 'אין תנועות')}</td></tr>`; document.getElementById('foot').innerHTML = ''; return; }
    body.innerHTML = list.items.map(r => `<tr>
      <td>${UI.fmtShort(r.date)}</td>
      <td><b>${e(r.feedType)}</b></td>
      <td><span class="badge ${r.direction === 'in' ? 'ok' : 'warn'}">${r.direction === 'in' ? 'קליטה' : 'צריכה'}</span></td>
      <td class="num">${UI.num(r.quantityKg)}</td>
      <td class="num">${r.cost ? UI.num(r.cost) : '—'}</td>
      <td>${e(r.supplier || r.groupName || '—')}</td>
      <td style="text-align:left">${App.canWrite() ? `<button class="pill-link" data-del="${e(r._id)}">מחיקה</button>` : ''}</td>
    </tr>`).join('');
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirmDialog('מחיקת רשומה', 'למחוק את תנועת המזון?')) return;
      await API.del(`/api/feed/${b.dataset.del}`); UI.closeModal(); UI.toast('נמחק'); App.go('feed');
    }));
    document.getElementById('foot').innerHTML =
      `<span>מציג ${list.items.length} מתוך ${UI.num(list.total)}</span>${UI.pager(list.page, list.pages, 'FeedView.goPage')}`;
  }

  function form(direction) {
    const isIn = direction === 'in';
    UI.openModal({
      title: isIn ? 'קליטת מזון' : 'רישום צריכה',
      submitLabel: 'שמירה',
      body: `<div class="form-grid">
        ${UI.field('feedType', 'סוג מזון', { required: true, attrs: 'placeholder="למשל תערובת, שחת, גרעינים"' })}
        ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
        ${UI.field('quantityKg', 'כמות (ק״ג)', { type: 'number', required: true, attrs: 'min="0" step="0.1"' })}
        ${isIn ? UI.field('cost', 'עלות (₪)', { type: 'number', attrs: 'min="0" step="0.01"' }) : UI.field('groupName', 'קבוצה', {})}
        ${isIn ? UI.field('supplier', 'ספק', { cls: 'full' }) : ''}
        ${UI.textarea('notes', 'הערות', '')}
      </div>`,
      onSubmit: async f => {
        const data = UI.formData(f);
        data.direction = direction;
        await API.post('/api/feed', data);
        UI.toast(isIn ? 'המזון נקלט למלאי' : 'הצריכה נרשמה'); App.go('feed');
      },
    });
  }

  function goPage(p) { page = p; App.go('feed'); }

  return { render, goPage };
})();
