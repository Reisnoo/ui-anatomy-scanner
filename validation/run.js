// UI Anatomy Scanner の自動判定を、外部ツール(axe-core)と突き合わせて精度を測る
//   node run.js                 … .corpus/ の実在テンプレート(targets.json)で実行
//   node run.js --live urls.txt … 実サイトのURL一覧(1行1URL、空白のあとにラベル可)で実行（ネットワーク必須）
//   node run.js --only shop-home,landing
// 環境変数: PLAYWRIGHT_MODULE(playwrightの場所), CHROMIUM_PATH(Chromiumの実行ファイル)
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const offline = require('./lib/offline');
const args = process.argv.slice(2), flag = n => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const DIAG = flag('--diag'), EXPLAIN = flag('--explain'), SET = flag('--set'), EVAL = flag('--eval'), LIVE = flag('--live'), ONLY = flag('--only') && String(flag('--only')).split(',');
const OUT = path.resolve(flag('--out') || path.join(__dirname, 'results'));
const TOOL_DIR = path.resolve(__dirname, '..'), CORPUS = path.join(__dirname, '.corpus');
function loadPW() { for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) { try { return require(m); } catch (e) {} } throw new Error('playwright が見つかりません（npm i playwright、または PLAYWRIGHT_MODULE を指定）'); }
const { chromium } = loadPW(), axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'), axeVersion = require('axe-core/package.json').version;
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.map': 'application/json' };
function serve() {
  return new Promise(res => { const s = http.createServer((req, r) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname); let root, rel;
    if (u.startsWith('/tool/')) { root = TOOL_DIR; rel = u.slice(6) || 'index.html'; } else if (u.startsWith('/corpus/')) { root = CORPUS; rel = u.slice(8); } else if (u.startsWith('/fixtures/')) { root = path.join(__dirname, 'fixtures'); rel = u.slice(10); } else { r.writeHead(404); return r.end(); }
    const f = path.resolve(root, rel); if (!f.startsWith(root + path.sep) && f !== root) { r.writeHead(403); return r.end(); }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); r.end(b); });
  }).listen(0, '127.0.0.1', () => res({ s, port: s.address().port })); });
}
const close = (a, b) => Math.abs(a.x - b.x) <= 6 && Math.abs(a.y - b.y) <= 6 && Math.abs(a.w - b.w) <= 8 && Math.abs(a.h - b.h) <= 8;
const hasClose = (r, list) => list.some(x => close(r, x.rect || x));

const AXE_RULES = ['color-contrast', 'image-alt', 'button-name', 'input-button-name', 'link-name', 'target-size', 'label', 'select-name'];
async function runAxe(page) {
  await page.addScriptTag({ content: axeSrc });
  return page.evaluate(async rules => {
    window.scrollTo(0, 0);
    const r = await axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations', 'incomplete', 'passes'] });
    const pack = list => list.map(rule => ({ id: rule.id, nodes: rule.nodes.map(n => {
      let el = null; try { el = n.target.length === 1 ? document.querySelector(n.target[0]) : null; } catch (e) {} if (!el) return null;
      const b = el.getBoundingClientRect(); return { rect: { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }, tag: el.tagName, role: el.getAttribute('role') || '', html: n.html.slice(0, 160) }; }).filter(Boolean) }));
    return { violations: pack(r.violations), incomplete: pack(r.incomplete), passes: pack(r.passes) };
  }, AXE_RULES);
}
const nodesOf = (axe, kind, ids) => axe[kind].filter(r => ids.includes(r.id)).flatMap(r => r.nodes);

// 1つの検査: axeの違反を正解とし、ツールの検出(rect)と照合する
function score(axeViol, axeIncomplete, axePass, toolRects, scope = () => true) {
  const gt = axeViol.filter(scope), tool = toolRects;
  const tp = gt.filter(n => hasClose(n.rect, tool)), fn = gt.filter(n => !hasClose(n.rect, tool));
  const fpAll = tool.filter(r => !hasClose(r.rect || r, axeViol));
  const fpConfirmed = fpAll.filter(r => hasClose(r.rect || r, axePass)), fpUnverified = fpAll.filter(r => !hasClose(r.rect || r, axePass));
  const fpIncomplete = fpUnverified.filter(r => hasClose(r.rect || r, axeIncomplete));      // axeも「要確認」とした（両者とも確定できない）
  const fpNone = fpUnverified.filter(r => !hasClose(r.rect || r, axeIncomplete));          // axeがまったく評価しなかった
  return { axeViolations: gt.length, toolDetections: tool.length, tp: tp.length, fn: fn.length, fpConfirmed: fpConfirmed.length, fpUnverified: fpUnverified.length, fpIncomplete: fpIncomplete.length, fpNone: fpNone.length, fpNoneExamples: fpNone.slice(0, 6).map(r => ({ rect: r.rect || r, label: r.label || '' })),
    fnExamples: fn.slice(0, 4).map(n => n.html), fnRects: fn.slice(0, 12).map(n => n.rect), fpExamples: fpConfirmed.slice(0, 4).map(r => ({ rect: r.rect || r, label: r.label || '' })), fpUnverifiedExamples: fpUnverified.slice(0, 3).map(r => ({ rect: r.rect || r, label: r.label || '' })) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let pages;
  if (LIVE && LIVE !== true) {
    pages = fs.readFileSync(LIVE, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).map((l, i) => { const [url, ...rest] = l.split(/\s+/); return { id: 'live' + (i + 1), label: rest.join(' ') || new URL(url).host, kind: 'live', url }; });
  } else {
    pages = T.pages.map(p => ({ ...p, file: p.local ? path.join(__dirname, p.local) : path.join(CORPUS, p.repo, p.path) })).filter(p => fs.existsSync(p.file));
    if (!pages.length) throw new Error('検証用ページがありません。先に node fetch_corpus.js を実行してください');
  }
  if (ONLY) pages = pages.filter(p => ONLY.includes(p.id));
  if (SET && SET !== true) pages = pages.filter(p => (p.set || '') === SET);
  const { s: server, port } = await serve(), origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const stubStats = LIVE ? null : offline.install(ctx, m => console.warn(m));
  const toolPage = await ctx.newPage(); await toolPage.goto(`${origin}/tool/index.html`); await toolPage.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  const results = [];
  for (const p of pages) {
    const url = p.url || (p.local ? `${origin}/fixtures/${path.basename(p.local)}` : `${origin}/corpus/${p.repo}/${p.path}`);
    const live = await ctx.newPage(); await live.setViewportSize({ width: 1280, height: 800 });
    try { await live.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) { await live.waitForTimeout(1500); }
    await live.waitForTimeout(600);
    // --diag: 実ブラウザで実際に見えている文字要素に印を付けておき、ツールが「見えない」と判定したものを後で突き合わせる
    if (DIAG) await live.evaluate(() => { document.body.querySelectorAll('*').forEach(el => { if (![...el.childNodes].some(t => t.nodeType === 3 && t.textContent.trim())) return; const r = el.getBoundingClientRect(); if (el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width >= 4 && r.height >= 4 && r.top < 810 && r.bottom > 0 && r.left < 1280 && r.right > 0) el.setAttribute('data-uas-rv', '1'); }); });
    const html = '<!DOCTYPE html>\n' + await live.evaluate(() => document.documentElement.outerHTML), baseHref = live.url();
    const liveH = await live.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const audit = await live.evaluate(() => {   // ニールセンの一部の指摘は、ツールと別の実装で事実確認する
      const q = sel => [...document.querySelectorAll(sel)];
      const navLike = q('nav,[role=navigation],ul[class*="nav"],ul[class*="sidebar"],ul[class*="menu"]').filter(n => n.querySelectorAll('a').length >= 3 && !n.closest('footer'));
      const navActive = navLike.some(n => n.matches('[aria-current],.active,[class*="active"]') || n.querySelector('[aria-current],[aria-selected=true],.active,.current,.selected,[class*="-active"]'));
      const helpWords = /help|faq|support|contact|お問い合わせ|問い合わせ|サポート|ヘルプ|よくある/i;
      const seen = e => { const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
      const helpEl = q('a[href],button').filter(seen).find(e => { const t = (e.textContent || '').trim(); return (t.length <= 40 && helpWords.test(t)) || helpWords.test(e.getAttribute('aria-label') || ''); });
      const helpLink = !!helpEl, helpMatch = helpEl ? helpEl.outerHTML.replace(/\s+/g, ' ').slice(0, 120) : '';
      const forms = q('form').filter(f => f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea').length >= 6);
      return { navCandidates: navLike.length, navActive, helpLink, helpMatch, longForms: forms.length };
    });
    const axe = await runAxe(live); await live.close();
    const t0 = Date.now();
    const tool = await toolPage.evaluate(async ([html, name, base, DIAG]) => {
      await loadHTML(html, name, base);
      const doc = D.doc, vis = D.isVis, snip = el => el.outerHTML.replace(/\s+/g, ' ').slice(0, 150);
      const oracleSel = 'button,input[type=submit],input[type=button],input[type=reset],[role=button],a.btn,a[class*="btn-"]';
      const oracle = [...doc.querySelectorAll(oracleSel)].filter(vis), toolBtn = S.comps.filter(c => c.type === 'button');
      const toolSet = new Set(toolBtn.map(c => c.el)), orSet = new Set(oracle);
      const exp = el => { const c = el.getAttribute('class') || ''; if (/\bbtn-link\b/.test(c)) return 'text'; if (/\bbtn-outline-/.test(c)) return 'secondary'; if (/\bbtn-(secondary|light)\b/.test(c)) return 'secondary'; if (/\bbtn-(primary|success|danger|warning|info|dark)\b/.test(c)) return 'primary'; return null; };
      const kindPairs = toolBtn.filter(c => exp(c.el)).map(c => ({ exp: exp(c.el), got: c.bi.kind, html: snip(c.el) }));
      const ret = {
        comps: S.comps.length, types: S.comps.reduce((a, c) => (a[c.type] = (a[c.type] || 0) + 1, a), {}), pageH: S.frameH, ms: 0,
        issues: S.issues.filter(i => i.auto).map(i => ({ h: i.h, sev: i.sev, title: i.title, detail: i.detail, evidence: i.evidence, fix: i.fix })),
        scores: NIELSEN.map(h => hScore(h.id)), debug: S.debug,
        buttons: { oracle: oracle.length, tool: toolBtn.length, tp: oracle.filter(e => toolSet.has(e)).length,
          fn: oracle.filter(e => !toolSet.has(e)).map(snip).slice(0, 6), fnCount: oracle.filter(e => !toolSet.has(e)).length,
          fp: toolBtn.filter(c => !orSet.has(c.el)).map(c => ({ html: snip(c.el), kind: c.bi.kind })).slice(0, 8), fpCount: toolBtn.filter(c => !orSet.has(c.el)).length },
        kindPairs
      };
      let diag = null;
      if (DIAG) {
        const marked = [...doc.querySelectorAll('[data-uas-rv]')], miss = marked.filter(e => !vis(e)), causes = {};
        const sig = n => n.tagName.toLowerCase() + (n.getAttribute('class') ? '.' + n.getAttribute('class').trim().split(/\s+/).slice(0, 2).join('.') : '');
        miss.forEach(e => {
          const s0 = D.cs(e); let why = null;
          if (s0.display === 'none') why = 'self display:none'; else if (s0.visibility === 'hidden') why = 'self visibility:hidden'; else if (parseFloat(s0.opacity) === 0) why = 'self opacity:0 (animation=' + s0.animationName + ')';
          else { for (let n = e.parentElement; n && n !== doc.documentElement; n = n.parentElement) { const s = D.cs(n), b = n.getBoundingClientRect(); if (s.display === 'none') { why = 'ancestor display:none ' + sig(n); break; } if (parseFloat(s.opacity) === 0) { why = 'ancestor opacity:0 ' + sig(n) + ' (animation=' + s.animationName + ', transition=' + s.transitionProperty + ', style=' + (n.getAttribute('style') || '').slice(0, 50) + ')'; break; } if (/(hidden|clip|auto|scroll)/.test(s.overflowX + ' ' + s.overflowY) && (b.width < 4 || b.height < 4)) { why = 'ancestor collapsed ' + sig(n) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' ' + s.overflowX + '/' + s.overflowY; break; } } }
          if (!why) { const r = D.rect(e); why = 'position/size: ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h; }
          (causes[why] = causes[why] || { n: 0, sample: '' }).n++; if (!causes[why].sample) causes[why].sample = snip(e);
        });
        diag = { realVisibleTextEls: marked.length, toolHidden: miss.length, causes };
      }
      return Object.assign(ret, { diag });
    }, [html, p.label, baseHref, !!DIAG]);
    tool.ms = Date.now() - t0;
    if (DIAG) { console.log('--diag', p.id, JSON.stringify(tool.diag, null, 1)); delete tool.diag; }
    if (EVAL) { console.log('--eval', p.id, JSON.stringify(await toolPage.evaluate(EVAL), null, 1)); }
    const D = tool.debug;
    const checks = {
      contrast: score(nodesOf(axe, 'violations', ['color-contrast']), nodesOf(axe, 'incomplete', ['color-contrast']), nodesOf(axe, 'passes', ['color-contrast']), D.lowContrast),
      imageAlt: score(nodesOf(axe, 'violations', ['image-alt']), nodesOf(axe, 'incomplete', ['image-alt']), nodesOf(axe, 'passes', ['image-alt']), D.altMissing.map(r => ({ rect: r })), n => n.rect.w >= 48 && n.rect.h > 0),
      // ツールは「ボタンに見える要素」を対象にするため、axeのlink-name違反のうち、ツールがボタンとして扱った要素も正解に含める
      buttonName: score([...nodesOf(axe, 'violations', ['button-name', 'input-button-name']), ...nodesOf(axe, 'violations', ['link-name']).filter(n => hasClose(n.rect, D.allButtons))], [],
        [...nodesOf(axe, 'passes', ['button-name', 'input-button-name']), ...nodesOf(axe, 'passes', ['link-name']).filter(n => hasClose(n.rect, D.allButtons))], D.iconNoLabel),
      targetSize: score(nodesOf(axe, 'violations', ['target-size']), nodesOf(axe, 'incomplete', ['target-size']), nodesOf(axe, 'passes', ['target-size']), D.targetSmall, n => ['BUTTON', 'INPUT', 'SELECT'].includes(n.tag) || n.role === 'button')
    };
    if (EXPLAIN && checks.contrast.fnRects.length) {
      console.log('--explain', p.id, JSON.stringify(await toolPage.evaluate(rs => rs.map(r => {
        const els = [...D.doc.body.querySelectorAll('*')].filter(e => { const b = D.rect(e); return Math.abs(b.x - r.x) <= 6 && Math.abs(b.y - r.y) <= 6 && Math.abs(b.w - r.w) <= 8 && Math.abs(b.h - r.h) <= 8; });
        const el = els[els.length - 1]; if (!el) return { miss: true, r };
        const s = D.cs(el), bg = D.effBg(el), c = parseColor(s.color); let op = 1; for (let n = el; n; n = n.parentElement) op *= parseFloat(D.cs(n).opacity);
        const st = D.doc.elementsFromPoint(r.x + r.w / 2, r.y + r.h / 2), i = st.indexOf(el);
        return { tag: el.tagName, cls: String(el.className || '').slice(0, 36), vis: D.isVis(el), direct: [...el.childNodes].some(t => t.nodeType === 3 && t.textContent.trim()), disabledAttr: el.matches(':disabled'), color: s.color, bgNull: bg === null, ratio: bg && c ? +contrast(over(c, bg), bg).toFixed(2) : null, fs: s.fontSize, opacity: +op.toFixed(2), inStack: i, chain: (() => { const o = []; for (let n = el; n && n !== D.doc.documentElement && o.length < 8; n = n.parentElement) { const q = D.cs(n), b = n.getBoundingClientRect(); o.push(n.tagName.toLowerCase() + '.' + String(n.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.') + ' op=' + q.opacity + ' disp=' + q.display + ' vis=' + q.visibility + ' ov=' + q.overflowX + '/' + q.overflowY + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' anim=' + q.animationName + ' style=' + (n.getAttribute('style') || '').slice(0, 60)); } return o; })(),
          anims: D.doc.getAnimations().length, below: st.slice(i + 1, i + 4).map(b => b.tagName + '.' + String(b.className || '').slice(0, 20) + (b.contains(el) ? '(anc)' : '')) };
      }), checks.contrast.fnRects)));
    }
    const info = { axeContrastIncomplete: nodesOf(axe, 'incomplete', ['color-contrast']).length, axeLinkNameViolations: nodesOf(axe, 'violations', ['link-name']).filter(n => !hasClose(n.rect, D.allButtons)).length,
      axeLabelViolations: nodesOf(axe, 'violations', ['label', 'select-name']).length, toolPlaceholderOnly: D.placeholderOnly.length,
      toolPlaceholderOnlyAxePass: D.placeholderOnly.filter(r => hasClose(r.rect, nodesOf(axe, 'passes', ['label', 'select-name']))).length };
    const { debug, ...toolOut } = tool;
    results.push({ id: p.id, label: p.label, kind: p.kind, set: p.set || (LIVE ? 'live' : ''), audit, liveH, url: p.url || `${p.repo}/${p.path}`, sha256: crypto.createHash('sha256').update(html).digest('hex').slice(0, 16), checks, info, tool: toolOut });
    console.log(`${p.id.padEnd(16)} comps=${tool.comps} issues=${tool.issues.length} contrast tp/fp/fn=${checks.contrast.tp}/${checks.contrast.fpConfirmed + checks.contrast.fpUnverified}/${checks.contrast.fn}  btn recall=${tool.buttons.tp}/${tool.buttons.oracle}`);
  }
  await browser.close(); server.close();
  const meta = { date: new Date().toISOString(), axeCore: axeVersion, playwright: require(process.env.PLAYWRIGHT_MODULE ? path.join(process.env.PLAYWRIGHT_MODULE, 'package.json') : 'playwright/package.json').version,
    toolCommit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TOOL_DIR, encoding: 'utf8' }).trim(); } catch (e) { return ''; } })(),
    mode: LIVE ? 'live' : 'corpus (offline stubs)', stubs: stubStats ? { npm: stubStats.npm, css: stubStats.fontsCss, js: stubStats.emptyJs, images: stubStats.images, blockedHosts: [...stubStats.aborted] } : null,
    corpus: LIVE ? null : Object.fromEntries(Object.entries(T.repos).map(([k, v]) => [k, v.commit.slice(0, 7)])) };
  fs.writeFileSync(path.join(OUT, LIVE ? 'results_live.json' : 'results.json'), JSON.stringify({ meta, results }, null, 1));
  require('./report').write(OUT, meta, results, !!LIVE);
}
main().catch(e => { console.error(e); process.exit(1); });
