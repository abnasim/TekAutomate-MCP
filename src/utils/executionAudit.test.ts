import { generateExecutionAudit } from './executionAudit';

describe('execution audit', () => {
  it('flags missing error_check parity', () => {
    const report = generateExecutionAudit({
      source: 'steps',
      steps: [
        { id: 's1', type: 'connect', label: 'Connect', params: {} },
        { id: 's2', type: 'error_check', label: 'Error check', params: {} },
      ],
      code: 'scope = rm.open_resource("TCPIP::127.0.0.1::INSTR")',
      ok: true,
    });
    expect(report.findings.some((f) => f.rule === 'step_codegen_parity_error_check')).toBe(true);
  });

  it('returns fail when run not ok', () => {
    const report = generateExecutionAudit({
      source: 'steps',
      steps: [],
      code: '',
      ok: false,
      exit_code: 1,
      stderr: 'Traceback',
    });
    expect(report.status).toBe('fail');
    expect(report.findings.some((f) => f.rule === 'run_exit_status')).toBe(true);
  });
});

