# MEGA Stream

A personal MEGA-backed video library that runs on your VPS. It indexes video files from one MEGA account and streams selected files through the VPS to a browser video player.

## MVP features

- One MEGA account, with credentials kept on the server.
- Recursive video catalogue and search.
- Mobile-friendly browser player.
- HTTP byte-range streaming for seeking.
- App-password login with HTTP-only session cookies.
- No full-video download to the VPS is required by the app.
- Docker Compose deployment.

MEGAJS documents logged-in storage, file metadata, chunked downloads and start/end download options: https://mega.js.org/docs/1.0/api

## Important limitations

- This is an initial personal-use implementation, not a production CDN.
- Browser playback depends on codecs. MP4 with H.264/AAC is broadly compatible; MKV/HEVC may not play in some browsers.
- MEGA transfer quotas and service limits still apply; no speed or quota is guaranteed.
- Test login, byte-range seeking and long playback with your account before relying on it.
- The initial session store is in-memory; restarts invalidate sessions.
- Docker binds port 8080 to localhost by default. Do not expose the app directly to the public internet; use Tailscale or a trusted HTTPS reverse proxy.
- Use only files you are entitled to access and follow MEGA's current terms.

## Deploy on Oracle VPS

1. Clone the repo or update an existing checkout.

```bash
git clone https://github.com/wroxtaaar/MEGA-Stream.git
cd MEGA-Stream
```

2. Configure secrets:

```bash
cp .env.example .env
nano .env
```

Set `MEGA_EMAIL`, `MEGA_PASSWORD`, optional `MEGA_TFA_CODE`, `APP_PASSWORD`, and `SESSION_SECRET`. Generate a secret with `openssl rand -hex 32`. Never commit `.env` or put MEGA credentials in browser code.

3. Start:

```bash
docker compose up -d --build
docker compose logs -f mega-stream
```

4. For private access over your tailnet, run on the VPS:

```bash
tailscale serve --bg http://127.0.0.1:8080
```

Use the HTTPS URL Tailscale reports. Alternatively, configure a trusted HTTPS reverse proxy. Do not open port 8080 publicly.

5. Confirm videos load, seek to the middle and end, and check browser requests for `206 Partial Content` and `Content-Range`.

Health endpoint: `GET /healthz` (available locally on the VPS at `http://127.0.0.1:8080/healthz`).

## API

- `GET /api/status` — status.
- `POST /api/login` — app password login.
- `POST /api/logout` — end session.
- `GET /api/videos` — list videos.
- `GET /api/videos?refresh=1` — force library refresh.
- `GET /api/account` — account quota information where available.
- `GET /api/stream/:id` — video stream with Range support.
- `HEAD /api/stream/:id` — video metadata.

All library and stream endpoints require an authenticated app session.
