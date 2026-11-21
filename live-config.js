(function () {
  'use strict';
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  window.ATOM_LIVE = Object.freeze({
    apiBase: local ? 'http://localhost:3001' : 'https://live-api.atom-edu.org',
    roomName: 'atomedu-live'
  });
})();
