const Module = require('module');
const orig = Module._load;
const handler = { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : new Proxy(function () {}, handler)), apply: () => new Proxy(function () {}, handler), construct: () => new Proxy(function () {}, handler) };
Module._load = function (req, ...a) {
  if (req === 'electron') return new Proxy({}, { get: (t, k) => k === 'app' ? new Proxy({ getPath: () => require('os').tmpdir(), getVersion: () => '0.1.10', whenReady: () => new Promise(() => {}), isPackaged: false }, { get: (t2, k2) => t2[k2] ?? (() => new Proxy(function () {}, handler)) }) : new Proxy(function () {}, handler) });
  if (req === 'youtubei.js') return {};
  return orig.call(this, req, ...a);
};
// Loads app-main.js with Electron stubbed out, so mistakes like using a function before it is defined
// (which would make an installed update crash on start) are caught in CI instead of on the user's PC.
try { require(require('path').join(__dirname, 'app-main.js')); console.log('LOADED OK'); setTimeout(() => process.exit(0), 300); }
catch (e) { console.error('LOAD FAILED:', e.stack); process.exit(1); }
