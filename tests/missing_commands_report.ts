import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { CASES, type BenchmarkCase } from './level_cases.ts';
import { planIntent } from '../src/core/intentPlanner.ts';

type MissingCaseExpectation = {
  requiredCommands: string[];
};

type MissingCaseRow = {
  caseId: string;
  level: string;
  userMessage: string;
  resolvedCommands: string[];
  missingCommands: string[];
};

const TARGET_IDS = [
  'L3_CHT_01',
  'L3_CHT_02',
  'L3_CHT_03',
  'L3_CHT_04',
  'L4_BUS_02',
  'L4_BUS_04',
  'L5_SAV_01',
  'L7_CPX_01',
  'L7_CPX_03',
  'L8_ENG_01',
  'L8_ENG_03',
  'L8_ENG_05',
  'L8_ENG_10',
  'AFG01',
] as const;

const EXPECTATIONS: Record<string, MissingCaseExpectation> = {
  L3_CHT_01: { requiredCommands: ['CH1:SCAle 0.5', 'CH1:COUPling DC', 'CH1:TERmination 50'] },
  L3_CHT_02: { requiredCommands: ['CH1:SCAle 1', 'CH1:COUPling DC', 'CH2:SCAle 0.5', 'CH2:COUPling AC'] },
  L3_CHT_03: { requiredCommands: ['TRIGger:A:EDGE:SOUrce CH1', 'TRIGger:A:EDGE:SLOpe RISe', 'TRIGger:A:LEVel 1', 'TRIGger:A:MODe NORMal'] },
  L3_CHT_04: { requiredCommands: ['TRIGger:A:HOLDoff:TIMe 0.05', 'TRIGger:A:MODe AUTO'] },
  L4_BUS_02: { requiredCommands: ['BUS:B1:TYPe CAN', 'BUS:B1:CAN:SOUrce CH2', 'BUS:B1:CAN:BITRate 500000'] },
  L4_BUS_04: { requiredCommands: ['BUS:B1:TYPe CAN', 'SEARCH:SEARCH1:TYPe BUS'] },
  L5_SAV_01: { requiredCommands: ['RECAll:SETUp "C:/tests/baseline.tss"', 'MEASUrement:ADDMEAS FREQUENCY'] },
  L7_CPX_01: { requiredCommands: ['CH1:SCAle 1', 'TRIGger:A:EDGE:SOUrce CH1', 'ACQuire:STOPAfter SEQuence'] },
  L7_CPX_03: { requiredCommands: ['RECAll:SETUp "C:/tests/baseline.tss"', 'MEASUrement:ADDMEAS AMPLITUDE'] },
  L8_ENG_01: { requiredCommands: ['CH1:SCAle 0.05', 'MEASUrement:ADDMEAS MEAN', 'MEASUrement:ADDMEAS RMS', 'MEASUrement:ADDMEAS PK2PK'] },
  L8_ENG_03: { requiredCommands: ['BUS:B1:TYPe CAN', 'BUS:B1:CAN:BITRate 500000'] },
  L8_ENG_05: { requiredCommands: ['CH1:SCAle 3.3', 'CH2:SCAle 3.3', 'BUS:B1:TYPe I2C'] },
  L8_ENG_10: { requiredCommands: ['CH4:SCAle 2', 'TRIGger:A:EDGE:SOUrce CH4', 'ACQuire:STOPAfter SEQuence'] },
  AFG01: { requiredCommands: ['SOURce1:FUNCtion SIN', 'SOURce1:FREQuency 1000', 'OUTPut1:STATe ON'] },
};

function includesPattern(haystack: string[], pattern: string): boolean {
  const needle = pattern.toLowerCase();
  return haystack.some((item) => String(item || '').toLowerCase().includes(needle));
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCommandList(items: string[], className: string): string {
  if (!items.length) return `<div class="${className} empty">None</div>`;
  return `<ul class="${className}">${items.map((item) => `<li><code>${htmlEscape(item)}</code></li>`).join('')}</ul>`;
}

function renderRow(row: MissingCaseRow): string {
  return `
    <section class="case-card">
      <div class="case-header">
        <div>
          <h2>${htmlEscape(row.caseId)}</h2>
          <div class="level">${htmlEscape(row.level)}</div>
        </div>
        <div class="chip">${row.missingCommands.length} missing</div>
      </div>
      <div class="prompt"><strong>Prompt</strong><p>${htmlEscape(row.userMessage)}</p></div>
      <div class="grid">
        <div class="panel">
          <h3>Resolved Commands</h3>
          ${renderCommandList(row.resolvedCommands, 'resolved')}
        </div>
        <div class="panel">
          <h3>Missing Commands</h3>
          ${renderCommandList(row.missingCommands, 'missing')}
        </div>
      </div>
    </section>
  `;
}

function buildHtml(rows: MissingCaseRow[], generatedAt: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Missing Commands Bucket Report</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --card: #fffdf8;
      --ink: #22201c;
      --muted: #6d655b;
      --accent: #165a72;
      --accent-soft: #d9edf3;
      --danger: #8e2f2f;
      --danger-soft: #fde7e3;
      --border: #d8d0c4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Segoe UI", serif;
      background: linear-gradient(180deg, #efe7da 0%, var(--bg) 100%);
      color: var(--ink);
      line-height: 1.5;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 80px;
    }
    header {
      margin-bottom: 24px;
      padding: 24px;
      background: rgba(255,255,255,0.65);
      border: 1px solid var(--border);
      border-radius: 18px;
      backdrop-filter: blur(8px);
    }
    h1 { margin: 0 0 8px; font-size: 2rem; }
    .subtle { color: var(--muted); }
    .summary {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    .stat {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 0.95rem;
    }
    .case-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 18px;
      box-shadow: 0 12px 30px rgba(42, 35, 26, 0.06);
    }
    .case-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .case-header h2 {
      margin: 0;
      font-size: 1.35rem;
    }
    .level { color: var(--muted); }
    .chip {
      white-space: nowrap;
      background: var(--danger-soft);
      color: var(--danger);
      border: 1px solid #efc2b8;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .prompt {
      margin-bottom: 16px;
      padding: 14px 16px;
      background: #faf6ef;
      border-left: 4px solid var(--accent);
      border-radius: 10px;
    }
    .prompt p { margin: 6px 0 0; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
      background: #fffdfa;
    }
    .panel h3 {
      margin: 0 0 10px;
      font-size: 1rem;
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
    li { margin: 6px 0; }
    code {
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 0.92rem;
      background: #f5efe6;
      padding: 1px 4px;
      border-radius: 4px;
    }
    .resolved li::marker { color: var(--accent); }
    .missing li::marker { color: var(--danger); }
    .empty {
      padding: 12px;
      border-radius: 10px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Missing Commands Bucket Report</h1>
      <div class="subtle">Generated ${htmlEscape(generatedAt)}. This view compares each prompt against the current planner output so we can fix the bucket in one pass.</div>
      <div class="summary">
        <div class="stat">Cases: ${rows.length}</div>
        <div class="stat">Bucket: MISSING_COMMANDS</div>
      </div>
    </header>
    ${rows.map(renderRow).join('\n')}
  </main>
</body>
</html>`;
}

async function main(): Promise<void> {
  const rows: MissingCaseRow[] = [];
  for (const id of TARGET_IDS) {
    const test = CASES.find((entry) => entry.id === id);
    if (!test) throw new Error(`Missing case definition for ${id}`);
    const expectation = EXPECTATIONS[id];
    const plannerOutput = await planIntent({
      userMessage: test.userMessage,
      flowContext: test.flowContext,
    });
    const resolvedCommands = plannerOutput.resolvedCommands.map((command) => command.concreteCommand);
    const missingCommands = expectation.requiredCommands.filter((pattern) => !includesPattern(resolvedCommands, pattern));
    rows.push({
      caseId: test.id,
      level: test.level,
      userMessage: test.userMessage,
      resolvedCommands,
      missingCommands,
    });
  }

  const reportsDir = path.join(process.cwd(), 'reports');
  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, '-');
  const jsonPath = path.join(reportsDir, `missing_commands_bucket_${stamp}.json`);
  const htmlPath = path.join(reportsDir, `missing_commands_bucket_${stamp}.html`);
  await writeFile(jsonPath, JSON.stringify(rows, null, 2), 'utf8');
  await writeFile(htmlPath, buildHtml(rows, new Date().toLocaleString()), 'utf8');
  console.log(`HTML: ${htmlPath}`);
  console.log(`JSON: ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
