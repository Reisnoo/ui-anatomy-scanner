// 採点アプリ（results/rating_app.html）の動作確認。採点そのものは行わず、操作が正しく動くことだけを確かめる。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node rating_app_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const file = path.join(__dirname, 'results', 'rating_app.html'); if (!fs.existsSync(file)) { console.error('先に node rating_app.js を実行してください'); process.exit(1); }
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + file);
  const n = await p.evaluate(() => ({ all: DATA.rows.length, shown: total().length, ctl: DATA.rows.filter(r => r.set === 'control').length, withRect: DATA.rows.filter(r => r.rects && r.rects.length).length, pages: Object.keys(DATA.pages).length }));
  assert(n.all === 235 && n.shown === n.all - n.ctl, '全235件のうち、コントロールを除く' + n.shown + '件を、既定で採点対象にする');
  assert(n.withRect > n.all * 0.6, '指摘の場所（枠）が取れている件数が多い（' + n.withRect + ' / ' + n.all + '）');
  assert(await p.evaluate(() => document.querySelector('#inner img').naturalWidth > 100 && document.querySelectorAll('.box').length >= 0), 'ページの画像が表示される');
  assert((await p.textContent('#progTxt')).includes('0 / ' + n.shown), '開始時は、すべて未採点（0件）で、AIの採点は入っていない');
  const first = await p.evaluate(() => list()[0].key); await p.keyboard.press('1');
  assert(await p.evaluate(k => ST.a['1'][k], first) === '妥当' && await p.evaluate(() => ST.idx) === 1, '「1」で妥当を付け、次の未採点へ進む');
  await p.keyboard.press('3'); await p.keyboard.press('2'); await p.keyboard.press('ArrowLeft');
  assert(await p.evaluate(() => Object.keys(ST.a['1']).length) === 3, '「3」「2」でも付けられ、←で戻れる');
  await p.keyboard.press('0'); assert(await p.evaluate(() => Object.keys(ST.a['1']).length) === 2, '「0」で、いまの判定を消せる');
  await p.fill('#note', '迷った'); await p.keyboard.press('Tab'); assert(await p.evaluate(() => Object.values(ST.notes['1'])[0]) === '迷った', 'メモを保存できる（入力中は、数字キーで判定されない）');
  await p.check('#onlyUn'); const un = await p.evaluate(() => list().length); assert(un === n.shown - 2, '「未採点だけ」で、採点済みを除く（' + un + '件）');
  await p.uncheck('#onlyUn');
  await p.reload(); assert(await p.evaluate(() => Object.keys(ST.a['1']).length) === 2, '再読み込みしても、採点が残る（ブラウザに自動保存）');
  // 評価者2：別の判定で、同じ指摘を採点 → κが出る
  const keys = await p.evaluate(() => list().slice(0, 6).map(r => r.key));
  await p.selectOption('#rater', '2'); assert(await p.evaluate(() => Object.keys(ST.a['2']).length) === 0, '評価者を切り替えると、評価者2の採点は、別に数える');
  await p.evaluate(ks => { ST.a['1'] = {}; ks.forEach((k, i) => { ST.a['1'][k] = ['妥当', '妥当', '疑わしい', '誤り', '妥当', '疑わしい'][i]; ST.a['2'][k] = ['妥当', '疑わしい', '疑わしい', '誤り', '妥当', '妥当'][i]; }); save(); render(); }, keys);
  await p.click('#sum'); const sum = await p.textContent('#dlgBody'); assert(/一致率 67%/.test(sum) && /κ/.test(sum), '集計で、2人の一致率とκを出す（テスト用の仮の判定で、式を確認）'); await p.click('#dlgClose');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exp')]); const out = path.join(os.tmpdir(), 'rating_test.csv'); await dl.saveAs(out);
  const txt = fs.readFileSync(out, 'utf8').replace(/^﻿/, ''); assert(txt.split('\n')[0] === '"page","set","issue_no","heuristic","severity","title","evidence","rater1","rater2","note"', '書き出したCSVの列が、採点シート（rating_sheet.csv）と同じ');
  const sc = execFileSync('node', [path.join(__dirname, 'score_ratings.js'), out], { encoding: 'utf8' });
  assert(/κ/.test(sc) && /評価者1/.test(sc), 'score_ratings.js で、書き出したCSVを集計できる');
  // 取り込み：評価者2だけのCSVを、評価者1の採点に合体
  const only2 = txt.split('\n').map((l, i) => i === 0 ? l : l).join('\n'); fs.writeFileSync(out + '.2.csv', only2);
  await p.evaluate(() => { ST.a = { '1': {}, '2': {} }; save(); render(); }); await p.setInputFiles('#file', out + '.2.csv'); await p.waitForTimeout(300);
  assert(await p.evaluate(() => Object.keys(ST.a['1']).length) === 6 && await p.evaluate(() => Object.keys(ST.a['2']).length) === 6, 'CSVを読み込むと、評価者1・2の採点が復元される（別の人の分の合体にも使える）');
  assert(!errs.length, 'JavaScriptのエラーがない'); await b.close();
})();
