// ⑨ 実測視線（CSV / Excel の読み込み・座標変換・重ね表示）を確かめる。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node real_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const path = require('path');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
const G = path.join(__dirname, 'fixtures/gaze/') ;
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/net::|ERR_/.test(m.text()) && errs.push(m.text()));
  await p.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  assert(await p.evaluate(() => [...document.querySelectorAll('.tabs button')].map(b => b.dataset.tab).join()) === 'comps,heur,gaze,lens,cmp,multi,resp,kp,real', '⑨のタブが⑧の次に並ぶ');
  await p.click('.tabs button[data-tab="real"]');
  assert((await p.textContent('#panelBody')).includes('実測データ'), '実測データのバッジが出る(③の仮想と別ラベル)');
  assert(!(await p.textContent('.tabs button[data-tab="gaze"]')).includes('実測'), '③のタブは「仮想視線」のまま');

  // CSV(注視データ, 1920x1080)
  await p.setInputFiles('#rgFile', G + 'fix.csv'); await p.waitForSelector('#rgResult .tile');
  const st = await p.evaluate(() => { const c = S.real.cfg, r = realCompute(); return { c, n: r.fix.length, out: r.st.out, f0: [r.fix[0].x, r.fix[0].y, r.fix[0].dur], f5: [r.fix[5].x, r.fix[5].y], head: S.real.tbl.sheets[0].head }; });
  console.log(JSON.stringify(st));
  assert(st.c.xi === 2 && st.c.yi === 3 && st.c.di === 4 && st.c.unit === 'px', 'ヘッダーからX・Y・継続時間の列を自動で選ぶ');
  assert(st.n === 6 && st.out === 1, 'ページの外の1点は外す(6点表示・1点除外)');
  assert(Math.abs(st.f0[0] - 300 * 1280 / 1920) < .01 && Math.abs(st.f0[1] - 120 * 800 / 1080) < .01, '1920×1080 → 1280×800 の倍率で座標を変換');
  assert(Math.abs(st.f5[0] - 640) < .01 && Math.abs(st.f5[1] - 400) < .01, '画面中央(960,540)は、解析画面の中央(640,400)に来る');
  assert((await p.textContent('#rgResult')).includes('縦横比が違います') === true || (1920 / 1080) / (1280 / 800) - 1 < .02 === false, '縦横比の違いを知らせる');
  assert(await p.evaluate(() => document.querySelector('#ov').innerHTML.includes('実測視線（記録データ）') && document.querySelector('#ov').innerHTML.includes('stroke-dasharray="10 5"')), 'ステージに実測の軌跡(破線・青)と「実測視線」ラベルを重ねる');
  assert(await p.evaluate(() => !document.querySelector('#ov').innerHTML.includes('#E11D48')), '仮想視線(赤)は、このタブでは重ならない');
  // 解析幅を記録に合わせる
  await p.click('#rgFitVp'); await p.waitForFunction(() => PAGE_W === 1920 && FOLD_H === 1080, null, { timeout: 30000 }); await p.waitForTimeout(1500);
  const f = await p.evaluate(() => { const r = realCompute(); return [r.fix[0].x, r.fix[0].y, r.fix.length, S.real.cfg.recW]; });
  assert(Math.abs(f[0] - 300) < .01 && Math.abs(f[1] - 120) < .01 && f[3] === 1920, '解析幅を1920×1080にすると、座標は記録のまま(倍率1)');
  assert(!(await p.textContent('#rgResult')).includes('縦横比が違います'), '縦横比が合うと、警告が消える');
  await p.evaluate(async () => { await setViewport('pc'); renderAll(); }); await p.waitForTimeout(1200);

  // 実測ヒートマップ
  await p.check('#tgRealHeat'); const hv = await p.evaluate(() => { const c = document.getElementById('heatReal'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return [c.style.display, n]; });
  assert(hv[0] === 'block' && hv[1] > 100, '実測ヒートマップが描かれる');

  // CSV出力
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rgCsv')]); const txt = require('fs').readFileSync(await dl.path(), 'utf8');
  assert(txt.startsWith('﻿no,x_recorded_px') && txt.split('\r\n').length === 7, '変換後の注視点をCSVで保存できる(6行+見出し)');

  // 生サンプル + 小数カンマ + 秒 + 割合
  await p.setInputFiles('#rgFile', G + 'samples.csv'); await p.waitForSelector('#rgResult');
  const s2 = await p.evaluate(() => { const r = realCompute(); return { c: S.real.cfg, n: r.fix.length, d: r.fix.map(f => f.dur), x: r.fix.map(f => Math.round(f.x)) }; });
  console.log(JSON.stringify(s2));
  assert(s2.c.kind === 'sample' && s2.c.unit === 'norm' && s2.c.tunit === 's', '時刻だけの列・0〜1の値・秒を自動判定(生サンプル)');
  assert(s2.n === 3 && Math.abs(s2.x[0] - .2 * 1280) < 8 && Math.abs(s2.x[2] - .8 * 1280) < 8, '生サンプルから3回の注視にまとめ、割合を解析画面の座標に直す');
  assert(s2.d[0] > 400 && s2.d[0] < 560, '注視の長さは、時刻から計算される(約500ms)');

  // Shift_JIS
  await p.setInputFiles('#rgFile', G + 'sjis.csv'); await p.waitForSelector('#rgResult');
  assert(await p.evaluate(() => S.real.tbl.sheets[0].head.join('|')) === 'X座標|Y座標|注視時間(ms)', 'Shift_JISのCSVでも、見出しが読める');

  // xlsx (2シート)
  await p.setInputFiles('#rgFile', G + 'gaze.xlsx'); await p.waitForSelector('#rgSheet');
  assert(await p.evaluate(() => S.real.tbl.sheets.map(s => s.name).join()) === 'メモ,gaze', 'xlsxのシート名を読む');
  await p.selectOption('#rgSheet', '1'); await p.waitForSelector('#rgResult .tile');
  const x1 = await p.evaluate(() => { const r = realCompute(); return { c: S.real.cfg, n: r.fix.length, d: r.fix.map(f => f.dur) }; });
  assert(x1.n === 4 && x1.c.xi === 1 && x1.c.yi === 2 && x1.c.di === 3 && x1.d[0] === 300, 'xlsxのシートから、4回の注視を読む');
  assert((await p.textContent('#rgResult')).includes('種類別の滞留割合'), '③の仮想視線との比較が出る');

  // 再生
  await p.click('#rgPlay'); await p.waitForTimeout(300); assert(await p.evaluate(() => S.real.upTo !== null && S.real.upTo >= 1), '再生で、軌跡が順に伸びる'); await p.click('#rgPlay');
  // 仮想視線タブとの切替で状態が混ざらない
  await p.click('.tabs button[data-tab="gaze"]'); assert(await p.evaluate(() => S.show.real === false && document.querySelector('#ov').innerHTML.includes('#E11D48')), '③に戻ると、実測は消え、仮想視線(赤)が出る');
  await p.click('.tabs button[data-tab="real"]'); assert(await p.evaluate(() => S.show.real === true), '⑨に戻ると実測が出る');
  // 列未選択
  await p.selectOption('#rgX', '-1'); assert((await p.textContent('#rgResult')).includes('列を選んでください'), 'X列が未選択ならメッセージを出す');
  // 画面遷移の記録(座標なし)を、座標として描かない
  await p.setInputFiles('#rgFile', G + 'transitions.csv'); await p.waitForSelector('#rgResult');
  assert(await p.evaluate(() => S.real.cfg.xi === -1 && S.real.cfg.yi === -1 && realCompute().fix.length === 0), '座標のない表(画面遷移の記録)は、先頭2列を座標とみなさない');
  assert((await p.textContent('#rgResult')).includes('画面の切り替え時刻の記録'), '画面遷移の記録だと、案内を出す');
  // 標準タグを使わない画面(構成要素が0個)でも、⑨は使える
  await p.evaluate(async () => { await loadHTML('<!doctype html><body style="margin:0"><div style="padding:40px"><div style="font-size:20px">タイトル</div><label style="display:inline-block;padding:10px;background:#27c">はじめる</label></div></body>', 'plain'); });
  await p.waitForTimeout(500); assert(await p.evaluate(() => S.comps.length) === 0, '(前提)標準タグがない画面は、構成要素が0個');
  await p.click('.tabs button[data-tab="real"]'); await p.setInputFiles('#rgFile', G + 'fix.csv'); await p.waitForSelector('#rgResult .tile');
  assert(await p.evaluate(() => realCompute().fix.length) === 6 && (await p.textContent('#rgResult')).includes('構成要素が見つかっていません'), '構成要素が0個でも、軌跡を重ねられる(要素別の集計は出ない旨を表示)');
  // 標準タグを使わない作り: label のボタン・CSS の content の文言・選択カード・aoi 指定
  await p.evaluate(async h => { await loadHTML(h, 'aoi-shop'); }, require('fs').readFileSync(path.join(__dirname, 'fixtures/aoi-shop.html'), 'utf8')); await p.waitForTimeout(600);
  const dt = await p.evaluate(() => ({ btn: S.comps.filter(c => c.type === 'button').map(c => c.label), card: S.comps.filter(c => c.type === 'card').length, aoi: S.aoi.map(a => a.name).sort().join() }));
  assert(dt.btn.length === 3 && dt.btn.every(l => l === 'カートに追加'), 'label で作ったボタン(文言は CSS の content)を、ボタンとして拾う');
  assert(dt.card >= 3, '選択カード(label)と商品カードを、カードとして拾う(' + dt.card + ')');
  assert(dt.aoi === 'aoi-decoy,aoi-decoy,aoi-target', 'id・class の aoi 指定を、AOIとして読む');
  const tg = await p.evaluate(() => { const a = S.aoi.find(x => x.name === 'aoi-target').rect, d = S.aoi.find(x => x.name === 'aoi-decoy').rect; const k = 1920 / PAGE_W; return { t: [(a.x + a.w / 2) * k, (a.y + 30) * 1080 / FOLD_H], d: [(d.x + d.w / 2) * k, (d.y + 30) * 1080 / FOLD_H] }; });
  const csvText = 'x,y,duration\n' + [[...tg.t, 400], [...tg.t, 300], [...tg.t, 200], [...tg.d, 500], [10, 790, 100]].map(r => r.join(',')).join('\n');
  await p.click('.tabs button[data-tab="real"]'); await p.setInputFiles('#rgFile', { name: 'aoi.csv', mimeType: 'text/csv', buffer: Buffer.from(csvText) }); await p.waitForSelector('#rgResult .tile');
  const ar = await p.evaluate(() => { const r = realAoiRows(realCompute().fix); return { g: r.groups.map(o => [o.name, o.els.length, o.dur, o.n, o.first]), out: [r.out.dur, r.out.n] }; });
  assert(JSON.stringify(ar.g[0]) === '["aoi-target",1,900,3,1]' && JSON.stringify(ar.g[1]) === '["aoi-decoy",2,500,1,4]', 'AOI別に、滞留・回数・最初に見た順を集計する(target 900ms/3回、decoy 500ms/1回)');
  assert((await p.textContent('#rgResult')).includes('AOI別の滞留') && await p.evaluate(() => document.querySelector('#ov').innerHTML.includes('stroke="#7E22CE"')), 'AOI別の表と、AOIの位置(紫の破線)をステージに出す');
  // CSSだけ(非表示の radio の :checked)で切り替わる画面: 中身の少ない画面も数え、共通のナビもその画面の状態で解析する
  await p.evaluate(async h => { await loadHTML(h, 'radio-screens'); }, require('fs').readFileSync(path.join(__dirname, 'fixtures/radio-screens.html'), 'utf8')); await p.waitForTimeout(600);
  assert(await p.evaluate(() => S.screens && S.screens.items.length) === 3, '中身の少ない画面(完了)も、画面として数える(3画面)');
  await p.evaluate(async () => { await selectScreen(1); }); await p.waitForTimeout(500);
  assert(await p.evaluate(() => S.aoi.some(a => a.name === 'aoi-logo') && S.comps.some(c => c.type === 'button' && c.label === '一覧')), 'radio で切り替わる画面は、その画面の状態(共通ナビあり)で解析する');
  await p.evaluate(async () => { await selectScreen(0); }); await p.waitForTimeout(500);
  assert(await p.evaluate(() => !S.aoi.some(a => a.name === 'aoi-logo')), 'スタート画面では、共通ナビは出ない(その画面の状態のまま)');
  // デモ
  await p.click('#rgDemo'); await p.waitForSelector('#rgResult .tile'); assert((await p.textContent('#panelBody')).includes('デモ用データ(作り物)') && await p.evaluate(() => realCompute().fix.length) >= 5, 'デモ用データ(作り物と明記)で試せる');
  await p.click('#rgClear'); assert(await p.evaluate(() => S.real === null), '読み込みを消せる');
  assert(errs.length === 0, 'JSエラーなし ' + errs.join('|'));
  await b.close();
})();
