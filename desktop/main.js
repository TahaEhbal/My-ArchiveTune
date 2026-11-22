// Bootstrap: runs the newest app code. A downloaded update (a few MB, stored in the user's data
// folder) wins over the code bundled inside the .exe when its version is higher.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const cmp = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

let dir = __dirname;
let version = app.getVersion();
try {
  const data = app.getPath('userData');
  const live = path.join(data, 'code');
  const staged = path.join(data, 'code-staged');
  if (fs.existsSync(path.join(staged, 'version.txt'))) {
    fs.rmSync(live, { recursive: true, force: true });
    fs.renameSync(staged, live);
  }
  const v = fs.readFileSync(path.join(live, 'version.txt'), 'utf8').trim();
  if (cmp(v, app.getVersion()) > 0 && fs.existsSync(path.join(live, 'app-main.js'))) {
    dir = live;
    version = v;
  }
} catch { /* no update installed */ }

global.__codeVersion = version;
try {
  require(path.join(dir, 'app-main.js'));
} catch (e) {
  if (dir === __dirname) throw e;
  // The downloaded update is broken: fall back to the code bundled in the .exe.
  global.__codeVersion = app.getVersion();
  require(path.join(__dirname, 'app-main.js'));
}
