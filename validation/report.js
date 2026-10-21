// results.json から RESULTS.md を作る
const fs = require('fs'), path = require('path');
const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '—';
function agg(results, key) { const s = { axeViolations: 0, toolDetections: 0, tp: 0, fn: 0, fpConfirmed: 0, fpUnverified: 0 }; results.forEach(r => Object.keys(s).forEach(k => { s[k] += r.checks[key][k]; })); return s; }
const f1 = (p, r) => (p + r) ? (2 * p * r / (p + r)) : 0;
function write(out, meta, results, live) {
  const names = { contrast: '文字のコントラスト比（WCAG AA）', imageAlt: '画像の代替テキスト（48px以上）', buttonName: 'アイコンのみのボタンの名前', targetSize: '操作領域のサイズ（24px未満）' };
  const axeRule = { contrast: 'color-contrast', imageAlt: 'image-alt', buttonName: 'button-name / input-button-name', targetSize: 'target-size' };
  let m = `# 精度確認の結果（自動生成）\n\n> \`validation/run.js\` が生成。手で編集しないでください。考察は [README.md](README.md) にあります。\n\n- 実行日: ${meta.date}\n- モード: ${meta.mode}\n- 基準にした外部ツール: axe-core ${meta.axeCore}\n- 検証したツール: UI Anatomy Scanner（commit \`${(meta.toolCommit || '').slice(0, 7)}\`）\n- ページ数: ${results.length}\n`;
  if (meta.corpus) m += `- 対象: 実在のオープンソーステンプレート（MIT）。取得コミット: ${Object.entries(meta.corpus).map(([k, v]) => `${k}@${v}`).join(', ')}\n`;
  if (meta.stubs) m += `- 外部CDNへの接続はこの環境では不可のため、npmの固定バージョン／空のスタブ／代替画像で置き換え（npm ${meta.stubs.npm}件、CSSスタブ ${meta.stubs.css}件、JSスタブ ${meta.stubs.js}件、画像 ${meta.stubs.images}件）。Webフォントとアイコンフォントは入っていない\n`;
  m += `\n## 1. 外部ツールとの一致（ページ全体の合算）\n\n正解＝axe-core が「違反」とした要素。ツールの検出と、要素の位置・大きさで照合しています。\n\n| 検査 | 対応するaxeのルール | axe違反 | ツール検出 | 一致(TP) | 見逃し(FN) | 誤検出：axeが合格(FP) | 判定不能：axeが未評価 | 適合率 | 再現率 | F1 |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const k of Object.keys(names)) {
    const a = agg(results, k), prec = (a.tp + a.fpConfirmed) ? a.tp / (a.tp + a.fpConfirmed) : null, rec = a.axeViolations ? a.tp / a.axeViolations : null;
    m += `| ${names[k]} | ${axeRule[k]} | ${a.axeViolations} | ${a.toolDetections} | ${a.tp} | ${a.fn} | ${a.fpConfirmed} | ${a.fpUnverified} | ${prec === null ? '—' : (prec * 100).toFixed(0) + '%'} | ${rec === null ? '—' : (rec * 100).toFixed(0) + '%'} | ${prec !== null && rec !== null ? f1(prec, rec).toFixed(2) : '—'} |\n`;
  }
  m += `\n- 適合率＝TP ÷ (TP + axeが合格とした誤検出)。「判定不能」（axeが評価しなかった要素）は分母に入れていません\n- 再現率＝TP ÷ axe違反\n- 検査ごとにスコープをそろえています（画像は48px以上、操作領域はボタン・入力欄のみ、ボタン名はボタンのみ。リンクの名前はツールの対象外）\n`;
  m += `\n## 2. ページごとの内訳（コントラスト）\n\n| ページ | 種類 | axe違反 | ツール検出 | TP | FN | FP | 判定不能 | axe「要確認」 |\n|---|---|---|---|---|---|---|---|---|\n`;
  results.forEach(r => { const c = r.checks.contrast; m += `| ${r.label} | ${r.kind} | ${c.axeViolations} | ${c.toolDetections} | ${c.tp} | ${c.fn} | ${c.fpConfirmed} | ${c.fpUnverified} | ${r.info.axeContrastIncomplete} |\n`; });
  m += `\n## 3. ボタン検出（要素の抽出）\n\n正解＝\`button\`・\`input[type=button|submit|reset]\`・\`[role=button]\`・Bootstrapの\`.btn\`を持つ可視要素（制作者が「ボタン」と意図した印）。\n\n| ページ | 正解のボタン数 | ツールが検出 | 一致 | 見逃し | 正解外を検出 |\n|---|---|---|---|---|---|\n`;
  let bo = 0, bt = 0, bf = 0, bn = 0; results.forEach(r => { const b = r.tool.buttons; bo += b.oracle; bt += b.tp; bf += b.fpCount; bn += b.fnCount; m += `| ${r.label} | ${b.oracle} | ${b.tool} | ${b.tp} | ${b.fnCount} | ${b.fpCount} |\n`; });
  m += `| **合計** | **${bo}** | | **${bt}** | **${bn}** | **${bf}** |\n\n再現率 ${pct(bt, bo)}。「正解外を検出」は、ボタンのように見えるリンクなど、正解の定義に含まれない要素です（正しい検出の場合があるため、適合率とは呼ばず、README で内訳を確認しています）。\n`;
  const kp = results.flatMap(r => r.tool.kindPairs), ok = kp.filter(x => x.exp === x.got).length;
  m += `\nBootstrapのクラスから期待する種類（primary／secondary／text）との一致: ${ok} / ${kp.length}（${pct(ok, kp.length)}）\n`;
  m += `\n## 4. 参考情報\n\n| ページ | axe: ラベルなし入力 | ツール: プレースホルダのみ | うちaxeは合格 | axe: リンク名なし(ツール対象外) | 解析時間 |\n|---|---|---|---|---|---|\n`;
  results.forEach(r => { m += `| ${r.label} | ${r.info.axeLabelViolations} | ${r.info.toolPlaceholderOnly} | ${r.info.toolPlaceholderOnlyAxePass} | ${r.info.axeLinkNameViolations} | ${r.tool.ms}ms |\n`; });
  m += `\naxe-core は、プレースホルダだけの入力欄を「名前あり」として合格にします。ツールはそれを「ラベルなし」と指摘します（基準が違うため、一致率は測っていません）。\n`;
  m += `\n## 5. ニールセン系の指摘の事実確認（別実装との照合）\n\n外部ツールに正解がない指摘のうち、事実を独立に確かめられるものを、別に書いたDOM検査（ツールの判定ロジックとは別実装）と照合します。\n\n| ページ | ナビの候補 | 現在地あり(別実装) | ツール: H1指摘 | ヘルプ導線あり(別実装) | ツール: H10指摘 | 判定 |\n|---|---|---|---|---|---|---|\n`;
  let h1ok = 0, h1n = 0, h10ok = 0, h10n = 0;
  results.filter(r => r.audit).forEach(r => {
    const t1 = r.tool.issues.some(i => i.h === 'H1' && /ナビゲーション/.test(i.title)), t10 = r.tool.issues.some(i => i.h === 'H10');
    const a1 = r.audit.navCandidates > 0 ? !r.audit.navActive : null, a10 = !r.audit.helpLink; let v = [];
    if (a1 !== null) { h1n++; if (t1 === a1) h1ok++; else v.push(t1 ? 'H1: ツールが過剰' : 'H1: ツールが見逃し'); }
    h10n++; if (t10 === a10) h10ok++; else v.push(t10 ? 'H10: ツールが過剰' : 'H10: ツールが見逃し');
    m += `| ${r.label} | ${r.audit.navCandidates} | ${r.audit.navCandidates ? (r.audit.navActive ? 'あり' : 'なし') : '—'} | ${t1 ? '指摘' : '—'} | ${r.audit.helpLink ? 'あり' : 'なし'} | ${t10 ? '指摘' : '—'} | ${v.length ? v.join('、') : '一致'} |\n`;
  });
  m += `\n一致: H1 ${h1ok}/${h1n}、H10 ${h10ok}/${h10n}\n`;
  m += `\n## 6. ツールが出した自動指摘（件数）\n\n| ページ | ${Array.from({ length: 10 }, (_, i) => 'H' + (i + 1)).join(' | ')} | 補助 | 合計 |\n|---|${Array(12).fill('---').join('|')}|\n`;
  results.forEach(r => { const c = {}; r.tool.issues.forEach(i => { c[i.h] = (c[i.h] || 0) + 1; }); m += `| ${r.label} | ${Array.from({ length: 10 }, (_, i) => c['H' + (i + 1)] || 0).join(' | ')} | ${c.SUP || 0} | ${r.tool.issues.length} |\n`; });
  fs.writeFileSync(path.join(out, live ? 'RESULTS_live.md' : 'RESULTS.md'), m);
  // 評価者用シート（人手の採点に使う）
  const rows = [['page', 'issue_no', 'heuristic', 'severity', 'title', 'evidence', 'rater1', 'rater2', 'note']];
  results.forEach(r => r.tool.issues.forEach((i, n) => rows.push([r.id, n + 1, i.h, i.sev, i.title, (i.evidence || []).join(' / '), '', '', ''])));
  fs.writeFileSync(path.join(out, live ? 'rating_sheet_live.csv' : 'rating_sheet.csv'), '﻿' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n') + '\n');
}
module.exports = { write };
