const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dist = path.resolve(__dirname, '../dist');
const indexFile = path.join(dist, 'index.html');
if (!fs.existsSync(indexFile)) throw new Error('Run expo export before preparing PWA assets.');

let index = fs.readFileSync(indexFile, 'utf8');
const additions = [
  '<link rel="manifest" href="./manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">',
  '<meta name="theme-color" content="#19243d">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="Pocket Ledger">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
];
if (!index.includes('rel="manifest"')) {
  if (!index.includes('</head>')) throw new Error('Expo export is missing an HTML head.');
  index = index.replace('</head>', `${additions.join('\n')}\n</head>`);
}
fs.writeFileSync(indexFile, index);

function getFiles(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? getFiles(full) : [full];
  });
}
const assets = getFiles(dist).map(p => path.relative(dist, p).replace(/\\/g, '/'))
  .filter(p => !p.endsWith('.map') && p !== 'sw.js' && p !== '.nojekyll')
  .map(p => `./${p}`);
assets.push('./');
const unique = [...new Set(assets)].sort();
const urls = unique.map(p => new URL(p, 'https://example.org/Pocket-ledger/').pathname);
const digest = crypto.createHash('sha256').update(JSON.stringify(urls)).digest('hex').slice(0, 12);
const sw = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8')
  .replace('__CACHE_NAME__', JSON.stringify(`pocket-ledger-app-${digest}`))
  .replace('__PRE_CACHE__', `['${unique.map(p => p.replace(/'/g,"\\'")).join("','")}'].map(p => new URL(p, BASE).href)`);
fs.writeFileSync(path.join(dist, 'sw.js'), sw);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`PWA generated with ${unique.length} offline resources.`);
