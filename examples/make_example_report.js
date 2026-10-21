// サンプルの提出用レポート（examples/sample-history-report.html）を、架空のECストアのデモ履歴から作り直す
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node examples/make_example_report.js
// ツールの判定ルールを変えたあとに実行すると、サンプルの数値が最新になる。個人名は入れない
const fs = require('fs'), path = require('path');
function loadPW() { for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) { try { return require(m); } catch (e) {} } throw new Error('playwright が見つかりません'); }
(async () => {
  const { chromium } = loadPW(), browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('解析完了'), null, { timeout: 30000 });
  const html = await page.evaluate(async () => {
    await histDemo();
    Object.assign(S.rep, {
      title: 'サンプル：ECストア改善の履歴', author: '',
      purpose: 'サンプルです。架空のECストアを題材に、広告の競合・ボタンの不統一・読みにくい文字を段階的に整理した記録を、このツールのレポートとしてまとめています。',
      note: 'V2で告知バーとバナーを整理、V3で操作の安全性と可読性を改善（ただし告知バーを再び足してしまい後退）、V4で仕上げ、という流れです。', thumbs: true });
    S.hCur = false;
    return buildReportHTML();
  });
  fs.writeFileSync(path.join(__dirname, 'sample-history-report.html'), html);
  console.log('書き出しました：examples/sample-history-report.html', Math.round(html.length / 1024) + 'KB');
  await browser.close();
})();
