// 複数画面（1つのHTML内のページ遷移）の検出・画面ごとの解析を確かめる。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node screens_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const fs = require('fs'), path = require('path');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/spa-multipage.html'), 'utf8');
  const snap = () => p.evaluate(() => ({ screen: S.src.screen, idx: S.screenIdx, comps: S.comps.length, titles: S.issues.filter(i => i.auto).map(i => i.title) }));

  assert(await p.evaluate(() => S.screens === null), 'サンプル（画面が1つ）では画面選択を出さない');
  await p.evaluate(async h => { await loadHTML(h, 'spa'); }, html);
  assert(await p.evaluate(() => S.screens && S.screens.items.length) === 4, '4つの画面（home/list/detail/cart）を検出する');
  assert(await p.evaluate(() => !document.getElementById('scrRow').hidden), '画面の選択行を表示する');
  const initial = await snap(); assert(initial.idx === null && initial.comps === 6, '何も選ばないときは、初期表示（home）のまま解析する');

  const s = []; for (let i = 0; i < 4; i++) { await p.evaluate(async i => { await selectScreen(i); }, i); s.push(await snap()); }
  assert(s[0].comps === initial.comps, 'home を選んだ結果は、初期表示と同じ');
  assert(s[1].titles.some(t => /コントラスト/.test(t)) && !s[0].titles.some(t => /コントラスト/.test(t)), 'コントラスト不足は「一覧」画面だけに出る');
  assert(s[2].titles.some(t => /12px未満/.test(t)) && !s[1].titles.some(t => /12px未満/.test(t)), '小さな文字は「詳細」画面だけに出る');
  assert(s[3].titles.some(t => /エラーを伝える領域/.test(t)), '「カート」画面だけがフォームを持ち、エラー領域の指摘が出る');
  assert(s.every((x, i) => x.idx === i && x.screen), '選んだ画面名が解析結果に付く');

  await p.evaluate(async () => { await setViewport('mobile'); });
  assert(await p.evaluate(() => S.screenIdx) === 3 && await p.evaluate(() => PAGE_W) === 375, '画面幅を変えても、選んだ画面を保つ');
  await p.evaluate(async () => { await setViewport('pc'); });

  const op = async r => p.evaluate(async ([h, r]) => { S.screenReveal = r; await loadHTML(h, 'spa'); await selectScreen(2); return [...frame.contentDocument.querySelectorAll('[data-uas-screen] *')].filter(e => getComputedStyle(e).opacity === '0').length; }, [html, r]);
  assert(await op(false) > 0 && await op(true) === 0, '「透明な要素も表示扱い」で、スクロール連動の隠れた要素を表示する');

  await p.evaluate(async () => { S.versions = []; await analyzeAllScreens(); });
  assert(await p.evaluate(() => S.versions.length) === 4 && await p.evaluate(() => S.tab + '/' + S.cTab) === 'cmp/history', '全画面を一括解析すると、履歴に4件追加して比較タブを開く');

  await p.evaluate(async () => { await loadHTML(SAMPLES[0].build(), 'sample'); });
  assert(await p.evaluate(() => S.screens === null && document.getElementById('scrRow').hidden), '別のページを読み込むと、画面の選択をリセットする');
  assert(!errs.length, 'JavaScriptのエラーがない'); await b.close();
})();
