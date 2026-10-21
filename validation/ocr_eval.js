// スクリーンショットのOCR（文字・大きさ・色の推定）の精度を、DOMを正解にして測る
//   node ocr_eval.js --set dev            … 開発セット（.corpus の実在テンプレート。先に node fetch_corpus.js）
//   node ocr_eval.js --set ja             … 日本語の自作ページ（fixtures/ja-*.html）
//   node ocr_eval.js --live urls.txt     … 実サイトのURL一覧(1行1URL、空白のあとにラベル可)で測る（ネットワーク必須。自分のPC用）
//   node ocr_eval.js --only shop-home --dpr 2
//   node ocr_eval.js --grid '[{"psm":11,"scale":2},{"psm":12,"scale":2}]'   … 設定を総当たりで比べる
// 環境変数: PLAYWRIGHT_MODULE, CHROMIUM_PATH。OCRエンジンと言語データは node_modules（npm install）から配る
const fs = require('fs'), path = require('path'), http = require('http');
const offline = require('./lib/offline');
const args = process.argv.slice(2), flag = n => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const LIVE = flag('--live'), SET = flag('--set') || 'dev', ONLY = flag('--only') && String(flag('--only')).split(','), DPR = +(flag('--dpr') || 1), MAXH = +(flag('--maxh') || 3000);
const GRID = flag('--grid') ? JSON.parse(flag('--grid')) : [{}];
const OUT = path.resolve(flag('--out') || path.join(__dirname, 'results'));
const TOOL_DIR = path.resolve(__dirname, '..'), CORPUS = path.join(__dirname, '.corpus'), NM = path.join(__dirname, 'node_modules');
function loadPW() { for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) { try { return require(m); } catch (e) {} } throw new Error('playwright が見つかりません'); }
const { chromium } = loadPW();
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };
function serve() {
  return new Promise(res => { const s = http.createServer((req, r) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname); let root, rel;
    if (u.startsWith('/tool/')) { root = TOOL_DIR; rel = u.slice(6) || 'index.html'; } else if (u.startsWith('/corpus/')) { root = CORPUS; rel = u.slice(8); } else if (u.startsWith('/fixtures/')) { root = path.join(__dirname, 'fixtures'); rel = u.slice(10); }
    else if (u.startsWith('/vendor/')) { root = NM; rel = u.slice(8); } else if (u.startsWith('/lang/')) { root = path.join(__dirname, '.ocr_lang'); rel = u.slice(6); } else { r.writeHead(404); return r.end(); }
    const f = path.resolve(root, rel); if (!f.startsWith(root + path.sep) && f !== root) { r.writeHead(403); return r.end(); }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }); r.end(b); });
  }).listen(0, '127.0.0.1', () => res({ s, port: s.address().port })); });
}
// 言語データを1つのフォルダにまとめる（tesseract.js は、言語を1つのフォルダから読む）
function prepLang() {
  const d = path.join(__dirname, '.ocr_lang'); fs.mkdirSync(d, { recursive: true });
  for (const l of ['jpn', 'eng']) { const src = path.join(NM, '@tesseract.js-data', l, '4.0.0_best_int', l + '.traineddata.gz'); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(d, l + '.traineddata.gz')); }
}

// ページ内：正解の文字行（DOMから）を取り出す。単位はCSSピクセル
function truthInPage() {
  const out = [], cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const parse = s => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const effBg = el => { const layers = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
  const W = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (W.nextNode()) {
    const n = W.currentNode, t0 = n.textContent; if (!t0.trim()) continue; const el = n.parentElement; if (!el || el.closest('script,style,noscript,textarea,option')) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    { let hidden = false; for (let a = el; a && a !== document.body; a = a.parentElement) { const q = getComputedStyle(a), r0 = a.getBoundingClientRect(); if (/(hidden|clip)/.test(q.overflow + q.overflowX + q.overflowY) && (r0.width <= 2 || r0.height <= 2)) { hidden = true; break; } if (q.clip && q.clip !== 'auto' && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(q.clip)) { hidden = true; break; } } if (hidden) continue; }   // 視覚的に隠した文字（スクリーンリーダー用）は、正解に含めない
    const s = getComputedStyle(el); let op = 1; for (let a = el; a; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
    const tt = s.textTransform, t = tt === 'uppercase' ? t0.toUpperCase() : tt === 'lowercase' ? t0.toLowerCase() : t0;
    const fg = parse(s.color), bg = effBg(el), r = document.createRange(); let cur = null;
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) { if (cur) cur.pendingSpace = true; continue; }
      r.setStart(n, i); r.setEnd(n, i + 1); const rs = r.getClientRects(); if (!rs.length) continue; const q = rs[0]; if (q.width < .5 || q.height < .5) continue;
      const fs = parseFloat(s.fontSize);
      if (cur && Math.abs(q.top - cur.top) < q.height * .5 && q.left >= cur.right - 2 && q.left - cur.right < fs * 2.5) { if (cur.pendingSpace) { cur.text += ' '; cur.pendingSpace = false; } cur.text += t[i]; cur.right = Math.max(cur.right, q.right); cur.bottom = Math.max(cur.bottom, q.bottom); cur.top = Math.min(cur.top, q.top); }
      else { cur = { text: t[i], left: q.left, top: q.top, right: q.right, bottom: q.bottom, fs, weight: parseInt(s.fontWeight) || 400, fg: fg && op >= .999 ? over(fg, bg || { r: 255, g: 255, b: 255, a: 1 }) : null, bg: bg && op >= .999 ? bg : null, tag: el.tagName }; out.push(cur); }
    }
  }
  const sy = window.scrollY, sx = window.scrollX, H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const lines = out.filter(l => l.text.trim().length).map(l => ({ text: l.text.trim(), x: l.left + sx, y: l.top + sy, w: l.right - l.left, h: l.bottom - l.top, fs: l.fs, weight: l.weight, fg: l.fg, bg: l.bg, tag: l.tag }));
  // 枠が見える部品（正解）：背景色または枠線が見えるボタン・入力欄。文字がないもの（アイコンだけ）や、枠のない文字だけのリンクは、見た目からは判別できないので除く
  const vis = e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const boxed = e => { const s = getComputedStyle(e), bg = parse(s.backgroundColor), bw = parseFloat(s.borderTopWidth) || 0, bc = parse(s.borderTopColor); return (bg && bg.a >= .3) || (bw >= 1 && bc && bc.a >= .3); };
  const btns = [...document.querySelectorAll('button,[role=button],input[type=submit],input[type=button],a.btn,a[class*="btn-"],input[type=text],input[type=email],input[type=password],input[type=search],textarea,select')].filter(e => vis(e) && boxed(e)).map(e => { const b = e.getBoundingClientRect(); return { x: b.left + sx, y: b.top + sy, w: b.width, h: b.height, text: (e.innerText || e.value || e.getAttribute('placeholder') || '').trim().slice(0, 30), tag: e.tagName }; }).filter(b => b.w >= 20 && b.h >= 16 && b.w <= 520 && b.h <= 90 && (b.text || b.tag === 'INPUT' || b.tag === 'SELECT' || b.tag === 'TEXTAREA'));
  return { lines, btns, H, lang: document.documentElement.lang || '' };
}

// ツールのページ内：OCRして、正解と突き合わせる
async function evalInTool({ b64, truth, dpr, opts, maxH }) {
  const lev = (a, b) => { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; };
  const norm = s => s.normalize('NFKC').replace(/\s+/g, '');
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  let sheetOut = null; if (opts.sheet) { const sg = ocrSegment(c, dpr, opts.seg), shs = ocrMontage(c, dpr, sg.boxes, { ...opts }); sheetOut = { boxes: sg.boxes, sheets: shs.slice(0, 2).map(x => x.canvas.toDataURL('image/png')) }; }
  const t0 = performance.now(), lines = await ocrExtract(c, { ...opts, dpr }), ms = performance.now() - t0;
  const dump = opts.dump ? lines.map(l => ({ t: l.text.slice(0, 30), c: Math.round(l.conf), x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h), fs: Math.round(l.fs * 10) / 10, syms: opts.dump === 'syms' ? l.words.map(w => w.syms.map(q => q.t + '@' + q.x.toFixed(1) + ',' + q.w.toFixed(1) + ',' + q.h.toFixed(1)).join(' ')) : undefined })) : null;
  const ctx = c.getContext('2d'), words = lines.flatMap(l => l.words.map(w => ({ ...w, line: l })));
  const used = new Set(); let lenT = 0, lenE = 0, nMatch = 0; const fsR = [], con = [], small = { tp: 0, fp: 0, fn: 0 }, low = { tp: 0, fp: 0, fn: 0, tn: 0, amb: 0 }, per = [];
  const inScope = truth.lines.filter(l => l.y < maxH - 4);
  inScope.forEach(T => {
    const x0 = T.x - 3, x1 = T.x + T.w + 3, y0 = T.y - 3, y1 = T.y + T.h + 3;
    const ws = words.filter(w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; }).sort((a, b) => a.x - b.x);
    ws.forEach(w => used.add(w));
    const ref = norm(T.text), hyp = norm(ws.map(w => w.text).join(' ')); const e = lev(ref, hyp); lenT += ref.length; lenE += Math.min(e, ref.length + hyp.length);
    const sim = ref.length ? 1 - e / Math.max(ref.length, hyp.length, 1) : 0; if (sim >= .8) nMatch++;
    if (sim >= .8 && ws.length) {
      const bb = { x: Math.min(...ws.map(w => w.x)), y: Math.min(...ws.map(w => w.y)), w: 0, h: 0 }; bb.w = Math.max(...ws.map(w => w.x + w.w)) - bb.x; bb.h = Math.max(...ws.map(w => w.y + w.h)) - bb.y;
      const f = ocrFontSize({ words: ws, h: bb.h, text: ws.map(w => w.text).join(' '), box: ws[0].line.box && ws.length === ws[0].line.words.length ? ws[0].line.box : { x: bb.x, y: bb.y, w: bb.w, h: bb.h } }, opts.cal); const col = ocrColors(ctx, dpr, bb, opts.fgPct || OCR_DEFAULT.fgPct);
      fsR.push({ est: f.v, tru: T.fs, kind: f.k, text: T.text.slice(0, 16), weight: T.weight });
      if (T.fg && T.bg && col.bgShare >= .5) { const tr = contrast(T.fg, T.bg), er = col.ratio; con.push({ est: er, tru: tr, fs: T.fs, text: T.text.slice(0, 16) });
        const thr = T.fs >= 24 ? 3 : 4.5, tl = tr < thr, el = er < thr * .96;
        if (Math.abs(tr / thr - 1) <= .04) low.amb++; else low[tl && el ? 'tp' : !tl && el ? 'fp' : tl ? 'fn' : 'tn'] += 1; }
      const ts = T.fs < 12, es = f.v < (opts.smallThr || 11.2); if (ts && es) small.tp++; else if (!ts && es) small.fp++; else if (ts && !es) small.fn++;
    }
    per.push({ text: T.text.slice(0, 24), sim: +sim.toFixed(2), hyp: hyp.slice(0, 24) });
  });
  const extra = words.filter(w => !used.has(w) && w.y < maxH && w.text.replace(/\s/g, '').length >= 2);
  const lenX = extra.reduce((a, w) => a + norm(w.text).length, 0);
  // ボタン・入力欄の候補（枠）を、DOMのボタンと照合する
  const cleaned = lines.map(l => ({ ...l, text: ocrCleanText(l.text) })).filter(l => ocrMeaningful(l.text) && l.box), dbg = [], ctl = ocrControls(cleaned, lines.containers || [], ctx, dpr, c.width / dpr, c.height / dpr, dbg).controls;
  const iou = (a, b) => { const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); if (ix <= 0 || iy <= 0) return 0; const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i); };
  const tb = truth.btns.filter(b => b.y + b.h < maxH && b.w >= 20 && b.h >= 16), pb = ctl.map(c => c.rect);
  const btn = { truth: tb.length, matched: tb.filter(b => pb.some(r => iou(b, r) >= .5)).length, pred: ctl.length, predOk: ctl.filter(c => tb.some(b => iou(b, c.rect) >= .5)).length, predButton: ctl.filter(c => c.kind === 'button').length, predButtonOk: ctl.filter(c => c.kind === 'button' && tb.some(b => iou(b, c.rect) >= .5)).length };
  const conts = lines.containers || [];
  const missed = tb.filter(b => !pb.some(r => iou(b, r) >= .5)).slice(0, 40).map(b => ({ near: conts.filter(c => iou(b, c) > .25).slice(0, 2).map(c => [c.x, c.y, c.w, c.h].join(',') + ':' + (dbg.filter(d => d.x === c.x && d.y === c.y).map(d => d.r).join('/') || '?')), inl: cleaned.filter(l => { const cx = l.box.x + l.box.w / 2, cy = l.box.y + l.box.h / 2; return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h; }).map(l => l.text.slice(0, 14) + '@' + Math.round(l.conf)).join('|'), t: b.text, tag: b.tag, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
  const fpc = ctl.filter(c => !tb.some(b => iou(b, c.rect) >= .5)).slice(0, 40).map(c => ({ t: c.text.slice(0, 18), k: c.kind, x: Math.round(c.rect.x), y: Math.round(c.rect.y), w: Math.round(c.rect.w), h: Math.round(c.rect.h) }));
  return { missed, fpc, btn, ms, nLines: inScope.length, nMatch, lenT, lenE, lenX, lenHyp: words.reduce((a, w) => a + norm(w.text).length, 0), fsR, con, small, low, nOcrLines: lines.length, dump, sheetOut, bad: per.filter(p => p.sim < .8).slice(0, 12) };
}

const pct = x => (x * 100).toFixed(1) + '%', median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
function summarize(rs) {
  const sum = k => rs.reduce((a, r) => a + r[k], 0), fs = rs.flatMap(r => r.fsR), allFs = fs, con = rs.flatMap(r => r.con);
  const ratio = fs.map(x => x.est / x.tru), err = ratio.map(r => Math.abs(r - 1));
  const cerr = con.map(x => Math.abs(x.est - x.tru) / x.tru);
  const s = rs.reduce((a, r) => ({ tp: a.tp + r.small.tp, fp: a.fp + r.small.fp, fn: a.fn + r.small.fn }), { tp: 0, fp: 0, fn: 0 });
  const l = rs.reduce((a, r) => ({ tp: a.tp + r.low.tp, fp: a.fp + r.low.fp, fn: a.fn + r.low.fn, amb: a.amb + r.low.amb }), { tp: 0, fp: 0, fn: 0, amb: 0 });
  const pr = x => `P ${x.tp + x.fp ? pct(x.tp / (x.tp + x.fp)) : '—'} R ${x.tp + x.fn ? pct(x.tp / (x.tp + x.fn)) : '—'} (tp${x.tp}/fp${x.fp}/fn${x.fn})`;
  const bt = k => rs.reduce((a, r) => a + r.btn[k], 0);
  return { buttons: `再現 ${bt('matched')}/${bt('truth')} (${pct(bt('matched') / Math.max(1, bt('truth')))})／検出した枠 ${bt('pred')} のうちDOMのボタンと一致 ${bt('predOk')} (${pct(bt('predOk') / Math.max(1, bt('pred')))})`, pages: rs.length, lines: sum('nLines'), lineRecall: sum('nMatch') / Math.max(1, sum('nLines')), CER: sum('lenE') / Math.max(1, sum('lenT')), extraRate: sum('lenX') / Math.max(1, sum('lenHyp')),
    fsN: fs.length, fsMedRatio: median(ratio), fsMedAbsErr: median(err), fsWithin15: err.filter(e => e <= .15).length / Math.max(1, err.length), fsWithin25: err.filter(e => e <= .25).length / Math.max(1, err.length),
    byKind: (() => { const o = {}; fs.forEach(x => { const k = x.kind + (x.tru < 14 ? '<14' : x.tru < 20 ? '14-19' : '20+'); (o[k] = o[k] || []).push(x.est / x.tru); }); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { n: v.length, med: +median(v).toFixed(3), w15: +(v.filter(r => Math.abs(r - 1) <= .15).length / v.length).toFixed(2) }])); })(),
    conN: con.length, conMedRelErr: median(cerr), conWithin20: cerr.filter(e => e <= .2).length / Math.max(1, cerr.length), small: pr(s), low: pr(l) + ` ／基準ぎりぎり(±4%)で除外 ${l.amb}件`, msPerPage: sum('ms') / rs.length };
}

(async () => {
  prepLang();
  const pages = (LIVE && LIVE !== true) ? fs.readFileSync(LIVE, 'utf8').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#')).map((l, i) => { const [url, ...rest] = l.split(/\s+/); return { id: 'live' + (i + 1), label: rest.join(' ') || new URL(url).host, set: 'live', url }; }).filter(p => (!ONLY || ONLY.includes(p.id))) : T.pages.filter(p => (SET === 'all' || (p.set || '') === SET) && (!ONLY || ONLY.includes(p.id)) && p.set !== 'control')
    .map(p => ({ ...p, file: p.local ? path.join(__dirname, p.local) : path.join(CORPUS, p.repo, p.path) })).filter(p => fs.existsSync(p.file));
  if (!pages.length) throw new Error('対象ページがありません（先に node fetch_corpus.js、または --set ja）');
  const { s: server, port } = await serve(), origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const cache = new Map();
  async function shot(p) {          // ページを描画して、スクリーンショットと正解を取る
    if (cache.has(p.id)) return cache.get(p.id);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR }); if (!LIVE) offline.install(ctx, () => {});
    const pg = await ctx.newPage(); const url = p.url ? p.url : p.local ? `${origin}/fixtures/${path.basename(p.local)}` : `${origin}/corpus/${p.repo}/${p.path}`;
    try { await pg.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) { await pg.waitForTimeout(1500); }
    await pg.waitForTimeout(500); await pg.evaluate(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { try { a.cancel(); } catch (_) {} } }); window.scrollTo(0, 0); });
    // 正解の取得と撮影を、同じ状態（ページ全体が入る高さのウィンドウ）で行う。フルページ撮影では、レイアウトが変わって位置がずれるページがあるため
    const H0 = await pg.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)), H = Math.max(800, Math.min(MAXH, H0));
    await pg.setViewportSize({ width: 1280, height: H }); await pg.waitForTimeout(400);
    await pg.evaluate(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { try { a.cancel(); } catch (_) {} } }); window.scrollTo(0, 0); });
    const truth = await pg.evaluate(truthInPage);
    const png = await pg.screenshot({ clip: { x: 0, y: 0, width: 1280, height: H } }); await ctx.close();
    if (flag('--saveshots')) { fs.mkdirSync(flag('--saveshots'), { recursive: true }); fs.writeFileSync(path.join(flag('--saveshots'), `${p.id}_dpr${DPR}.png`), png); }
    const r = { png: png.toString('base64'), truth, H }; cache.set(p.id, r); return r;
  }
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await tctx.addInitScript(({ port }) => { window.UAS_OCR = { script: `http://127.0.0.1:${port}/vendor/tesseract.js/dist/tesseract.min.js`, worker: `http://127.0.0.1:${port}/vendor/tesseract.js/dist/worker.min.js`, core: `http://127.0.0.1:${port}/vendor/tesseract.js-core`, lang: `http://127.0.0.1:${port}/lang` }; }, { port });
  const tool = await tctx.newPage(); tool.on('pageerror', e => console.log('PAGEERR', e.message)); await tool.goto(`${origin}/tool/index.html`); await tool.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  const report = [];
  for (const g of GRID) {
    const rs = [], per = [];
    for (const p of pages) {
      const sh = await shot(p), isJa = /^ja/.test(p.set || '') || /^ja/i.test(sh.truth.lang || '');
      if (flag('--truthdump')) sh.truth.lines.filter(l => new RegExp(flag('--truthdump')).test(l.text)).slice(0, 6).forEach(l => console.log(' TRUTH', p.id, JSON.stringify({ t: l.text.slice(0, 20), x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) })), '| H', sh.truth.H, 'img', sh.H);
      const opts = { langs: isJa ? 'jpn+eng' : 'eng', ...g };
      const r = await tool.evaluate(evalInTool, { b64: sh.png, truth: sh.truth, dpr: DPR, opts, maxH: sh.H });
      rs.push(r); per.push({ id: p.id, lines: r.nLines, recall: +(r.nMatch / Math.max(1, r.nLines)).toFixed(2), CER: +(r.lenE / Math.max(1, r.lenT)).toFixed(3), ms: Math.round(r.ms), bad: r.bad.slice(0, 12) });
      process.stdout.write('.');
    }
    const sm = summarize(rs); report.push({ opts: g, dpr: DPR, set: SET, summary: sm, pages: per });
    if (flag('--sheet')) rs.forEach((r, i) => { if (!r.sheetOut) return; fs.mkdirSync(flag('--sheet'), { recursive: true }); r.sheetOut.sheets.forEach((d, k) => fs.writeFileSync(path.join(flag('--sheet'), pages[i].id + '_sheet' + k + '.png'), Buffer.from(d.split(',')[1], 'base64'))); fs.writeFileSync(path.join(flag('--sheet'), pages[i].id + '_boxes.json'), JSON.stringify(r.sheetOut.boxes)); });
    if (flag('--outliers')) rs.forEach((r, i) => r.fsR.filter(x => x.tru <= 13 && x.est / x.tru < .97).forEach(x => console.log(' OUT', pages[i].id, x.kind, 'est', x.est.toFixed(1), 'tru', x.tru, x.weight, JSON.stringify(x.text))));
    if (flag('--lowfp')) rs.forEach((r, i) => r.con.filter(x => (x.est < (x.fs >= 24 ? 3 : 4.5) * .96) !== (x.tru < (x.fs >= 24 ? 3 : 4.5))).forEach(x => console.log(' LOW', pages[i].id, 'est', x.est.toFixed(2), 'tru', x.tru.toFixed(2), 'fs', x.fs, JSON.stringify(x.text))));
    if (flag('--btndbg')) rs.forEach((r, i) => { r.missed.forEach(m => console.log(' MISS', pages[i].id, JSON.stringify(m))); r.fpc.forEach(m => console.log(' FPC ', pages[i].id, JSON.stringify(m))); });
    if (flag('--dump')) rs.forEach((r, i) => { console.log('\n#', pages[i].id); (r.dump || []).forEach(d => console.log(' ', JSON.stringify(d))); });
    console.log('\n' + JSON.stringify(g), JSON.stringify(sm, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
    if (flag('--verbose')) per.forEach(x => { console.log(' ', x.id, x.lines, 'recall', x.recall, 'CER', x.CER, x.ms + 'ms'); x.bad.forEach(b => console.log('     ', JSON.stringify(b))); });
  }
  fs.mkdirSync(OUT, { recursive: true }); if (flag('--save')) fs.writeFileSync(path.join(OUT, flag('--save')), JSON.stringify(report, null, 1));
  await browser.close(); server.close();
})();
