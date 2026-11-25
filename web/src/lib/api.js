const jsonHeaders = { 'Content-Type': 'application/json' };

async function handle(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) || (typeof data === 'string' ? data : 'Request failed');
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => fetch(p).then(handle),
  post: (p, body) => fetch(p, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body ?? {}) }).then(handle),
  del: (p) => fetch(p, { method: 'DELETE' }).then(handle),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(p, { method: 'POST', body: fd }).then(handle);
  },
};

export default api;
