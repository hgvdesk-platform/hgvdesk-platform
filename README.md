# HGV Platform — Run & Deploy Guide

## What's in this folder

```
hgv-platform/
├── server.js          ← The entire backend (no dependencies, pure Node.js)
├── README.md          ← This file
└── public/
    ├── hgv-workshop.html   ← Workshop system UI
    ├── hgv-inspect.html    ← Inspect system UI
    ├── hgv-parts.html      ← Parts system UI
    └── hgv-command.html    ← Command centre UI
```

---

## Run locally (right now, on your laptop)

1. Make sure Node.js is installed (https://nodejs.org — get LTS version)
2. Open Terminal (Mac) or Command Prompt (Windows)
3. Navigate to this folder:
   ```
   cd hgv-platform
   ```
4. Start the server:
   ```
   node server.js
   ```
5. You'll see:
   ```
   ╔══════════════════════════════════════════════╗
   ║         HGV PLATFORM — SERVER LIVE           ║
   ╠══════════════════════════════════════════════╣
   ║  http://localhost:3000                        ║
   ...
   ```
6. Open the HTML files in your browser — they will now connect to your live server.

**Important:** Keep the Terminal open while using the system. Closing it stops the server.

---

## Deploy free online (so anyone can access it)

### Option 1: Railway.app (Recommended — easiest)

1. Create a free account at https://railway.app
2. Create a new GitHub repo and push this folder to it
3. In Railway: New Project → Deploy from GitHub → select your repo
4. Railway auto-detects Node.js and deploys
5. It gives you a URL like `https://hgv-platform-production.up.railway.app`
6. Update the `API_BASE` in each HTML file from `http://localhost:3000` to that URL
7. Done — your platform is live on the internet

### Option 2: Render.com (Also free)

1. Create account at https://render.com
2. New → Web Service → connect your GitHub repo
3. Build Command: (leave blank)
4. Start Command: `node server.js`
5. Deploy — get your URL, update `API_BASE` in the HTML files

### Option 3: Fly.io (Slightly more technical, very reliable)

1. Install Fly CLI: https://fly.io/docs/getting-started/installing-flyctl/
2. Run `fly launch` in this folder
3. Run `fly deploy`
4. Get your URL

---

## Upgrade to a real database (when you're ready)

The server currently uses in-memory storage — data resets when the server restarts.

To persist data with PostgreSQL:
1. Replace the `DB` object in `server.js` with `pg` queries
2. Railway and Render both offer free PostgreSQL databases
3. Set `DATABASE_URL` environment variable
4. The API routes stay exactly the same — only the data layer changes

---

## API Reference

All endpoints return JSON.

### Workshop
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/jobs | List all jobs |
| POST | /api/jobs | Create new job |
| GET | /api/jobs/:id | Get single job |
| PUT | /api/jobs/:id | Update job |
| POST | /api/jobs/:id/send | Send to floor → fires to Inspect + Parts |
| POST | /api/sync/parts-update | Receive parts status from Parts |

### Inspect
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/inspections | List all inspections |
| POST | /api/inspections | Create inspection |
| GET | /api/inspections/:id | Get single inspection |
| PUT | /api/inspections/:id | Update inspection / complete |
| POST | /api/sync/assigned-job | Receive job from Workshop |
| POST | /api/sync/defects | Send defects to Parts |

### Parts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/parts | List all parts |
| POST | /api/parts | Add part manually |
| GET | /api/parts/:id | Get single part |
| PUT | /api/parts/:id | Update part / mark ready |
| POST | /api/inbound/job | Receive job from Workshop |
| POST | /api/inspection-defects | Receive defects from Inspect |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check — all 3 systems |
| GET | /api/stats | Live counts across all systems |

---

## The data flow

```
WORKSHOP  ──POST /api/jobs/:id/send──►  INSPECT (creates inspection)
          └──POST /api/inbound/job───►  PARTS   (creates parts record)

INSPECT   ──POST /api/sync/defects──►  PARTS   (raises defect parts)

PARTS     ──POST /api/sync/parts-update──►  WORKSHOP (status sync)
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |

Set on Railway/Render via their dashboard. Railway sets PORT automatically.
