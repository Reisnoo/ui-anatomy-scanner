// 採点シート（results/rating_sheet.csv）の全指摘を、人が1件ずつ採点するための単体HTMLアプリを作る
//   node rating_app.js            → results/rating_app.html
//   node rating_app.js --out dir  → dir/rating_app.html
// 各指摘に、ページの画像と、指摘の場所（枠）を付ける。採点は人が行う（このスクリプトもアプリも、採点はしない）。
// 環境変数: PLAYWRIGHT_MODULE, CHROMIUM_PATH（run.js と同じ）
const fs = require('fs'), path = require('path'), http = require('http');
const offline = require('./lib/offline');
const args = process.argv.slice(2), flag = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const OUT = path.resolve(flag('--out') || path.join(__dirname, 'results'));
const TOOL_DIR = path.resolve(__dirname, '..'), CORPUS = path.join(__dirname, '.corpus');
const SCALE = 0.6, MAX_H = 5000;          // 画像は実寸の60%、ページの上から5000pxまで
function loadPW() { for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) { try { return require(m); } catch (e) {} } throw new Error('playwright が見つかりません'); }
const { chromium } = loadPW();
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.webp': 'image/webp' };
function serve() {
  return new Promise(res => { const s = http.createServer((req, r) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname); let root, rel;
    if (u.startsWith('/tool/')) { root = TOOL_DIR; rel = u.slice(6) || 'index.html'; } else if (u.startsWith('/corpus/')) { root = CORPUS; rel = u.slice(8); } else if (u.startsWith('/fixtures/')) { root = path.join(__dirname, 'fixtures'); rel = u.slice(10); } else { r.writeHead(404); return r.end(); }
    const f = path.resolve(root, rel); if (!f.startsWith(root + path.sep) && f !== root) { r.writeHead(403); return r.end(); }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); r.end(b); });
  }).listen(0, '127.0.0.1', () => res({ s, port: s.address().port })); });
}
function parseCSV(t) {
  const rows = []; let row = [], cur = '', q = false; t = t.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  if (cur || row.length) { row.push(cur); rows.push(row); } return rows;
}

(async () => {
  const sheet = parseCSV(fs.readFileSync(path.join(__dirname, 'results', 'rating_sheet.csv'), 'utf8')), head = sheet[0], ix = n => head.indexOf(n);
  const ROWS = sheet.slice(1).filter(r => r.length > 5).map(r => ({ key: r[ix('page')] + '|' + r[ix('set')] + '|' + r[ix('issue_no')], page: r[ix('page')], set: r[ix('set')], no: +r[ix('issue_no')], h: r[ix('heuristic')], sev: +r[ix('severity')], title: r[ix('title')], evidence: r[ix('evidence')] }));
  const pageIds = [...new Set(ROWS.map(r => r.page))];
  const pages = T.pages.map(p => ({ ...p, file: p.local ? path.join(__dirname, p.local) : path.join(CORPUS, p.repo, p.path) })).filter(p => pageIds.includes(p.id) && fs.existsSync(p.file));
  const { s: server, port } = await serve(), origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE });
  offline.install(ctx, m => console.warn(m));
  const toolPage = await ctx.newPage(); await toolPage.goto(`${origin}/tool/index.html`); await toolPage.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  const names = await toolPage.evaluate(() => Object.fromEntries([...NIELSEN, SUP].map(h => [h.id, { ja: h.ja, en: h.en }])));
  const PAGES = {}, detail = {};
  for (const p of pages) {
    const url = p.url || (p.local ? `${origin}/fixtures/${path.basename(p.local)}` : `${origin}/corpus/${p.repo}/${p.path}`);
    const live = await ctx.newPage(); await live.setViewportSize({ width: 1280, height: 800 });
    try { await live.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) { await live.waitForTimeout(1500); }
    await live.waitForTimeout(600);
    const html = '<!DOCTYPE html>\n' + await live.evaluate(() => document.documentElement.outerHTML), baseHref = live.url();
    const pageH = await live.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const h = Math.min(pageH, MAX_H);
    const buf = await live.screenshot({ type: 'jpeg', quality: 50, fullPage: true, clip: { x: 0, y: 0, width: 1280, height: h } }); await live.close();
    const iss = await toolPage.evaluate(async ([html, name, base]) => { await loadHTML(html, name, base); return S.issues.filter(i => i.auto).map(i => ({ h: i.h, sev: i.sev, title: i.title, detail: i.detail, evidence: i.evidence, fix: i.fix, rects: (i.rects || []).slice(0, 12).map(r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })) })); }, [html, p.label, baseHref]);
    detail[p.id] = iss; PAGES[p.id] = { label: p.label, set: p.set || '', pageH, shownH: h, img: 'data:image/jpeg;base64,' + buf.toString('base64') };
    console.log(p.id.padEnd(34), iss.length + '件', Math.round(buf.length / 1024) + 'KB');
  }
  await browser.close(); server.close();
  let missing = 0;
  ROWS.forEach(r => { const list = detail[r.page] || []; let is = list[r.no - 1]; if (!is || is.title !== r.title) is = list.find(x => x.title === r.title && x.h === r.h) || null; if (!is) { missing++; r.detail = ''; r.fix = ''; r.rects = []; return; } r.detail = is.detail; r.fix = is.fix; r.rects = is.rects; r.evList = is.evidence || []; });
  if (missing) console.warn(`警告: ${missing}件は、現在の解析結果と照合できませんでした（枠なしで表示します）`);
  const data = { generated: new Date().toISOString().slice(0, 10), scale: SCALE, names, pages: PAGES, rows: ROWS };
  const tpl = fs.readFileSync(path.join(__dirname, 'lib', 'rating_app.template.html'), 'utf8');
  fs.mkdirSync(OUT, { recursive: true });
  const html = tpl.replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(OUT, 'rating_app.html'), html);
  console.log(`\n${ROWS.length}件・${Object.keys(PAGES).length}ページ → ${path.join(OUT, 'rating_app.html')}（${Math.round(html.length / 1024 / 1024 * 10) / 10}MB）`);
})();
