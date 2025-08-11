// ---- tiny helpers ----
const $ = (id) => document.getElementById(id);
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { cache: 'no-store', ...opts });
  if (!res.ok) {
    let msg = 'request_error';
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ---- DOM ----
const loginBtn = $('loginAdmin');
const logoutBtn = $('logoutAdmin');
const panel = $('panel');
const loginBox = $('adminLogin');
const aerr = $('aerr');

const fArea = $('fArea');
const fCluster = $('fCluster');
const fPlant = $('fPlant');
const fCompany = $('fCompany');
const fName = $('fName');
const applyBtn = $('apply');
const tbody = document.querySelector('#tbl tbody');
const count = $('count');
const start = $('start');
const end = $('end');
let chart, pollHandle, idleTimer;

const IDLE_MIN = 15;           // auto-logout after 15 mins idle
const POLL_MS = 10000;         // live refresh every 10s

// ---- idle logout ----
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    try { await fetchJSON('/api/admin/logout', { method: 'POST' }); } catch {}
    location.reload();
  }, IDLE_MIN * 60 * 1000);
}
['mousemove','keydown','click','touchstart','scroll'].forEach(ev =>
  window.addEventListener(ev, resetIdleTimer, { passive: true })
);

// ---- Filters/meta ----
async function initFilters() {
  const meta = await fetchJSON('/api/meta');
  // areas
  fArea.innerHTML = '<option value="">All</option>';
  Object.keys(meta.areas).forEach(a => fArea.appendChild(new Option(a, a)));
  // companies
  fCompany.innerHTML = '<option value="">All</option>';
  meta.companies.forEach(c => fCompany.appendChild(new Option(c, c)));

  function syncClusters() {
    fCluster.innerHTML = '<option value="">All</option>';
    const clusters = meta.areas[fArea.value] || {};
    Object.keys(clusters).forEach(cl => fCluster.appendChild(new Option(cl, cl)));
    syncPlants();
  }
  function syncPlants() {
    fPlant.innerHTML = '<option value="">All</option>';
    const clusters = meta.areas[fArea.value] || {};
    (clusters[fCluster.value] || []).forEach(p => fPlant.appendChild(new Option(p, p)));
  }

  fArea.addEventListener('change', syncClusters);
  fCluster.addEventListener('change', syncPlants);
  syncClusters();

  // default range: last 7 days → today
  const now = new Date();
  const toISO = (d) => d.toISOString().slice(0, 10);
  end.value = toISO(now);
  const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 7);
  start.value = toISO(lastWeek);
}

// ---- table & chart ----
async function loadTable() {
  const params = new URLSearchParams();
  if (fArea.value) params.set('area', fArea.value);
  if (fCluster.value) params.set('cluster', fCluster.value);
  if (fPlant.value) params.set('plant', fPlant.value);
  if (fCompany.value) params.set('company', fCompany.value);
  if (fName.value.trim()) params.set('name', fName.value.trim());

  const data = await fetchJSON('/api/admin/logins?' + params.toString());
  count.textContent = `${data.count} currently logged in`;
  tbody.innerHTML = '';
  data.rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.first_name} ${r.last_name}</td>
      <td>${r.job_id}</td>
      <td>${r.phone}</td>
      <td>${r.company}</td>
      <td>${r.area}</td>
      <td>${r.cluster || ''}</td>
      <td>${r.plant}</td>
      <td>${r.ts}</td>
      <td><button data-id="${r.id}" class="del">Delete</button></td>`;
    tbody.appendChild(tr);
  });
  // bind deletes
  tbody.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      if (!confirm('Delete this user session?')) return;
      try { await fetchJSON('/api/admin/login/' + id, { method: 'DELETE' }); await loadTable(); }
      catch {}
    });
  });
}

async function loadChart() {
  if (!window.Chart) return; // guard CDN
  const params = new URLSearchParams({ start: start.value, end: end.value });
  if (fArea.value) params.set('area', fArea.value);
  if (fCluster.value) params.set('cluster', fCluster.value);
  if (fPlant.value) params.set('plant', fPlant.value);

  const rows = await fetchJSON('/api/admin/metrics?' + params.toString());
  const labels = rows.map(r => r.date);
  const counts = rows.map(r => r.count);

  const ctx = document.getElementById('loginChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Logins', data: counts }] },
    options: { responsive: true, maintainAspectRatio: false, resizeDelay: 100 }
  });
}

// ---- auth flow ----
async function doLogin() {
  aerr.classList.add('hidden');
  try {
    // IMPORTANT: actually call the login API
    await fetchJSON('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ username: $('u').value, password: $('p').value })
    });
    await enterPanel();
  } catch (e) {
    aerr.textContent = (e && e.message === 'bad_creds') ? 'Wrong username or password' : 'Login failed';
    aerr.classList.remove('hidden');
  }
}

async function enterPanel() {
  loginBox.classList.add('hidden');
  panel.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  await initFilters();
  await loadTable();
  await loadChart();
  resetIdleTimer();
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(async () => { await loadTable(); await loadChart(); }, POLL_MS);
}

async function boot() {
  // First, check if we already have a session
  try {
    const me = await fetchJSON('/api/admin/me');
    if (me.authed) { await enterPanel(); }
  } catch { /* not authed; stay on login box */ }
}
boot();

// ---- events ----
loginBtn.addEventListener('click', doLogin);
// enter key submits
['u','p'].forEach(id => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); }));
logoutBtn.addEventListener('click', async () => { await fetchJSON('/api/admin/logout', { method: 'POST' }); location.reload(); });
applyBtn.addEventListener('click', async () => { await loadTable(); await loadChart(); });
$('loadChart').addEventListener('click', loadChart);
