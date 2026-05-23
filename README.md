# Deal Manager

## Setup

### 1. Backend
```bash
cd server
npm install
```
Open `server/.env` and paste your MongoDB connection string:
```
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/deal-manager
PORT=4000
CORS_ORIGIN=http://localhost:5173
```

### 2. Frontend
```bash
# in root folder
npm install
```

## Run (VS Code)
Press `Ctrl+Shift+B` → **Start Both** (runs backend + frontend together)

Or run manually in two terminals:
```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend
npm run dev
```

Open http://localhost:5173

## Project structure
```
deal-manager/
├── src/                  # React frontend
│   ├── lib/
│   │   ├── api.ts        # All MongoDB calls (replaces old db.ts)
│   │   ├── types.ts
│   │   ├── compute.ts
│   │   ├── excel.ts
│   │   └── formulas.ts
│   ├── components/
│   └── App.tsx
├── server/               # Express backend
│   ├── src/
│   │   ├── index.js      # Entry point
│   │   ├── models.js     # Mongoose schemas
│   │   └── routes.js     # REST API routes
│   └── .env              # ← paste MONGO_URI here
└── .env                  # Frontend env (VITE_API_URL)
```

## API endpoints
| Method | Path | Action |
|--------|------|--------|
| GET/PUT | /api/deals | bulk read/write base deals |
| PUT/DELETE | /api/deals/:id | single deal |
| GET | /api/months | list all months |
| POST | /api/months/next | create next month with snapshots |
| GET/PUT | /api/month-records/:monthId | records for a month |
| PUT | /api/month-records/:id | single record |
| POST | /api/propagate-snapshot | forward-propagate balance |
| GET/PUT | /api/meta/:key | activeMonthId / formulas |
