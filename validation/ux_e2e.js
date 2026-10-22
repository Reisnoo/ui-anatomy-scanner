// 次にやること・②の絞り込み/並べ替え・レポートの入口・用語の説明（タブのtitle）を確かめる。
// 使い方: PLAYWRIGHT_MODULE=$PWD/node_modules/playwright CHROMIUM_PATH=<chromium> node ux_e2e.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); const path = require('path');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const url = 'file://' + path.resolve(__dirname, '../index.html');
  const ready = () => p.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  await p.goto(url); await ready();

  assert(await p.evaluate(() => [...document.querySelectorAll('.tabs button')].every(b => (b.title || '').length > 8)), '8つのタブすべてに、用語の説明（title）がある');
  const ns = await p.evaluate(() => { const e = document.querySelector('.next-steps'); return e ? { text: e.textContent, btns: [...e.querySelectorAll('[data-goto]')].map(b => b.dataset.goto), act: S.issues.filter(isActive).length } : null; });
  assert(ns && ns.text.includes('解析できました') && ns.text.includes(ns.act + '件'), '解析後、①の先頭に「次にやること」と指摘件数を出す');
  assert(ns && ns.btns.join() === 'heur,gaze,kp,report', '次にやること：② 指摘・③ 仮想視線・⑧ 記録・レポートへ進める');
  await p.click('.next-steps [data-goto="heur"]'); assert(await p.evaluate(() => S.tab) === 'heur', '「② 指摘を見る」で、②のタブへ移る');

  const cnt = () => p.evaluate(() => ({ cards: [...document.querySelectorAll('.h-card')].length, issues: document.querySelectorAll('#panelBody .issue').length, manual: document.querySelectorAll('#panelBody .issue .badge-manual').length, pressed: [...document.querySelectorAll('[data-hf]')].find(b => b.getAttribute('aria-pressed') === 'true').dataset.hf }));
  const all = await cnt();
  await p.click('[data-hf="manual"]'); const man = await cnt();
  assert(man.pressed === 'manual' && man.issues > 0 && man.issues === man.manual, '「要確認」で、手動判定の項目だけに絞れる（' + man.issues + '件）');
  await p.click('[data-hf="auto"]'); const aut = await cnt();
  assert(aut.issues > 0 && aut.manual === 0 && aut.issues + man.issues === await p.evaluate(() => S.issues.length), '「自動の指摘」＋「要確認」＝全件（' + aut.issues + '+' + man.issues + '）');
  await p.click('[data-hf="sev3"]'); const sv = await cnt();
  assert(await p.evaluate(() => [...document.querySelectorAll('#panelBody .issue .sev')].every(e => parseInt(e.textContent.replace(/\D/g, '')) >= 3)) , '「重大度3以上」で、重大度3以上だけが出る（' + sv.issues + '件）');
  await p.click('[data-hf="all"]'); await p.click('[data-hs="sev"]');
  const sevs = await p.evaluate(() => [...document.querySelectorAll('#panelBody .issue')].map(e => { const s = e.querySelector('.sev'); return s ? parseInt(s.textContent.replace(/\D/g, '')) : 0; }));
  assert(sevs.length > 3 && sevs.slice(1).every((v, i) => sevs[i] >= v), '「重大度順」で、重大度の高いものから並ぶ');
  await p.click('[data-hs="h"]'); assert((await cnt()).cards >= 10, '「原則順」に戻すと、原則ごとのカードに戻る');

  await p.click('#repBtn'); await p.waitForTimeout(600);
  assert(await p.evaluate(() => S.tab + '/' + S.cTab) === 'cmp/history' && await p.evaluate(() => !!document.getElementById('rTitle')), 'ヘッダーの「レポートを書き出す」で、履歴の提出用レポートの設定へ移る');

  await p.click('.tabs button[data-tab="comps"]'); await p.click('[data-next-off]');
  assert(await p.evaluate(() => !document.querySelector('.next-steps')), '「閉じる」で、次にやることの案内を消せる');
  await p.reload(); await ready();
  assert(await p.evaluate(() => !document.querySelector('.next-steps')), '再読み込みしても、閉じた案内は出ない');
  await p.evaluate(() => localStorage.removeItem('uas-next-off'));
  assert(!errs.length, 'JavaScriptのエラーがない'); await b.close();
})();
