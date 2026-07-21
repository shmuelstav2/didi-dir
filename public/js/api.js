'use strict';

/** Thin fetch wrapper: JSON in, JSON out, redirects to login on 401. */
const API = (() => {
  async function call(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (res.status === 401 && !path.endsWith('/auth/me')) {
      location.href = '/login';
      throw new Error('נדרשת התחברות');
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
    }
    if (!res.ok) throw new Error((data && data.error) || `שגיאה ${res.status}`);
    return data;
  }

  function qs(params) {
    const clean = {};
    Object.keys(params || {}).forEach(k => {
      if (params[k] !== '' && params[k] !== null && params[k] !== undefined) clean[k] = params[k];
    });
    const s = new URLSearchParams(clean).toString();
    return s ? `?${s}` : '';
  }

  return {
    get: (p, params) => call('GET', p + qs(params)),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: p => call('DELETE', p),
  };
})();
