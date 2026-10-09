# MEGA Stream

A browser-based MEGA video library hosted on your Oracle VPS. Open the website in Chrome on a phone, PC, or compatible TV browser. No Android app, phone-side Tailscale, or app password is required for this experimental setup.

## MVP features

- One MEGA account, with credentials kept on the server.
- Public, no-login website for experimentation.
- Recursive video catalogue and search.
- Mobile-friendly browser player.
- HTTP byte-range streaming for seeking.
- No full-video download to the VPS is required by the app.
- Docker Compose deployment.

MEGAJS documents logged-in storage, file metadata, chunked downloads and start/end download options: https://mega.js.org/docs/1.0/api

## Important notes

- **Anyone who can reach the URL can browse and stream the indexed video library.** This is intentional for your current experiment; do not put private files in this MEGA account while the site is public.
- The temporary setup uses HTTP on port 8080. Add a domain and HTTPS later before treating it as a long-term service.
- This is an initial personal-use implementation, not a production CDN.
- Browser playback depends on codecs. MP4 with H.264/AAC is broadly compatible; MKV/HEVC may not play in some browsers.
- MEGA transfer quotas and service limits still apply; no speed or quota is guaranteed.
- Test MEGA connection, byte-range seeking and long playback with your account.
- Use only files you are entitled to access and follow MEGA's current terms.

## Deploy on Oracle VPS

1. Clone the repository or update your existing checkout:

```bash
git clone https://github.com/wroxtaaar/MEGA-Stream.git
cd MEGA-Stream
```

2. Configure the MEGA credentials on the VPS only:

```bash
cp .env.example .env
nano .env
```

Set `MEGA_EMAIL`, `MEGA_PASSWORD`, and `MEGA_TFA_CODE` only if your account requires a current two-factor code. Never commit `.env` or put MEGA credentials in browser code.

3. Start or rebuild the website:

```bash
docker compose up -d --build
docker compose logs -f mega-stream
```

4. Allow inbound TCP port 8080 in the VPS cloud/network firewall and host firewall, if enabled. Then open:

```
http://YOUR_VPS_PUBLIC_IP:8080
```

This temporary public HTTP setup intentionally has no login. Anyone with network access to that URL can browse and stream the catalogue. We'll add a domain and HTTPS later.

5. Confirm videos load, seek to the middle and end, and check browser requests for `206 Partial Content` and `Content-Range`.

Health endpoint: `GET /healthz` at `http://YOUR_VPS_PUBLIC_IP:8080/healthz`.

## API

- `GET /api/status` — service status.
- `GET /api/videos` — list videos.
- `GET /api/videos?refresh=1` — force library refresh.
- `GET /api/account` — account quota information where available.
- `GET /api/stream/:id` — video stream with Range support.
- `HEAD /api/stream/:id` — video metadata.

There is no app login in this experimental configuration.
