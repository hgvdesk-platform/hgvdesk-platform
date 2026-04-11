const API_KEY = '13940e4c045e4b2691354522b103d7be';
const BASE = '';

async function apiCall(method, path, body) {
  try {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + '/api' + path, opts);
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('API Error:', e);
    return null;
  }
}

const LIVE = {
  getJobs: () => apiCall('GET', '/jobs'),
  createJob: (d) => apiCall('POST', '/jobs', d),
  sendToFloor: (id, targets) => apiCall('POST', `/jobs/${id}/send`, { targets }),
  getInspections: () => apiCall('GET', '/inspections'),
  getParts: () => apiCall('GET', '/parts'),
  updatePart: (id, d) => apiCall('PUT', `/parts/${id}`, d),
  getOverview: () => apiCall('GET', '/command/overview'),
  health: () => apiCall('GET', '/health')
};

// Auto-load live data when page is ready
window.addEventListener('DOMContentLoaded', async () => {
  console.log('[HGV] Connecting to live API...');
  const h = await LIVE.health();
  if (h && h.status === 'healthy') {
    console.log('[HGV] Live API connected ✅', h);
    window._liveAPI = LIVE;
    window.dispatchEvent(new CustomEvent('hgv:ready', { detail: h }));
  }
});
