const jsonHeaders = { 'Content-Type': 'application/json' };
const withSession = (options = {}) => ({ ...options, credentials: 'include' });

async function handle(res, path) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 && !String(path).startsWith('/api/auth/login')) {
      window.dispatchEvent(new CustomEvent('gst:unauthorized'));
    }
    const msg = (data && data.error) || (typeof data === 'string' ? data : 'Request failed');
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => fetch(p, withSession()).then((r) => handle(r, p)),
  post: (p, body) => fetch(p, withSession({
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(body ?? {}),
  })).then((r) => handle(r, p)),
  del: (p) => fetch(p, withSession({ method: 'DELETE' })).then((r) => handle(r, p)),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(p, withSession({ method: 'POST', body: fd })).then((r) => handle(r, p));
  },
};

export default api;
