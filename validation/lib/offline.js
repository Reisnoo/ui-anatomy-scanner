// ネットワークに出られない環境（クラウド実行環境など）向けの補助。
// 外部CDNへのリクエストを、固定バージョンのnpmパッケージ・空のスタブ・代替画像に置き換える。
// --live を付けると使わない（実サイトをそのまま取得する）。
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const CACHE = path.join(__dirname, '..', '.cache', 'npm');

const MIME = { '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.png': 'image/png', '.jpg': 'image/jpeg', '.map': 'application/json' };

function sh(cmd, args) { return execFileSync(cmd, args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }); }
function parseSpec(urlPath) {            // "bootstrap@5.2.3/dist/css/x.css" / "@scope/pkg@1.0.0/y"
  const m = urlPath.match(/^(@[^/@]+\/[^/@]+|[^/@]+)(?:@([^/]+))?\/(.+)$/);
  return m ? { pkg: m[1], ver: m[2] || 'latest', file: m[3] } : null;
}
function ensurePackage(pkg, ver) {
  const base = path.join(CACHE, pkg.replace('/', '__') + '@' + ver);
  if (fs.existsSync(path.join(base, 'package'))) return base;
  fs.mkdirSync(base, { recursive: true });
  const meta = JSON.parse(sh('curl', ['-fsSL', '-m', '60', `https://registry.npmjs.org/${pkg.replace('/', '%2f')}`]).toString());
  const v = (ver === 'latest' || !meta.versions[ver]) ? meta['dist-tags'].latest : ver;
  const tgz = path.join(base, 'pkg.tgz');
  fs.writeFileSync(tgz, sh('curl', ['-fsSL', '-m', '120', meta.versions[v].dist.tarball]));
  sh('tar', ['-xzf', tgz, '-C', base]);
  return base;
}
const svg = (w, h, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#dee2e6"/><text x="50%" y="50%" fill="#6c757d" font-family="sans-serif" font-size="${Math.max(12, Math.min(w, h) / 10)}" text-anchor="middle" dominant-baseline="middle">${label || ''}</text></svg>`;

function install(context, log) {
  const stats = { npm: 0, fontsCss: 0, emptyJs: 0, images: 0, aborted: new Set() };
  context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    try {
      if (/(^|\.)(cdn\.jsdelivr\.net|unpkg\.com)$/.test(u.hostname)) {
        const p = u.hostname.includes('jsdelivr') ? u.pathname.replace(/^\/npm\//, '') : u.pathname.slice(1);
        const sp = parseSpec(p.replace(/^\//, ''));
        if (sp) {
          const base = ensurePackage(sp.pkg, sp.ver), f = path.join(base, 'package', sp.file);
          if (fs.existsSync(f)) { stats.npm++; return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); }
        }
      }
      if (u.hostname === 'fonts.googleapis.com') { stats.fontsCss++; return route.fulfill({ status: 200, contentType: 'text/css', body: '/* offline: webfont stub */' }); }
      if (u.hostname === 'dummyimage.com' || u.hostname === 'via.placeholder.com' || u.hostname === 'placehold.co') {
        const m = u.pathname.match(/(\d+)x(\d+)/); stats.images++;
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(+(m ? m[1] : 600), +(m ? m[2] : 400), '') });
      }
      if (req.resourceType() === 'image') { stats.images++; return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(600, 400, '') }); }
      if (req.resourceType() === 'script') { stats.emptyJs++; return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline stub */' }); }
      if (req.resourceType() === 'stylesheet') { stats.fontsCss++; return route.fulfill({ status: 200, contentType: 'text/css', body: '/* offline stub */' }); }
    } catch (e) { log && log('offline route error: ' + u.href + ' ' + e.message); }
    stats.aborted.add(u.hostname); return route.abort();
  });
  return stats;
}
module.exports = { install };
