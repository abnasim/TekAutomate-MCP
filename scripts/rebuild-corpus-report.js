/**
 * Rebuilds analysis.json and analysis-report.md from all partial files in
 * e2e-output/scpi-corpus/_partials/.
 *
 * Run after a full corpus test suite to ensure the report includes every group,
 * even groups whose tests finished after the summary test had already written
 * its report (can happen when tests run out of order in the Playwright runner).
 *
 * Usage:  node scripts/rebuild-corpus-report.js
 */
const fs = require('fs');
const path = require('path');

const CORPUS_DIR = path.join(process.cwd(), 'e2e-output', 'scpi-corpus');
const PARTIALS_DIR = path.join(CORPUS_DIR, '_partials');
const ANALYSIS_FILE = path.join(CORPUS_DIR, 'analysis.json');
const REPORT_FILE = path.join(CORPUS_DIR, 'analysis-report.md');

if (!fs.existsSync(PARTIALS_DIR)) {
  console.error('No _partials directory found. Run the corpus tests first.');
  process.exit(1);
}

const partialFiles = fs.readdirSync(PARTIALS_DIR).filter(f => f.endsWith('.json'));
if (partialFiles.length === 0) {
  console.error('No partial files found. Run the corpus tests first.');
  process.exit(1);
}

const results = partialFiles.flatMap(f => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PARTIALS_DIR, f), 'utf-8'));
  } catch {
    return [];
  }
});

fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(results, null, 2));

const total = results.length;
const passed = results.filter(r => r.foundInOutput).length;
const failed = results.filter(r => !r.foundInOutput).length;

// Group by family / group
const byGroup = new Map();
for (const r of results) {
  const k = r.family + ' / ' + r.group;
  if (!byGroup.has(k)) byGroup.set(k, []);
  byGroup.get(k).push(r);
}

const summaryRows = [];
for (const [k, items] of [...byGroup.entries()].sort()) {
  const p = items.filter(i => i.foundInOutput).length;
  const f = items.length - p;
  const rate = Math.round((p / items.length) * 100) + '%';
  summaryRows.push('| ' + k + ' | ' + p + ' | ' + f + ' | ' + rate + ' |');
}

const failedCmds = results.filter(r => !r.foundInOutput);
const failedLines = failedCmds.length === 0
  ? ['_None — all commands found in output._']
  : failedCmds.map(r => '- **' + r.family + '/' + r.group + '** `' + r.scpi + '` (params: ' + r.paramLabel + ')');

const mdLines = [
  '# SCPI Corpus Analysis Report',
  '',
  '**Total commands tested:** ' + total + '  ',
  '**Found in output:** ' + passed + ' (' + Math.round((passed / total) * 100) + '%)  ',
  '**Missing from output:** ' + failed + '  ',
  '',
  '## Results by Group',
  '',
  '| Family / Group | Pass | Fail | Rate |',
  '|---|---|---|---|',
  ...summaryRows,
  '',
  '## Failed Commands',
  '',
  ...failedLines,
];

fs.writeFileSync(REPORT_FILE, mdLines.join('\n'));

console.log('');
console.log('SCPI Corpus Report rebuilt from ' + partialFiles.length + ' partial files');
console.log('  Total  : ' + total);
console.log('  Passed : ' + passed + ' (' + Math.round((passed / total) * 100) + '%)');
console.log('  Failed : ' + failed);
console.log('  Groups : ' + byGroup.size);
console.log('  Report : ' + REPORT_FILE);
if (failedCmds.length > 0) {
  console.log('');
  console.log('Failed commands:');
  failedCmds.forEach(r => console.log('  ' + r.family + '/' + r.group + ' ' + r.scpi + ' (' + r.paramLabel + ')'));
}
