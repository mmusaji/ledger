// The version number must read the same in the app (js/vault.js), the service worker cache (sw.js) and the newest CHANGELOG heading.
// Run: node tests/version.test.js
const fs = require('fs'), path = require('path'); const root = path.resolve(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const app = (rd('js/vault.js').match(/APP_VERSION = '([^']+)'/) || [])[1];
const sw = (rd('sw.js').match(/const CACHE = 'ledger-v([^']+)'/) || [])[1];
const log = (rd('CHANGELOG.md').match(/^## v(\d+(?:\.\d+)*)/m) || [])[1];
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
ok(app, 'APP_VERSION found in js/vault.js'); ok(sw === app, `sw.js cache name (${sw}) matches APP_VERSION (${app})`); ok(log === app, `newest CHANGELOG heading (${log}) matches APP_VERSION (${app})`);
ok(/\$\{APP_VERSION\}/.test(rd('js/settings.js')), 'Settings shows APP_VERSION, not a typed number');
console.log(bad ? `${bad} FAILED` : `version: ${app} is the same everywhere`); process.exit(bad ? 1 : 0);
