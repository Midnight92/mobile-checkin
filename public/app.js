// ---- helpers ----
function isMobileOrTablet() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return /android|iphone|ipad|ipod|windows phone|mobile/i.test(ua) || coarse;
}

function getDeviceId() {
  const key = 'deviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    id = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, id);
  }
  return id;
}

async function fetchJSON(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = 'request_error';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  } catch (e) {
    throw e;
  }
}

// ---- dom refs ----
const $ = (id) => document.getElementById(id);
const desktopBlock = $('desktop-block');
const app = $('app');
const formWrap = $('form-wrap');
const welcome = $('welcome');
const salam = $('salam');
const logoutBtn = $('logoutBtn');
const errBox = $('err');

// ---- ui helpers ----
function showWelcome(firstName) {
  salam.textContent = `Salam ${firstName}, Please stay safe`;
  formWrap.classList.add('hidden');
  welcome.classList.remove('hidden');
}
function showForm() {
  welcome.classList.add('hidden');
  formWrap.classList.remove('hidden');
}

// ---- main ----
async function init() {
  if (!isMobileOrTablet()) {
    desktopBlock.classList.remove('hidden');
    return;
  }

  app.classList.remove('hidden');

  // Bind logout FIRST so it always works even after a fresh reopen
  const deviceId = getDeviceId();
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetchJSON('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId })
      });
    } catch (_) {
      // ignore network errors; still return to form
    } finally {
      // Always return to the form page state
      window.location.href = '/';
    }
  }, { once: false });

  // Initially show form (we'll flip to welcome if session exists)
  showForm();

  // Load dropdown metadata
  let meta;
  try {
    meta = await fetchJSON('/api/meta');
  } catch {
    errBox.textContent = 'Failed to load form data. Check your connection.';
    errBox.classList.remove('hidden');
    return;
  }

  // Populate company
  const companySel = $('company');
  companySel.innerHTML = '';
  (meta.companies || []).forEach(c => companySel.appendChild(new Option(c, c)));

  // Populate Area → Cluster → Plant
  const areaSel = $('area');
  const clusterSel = $('cluster');
  const plantSel = $('plant');

  function syncAreas() {
    areaSel.innerHTML = '';
    Object.keys(meta.areas || {}).forEach(a => areaSel.appendChild(new Option(a, a)));
  }
  function syncClusters() {
    clusterSel.innerHTML = '';
    const clusters = (meta.areas || {})[areaSel.value] || {};
    Object.keys(clusters).forEach(cl => clusterSel.appendChild(new Option(cl, cl)));
    syncPlants();
  }
  function syncPlants() {
    plantSel.innerHTML = '';
    const clusters = (meta.areas || {})[areaSel.value] || {};
    const plants = clusters[clusterSel.value] || [];
    plants.forEach(p => plantSel.appendChild(new Option(p, p)));
  }

  syncAreas();
  areaSel.addEventListener('change', syncClusters);
  clusterSel.addEventListener('change', syncPlants);
  // initialize chain
  syncClusters();

  // Default date/time to device now
  const now = new Date();
  $('date').value = now.toISOString().slice(0, 10);
  $('time').value = now.toTimeString().slice(0, 5);

  // If already logged in on this device, switch UI (do NOT return)
  try {
    const st = await fetchJSON(`/api/status?deviceId=${deviceId}`);
    if (st.loggedIn) showWelcome(st.firstName);
  } catch {
    // ignore
  }

  // Submit handler
  const form = $('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');

    const data = Object.fromEntries(new FormData(form).entries());
    const ts = `${data.date} ${data.time}`;

    try {
      await fetchJSON('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          firstName: (data.firstName || '').trim(),
          lastName: (data.lastName || '').trim(),
          jobId: (data.jobId || '').trim(),
          phone: (data.phone || '').trim(),
          company: data.company,
          area: data.area,
          cluster: data.cluster,
          plant: data.plant,
          ts
        })
      });
      showWelcome((data.firstName || '').trim());
    } catch {
      errBox.textContent = 'Could not save. Please try again.';
      errBox.classList.remove('hidden');
    }
  });
}

init();
