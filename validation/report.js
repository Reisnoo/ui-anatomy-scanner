// results.json から RESULTS.md と rating_sheet.csv を作る
const fs = require('fs'), path = require('path');
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const SETS = [
  { key: 'holdout2', title: '未見ページ（holdout 2）', note: 'ツールの修正が一段落した後に、初めて走らせたページ。**精度の推定には、この表を使う**。初回測定の結果は `results/history/` に保存（その後の修正前の値）' },
  { key: 'holdout', title: 'holdout 1', note: '最初に未見として測ったが、失敗の原因調査と修正に使ったため、現在は調整済み（初回測定は `results/history/`）' },
  { key: 'ja-real', title: '日本語の実在ページ（ja-real：デジタル庁デザインシステムの部品ページ23件、MIT）', note: '日本語の実在するUIでの確認。初めて走らせた結果で、調整前。アクセシビリティに配慮した設計のため、**違反がほとんどなく、再現率は測れない**（誤検出が出ないかの確認が主）' },
  { key: 'ja', title: '日本語の自作ページ（ja）', note: '自作の日本語5ページ（EC・フォーム・記事・管理画面・ランディング。低コントラスト・小さな文字・色の違うボタンを意図的に含む）。**OCRの調整にも使ったページ**で、精度の推定には使えない' },
  { key: 'dev', title: '開発セット', note: 'ツールの修正中に見ていたページ。調整済みで、精度の推定には使えない' },
  { key: 'control', title: '陽性対照', note: '違反をわざと入れた自作ページ。検出できるかの確認用' },
  { key: 'live', title: '実サイト（--live）', note: '' },
];
const NAMES = { contrast: '文字のコントラスト比', imageAlt: '画像の代替テキスト(48px以上)', buttonName: 'アイコンのみのボタンの名前', targetSize: '操作領域のサイズ(24px未満)' };
const RULE = { contrast: 'color-contrast', imageAlt: 'image-alt', buttonName: 'button-name 等', targetSize: 'target-size' };
function agg(rs, key) { const s = { axeViolations: 0, toolDetections: 0, tp: 0, fn: 0, fpConfirmed: 0, fpUnverified: 0, fpIncomplete: 0, fpNone: 0 }; rs.forEach(r => Object.keys(s).forEach(k => { s[k] += (r.checks[key][k] || 0); })); return s; }
function checkTable(rs) {
  let m = `| 検査 | axeのルール | axe違反 | ツール検出 | 一致 | 見逃し | 誤検出(axeは合格) | 判定不能：axeも要確認 | 判定不能：axe未評価 | 適合率 | 再現率 |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const k of Object.keys(NAMES)) {
    const a = agg(rs, k);
    m += `| ${NAMES[k]} | ${RULE[k]} | ${a.axeViolations} | ${a.toolDetections} | ${a.tp} | ${a.fn} | ${a.fpConfirmed} | ${a.fpIncomplete} | ${a.fpNone} | ${(a.tp + a.fpConfirmed) ? pct(a.tp, a.tp + a.fpConfirmed) : '—'} | ${a.axeViolations ? pct(a.tp, a.axeViolations) : '—'} |\n`;
  }
  return m;
}
function write(out, meta, results, live) {
  let m = `# 精度確認の結果（自動生成）\n\n> \`validation/run.js\` が生成。手で編集しないでください。考察は [README.md](README.md) にあります。\n\n- 実行日: ${meta.date}\n- モード: ${meta.mode}\n- 基準にした外部ツール: axe-core ${meta.axeCore}\n- 検証したツール: UI Anatomy Scanner（commit \`${(meta.toolCommit || '').slice(0, 7)}\`、実行時の作業ツリー）\n- ページ数: ${results.length}\n`;
  if (meta.corpus) m += `- 対象: 実在のオープンソーステンプレート（MIT）。取得コミット: ${Object.entries(meta.corpus).map(([k, v]) => `${k}@${v}`).join(', ')}\n`;
  if (meta.stubs) m += `- 外部CDNへの接続は、この実行環境では不可。npmの固定バージョン／空のスタブ／代替画像で置き換え（npm ${meta.stubs.npm}件、CSS ${meta.stubs.css}件、JS ${meta.stubs.js}件、画像 ${meta.stubs.images}件）。Webフォント・アイコンフォントは入っていない\n`;
  m += `\n## 1. 外部ツール(axe-core)との一致\n\n正解＝axe-core が「違反」とした要素。ツールの検出と、要素の位置・大きさで照合。\n\n- 適合率＝一致 ÷（一致＋axeが合格とした誤検出）、再現率＝一致 ÷ axe違反\n- 「判定不能」は、ツールだけが検出し、axeが違反とも合格とも言わなかったもの（「axeも要確認」＝両者とも確定できない、「axe未評価」＝axeが対象にしなかった）。適合率の分母には入れていない\n- 検査ごとにスコープをそろえている（画像は48px以上、操作領域はボタン・入力欄のみ、ボタン名は「ボタンに見える要素」。ボタンとして扱った要素の link-name 違反も正解に含める）\n`;
  SETS.forEach((st, i) => {
    const rs = results.filter(r => (r.set || '') === st.key); if (!rs.length) return;
    m += `\n### 1-${i + 1}. ${st.title}（${rs.length}ページ）\n\n${st.note ? st.note + '\n\n' : ''}${checkTable(rs)}`;
  });
  m += `\n## 2. ページごとの内訳（コントラスト）\n\n| ページ | セット | 種類 | axe違反 | ツール検出 | 一致 | 見逃し | 誤検出 | 判定不能 | 実際の高さ | ツール内の高さ |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  results.forEach(r => { const c = r.checks.contrast; m += `| ${r.label} | ${r.set} | ${r.kind} | ${c.axeViolations} | ${c.toolDetections} | ${c.tp} | ${c.fn} | ${c.fpConfirmed} | ${c.fpUnverified} | ${r.liveH ?? '—'} | ${r.tool.pageH} |\n`; });
  m += `\n## 3. ボタン検出（要素の抽出）\n\n正解＝\`button\`・\`input[type=button|submit|reset]\`・\`[role=button]\`・Bootstrapの\`.btn\`を持つ可視要素（制作者が「ボタン」と意図した印）。\n\n| セット | ページ数 | 正解のボタン数 | 一致 | 見逃し | 正解外を検出 | 再現率 |\n|---|---|---|---|---|---|---|\n`;
  SETS.forEach(st => { const rs = results.filter(r => (r.set || '') === st.key); if (!rs.length) return; let o = 0, t = 0, f = 0, n = 0; rs.forEach(r => { const b = r.tool.buttons; o += b.oracle; t += b.tp; f += b.fpCount; n += b.fnCount; }); m += `| ${st.title} | ${rs.length} | ${o} | ${t} | ${n} | ${f} | ${pct(t, o)} |\n`; });
  const kp = results.flatMap(r => r.tool.kindPairs), ok = kp.filter(x => x.exp === x.got).length;
  m += `\n「正解外を検出」は、ボタンのように見えるリンク（ページネーションのリンクなど）で、正解の定義に含まれないだけの場合がある。Bootstrapのクラスから期待する種類（primary／secondary／text）との一致: ${ok} / ${kp.length}（${pct(ok, kp.length)}）\n`;
  m += `\n## 4. ニールセン系の指摘の事実確認（別実装との照合）\n\n正解のない指摘のうち、事実を独立に確かめられるものを、ツールとは別に書いたDOM検査と照合（H1: 主ナビのどれにも現在地の印がない／H10: 見えているヘルプ・問い合わせの導線がない）。\n\n| セット | H1 一致 | H10 一致 |\n|---|---|---|\n`;
  SETS.forEach(st => { const rs = results.filter(r => (r.set || '') === st.key && r.audit); if (!rs.length) return; let a = 0, an = 0, b = 0, bn = 0;
    rs.forEach(r => { const t1 = r.tool.issues.some(i => i.h === 'H1' && /ナビゲーション/.test(i.title)), t10 = r.tool.issues.some(i => i.h === 'H10'); if (r.audit.navCandidates > 0) { an++; if (t1 === !r.audit.navActive) a++; } bn++; if (t10 === !r.audit.helpLink) b++; });
    m += `| ${st.title} | ${a} / ${an} | ${b} / ${bn} |\n`; });
  m += `\n## 5. ツールが出した自動指摘（件数）\n\n| ページ | セット | ${Array.from({ length: 10 }, (_, i) => 'H' + (i + 1)).join(' | ')} | 補助 | 合計 | 解析時間 |\n|---|---|${Array(13).fill('---').join('|')}|\n`;
  results.forEach(r => { const c = {}; r.tool.issues.forEach(i => { c[i.h] = (c[i.h] || 0) + 1; }); m += `| ${r.label} | ${r.set} | ${Array.from({ length: 10 }, (_, i) => c['H' + (i + 1)] || 0).join(' | ')} | ${c.SUP || 0} | ${r.tool.issues.length} | ${r.tool.ms}ms |\n`; });
  fs.writeFileSync(path.join(out, live ? 'RESULTS_live.md' : 'RESULTS.md'), m);
  const rows = [['page', 'set', 'issue_no', 'heuristic', 'severity', 'title', 'evidence', 'rater1', 'rater2', 'note']];
  results.forEach(r => r.tool.issues.forEach((i, n) => rows.push([r.id, r.set, n + 1, i.h, i.sev, i.title, (i.evidence || []).join(' / '), '', '', ''])));
  fs.writeFileSync(path.join(out, live ? 'rating_sheet_live.csv' : 'rating_sheet.csv'), '﻿' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n') + '\n');
}
module.exports = { write };
