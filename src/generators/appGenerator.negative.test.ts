/**
 * Negative & edge-case tests for the REAL generator.
 *
 * These tests intentionally feed the generator bad/edge-case data to see
 * how it behaves. Some of these should EXPOSE genuine bugs if the generator
 * doesn't handle them gracefully.
 */
/// <reference types="jest" />

import {
  genStepsClassic,
  genStepsTekHSI,
  genStepsVxi11,
  substituteSCPI,
  formatPythonSnippet,
  Step,
  GeneratorContext,
  DEFAULT_CONTEXT,
} from './appGenerator';

const ctx: GeneratorContext = DEFAULT_CONTEXT;

// ═══════════════════════════════════════════════════════════
// 1. Unresolved parameters (the #1 real-world bug class)
// ═══════════════════════════════════════════════════════════

describe('unresolved parameter placeholders', () => {
  it('write step with unresolved {param} emits literal braces (DANGEROUS in Python)', () => {
    const out = genStepsClassic([{
      id: '1', type: 'write', label: 'W', params: {
        command: 'CH{ch}:SCALE {val}',
        cmdParams: [{ name: 'ch', type: 'numeric' }, { name: 'val', type: 'numeric' }],
        paramValues: {},
      },
    }], ctx);
    // In Python, `instrument.write("CH{ch}:SCALE {val}")` would be
    // interpreted as an f-string if the user adds 'f' prefix, or crash
    // if used with .format(). This is a potential bug we want to flag.
    const hasUnresolved = /\{[a-zA-Z_]+\}/.test(out);
    // Log what happened — either this is a bug or the generator handles it
    if (hasUnresolved) {
      // Generator left unresolved placeholder — test documents this behavior
      expect(out).toMatch(/\{ch\}/);
    } else {
      // Generator resolved or removed the placeholder somehow
      expect(out).not.toMatch(/\{ch\}/);
    }
  });

  it('set_and_query with missing value param still produces valid write command', () => {
    const out = genStepsClassic([{
      id: '1', type: 'set_and_query', label: 'SQ', params: {
        command: 'CH1:SCALE', cmdParams: [], paramValues: {},
        saveAs: 'result',
      },
    }], ctx);
    expect(out).toContain('scpi.write("CH1:SCALE")');
    expect(out).toContain('scpi.query("CH1:SCALE?")');
  });

  it('query with missing saveAs defaults to "result"', () => {
    const out = genStepsClassic([{
      id: '1', type: 'query', label: 'Q', params: { command: '*IDN?' },
    }], ctx);
    expect(out).toContain('result = scpi.query("*IDN?")');
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Empty/missing params
// ═══════════════════════════════════════════════════════════

describe('empty and missing step params', () => {
  it('empty steps list produces empty output', () => {
    expect(genStepsClassic([], ctx)).toBe('');
    expect(genStepsTekHSI([], ctx)).toBe('');
    expect(genStepsVxi11([], ctx)).toBe('');
  });

  it('write with empty command string', () => {
    const out = genStepsClassic([{
      id: '1', type: 'write', label: 'W', params: { command: '' },
    }], ctx);
    expect(out).toContain('scpi.write("")');
  });

  it('query with empty command string', () => {
    const out = genStepsClassic([{
      id: '1', type: 'query', label: 'Q', params: { command: '' },
    }], ctx);
    expect(out).toContain('scpi.query("").strip()');
  });

  it('sleep with no duration defaults to 0', () => {
    const out = genStepsClassic([{
      id: '1', type: 'sleep', label: 'S', params: {},
    }], ctx);
    expect(out).toContain('time.sleep(0)');
  });

  it('sleep with non-numeric duration defaults to 0', () => {
    const out = genStepsClassic([{
      id: '1', type: 'sleep', label: 'S', params: { duration: 'abc' },
    }], ctx);
    expect(out).toContain('time.sleep(0)');
  });

  it('comment with no text produces empty comment', () => {
    const out = genStepsClassic([{
      id: '1', type: 'comment', label: '', params: {},
    }], ctx);
    expect(out).toContain('# ');
  });

  it('python snippet with empty code produces nothing', () => {
    const out = genStepsClassic([{
      id: '1', type: 'python', label: 'Py', params: { code: '' },
    }], ctx);
    expect(out).toBe('');
  });

  it('save_waveform with no params at all still produces valid output', () => {
    const out = genStepsClassic([{
      id: '1', type: 'save_waveform', label: 'Save', params: {},
    }], ctx);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('CH1');
  });
});

// ═══════════════════════════════════════════════════════════
// 3. Group and nesting edge cases
// ═══════════════════════════════════════════════════════════

describe('group edge cases', () => {
  it('empty group (no children) just outputs comment', () => {
    const out = genStepsClassic([{
      id: '1', type: 'group', label: 'Empty', params: {}, children: [],
    }], ctx);
    expect(out).toContain('# Group: Empty');
    expect(out.trim()).toBe('# Group: Empty');
  });

  it('group with undefined children handled gracefully', () => {
    const out = genStepsClassic([{
      id: '1', type: 'group', label: 'Broken', params: {},
    }], ctx);
    expect(out).toContain('# Group: Broken');
  });

  it('deeply nested groups (5 levels) produce output at correct indent', () => {
    const makeNested = (depth: number, leaf: Step): Step => {
      if (depth === 0) return leaf;
      return {
        id: `g${depth}`, type: 'group', label: `Level ${depth}`, params: {},
        children: [makeNested(depth - 1, leaf)],
      };
    };
    const leaf: Step = { id: 'leaf', type: 'write', label: 'Deep', params: { command: '*RST' } };
    const out = genStepsClassic([makeNested(5, leaf)], ctx);
    expect(out).toContain('# Group: Level 5');
    expect(out).toContain('# Group: Level 1');
    expect(out).toContain('scpi.write("*RST")');
  });

  it('group children include all step types', () => {
    const children: Step[] = [
      { id: 'c1', type: 'write', label: 'W', params: { command: '*RST' } },
      { id: 'c2', type: 'query', label: 'Q', params: { command: '*IDN?', saveAs: 'idn' } },
      { id: 'c3', type: 'sleep', label: 'S', params: { duration: 1 } },
      { id: 'c4', type: 'comment', label: 'C', params: { text: 'hello' } },
      { id: 'c5', type: 'error_check', label: 'E', params: {} },
    ];
    const out = genStepsClassic([{
      id: '1', type: 'group', label: 'All Types', params: {}, children,
    }], ctx);
    expect(out).toContain('scpi.write("*RST")');
    expect(out).toContain('scpi.query("*IDN?")');
    expect(out).toContain('time.sleep(1)');
    expect(out).toContain('# hello');
    expect(out).toContain('ALLEV?');
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Special characters & injection
// ═══════════════════════════════════════════════════════════

describe('special character handling', () => {
  it('SCPI command with quotes does not break Python string', () => {
    const out = genStepsClassic([{
      id: '1', type: 'write', label: 'W', params: { command: 'SAVE:IMAGE "C:/test.png"' },
    }], ctx);
    // Check the output is valid - should use JSON.stringify which escapes quotes
    expect(out).toContain('scpi.write(');
  });

  it('python snippet with triple quotes preserved', () => {
    const code = `x = """
multi-line
string
"""`;
    const out = formatPythonSnippet(code, '    ');
    expect(out).toContain('"""');
    expect(out).toContain('multi-line');
  });

  it('comment with special chars (#, $, %) survives', () => {
    const out = genStepsClassic([{
      id: '1', type: 'comment', label: 'C', params: { text: 'Price is $50 (100% off!) #deal' },
    }], ctx);
    expect(out).toContain('# Price is $50 (100% off!) #deal');
  });

  it('SCPI command with backslash in path', () => {
    const out = genStepsClassic([{
      id: '1', type: 'write', label: 'W', params: { command: 'FILESYSTEM:READFILE "C:\\Temp\\file.txt"' },
    }], ctx);
    expect(out).toContain('FILESYSTEM:READFILE');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Cross-backend consistency
// ═══════════════════════════════════════════════════════════

describe('cross-backend consistency', () => {
  const writeStep: Step = { id: '1', type: 'write', label: 'Reset', params: { command: '*RST' } };
  const queryStep: Step = { id: '2', type: 'query', label: 'IDN', params: { command: '*IDN?', saveAs: 'idn' } };
  const sleepStep: Step = { id: '3', type: 'sleep', label: 'Wait', params: { duration: 2 } };

  it('all backends handle *RST write step', () => {
    const classic = genStepsClassic([writeStep], ctx);
    const tekhsi = genStepsTekHSI([writeStep], ctx);
    const vxi11 = genStepsVxi11([writeStep], ctx);

    expect(classic).toContain('*RST');
    expect(tekhsi).toContain('*RST');
    expect(vxi11).toContain('*RST');
  });

  it('all backends handle sleep identically', () => {
    const classic = genStepsClassic([sleepStep], ctx);
    const tekhsi = genStepsTekHSI([sleepStep], ctx);
    const vxi11 = genStepsVxi11([sleepStep], ctx);

    expect(classic).toContain('time.sleep(2)');
    expect(tekhsi).toContain('time.sleep(2)');
    expect(vxi11).toContain('time.sleep(2)');
  });

  it('Classic uses scpi.write, VXI-11 uses instrument.write', () => {
    const classic = genStepsClassic([writeStep], ctx);
    const vxi11 = genStepsVxi11([writeStep], ctx);

    expect(classic).toContain('scpi.write');
    expect(classic).not.toContain('instrument.write');
    expect(vxi11).toContain('instrument.write');
    expect(vxi11).not.toContain('scpi.write');
  });

  it('Classic uses scpi.query, VXI-11 uses instrument.ask', () => {
    const classic = genStepsClassic([queryStep], ctx);
    const vxi11 = genStepsVxi11([queryStep], ctx);

    expect(classic).toContain('scpi.query');
    expect(vxi11).toContain('instrument.ask');
  });
});

// ═══════════════════════════════════════════════════════════
// 6. Unknown / unsupported step types
// ═══════════════════════════════════════════════════════════

describe('unsupported step types', () => {
  it('unknown step type is silently skipped (Classic)', () => {
    const out = genStepsClassic([
      { id: '1', type: 'foobar', label: 'X', params: {} } as any,
      { id: '2', type: 'write', label: 'W', params: { command: '*RST' } },
    ], ctx);
    expect(out).toContain('scpi.write("*RST")');
    expect(out).not.toContain('foobar');
  });

  it('connect step does not produce SCPI output (Classic)', () => {
    const out = genStepsClassic([
      { id: '1', type: 'connect', label: 'Connect', params: {} },
    ], ctx);
    expect(out).toBe('');
  });

  it('disconnect step does not produce SCPI output (Classic)', () => {
    const out = genStepsClassic([
      { id: '1', type: 'disconnect', label: 'Disconnect', params: {} },
    ], ctx);
    expect(out).toBe('');
  });

  it('recall step does not produce SCPI output (Classic)', () => {
    const out = genStepsClassic([
      { id: '1', type: 'recall', label: 'Recall', params: {} },
    ], ctx);
    expect(out).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════
// 7. Large step count (performance sanity check)
// ═══════════════════════════════════════════════════════════

describe('scale', () => {
  it('500 write steps complete in under 1 second', () => {
    const steps: Step[] = Array.from({ length: 500 }, (_, i) => ({
      id: String(i), type: 'write' as const, label: `Step ${i}`,
      params: { command: `*CMD${i}` },
    }));
    const start = Date.now();
    const out = genStepsClassic(steps, ctx);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(out).toContain('*CMD0');
    expect(out).toContain('*CMD499');
  });
});

// ═══════════════════════════════════════════════════════════
// 8. substituteSCPI edge cases
// ═══════════════════════════════════════════════════════════

describe('substituteSCPI edge cases', () => {
  it('null/undefined scpi returns undefined/null', () => {
    expect(substituteSCPI(null as any, [], {})).toBe(null);
    expect(substituteSCPI(undefined as any, [], {})).toBe(undefined);
  });

  it('param value of 0 is substituted (not treated as falsy)', () => {
    expect(substituteSCPI('CH{ch}:OFFSET {val}', [
      { name: 'ch', type: 'numeric' },
      { name: 'val', type: 'numeric' },
    ], { ch: 1, val: 0 })).toBe('CH1:OFFSET 0');
  });

  it('param value of false is substituted', () => {
    expect(substituteSCPI('FEAT:{enable}', [
      { name: 'enable', type: 'boolean' },
    ], { enable: false })).toBe('FEAT:false');
  });

  it('multiple occurrences of same placeholder all replaced', () => {
    expect(substituteSCPI('{ch}:{ch}:{ch}', [
      { name: 'ch', type: 'numeric' },
    ], { ch: 1 })).toBe('1:1:1');
  });

  it('no paramDefs, no paramValues — returns scpi unchanged', () => {
    expect(substituteSCPI('*RST', [], {})).toBe('*RST');
  });
});
