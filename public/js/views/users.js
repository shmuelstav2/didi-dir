'use strict';

/** ניהול משתמשים — admin only. */
const UsersView = (() => {
  const e = UI.esc;
  const ROLE_LABEL = { admin: 'מנהל מערכת', manager: 'מנהל חווה', viewer: 'צפייה בלבד' };

  async function render(main) {
    if (App.user.role !== 'admin') {
      main.innerHTML = `<div class="card">${UI.empty('🔒', 'אין לך הרשאה לעמוד הזה')}</div>`;
      return;
    }
    const { users } = await API.get('/api/auth/users');

    main.innerHTML = `
      <div class="page-head">
        <div><h1>ניהול משתמשים</h1><p>${users.length} משתמשים רשומים</p></div>
        <div class="actions"><button class="btn btn-primary" id="add-user">+ משתמש חדש</button></div>
      </div>
      <div class="card">
        <div class="tbl-wrap">
          <table class="compact">
            <thead><tr><th>שם משתמש</th><th>שם</th><th>תפקיד</th><th>כניסה אחרונה</th><th></th></tr></thead>
            <tbody>${users.map(u => `<tr>
              <td class="tag-mono">${e(u.username)}</td>
              <td>${e(u.name || '—')}</td>
              <td><span class="badge ${u.role === 'admin' ? 'info' : u.role === 'manager' ? 'ok' : ''}">${e(ROLE_LABEL[u.role] || u.role)}</span></td>
              <td>${u.lastLogin ? UI.fmtDate(u.lastLogin) : '—'}</td>
              <td style="text-align:left">${u.username !== App.user.username
                ? `<button class="pill-link" data-del="${e(u.username)}">מחיקה</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('add-user').addEventListener('click', form);
    main.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!await UI.confirmDialog('מחיקת משתמש', `למחוק את המשתמש ${b.dataset.del}?`)) return;
        await API.del(`/api/auth/users/${encodeURIComponent(b.dataset.del)}`);
        UI.closeModal();
        UI.toast('המשתמש נמחק');
        App.go('users');
      }));
  }

  function form() {
    UI.openModal({
      title: 'משתמש חדש',
      submitLabel: 'יצירה',
      body: `<div class="form-grid">
        ${UI.field('username', 'שם משתמש', { required: true })}
        ${UI.field('name', 'שם מלא', {})}
        ${UI.select('role', 'תפקיד', [
          { value: 'manager', label: 'מנהל חווה' }, { value: 'viewer', label: 'צפייה בלבד' }, { value: 'admin', label: 'מנהל מערכת' },
        ], 'manager')}
        ${UI.field('password', 'סיסמה', { type: 'password', required: true, hint: '6 תווים לפחות' })}
      </div>`,
      onSubmit: async f => {
        await API.post('/api/auth/users', UI.formData(f));
        UI.toast('המשתמש נוצר');
        App.go('users');
      },
    });
  }

  return { render };
})();
