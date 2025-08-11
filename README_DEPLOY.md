# Deploy to Render + Neon (Free)

## 1) Create a free Postgres on Neon
- Go to https://neon.tech → Create project (Free tier).
- Copy the **connection string**; append `?sslmode=require` if not present.

## 2) Set up environment variables
On Render (or locally for testing), set:
    NODE_ENV=production
    PORT=3000
    SESSION_SECRET=<long random string>
    SESSION_MINUTES=120
    ADMIN_USER=admin
    ADMIN_PASS=<your password>
    DATABASE_URL=<your Neon connection string>


## 3) Deploy on Render
- Push this branch to GitHub.
- Render → **New → Web Service** → connect repo.
- Build: `npm install`
- Start: `node server.js`
- Add the env vars above.
- Deploy. First cold start may take ~30s on free tier.

## 4) App URLs
- App: `https://<render-subdomain>.onrender.com/`
- Admin: `https://<render-subdomain>.onrender.com/Qadmin`

## Notes
- Sessions are stored in Postgres via `connect-pg-simple`.
- Analytics table `login_events` persists counts even after user logout.
- If you later move to a custom domain, enable “trust proxy” (already set) and consider HTTPS-only cookies.

