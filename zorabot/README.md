# ZoraBot

Portable WhatsApp **JadiBot** platform — dashboard multi-tenant + Baileys engine + MongoDB.

## Quick start

```bash
cp .env.example .env   # isi MONGODB_URI, JWT_SECRET
npm install
npm start
```

Buka `http://localhost:3000` → `/login` → dashboard.

## Clean URLs (tanpa .html)

| Path | Halaman |
|------|---------|
| `/login` | Masuk / Daftar |
| `/dashboard` | Dashboard |
| `/connect` | Connect Bot (QR / Pairing) |
| `/bot-settings` | Bot Settings |
| `/feature-settings` | Feature Settings |
| `/upgrade` | Order Plan Premium |
| `/account` | Account |

## Environment

```
MONGODB_URI=mongodb+srv://...
JWT_SECRET=long-random-string
PORT=3000
APP_URL=http://localhost:3000
SOCIABUZZ_USERNAME=reyzdesu
OWNER_NUMBER=628xxxxxxxxxx
```

## Docker

```bash
docker build -t zorabot .
docker run -p 3000:3000 --env-file .env zorabot
```

## Architecture

- `index.js` — Express + BotManager
- `lib/botManager.js` — multi-session Baileys, no duplicate listeners
- `lib/mongoAuthState.js` — WA session di MongoDB
- `lib/featureGate.js` — feature OFF = logic tidak jalan
- `server/` — auth JWT, bots, settings, premium
- `public/` — multi-page dashboard (hamburger)

## Premium

Rp25.000/bulan via SociaBuzz. Status dicek **manual** (tombol Cek Status), tanpa polling.

## Notes

- Bot engine butuh proses Node.js **persistent** (bukan pure serverless).
- Session WA tidak pernah dikirim ke frontend.
- User hanya akses bot miliknya (`ownerId` di setiap query).
