const fs = require('fs');
const path = require('path');
const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('Usage: node convert-svg-to-p5.js input.svg output.js');
const svg = fs.readFileSync(sourcePath, 'utf8');
const fills = new Map([...svg.matchAll(/\.([\w-]+)\s*\{\s*fill:\s*(#[0-9a-fA-F]{3,8})\s*;\s*\}/g)].map(([, cls, fill]) => [cls, fill]));
const paths = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map(([, attrs]) => ({ className: /\bclass="([^"]+)"/.exec(attrs)?.[1], d: /\bd="([^"]+)"/.exec(attrs)?.[1] })).filter(({ d }) => d);
const n = value => Number(value.toFixed(3)).toString();
function p5Commands(d) {
  const tokens = [...d.matchAll(/([MmCcSsZz])|([-+]?(?:(?:\d+\.\d*)|(?:\.\d+)|\d+)(?:[eE][-+]?\d+)?)/g)].map(m => m[1] || Number(m[2]));
  let i = 0, command = null, x = 0, y = 0, subpathX = 0, subpathY = 0, lastControlX = null, lastControlY = null, hasShape = false;
  const lines = []; const take = () => { if (typeof tokens[i] !== 'number') throw new Error(`Bad SVG path near token ${i}`); return tokens[i++]; };
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') command = tokens[i++];
    if (!command) throw new Error('SVG path starts without a command');
    if (command === 'M' || command === 'm') {
      const relative = command === 'm'; x = relative ? x + take() : take(); y = relative ? y + take() : take(); subpathX = x; subpathY = y;
      lines.push('beginShape();', `vertex(${n(x)}, ${n(y)});`); hasShape = true; lastControlX = lastControlY = null;
      while (i < tokens.length && typeof tokens[i] === 'number') { x = relative ? x + take() : take(); y = relative ? y + take() : take(); lines.push(`vertex(${n(x)}, ${n(y)});`); }
      command = relative ? 'l' : 'L'; continue;
    }
    if (command === 'c' || command === 'C') { const relative = command === 'c'; while (i < tokens.length && typeof tokens[i] === 'number') { const c1x = relative ? x + take() : take(); const c1y = relative ? y + take() : take(); const c2x = relative ? x + take() : take(); const c2y = relative ? y + take() : take(); x = relative ? x + take() : take(); y = relative ? y + take() : take(); lines.push(`bezierVertex(${n(c1x)}, ${n(c1y)}, ${n(c2x)}, ${n(c2y)}, ${n(x)}, ${n(y)});`); lastControlX = c2x; lastControlY = c2y; } continue; }
    if (command === 's' || command === 'S') { const relative = command === 's'; while (i < tokens.length && typeof tokens[i] === 'number') { const c1x = lastControlX == null ? x : 2 * x - lastControlX; const c1y = lastControlY == null ? y : 2 * y - lastControlY; const c2x = relative ? x + take() : take(); const c2y = relative ? y + take() : take(); x = relative ? x + take() : take(); y = relative ? y + take() : take(); lines.push(`bezierVertex(${n(c1x)}, ${n(c1y)}, ${n(c2x)}, ${n(c2y)}, ${n(x)}, ${n(y)});`); lastControlX = c2x; lastControlY = c2y; } continue; }
    if (command === 'Z' || command === 'z') { if (hasShape) lines.push('endShape(CLOSE);'); x = subpathX; y = subpathY; lastControlX = lastControlY = null; command = null; hasShape = false; continue; }
    throw new Error(`Unsupported SVG path command: ${command}`);
  }
  if (hasShape) lines.push('endShape(CLOSE);'); return lines;
}
const out = ['/* Generated from Asset 8.svg: 243 SVG vector paths only. */', '/* Source viewBox: 0 0 1577 1571. */', 'function drawTree(x, y, treeScale = 1) {', '  push();', '  translate(x, y);', '  scale(treeScale);', '  noStroke();'];
paths.forEach(({ className, d }, index) => { out.push(`  // SVG path ${index + 1} (${className || 'no class'})`, `  fill('${fills.get(className) || '#000000'}');`, ...p5Commands(d).map(line => `  ${line}`)); });
out.push('  pop();', '}', ''); fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, out.join('\n')); console.log(`Wrote ${paths.length} paths to ${outputPath}`);