// 評価者が埋めた採点シート(results/rating_sheet.csv)を集計する
//   node score_ratings.js [rating_sheet.csv]
// 列 rater1 / rater2 には、次のどれかを入れる:  妥当 / 疑わしい / 誤り
//   妥当　　: 指摘の内容が事実で、そのページの種類にとって実際に問題になりうる
//   疑わしい: 事実だが、そのページの文脈では問題とは言いにくい（例: 問い合わせフォームにキャンセルがない）
//   誤り　　: 指摘の内容が事実と違う
// 出力: 評価者ごとの適合率（妥当 ÷ 全体）、原則ごとの内訳、2人の一致率とCohenのκ（3値）
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.join(__dirname, 'results', 'rating_sheet.csv');
function parseCSV(t) {
  const rows = []; let row = [], cur = '', q = false; t = t.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  if (cur || row.length) { row.push(cur); rows.push(row); } return rows;
}
const rows = parseCSV(fs.readFileSync(file, 'utf8')), head = rows[0], idx = n => head.indexOf(n);
const data = rows.slice(1).filter(r => r.length > 5).map(r => ({ page: r[idx('page')], h: r[idx('heuristic')], r1: (r[idx('rater1')] || '').trim(), r2: (r[idx('rater2')] || '').trim() }));
const LAB = ['妥当', '疑わしい', '誤り'], ok = v => LAB.includes(v);
for (const who of ['r1', 'r2']) {
  const rs = data.filter(d => ok(d[who])); if (!rs.length) { console.log(`${who}: 採点なし`); continue; }
  const c = Object.fromEntries(LAB.map(l => [l, rs.filter(d => d[who] === l).length]));
  console.log(`\n${who === 'r1' ? '評価者1' : '評価者2'}: ${rs.length}件  妥当 ${c['妥当']}（${Math.round(c['妥当'] / rs.length * 100)}%） 疑わしい ${c['疑わしい']} 誤り ${c['誤り']}`);
  const by = {}; rs.forEach(d => { (by[d.h] = by[d.h] || { n: 0, v: 0 }).n++; if (d[who] === '妥当') by[d.h].v++; });
  console.log('  原則別の妥当率: ' + Object.entries(by).sort().map(([h, x]) => `${h} ${x.v}/${x.n}`).join('  '));
}
const both = data.filter(d => ok(d.r1) && ok(d.r2));
if (both.length) {
  const n = both.length, agree = both.filter(d => d.r1 === d.r2).length, po = agree / n;
  const pe = LAB.reduce((s, l) => s + (both.filter(d => d.r1 === l).length / n) * (both.filter(d => d.r2 === l).length / n), 0);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  console.log(`\n2人が採点した ${n}件: 一致率 ${(po * 100).toFixed(0)}%、Cohenのκ = ${kappa.toFixed(2)}`);
} else console.log('\n2人分の採点がそろっていないため、κは算出しません');
