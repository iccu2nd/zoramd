# ZoraBot

Portable WhatsApp **JadiBot** platform. Dashboard + multi-bot engine, ready for Railway, Render, VPS, Docker, or any standard Node.js host.

## Features

- **Core Bot**: Baileys, Pairing Code & QR, session persisted in MongoDB (reconnect after restart without re-pair)
- **Portable**: env-based config, standard `npm start`, Dockerfile included — no lock-in to a specific provider
- **Multi-tenant**: each user only sees/owns their own bots
- **Dashboard**: Hamburger menu — Dashboard, Connect Bot, Bot Settings, Feature Settings, Upgrade Plan, Account
- **Free / Premium** (Rp25.000/bulan via SociaBuzz, manual status check)
- **Feature Settings**: ON/OFF, custom response/command, access rules (premium)
- **Security**: secrets only in env / backend; no credential exposure to frontend

## Requirements

- Node.js ≥ 18
- MongoDB (Atlas or self-hosted)

## Quick Start

```bash
cp .env.example .env
# edit MONGODB_URI and JWT_SECRET

npm install
npm start
```

Open `http://localhost:3000` → register → create bot → Connect (QR or Pairing).

## Docker

```bash
docker build -t zorabot .
docker run -p 3000:3000 --env-file .env zorabot
```

## Environment

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string (required) |
| `JWT_SECRET` | Secret for dashboard JWT |
| `PORT` | HTTP port (default 3000) |
| `APP_URL` | Public base URL |
| `SOCIABUZZ_USERNAME` | SociaBuzz username for payments |
| `OWNER_NUMBER` | Optional system owner number |

## Architecture

- `index.js` — starts Express (dashboard/API) + BotManager
- `lib/botManager.js` — multi-session Baileys, no duplicate listeners
- `lib/mongoAuthState.js` — WhatsApp session in MongoDB
- `server/` — auth, bots, settings, premium APIs
- `public/` — simple responsive dashboard (white, clean UI)
- `plugins/` — bot commands (existing)

Frontend and backend run in one process by default; you can reverse-proxy or split later. Core bot needs a **persistent** Node process (not pure serverless).

## Premium flow

1. User opens Upgrade Plan → creates SociaBuzz payment  
2. User pays  
3. User presses **Cek Status Pembayaran** (manual, no auto-polling)  
4. Backend validates → activates Premium 30 days  

## Notes

- Do not store full WhatsApp message history long-term (already avoided)
- Feature OFF = plugin logic is skipped entirely
- After redeploy, connected bots resume automatically if Mongo session is still valid
