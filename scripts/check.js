const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'js')).filter((name) => name.endsWith('.js'));
files.push('sw.js');
for (const relative of files) {
  const file = relative === 'sw.js' ? path.join(root, relative) : path.join(root, 'js', relative);
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const localSources = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]).filter((src) => !src.startsWith('http'));
for (const src of localSources) {
  if (!fs.existsSync(path.join(root, src))) throw new Error(`缺少腳本：${src}`);
}
console.log(`Checked ${files.length} JavaScript files and ${localSources.length} local scripts.`);
