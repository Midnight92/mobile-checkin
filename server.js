import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import morgan from 'morgan';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Postgres pool ---
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- init tables ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logins (
      id SERIAL PRIMARY KEY,
      device_id TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      job_id TEXT,
      phone TEXT,
      company TEXT,
      area TEXT,
      cluster TEXT,
      plant TEXT,
      ts TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_events (
      id SERIAL PRIMARY KEY,
      ts_date DATE NOT NULL,
      area TEXT,
      cluster TEXT,
      plant TEXT,
      count INTEGER DEFAULT 1,
      CONSTRAINT uniq_ev UNIQUE (ts_date, area, cluster, plant)
    );
  `);
}
initDb().catch(console.error);

// --- Middleware ---
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('etag', false);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

// --- Sessions (Postgres) ---
const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 1000 * 60 * (process.env.SESSION_MINUTES ? Number(process.env.SESSION_MINUTES) : 120),
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Meta (Area > Cluster > Plant) ---
const META = {
  companies: ['PDO', 'BP Oman', 'OQ', 'CCED', 'Schlumberger'],
  areas: {
    North: { 'Cluster N1': ['Plant N1-A', 'Plant N1-B'], 'Cluster N2': ['Plant N2-A'] },
    Central: { 'Cluster C1': ['Plant C1-A', 'Plant C1-B'], 'Cluster C2': ['Plant C2-A'] },
    South: { 'Cluster S1': ['Plant S1-A', 'Plant S1-B', 'Plant S1-C'], 'Cluster S2': ['Plant S2-A'] }
  }
};

// --- Helpers ---
const requireAdmin = (req, res, next) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// --- Public API ---
app.get('/api/meta', (req, res) => res.json(META));

app.get('/api/status', async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.json({ loggedIn: false });
  try {
    const { rows } = await pool.query('SELECT first_name FROM logins WHERE device_id = $1', [deviceId]);
    if (rows.length === 0) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, firstName: rows[0].first_name });
  } catch {
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/login', async (req, res) => {
  const { deviceId, firstName, lastName, jobId, phone, company, area, cluster, plant, ts } = req.body;
  if (!deviceId || !firstName || !lastName || !jobId || !phone || !company || !area || !cluster || !plant || !ts) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    await pool.query(
      `INSERT INTO logins (device_id, first_name, last_name, job_id, phone, company, area, cluster, plant, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (device_id) DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name  = EXCLUDED.last_name,
         job_id     = EXCLUDED.job_id,
         phone      = EXCLUDED.phone,
         company    = EXCLUDED.company,
         area       = EXCLUDED.area,
         cluster    = EXCLUDED.cluster,
         plant      = EXCLUDED.plant,
         ts         = EXCLUDED.ts`,
      [deviceId, firstName, lastName, jobId, phone, company, area, cluster, plant, ts]
    );

    const dateOnly = ts.slice(0, 10); // yyyy-mm-dd
    await pool.query(
      `INSERT INTO login_events (ts_date, area, cluster, plant, count)
       VALUES ($1,$2,$3,$4,1)
       ON CONFLICT (ts_date, area, cluster, plant) DO UPDATE SET count = login_events.count + 1`,
      [dateOnly, area, cluster, plant]
    );

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/logout', async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'missing_device' });
  try {
    const out = await pool.query('DELETE FROM logins WHERE device_id = $1', [deviceId]);
    res.json({ ok: true, deleted: out.rowCount });
  } catch {
    res.status(500).json({ error: 'db' });
  }
});

// --- Admin auth ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_PLAIN = process.env.ADMIN_PASS || 'changeme';
let ADMIN_HASH;
(async () => { ADMIN_HASH = await bcrypt.hash(ADMIN_PASS_PLAIN, 10); })();

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER) return res.status(401).json({ error: 'bad_creds' });
  const ok = await bcrypt.compare(password, ADMIN_HASH);
  if (!ok) return res.status(401).json({ error: 'bad_creds' });
  req.session.admin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => res.json({ authed: !!req.session.admin }));

// --- Admin data ---
app.get('/api/admin/logins', requireAdmin, async (req, res) => {
  const { area, cluster, plant, name, company } = req.query;
  const where = [];
  const vals = [];
  if (area)    { where.push(`area = $${where.length+1}`);    vals.push(area); }
  if (cluster) { where.push(`cluster = $${where.length+1}`); vals.push(cluster); }
  if (plant)   { where.push(`plant = $${where.length+1}`);   vals.push(plant); }
  if (company) { where.push(`company = $${where.length+1}`); vals.push(company); }
  if (name)    { where.push(`(first_name ILIKE $${where.length+1} OR last_name ILIKE $${where.length+2})`);
                 vals.push(`%${name}%`, `%${name}%`); }
  const sql = `SELECT id, first_name, last_name, job_id, phone, company, area, cluster, plant, ts
               FROM logins ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC`;
  try {
    const { rows } = await pool.query(sql, vals);
    res.json({ count: rows.length, rows });
  } catch {
    res.status(500).json({ error: 'db' });
  }
});

app.delete('/api/admin/login/:id', requireAdmin, async (req, res) => {
  try {
    const out = await pool.query('DELETE FROM logins WHERE id = $1', [req.params.id]);
    res.json({ ok: true, deleted: out.rowCount });
  } catch {
    res.status(500).json({ error: 'db' });
  }
});

app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  const { start, end, area, cluster, plant } = req.query;
  const where = [];
  const vals = [];
  if (start)  { where.push(`ts_date >= $${where.length+1}`); vals.push(start); }
  if (end)    { where.push(`ts_date <= $${where.length+1}`); vals.push(end); }
  if (area)   { where.push(`area = $${where.length+1}`);     vals.push(area); }
  if (cluster){ where.push(`cluster = $${where.length+1}`);  vals.push(cluster); }
  if (plant)  { where.push(`plant = $${where.length+1}`);    vals.push(plant); }

  const sql = `SELECT ts_date AS date, SUM(count) AS count
               FROM login_events
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               GROUP BY ts_date
               ORDER BY ts_date`;
  try {
    const { rows } = await pool.query(sql, vals);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'db' });
  }
});

// --- Health & pages ---
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/Qadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
