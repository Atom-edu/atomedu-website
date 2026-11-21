(function () {
  "use strict";
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var productionSignal =
    new URLSearchParams(location.search).get("signal") === "production";
  window.ATOM_LIVE = Object.freeze({
    signalBase:
      local && !productionSignal
        ? "http://localhost:8787"
        : "https://atom-live-signal.archimedes-api1.workers.dev",
    roomName: "atomedu-live",
  });
})();
