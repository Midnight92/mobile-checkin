// ---------- helpers ----------
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

const loginBtn = $('loginAdmin');
const logoutBtn = $('logoutAdmin');
const loginBox = $('adminLogin');
const panel = $('panel');
const aerr = $('aerr');

const tabs = document.querySelectorAll('.tab');
const panes = document.querySelectorAll('.tabpane');

const fArea = $('fArea'), fCluster = $('fCluster'), fPlant = $('fPlant'), fCompany = $('fCompany'), fName = $('fName');
const applyBtn = $('apply');
const tbody = document.querySelector('#tbl tbody');
const count = $('count');

const gArea = $('gArea'), gCluster = $('gCluster'), gPlant = $('gPlant');
const start = $('start'), end = $('end');
const loadChartBtn = $('loadChart');

let meta;
let chart;
let pollHandle;
let idleTimer;

const IDLE_MIN = 15;   // auto-logout after 15 min
const POLL_MS = 10000; // table refresh

// ---------- idle/logout ----------
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

// ---------- meta & filter chains ----------
async function loadMeta() {
  meta = await fetchJSON('/api/meta');
}

function buildAreaChain(areaSel, clusterSel, plantSel) {
  function syncAreas() {
    areaSel.innerHTML = '<option value="">All</option>';
    Object.keys(meta.areas).forEach(a => areaSel.appendChild(new Option(a, a)));
  }
  function syncClusters() {
    clusterSel.innerHTML = '<option value="">All</option>';
    const clusters = meta.areas[areaSel.value] || {};
    Object.keys(clusters).forEach(c => clusterSel.appendChild(new Option(c, c)));
    syncPlants();
  }
  function syncPlants() {
    plantSel.innerHTML = '<option value="">All</option>';
    const clusters = meta.areas[areaSel.value] || {};
    (clusters[clusterSel.value] || []).forEach(p => plantSel.appendChild(new Option(p, p)));
  }
  areaSel.addEventListener('change', syncClusters);
  clusterSel.addEventListener('change', syncPlants);
  syncAreas(); syncClusters(); // initialize
}

function initCompany() {
  fCompany.innerHTML = '<option value="">All</option>';
  meta.companies.forEach(c => fCompany.appendChild(new Option(c, c)));
}

function initDates() {
  const now = new Date();
  const toISO = (d) => d.toISOString().slice(0, 10);
  end.value = toISO(now);
  const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 7);
  start.value = toISO(lastWeek);
}

// ---------- table ----------
async function loadTable() {
  const qs = new URLSearchParams();
  if (fArea.value) qs.set('area', fArea.value);
  if (fCluster.value) qs.set('cluster', fCluster.value);
  if (fPlant.value) qs.set('plant', fPlant.value);
  if (fCompany.value) qs.set('company', fCompany.value);
  if (fName.value.trim()) {
    const v = fName.value.trim();
    qs.set('name', v);
  }

  const data = await fetchJSON('/api/admin/logins?' + qs.toString());
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
      <td><button class="btn danger ghost del" data-id="${r.id}">Delete</button></td>`;
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

// ---------- chart ----------
async function loadChart() {
  if (!window.Chart) return;
  const qs = new URLSearchParams({ start: start.value, end: end.value });
  if (gArea.value) qs.set('area', gArea.value);
  if (gCluster.value) qs.set('cluster', gCluster.value);
  if (gPlant.value) qs.set('plant', gPlant.value);

  const rows = await fetchJSON('/api/admin/metrics?' + qs.toString());
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

// ---------- auth flow ----------
async function doLogin() {
  aerr.classList.add('hidden');
  try {
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

  await loadMeta();

  // build independent chains
  buildAreaChain(fArea, fCluster, fPlant);
  initCompany();
  buildAreaChain(gArea, gCluster, gPlant);
  initDates();

  await loadTable();
  await loadChart();
  resetIdleTimer();

  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(loadTable, POLL_MS); // only table is live; graph by button
}

async function boot() {
  try {
    const me = await fetchJSON('/api/admin/me');
    if (me.authed) await enterPanel();
  } catch {}
}
boot();

// ---------- events ----------
loginBtn.addEventListener('click', doLogin);
['u','p'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
logoutBtn.addEventListener('click', async () => { try { await fetchJSON('/api/admin/logout', { method: 'POST' }); } catch {} location.reload(); });

applyBtn.addEventListener('click', loadTable);
loadChartBtn.addEventListener('click', loadChart);

// tabs
tabs.forEach(t => {
  t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    panes.forEach(p => p.classList.add('hidden'));
    t.classList.add('active');
    $(t.dataset.tab).classList.remove('hidden');
    // draw chart if opening Analytics tab and nothing drawn yet
    if (t.dataset.tab === 'tab-analytics' && !chart) loadChart();
  });
});
