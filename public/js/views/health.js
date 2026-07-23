'use strict';

/** טיפול רפואי — treatments with medication, dose, withdrawal window and cost. */
const HealthView = (() => {
  const e = UI.esc;
  const TYPE = { vaccination: 'חיסון', antibiotic: 'אנטיביוטיקה', deworming: 'תילוע', weaning: 'גמילה', other: 'אחר' };
  const STATUS = { planned: 'מתוכנן', in_progress: 'בטיפול', done: 'בוצע' };
  let filter = 'open';

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:140px"></div>`;
    const { treatments } = await API.get('/api/breeding/treatments');

    const open = treatments.filter(t => t.status !== 'done');
    const withdrawing = treatments.filter(t => t.withdrawalDays > 0 && withdrawalUntil(t) >= new Date());

    main.innerHTML = `
      <div class="page-head">
        <div><h1>טיפול רפואי</h1><p>${open.length} טיפולים פתוחים · ${withdrawing.length} בתקופת המתנה</p></div>
        <div class="actions">${App.canWrite() ? '<button class="btn btn-primary" id="add">+ טיפול רפואי</button>' : ''}</div>
      </div>

      <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="tile static"><div class="lbl">פתוחים</div><div class="val">${open.length}</div><div class="pct">מתוכננים או בטיפול</div></div>
        <div class="tile static"><div class="lbl">בתקופת המתנה</div><div class="val">${withdrawing.length}</div><div class="pct">איסור שיווק חלב/בשר</div></div>
        <div class="tile static"><div class="lbl">חיסונים</div><div class="val">${treatments.filter(t => t.type === 'vaccination').length}</div><div class="pct">סה״כ רשומים</div></div>
        <div class="tile static"><div class="lbl">עלות טיפולים</div><div class="val">${UI.num(treatments.reduce((s, t) => s + (t.cost || 0), 0))}</div><div class="pct">₪ מצטבר</div></div>
      </div>

      <div class="toolbar">
        <div class="chips" id="chips"></div>
      </div>

      <div class="card">
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>תאריך</th><th>טיפול</th><th>סוג</th><th>יעד</th><th>תרופה / מנה</th><th>המתנה</th><th>עלות</th><th>סטטוס</th><th></th></tr></thead>
            <tbody id="body"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('add') && document.getElementById('add').addEventListener('click', () => form());
    renderChips();
    paint(treatments);
  }

  function withdrawalUntil(t) {
    return new Date(new Date(t.date).getTime() + (t.withdrawalDays || 0) * 86400000);
  }

  function renderChips() {
    const chips = [['open', 'פתוחים'], ['', 'הכל'], ['vaccination', 'חיסונים'], ['antibiotic', 'אנטיביוטיקה'], ['done', 'בוצעו']];
    document.getElementById('chips').innerHTML = chips.map(([v, l]) =>
      `<button class="chip-f ${filter === v ? 'active' : ''}" data-v="${e(v)}">${e(l)}</button>`).join('');
    document.querySelectorAll('#chips .chip-f').forEach(b =>
      b.addEventListener('click', async () => {
        filter = b.dataset.v;
        renderChips();
        const { treatments } = await API.get('/api/breeding/treatments');
        paint(treatments);
      }));
  }

  function paint(all) {
    let list = all;
    if (filter === 'open') list = all.filter(t => t.status !== 'done');
    else if (filter === 'done') list = all.filter(t => t.status === 'done');
    else if (filter === 'vaccination' || filter === 'antibiotic') list = all.filter(t => t.type === filter);

    const body = document.getElementById('body');
    if (!list.length) { body.innerHTML = `<tr><td colspan="9">${UI.empty('⚕', 'אין טיפולים בסינון זה')}</td></tr>`; return; }

    body.innerHTML = list.map(t => {
      const until = t.withdrawalDays > 0 ? withdrawalUntil(t) : null;
      const active = until && until >= new Date();
      const target = t.groupName || (t.animalTags && t.animalTags.length ? `${t.animalTags.length} חיות` : (t.count ? `${t.count} ראשים` : '—'));
      const sCls = t.status === 'done' ? '' : t.status === 'in_progress' ? 'warn' : 'ok';
      return `<tr>
        <td>${UI.fmtShort(t.date)}</td>
        <td><b>${e(t.title)}</b></td>
        <td>${e(TYPE[t.type] || t.type)}</td>
        <td>${e(target)}</td>
        <td>${t.medication ? e(t.medication) + (t.dose ? ` · ${e(t.dose)}` : '') : '—'}</td>
        <td>${t.withdrawalDays ? `${t.withdrawalDays} ימים${active ? ` <span class="badge bad">עד ${UI.fmtShort(until)}</span>` : ''}` : '—'}</td>
        <td class="num">${t.cost ? UI.num(t.cost) + ' ₪' : '—'}</td>
        <td><span class="badge ${sCls}">${e(STATUS[t.status])}</span></td>
        <td style="text-align:left">${App.canWrite()
          ? `${t.status !== 'done' ? `<button class="pill-link" data-done="${e(t._id)}">סיום</button> ` : ''}<button class="pill-link" data-del="${e(t._id)}">מחיקה</button>` : ''}</td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', async () => {
      await API.put(`/api/breeding/treatments/${b.dataset.done}`, { status: 'done' });
      UI.toast('הטיפול סומן כבוצע'); App.go('health');
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirmDialog('מחיקת טיפול', 'למחוק את הטיפול?')) return;
      await API.del(`/api/breeding/treatments/${b.dataset.del}`);
      UI.closeModal(); UI.toast('הטיפול נמחק'); App.go('health');
    }));
  }

  function form() {
    UI.openModal({
      title: 'טיפול רפואי חדש',
      wide: true,
      submitLabel: 'הוספה',
      body: `<div class="form-grid">
        ${UI.field('title', 'כותרת', { required: true, cls: 'full' })}
        ${UI.select('type', 'סוג', [
          { value: 'vaccination', label: 'חיסון' }, { value: 'antibiotic', label: 'אנטיביוטיקה' },
          { value: 'deworming', label: 'תילוע' }, { value: 'other', label: 'אחר' },
        ], 'vaccination')}
        ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
        ${UI.field('groupName', 'קבוצה / יעד', {})}
        ${UI.field('count', 'מספר ראשים', { type: 'number', attrs: 'min="0"' })}
        ${UI.field('medication', 'תרופה', {})}
        ${UI.field('dose', 'מנה', { attrs: 'placeholder="למשל 2 מ״ל"' })}
        ${UI.field('withdrawalDays', 'ימי המתנה', { type: 'number', attrs: 'min="0"', hint: 'איסור שיווק חלב/בשר' })}
        ${UI.field('cost', 'עלות (₪)', { type: 'number', attrs: 'min="0" step="0.01"' })}
        ${UI.select('status', 'סטטוס', [
          { value: 'planned', label: 'מתוכנן' }, { value: 'in_progress', label: 'בטיפול' }, { value: 'done', label: 'בוצע' },
        ], 'planned')}
        ${UI.textarea('notes', 'הערות', '')}
      </div>`,
      onSubmit: async f => {
        await API.post('/api/breeding/treatments', UI.formData(f));
        UI.toast('הטיפול נוסף'); App.go('health');
      },
    });
  }

  return { render };
})();
