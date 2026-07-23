'use strict';

/** כלכלי — season P&L aggregated across all modules + a manual ledger. */
const FinanceView = (() => {
  const e = UI.esc;

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:160px"></div>`;
    const [summary, ledger] = await Promise.all([
      API.get('/api/finance/summary'),
      API.get('/api/finance/transactions'),
    ]);

    const net = summary.net;
    main.innerHTML = `
      <div class="page-head">
        <div><h1>כלכלי</h1><p>עונת ${e(summary.season)} · רווח והפסד</p></div>
        <div class="actions">${App.canWrite() ? '<button class="btn btn-primary" id="add-txn">+ תנועה ידנית</button>' : ''}</div>
      </div>

      <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
        <div class="tile static"><div class="lbl">הכנסות</div><div class="val" style="color:var(--brand-700)">${UI.num(summary.totalIncome)} <small style="font-size:13px">₪</small></div></div>
        <div class="tile static"><div class="lbl">הוצאות</div><div class="val" style="color:var(--critical)">${UI.num(summary.totalExpense)} <small style="font-size:13px">₪</small></div></div>
        <div class="tile static"><div class="lbl">רווח נקי</div><div class="val" style="color:${net >= 0 ? 'var(--brand-700)' : 'var(--critical)'}">${UI.num(net)} <small style="font-size:13px">₪</small></div></div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-head"><h2>הכנסות</h2><span class="sub">${UI.num(summary.totalIncome)} ₪</span></div>
          <div class="meters">${breakdown(summary.income, summary.totalIncome, 'var(--brand-600)')}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>הוצאות</h2><span class="sub">${UI.num(summary.totalExpense)} ₪</span></div>
          <div class="meters">${breakdown(summary.expenses, summary.totalExpense, 'var(--critical)')}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>תנועות ידניות</h2><span class="sub">${ledger.transactions.length} רשומות</span></div>
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>תאריך</th><th>סוג</th><th>קטגוריה</th><th>תיאור</th><th>סכום (₪)</th><th></th></tr></thead>
            <tbody id="txn-body"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('add-txn') && document.getElementById('add-txn').addEventListener('click', () => txnForm(ledger));
    paintTxns(ledger.transactions);
  }

  function breakdown(rows, total, color) {
    const nonzero = rows.filter(r => r.amount > 0);
    if (!nonzero.length) return UI.empty('—', 'אין נתונים לתקופה');
    return nonzero.map(r => {
      const pct = total ? Math.round(r.amount / total * 100) : 0;
      return `<div class="meter">
        <div class="row"><span>${e(r.source)}</span><b>${UI.num(r.amount)} ₪ · ${pct}%</b></div>
        <div class="track" style="background:var(--grid)"><i class="fill" style="display:block;width:${pct}%;background:${color}"></i></div>
      </div>`;
    }).join('');
  }

  function paintTxns(txns) {
    const body = document.getElementById('txn-body');
    if (!txns.length) { body.innerHTML = `<tr><td colspan="6">${UI.empty('📒', 'אין תנועות ידניות')}</td></tr>`; return; }
    body.innerHTML = txns.map(t => `<tr>
      <td>${UI.fmtShort(t.date)}</td>
      <td><span class="badge ${t.kind === 'income' ? 'ok' : 'bad'}">${t.kind === 'income' ? 'הכנסה' : 'הוצאה'}</span></td>
      <td>${e(t.category)}</td>
      <td>${e(t.description || '—')}</td>
      <td class="num"><b>${UI.num(t.amount)}</b></td>
      <td style="text-align:left">${App.canWrite() ? `<button class="pill-link" data-del="${e(t._id)}">מחיקה</button>` : ''}</td>
    </tr>`).join('');
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirmDialog('מחיקת תנועה', 'למחוק את התנועה?')) return;
      await API.del(`/api/finance/transactions/${b.dataset.del}`); UI.closeModal(); UI.toast('נמחק'); App.go('finance');
    }));
  }

  function txnForm(ledger) {
    UI.openModal({
      title: 'תנועה ידנית',
      submitLabel: 'הוספה',
      body: `<div class="form-grid">
        ${UI.select('kind', 'סוג', [{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }], 'expense')}
        ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
        ${UI.select('category', 'קטגוריה', ledger.expenseCategories, ledger.expenseCategories[0], 'full')}
        ${UI.field('amount', 'סכום (₪)', { type: 'number', required: true, attrs: 'min="0" step="0.01"' })}
        ${UI.textarea('description', 'תיאור', '')}
      </div>`,
      onSubmit: async f => {
        await API.post('/api/finance/transactions', UI.formData(f));
        UI.toast('התנועה נוספה'); App.go('finance');
      },
    });
    // Swap category options when income/expense changes.
    const kind = document.getElementById('f-kind');
    const cat = document.getElementById('f-category');
    kind.addEventListener('change', () => {
      const opts = kind.value === 'income' ? ledger.incomeCategories : ledger.expenseCategories;
      cat.innerHTML = opts.map(o => `<option value="${e(o)}">${e(o)}</option>`).join('');
    });
  }

  return { render };
})();
