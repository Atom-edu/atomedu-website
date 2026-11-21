# atomEDU Live service

The public site is static. Live video runs through a self-hosted LiveKit WebRTC SFU so the presenter uploads one screen-share stream and the server relays it to viewers. No video is proxied through Cloudflare and no hosted streaming vendor is required.

## Production

Provision a Linux VM with a public IPv4 address, Docker, and Docker Compose. Point `live-media.atom-edu.org` and `live-api.atom-edu.org` directly to that VM (DNS-only, not a proxied CDN record). Open TCP 80, 443, 7881 and UDP 7882. Copy `.env.example` to `.env`, replace every value, then run:

```sh
docker compose up -d --build
```

Generate separate secrets rather than reusing a password:

```sh
openssl rand -hex 16   # LIVEKIT_API_KEY
openssl rand -hex 32   # LIVEKIT_API_SECRET
openssl rand -hex 24   # LIVE_STREAM_KEY
```

Caddy obtains TLS certificates for the two HTTPS endpoints. LiveKit carries the WebRTC audio/video; the API signs short-lived viewer and host tokens and persists only stream title plus the optional development viewer-count override.

The broadcast recording is made locally in `/live-manage` with `MediaRecorder` and downloaded to the presenter's computer. Nothing is uploaded. For unattended server-side recording, deploy LiveKit Egress separately; it is intentionally not required here.

The self-hosted setup avoids a per-viewer or per-minute streaming vendor, but it still uses the VM's finite CPU and network bandwidth. Load-test the selected VM and watch its network utilization before a large public event.

## Local development

Use the same Compose stack with resolvable local endpoints, or run LiveKit in development mode and start the API with the required environment variables. Serve the repository on `http://localhost:4173`. The backslash viewer-count override is intentionally available only when the manager page itself is loaded from localhost.
