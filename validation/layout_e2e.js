// 画面の並びとタブ・結果パネルの配置を確かめる（PC・タブレット・スマホ）。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node layout_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const path = require('path');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); const errs = [];
  const open = async (w, h) => { const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', e => errs.push(e.message)); await p.goto('file://' + path.resolve(__dirname, '../index.html')); await p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 }); return p; };
  const tabs = p => p.evaluate(() => { const bar = document.querySelector('.tabs'), bs = [...bar.querySelectorAll('button')]; return { n: bs.length, rows: new Set(bs.map(x => Math.round(x.getBoundingClientRect().top))).size, scroll: bar.scrollWidth > bar.clientWidth + 1, clipped: bs.filter(x => x.querySelector('.tl').scrollWidth > x.clientWidth + 1).length, names: bs.map(x => x.querySelector('.sr-only').textContent) }; });

  let p = await open(1440, 900); let t = await tabs(p);
  assert(t.n === 9 && t.rows === 1, 'PC：9つのタブが1段に並ぶ（折り返さない）');
  assert(!t.scroll && t.clipped === 0, 'PC：タブの文字が切れず、横スクロールも要らない');
  assert(t.names[7] === '⑧ Where・When・Why' && t.names[0] === '① 構成要素', 'タブの読み上げ名は、「① 構成要素」「⑧ Where・When・Why」のまま');
  await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(300);
  const pr = await p.evaluate(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
  assert(pr.top >= 0 && pr.bottom <= pr.vh, 'PC：スクロールしても、結果パネル（タブを含む）が画面に収まる（' + pr.top + '〜' + pr.bottom + ' / ' + pr.vh + '）');
  assert(await p.evaluate(() => getComputedStyle(document.querySelector('#jump')).display) === 'none', 'PC：下の「結果／画面」切り替えは出さない');
  // --- 入力欄・重ね表示・文字の大きさ ---
  const ui = await p.evaluate(() => { const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; const s = document.querySelector('#settings'); const samples = [...document.querySelectorAll('.sample span')]; return { scrRowShown: vis(document.querySelector('#scrRow')), settingsOpen: s.open, sum: document.querySelector('#settingsSum').textContent, vpShown: (e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; })(document.querySelector('#vpSel')), clamped: samples.filter(e => e.scrollHeight > e.clientHeight + 1).length, groups: [...document.querySelectorAll('.stage-bar .bar-group')].map(g => g.getAttribute('aria-label').slice(0, 5)), toggles: document.querySelectorAll('.stage-bar .bar-group:first-child .toggle').length, actions: document.querySelectorAll('.stage-bar .bar-actions .mini').length, minFont: Math.min(...[...document.querySelectorAll('.input-card *, .stage-card *:not(iframe), .panel *')].filter(e => e.closest('svg') === null && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent !== null).map(e => parseFloat(getComputedStyle(e).fontSize))) }; });
  assert(!ui.scrRowShown, '画面が1つのときは、「解析する画面」の行を出さない');
  assert(!ui.settingsOpen && /1280×800/.test(ui.sum) && !ui.vpShown, '解析の設定は、既定で折りたたみ、いまの画面幅を見出しに出す');
  assert(ui.clamped === 0, 'サンプルの説明が、途中で省略されない');
  assert(ui.groups.length === 2 && ui.groups[0] === '重ねて表示' && ui.toggles === 8 && ui.actions === 2, 'ステージの操作を、「重ねて表示（8つ）」と「保存（2つ）」の2グループに分ける');
  assert(ui.minFont >= 13, '入力欄・ステージ・結果パネルの文字は、最小13px以上（実測 ' + ui.minFont + 'px）');
  await p.click('#settings summary'); assert(await p.evaluate(() => { const e = document.querySelector('#vpSel'), r = e.getBoundingClientRect(); return document.querySelector('#settings').open && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; }), '「解析の設定」を開くと、画面幅の選択が出る（押せる位置にある）');
  await p.close();

  p = await open(1100, 800); t = await tabs(p);
  assert(t.rows === 1 && t.scroll && t.clipped === 0, 'タブレット幅：タブは1段で、横にスクロールできる');
  await p.close();

  p = await open(390, 844); t = await tabs(p);
  assert(t.rows === 1 && t.scroll, 'スマホ：タブは1段で、横にスクロールできる');
  const o = await p.evaluate(() => { const y = s => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY); return { input: y('.input-card'), panel: y('.panel'), stage: y('.stage-card'), vis: getComputedStyle(document.querySelector('#jump')).display !== 'none' && !document.querySelector('#jump').hidden, hs: document.documentElement.scrollWidth }; });
  assert(o.input < o.panel && o.panel < o.stage, 'スマホ：入力 → 結果 → 画面 の順に並ぶ');
  assert(o.vis, 'スマホ：下の「結果／画面」切り替えが出る'); assert(o.hs <= 390, 'スマホ：横にはみ出さない');
  await p.click('#jump button[data-jump="stage"]'); await p.waitForTimeout(900);
  assert(await p.evaluate(() => Math.abs(document.querySelector('.stage-card').getBoundingClientRect().top) < 40) && await p.evaluate(() => document.querySelector('#jump button[data-jump="stage"]').getAttribute('aria-pressed')) === 'true', 'スマホ：「画面」を押すと、画面の位置へ移り、「画面」が選択状態になる');
  await p.click('#jump button[data-jump="panel"]'); await p.waitForTimeout(900);
  assert(await p.evaluate(() => document.querySelector('#jump button[data-jump="panel"]').getAttribute('aria-pressed')) === 'true', 'スマホ：「結果」を押すと、結果に戻り、「結果」が選択状態になる');
  await p.click('.tabs button[data-tab="kp"]'); await p.waitForTimeout(700);
  assert(await p.evaluate(() => { const a = document.querySelector('.tabs button[data-tab="kp"]').getBoundingClientRect(), r = document.querySelector('.tabs').getBoundingClientRect(); return a.left >= r.left - 1 && a.right <= r.right + 1; }), 'スマホ：⑧を選ぶと、タブが⑧の位置までスクロールする');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.evaluate(() => document.querySelectorAll('[data-sample]')[1].click()); await p.waitForTimeout(1500);
  assert(await p.evaluate(() => Math.abs(document.querySelector('.panel').getBoundingClientRect().top) < 60), 'スマホ：サンプルを選んで解析すると、結果の位置へ自動で移る');
  assert(!errs.length, 'JavaScriptのエラーがない'); await b.close();
})();
