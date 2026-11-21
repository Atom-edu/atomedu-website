# atomEDU Live signaling

This Worker coordinates direct browser-to-browser WebRTC connections. It carries only small JSON signaling messages and stream state; screen video and audio flow directly from the presenter to each viewer.

Set the broadcast secret with `wrangler secret put LIVE_STREAM_KEY`, then deploy with `npm run deploy`. The production endpoint is `https://atom-live-signal.archimedes-api1.workers.dev`.

Direct WebRTC is the immediately deployable path and is best for a modest audience. The repository's `live-service` directory remains the scalable self-hosted SFU path for a larger broadcast.
