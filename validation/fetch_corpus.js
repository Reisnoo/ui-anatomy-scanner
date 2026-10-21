// 検証用ページ(実在のオープンソーステンプレート)を、コミットを固定して取得する
// 使い方: node fetch_corpus.js   → .corpus/<repo>/ に展開される（Gitには含めない）
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));
const dir = path.join(__dirname, '.corpus'); fs.mkdirSync(dir, { recursive: true });
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
for (const [name, r] of Object.entries(T.repos)) {
  const d = path.join(dir, name);
  if (fs.existsSync(path.join(d, '.git'))) { try { if (sh('git', ['rev-parse', 'HEAD'], d).trim() === r.commit) { console.log('ok     ', name, r.commit.slice(0, 7)); continue; } } catch (e) {} }
  fs.rmSync(d, { recursive: true, force: true });
  try {
    fs.mkdirSync(d); sh('git', ['init', '-q'], d); sh('git', ['remote', 'add', 'origin', r.url], d);
    sh('git', ['fetch', '--depth', '1', '-q', 'origin', r.commit], d); sh('git', ['checkout', '-q', 'FETCH_HEAD'], d);
  } catch (e) {
    fs.rmSync(d, { recursive: true, force: true });
    sh('git', ['clone', '-q', r.url, d]); sh('git', ['checkout', '-q', r.commit], d);
  }
  console.log('fetched', name, sh('git', ['rev-parse', 'HEAD'], d).trim().slice(0, 7));
}
