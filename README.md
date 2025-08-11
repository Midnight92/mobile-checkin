# Mobile-Only Check-In App

A simple, responsive web app that only allows access from phones/tablets. Returning devices are remembered using a persistent device identifier (stored in `localStorage`). Submissions are saved to a local SQLite database. An admin page at `/Qadmin` lists all currently logged-in users with filters.

## Features
- Blocks desktop; allows phone/tablet UI.
- Form with First/Last name, Job ID, Phone, Company, Area → Plant (dependent), Date, Time.
- "Log in" saves record; success page shows “Salam {FirstName} Please stay safe” with a "Log Out" button.
- Closing the site preserves the session on that device until logout.
- Admin page `/Qadmin` with login/logout; shows count + filterable table.

## Quick start
```bash
cp .env.example .env
npm install
npm run dev
# open http://localhost:3000
```

## Admin login
Set `ADMIN_USER` and `ADMIN_PASS` in `.env`. Default is `admin` / `changeme`.

## Notes
- Browsers cannot expose device MAC addresses to websites. This app uses a randomly generated `deviceId` stored in `localStorage` to recognize the device.
- Data is stored in `data.db` (SQLite) in the project root.
