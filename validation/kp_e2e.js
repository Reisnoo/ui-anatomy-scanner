// ⑧ Where・When・Why（キーポイントの記録）を確かめる。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node kp_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const fs = require('fs'), path = require('path');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/spa-multipage.html'), 'utf8');
  await p.evaluate(async h => { await loadHTML(h, 'spa'); await selectScreen(1); }, html);   // 一覧画面

  assert(await p.evaluate(() => [...document.querySelectorAll('.tabs button')].map(b => b.dataset.tab).join()) === 'comps,heur,gaze,lens,cmp,multi,resp,kp,real', '⑧のタブが、⑦の次に並ぶ');
  await p.click('.tabs button[data-tab="kp"]');
  assert(await p.evaluate(() => document.querySelector('#panelBody').textContent.includes('Where') && document.querySelector('#panelBody').textContent.includes('When') && document.querySelector('#panelBody').textContent.includes('Why')), '⑧のパネルに Where・When・Why が出る');
  assert(await p.evaluate(() => document.getElementById('kpWhen').value) === 'list：商品一覧', 'When の初期値は、いま解析している画面');

  await p.click('#kpAdd');   // Why が空
  assert(await p.evaluate(() => S.kp.length) === 0, 'Why（自由記述）が空のままでは追加できない');
  await p.selectOption('#kpWhere', { index: 2 });
  await p.fill('#kpWhy', 'カードの説明文が薄く、読みにくい');
  await p.selectOption('#kpCode', 'R99');
  await p.click('#kpAdd');
  const k = await p.evaluate(() => S.kp[0]);
  assert(k && k.when === 'list：商品一覧' && k.whyText.includes('読みにくい') && k.whyCode === 'R99' && k.where.rect.w > 0, 'Where・When・Why を1件記録できる');

  await p.click('#kpDraft');
  const n1 = await p.evaluate(() => S.kp.length); assert(n1 > 1, '指摘から下書きを作れる（' + (n1 - 1) + '件）');
  assert(await p.evaluate(() => S.kp.filter(r => r.origin === 'issue').every(r => r.status === '下書き' && r.whyText && r.where.type)), '下書きは「下書き」状態で、Where と Why の案が入る');
  await p.click('#kpDraft'); assert(await p.evaluate(() => S.kp.length) === n1, '同じ指摘から、二重に下書きを作らない');
  assert(await p.evaluate(() => S.kp.filter(r => r.origin === 'issue').some(r => /コントラスト/.test(r.whyText))), '一覧画面のコントラストの指摘が、下書きになる');

  await p.evaluate(async () => { await selectScreen(2); });   // 詳細画面へ。記録は画面ごとの When を保つ
  assert(await p.evaluate(() => kpRows().length) === n1 && await p.evaluate(() => kpCurWhen()) === 'detail：トートバッグ', '画面を切り替えても、記録は残り、When は記録時の画面のまま');
  await p.evaluate(() => { S.tab = 'kp'; renderAll(); });
  assert(await p.evaluate(() => document.querySelector('#ov').innerHTML.includes('stroke-dasharray="8 4"')) === false, 'ステージには、いまの画面の記録だけを重ねる（別の画面の記録は重ねない）');
  await p.evaluate(async () => { await selectScreen(1); S.tab = 'kp'; renderAll(); });
  assert(await p.evaluate(() => document.querySelector('#ov').innerHTML.includes('stroke-dasharray="8 4"')), '一覧画面に戻すと、記録の枠をステージに重ねる');

  const csv = await p.evaluate(() => kpCSV());
  const sheet = path.join(__dirname, '../../gaze-entropy-research/docs/keypoint_record_sheet_v1.csv');   // 研究リポジトリが隣にあるときだけ照合する
  const mine = csv.replace(/^\ufeff/, '').split('\n')[0].trim();
  if (fs.existsSync(sheet)) assert(mine === fs.readFileSync(sheet, 'utf8').split('\n')[0].replace(/^\ufeff/, '').trim(), 'CSVの列が、コードブックの記録シート（keypoint_record_sheet_v1.csv）と同じ');
  else assert(mine.split(',').length === 16 && mine.startsWith('unit_id,condition,technique,screen,where_id'), 'CSVの列は、記録シートと同じ16列');
  assert(csv.split('\n').filter(Boolean).length === n1 + 1 && /W-/.test(csv), 'CSVは、記録の件数ぶんの行と where_id を持つ');

  // --- 提出用レポート（HTML）への反映 ---
  await p.evaluate(async () => { S.versions = []; S.rep.kp = true; S.rep.kpDraft = false; await selectScreen(1); addVersion('一覧', true); await selectScreen(2); addVersion('詳細', true); });
  const rep = async () => p.evaluate(() => { const h = buildReportHTML(); const d = new DOMParser().parseFromString(h, 'text/html'); return { has: h.includes('Where・When・Why の記録'), heads: [...d.querySelectorAll('section h2')].map(x => x.textContent), rows: [...d.querySelectorAll('section')].find(s => /Where・When・Why/.test(s.querySelector('h2').textContent)) ? [...[...d.querySelectorAll('section')].find(s => /Where・When・Why/.test(s.querySelector('h2').textContent)).querySelectorAll('tr')].length - 1 : 0, text: d.body.textContent }; });
  const r1 = await rep();
  assert(r1.has, '提出用レポートに「Where・When・Why の記録」の章が入る');
  assert(r1.rows === 1 && r1.text.includes('カードの説明文が薄く、読みにくい'), '既定では、人が書いた記録（1件）だけを載せ、下書きは載せない');
  const nums = r1.heads.map(h => parseInt(h)).filter(n => !isNaN(n)); assert(nums.every((n, i) => n === i + 1), '章の番号が、1から順に並ぶ（' + nums.join(',') + '）');
  assert(/Whyは解釈的な符号/.test(r1.text), '方法と限界に、記録の注意書きが入る');
  await p.evaluate(() => { S.rep.kpDraft = true; }); const r2 = await rep(); assert(r2.rows === n1 && /人の確認前/.test(r2.text), '「下書きも載せる」で全件を載せ、人の確認前であることを書く');
  await p.evaluate(() => { S.rep.kp = false; }); const r3 = await rep(); assert(!r3.has, '「記録を載せる」をオフにすると、章が入らない');
  const nums3 = r3.heads.map(h => parseInt(h)).filter(n => !isNaN(n)); assert(nums3.every((n, i) => n === i + 1), 'オフのときも、章の番号は1から順に並ぶ');
  await p.evaluate(() => { S.rep.kp = true; S.rep.kpDraft = false; S.tab = 'cmp'; S.cTab = 'history'; renderPanel(); });
  assert(await p.evaluate(() => !!document.getElementById('rKp') && !!document.getElementById('rKpDraft')), 'レポートの設定に、記録を載せる・下書きを載せるの選択がある');
  assert(await p.evaluate(() => buildReport().includes('## Where・When・Why の記録')), 'Markdownの分析レポートにも、記録が入る');

  await p.evaluate(async () => { await loadHTML(SAMPLES[0].build(), 'sample'); });   // 別のページ
  await p.evaluate(() => { S.tab = 'kp'; renderPanel(); });
  assert(await p.evaluate(() => kpRows().length) === 0 && await p.evaluate(() => S.kp.length) === n1, '別のページでは、そのページの記録だけを出す（ほかは保存したまま）');
  await p.reload(); await p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'));
  assert(await p.evaluate(() => S.kp.length) === n1, '再読み込みしても、記録がブラウザに残る');
  assert(!errs.length, 'JavaScriptのエラーがない'); await b.close();
})();
