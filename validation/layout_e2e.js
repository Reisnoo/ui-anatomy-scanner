// 画面の並びとタブ・結果パネルの配置を確かめる（PC・タブレット・スマホ）。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node layout_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const path = require('path');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); const errs = [];
  const open = async (w, h) => { const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', e => errs.push(e.message)); await p.goto('file://' + path.resolve(__dirname, '../index.html')); await p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 }); return p; };
  const tabs = p => p.evaluate(() => { const bar = document.querySelector('.tabs'), bs = [...bar.querySelectorAll('button')]; return { n: bs.length, rows: new Set(bs.map(x => Math.round(x.getBoundingClientRect().top))).size, scroll: bar.scrollWidth > bar.clientWidth + 1, clipped: bs.filter(x => x.querySelector('.tl').scrollWidth > x.clientWidth + 1).length, names: bs.map(x => x.querySelector('.sr-only').textContent) }; });

  let p = await open(1440, 900); let t = await tabs(p);
  assert(t.n === 8 && t.rows === 1, 'PC：8つのタブが1段に並ぶ（折り返さない）');
  assert(!t.scroll && t.clipped === 0, 'PC：タブの文字が切れず、横スクロールも要らない');
  assert(t.names[7] === '⑧ Where・When・Why' && t.names[0] === '① 構成要素', 'タブの読み上げ名は、「① 構成要素」「⑧ Where・When・Why」のまま');
  await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(300);
  const pr = await p.evaluate(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
  assert(pr.top >= 0 && pr.bottom <= pr.vh, 'PC：スクロールしても、結果パネル（タブを含む）が画面に収まる（' + pr.top + '〜' + pr.bottom + ' / ' + pr.vh + '）');
  assert(await p.evaluate(() => getComputedStyle(document.querySelector('#jump')).display) === 'none', 'PC：下の「結果／画面」切り替えは出さない');
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
