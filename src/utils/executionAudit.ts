export type AuditSeverity = 'P0' | 'P1' | 'P2' | 'info';

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  rule: string;
  message: string;
  details?: string;
}

export interface ExecutionAuditReport {
  id: string;
  timestamp: string;
  status: 'pass' | 'warn' | 'fail';
  source: 'steps' | 'blockly';
  summary: {
    findings: number;
    p0: number;
    p1: number;
    p2: number;
    info: number;
    exit_code?: number;
    ok: boolean;
  };
  findings: AuditFinding[];
  meta: {
    step_count: number;
    has_stdout: boolean;
    has_stderr: boolean;
  };
}

export interface AuditStepLike {
  id: string;
  type: string;
  label: string;
  params?: Record<string, unknown>;
  children?: AuditStepLike[];
}

export interface AuditInput {
  source: 'steps' | 'blockly';
  steps: AuditStepLike[];
  code: string;
  stdout?: string;
  stderr?: string;
  error?: string | null;
  exit_code?: number;
  ok: boolean;
  enabledDevices?: Array<{ id: string; alias?: string; host?: string }>;
}

function flattenSteps(steps: AuditStepLike[]): AuditStepLike[] {
  const out: AuditStepLike[] = [];
  const visit = (arr: AuditStepLike[]) => {
    for (const step of arr) {
      out.push(step);
      if (step.children?.length) visit(step.children);
    }
  };
  visit(steps);
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

export function generateExecutionAudit(input: AuditInput): ExecutionAuditReport {
  const findings: AuditFinding[] = [];
  const flatSteps = flattenSteps(input.steps);
  const code = input.code || '';

  const connectSteps = flatSteps.filter((s) => s.type === 'connect');
  const aliases = new Set<string>();
  for (const s of connectSteps) {
    const ids = Array.isArray(s.params?.instrumentIds) ? (s.params?.instrumentIds as string[]) : [];
    const single = typeof s.params?.instrumentId === 'string' ? [s.params?.instrumentId as string] : [];
    [...ids, ...single].forEach((x) => x && aliases.add(String(x)));
  }
  for (const d of input.enabledDevices || []) {
    if (d.alias) aliases.add(String(d.alias));
    if (d.id) aliases.add(String(d.id));
  }
  for (const alias of Array.from(aliases)) {
    const used = new RegExp(`\\b${alias}\\b`).test(code);
    if (!used) {
      findings.push({
        id: `unused_device_${alias}`,
        severity: 'P2',
        rule: 'unused_connected_device',
        message: `Connected device "${alias}" does not appear to be used in generated code.`,
      });
    }
  }

  const errorCheckStepCount = flatSteps.filter((s) => s.type === 'error_check').length;
  const errorPollCount = countOccurrences(code, 'ALLEV?') + countOccurrences(code, 'SYST:ERR?') + countOccurrences(code, '*ESR?');
  if (errorCheckStepCount > 0 && errorPollCount < errorCheckStepCount) {
    findings.push({
      id: 'missing_error_check_parity',
      severity: 'P1',
      rule: 'step_codegen_parity_error_check',
      message: `Flow has ${errorCheckStepCount} error_check step(s) but generated code exposes only ${errorPollCount} error queue poll(s).`,
    });
  }

  const sleepCount = countOccurrences(code, 'time.sleep(');
  const opcCount = countOccurrences(code, '*OPC?');
  if (sleepCount > 0 && opcCount === 0) {
    findings.push({
      id: 'sleep_without_opc',
      severity: 'P2',
      rule: 'sync_sleep_without_opc',
      message: `Generated code uses fixed sleeps (${sleepCount}) with no *OPC? synchronization.`,
    });
  }

  const localhostMatches = code.match(/TCPIP::127\.0\.0\.1::INSTR/g) || [];
  if (localhostMatches.length > 1) {
    findings.push({
      id: 'duplicate_localhost_resource',
      severity: 'P1',
      rule: 'duplicate_visa_resource',
      message: `Generated code opens localhost VISA resource ${localhostMatches.length} times; this is usually a config mismatch.`,
    });
  }

  const stepTypes = new Set(flatSteps.map((s) => s.type));
  if (stepTypes.has('recall') && !/RECALL:SESSION/i.test(code)) {
    findings.push({
      id: 'missing_recall_codegen',
      severity: 'P1',
      rule: 'step_codegen_parity_recall',
      message: 'Flow includes recall step but generated code does not emit RECALL:SESSION.',
    });
  }
  if (stepTypes.has('save_screenshot') && !/SAVE:IMAGE/i.test(code)) {
    findings.push({
      id: 'missing_screenshot_codegen',
      severity: 'P1',
      rule: 'step_codegen_parity_screenshot',
      message: 'Flow includes save_screenshot step but generated code does not emit SAVE:IMAGE.',
    });
  }
  if (stepTypes.has('query') && !/\.query\(/.test(code)) {
    findings.push({
      id: 'missing_query_codegen',
      severity: 'P1',
      rule: 'step_codegen_parity_query',
      message: 'Flow includes query step but generated code has no query() calls.',
    });
  }

  if (!input.ok) {
    findings.push({
      id: 'run_failed',
      severity: 'P0',
      rule: 'run_exit_status',
      message: `Execution failed${typeof input.exit_code === 'number' ? ` (exit ${input.exit_code})` : ''}.`,
      details: input.error || input.stderr || 'Unknown runtime failure.',
    });
  }

  const counts = {
    p0: findings.filter((f) => f.severity === 'P0').length,
    p1: findings.filter((f) => f.severity === 'P1').length,
    p2: findings.filter((f) => f.severity === 'P2').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  const status: ExecutionAuditReport['status'] = counts.p0 > 0 ? 'fail' : counts.p1 > 0 ? 'warn' : 'pass';

  return {
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString(),
    status,
    source: input.source,
    summary: {
      findings: findings.length,
      p0: counts.p0,
      p1: counts.p1,
      p2: counts.p2,
      info: counts.info,
      exit_code: input.exit_code,
      ok: input.ok,
    },
    findings,
    meta: {
      step_count: flatSteps.length,
      has_stdout: !!input.stdout,
      has_stderr: !!input.stderr,
    },
  };
}

export function reportToMarkdown(report: ExecutionAuditReport): string {
  const lines: string[] = [];
  lines.push(`# Execution Audit Report`);
  lines.push('');
  lines.push(`- ID: ${report.id}`);
  lines.push(`- Time: ${report.timestamp}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Source: ${report.source}`);
  lines.push(`- Findings: ${report.summary.findings} (P0=${report.summary.p0}, P1=${report.summary.p1}, P2=${report.summary.p2})`);
  lines.push('');
  lines.push(`## Findings`);
  if (!report.findings.length) {
    lines.push('- No findings.');
  } else {
    for (const f of report.findings) {
      lines.push(`- [${f.severity}] ${f.rule}: ${f.message}`);
      if (f.details) lines.push(`  - Details: ${f.details}`);
    }
  }
  return lines.join('\n');
}
