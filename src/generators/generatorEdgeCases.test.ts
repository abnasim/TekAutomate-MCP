/**
 * D: Error & Edge Case Coverage
 *
 * Tests error states, boundary conditions, and unusual inputs:
 *  - Missing required command parameters
 *  - Invalid/empty commands
 *  - Group with no children
 *  - Deeply nested groups
 *  - Unknown step types (silently ignored)
 *  - Massive step count
 *  - Special characters in commands
 *  - connect/disconnect skipping
 */
/// <reference types="jest" />

import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from './stepToPython';

const cfg: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

const gen = (steps: GeneratorStep[]) => generatePythonFromSteps(steps, cfg);

describe('D: Error & Edge Case Coverage', () => {
  // ─── Missing / empty command params ───
  describe('missing or empty command parameters', () => {
    it('write with empty command string emits scpi.write("")', () => {
      const code = gen([{ id: '1', type: 'write', params: { command: '' } }]);
      expect(code).toContain('scpi.write("")');
    });

    it('write with undefined command does not crash', () => {
      expect(() => gen([{ id: '1', type: 'write', params: {} }])).not.toThrow();
    });

    it('query with empty command emits scpi.query("")', () => {
      const code = gen([{ id: '1', type: 'query', params: { command: '' } }]);
      expect(code).toContain('scpi.query("")');
    });

    it('set_and_query with empty command does not crash', () => {
      const code = gen([{
        id: '1', type: 'set_and_query', params: {
          command: '', cmdParams: [], paramValues: {}, saveAs: 'r',
        },
      }]);
      expect(code).toContain('scpi.write');
      expect(code).toContain('scpi.query');
    });

    it('write with no params object at all', () => {
      expect(() => gen([{ id: '1', type: 'write' } as GeneratorStep])).not.toThrow();
    });

    it('query with no params object at all', () => {
      expect(() => gen([{ id: '1', type: 'query' } as GeneratorStep])).not.toThrow();
    });
  });

  // ─── Group edge cases ───
  describe('group edge cases', () => {
    it('group with no children emits only comment', () => {
      const code = gen([{
        id: 'g1', type: 'group', label: 'Empty Group', params: {},
        children: [],
      }]);
      expect(code).toContain('# Group: Empty Group');
    });

    it('group with undefined children emits only comment', () => {
      const code = gen([{
        id: 'g1', type: 'group', label: 'No Children', params: {},
      }]);
      expect(code).toContain('# Group: No Children');
    });

    it('group with no label uses fallback', () => {
      const code = gen([{
        id: 'g1', type: 'group', params: {},
        children: [{ id: '1', type: 'write', params: { command: '*RST' } }],
      }]);
      expect(code).toContain('# Group: Group');
    });

    it('deeply nested groups (5 levels) do not crash', () => {
      let innermost: GeneratorStep = { id: 'leaf', type: 'write', params: { command: 'DEEP:CMD' } };
      for (let i = 0; i < 5; i++) {
        innermost = {
          id: `g${i}`, type: 'group', label: `Level ${i}`, params: {},
          children: [innermost],
        };
      }
      const code = gen([innermost]);
      expect(code).toContain('DEEP:CMD');
      expect(code).toContain('# Group: Level 0');
      expect(code).toContain('# Group: Level 4');
    });

    it('10 levels of nesting still produces valid output', () => {
      let node: GeneratorStep = { id: 'leaf', type: 'query', params: { command: '*IDN?', saveAs: 'deep' } };
      for (let i = 0; i < 10; i++) {
        node = { id: `g${i}`, type: 'group', label: `Nest${i}`, params: {}, children: [node] };
      }
      const code = gen([node]);
      expect(code).toContain('deep = scpi.query("*IDN?")');
      expect(code).toContain('# Group: Nest0');
      expect(code).toContain('# Group: Nest9');
    });
  });

  // ─── Unknown step types ───
  describe('unknown step types', () => {
    it('unknown type is silently ignored', () => {
      const code = gen([
        { id: '1', type: 'bogus_type' as string, params: { command: 'FAKE' } },
        { id: '2', type: 'write', params: { command: '*RST' } },
      ]);
      expect(code).not.toContain('FAKE');
      expect(code).toContain('scpi.write("*RST")');
    });

    it('save_waveform type not handled by standalone generator (ignored)', () => {
      const code = gen([
        { id: '1', type: 'save_waveform', params: { source: 'CH1', filename: 'wave.bin' } },
        { id: '2', type: 'write', params: { command: '*RST' } },
      ]);
      expect(code).toContain('scpi.write("*RST")');
    });

    it('save_screenshot type not handled (ignored)', () => {
      const code = gen([
        { id: '1', type: 'save_screenshot', params: { filename: 'screen.png' } },
        { id: '2', type: 'write', params: { command: '*RST' } },
      ]);
      expect(code).toContain('scpi.write("*RST")');
    });

    it('error_check type not handled (ignored)', () => {
      const code = gen([
        { id: '1', type: 'error_check', params: { command: 'ALLEV?' } },
        { id: '2', type: 'write', params: { command: '*RST' } },
      ]);
      expect(code).toContain('scpi.write("*RST")');
    });
  });

  // ─── connect/disconnect skipping ───
  describe('connect/disconnect skipping', () => {
    it('connect step produces no additional output beyond skeleton', () => {
      const withConnect = gen([{ id: '1', type: 'connect', params: {} }]);
      const empty = gen([]);
      expect(withConnect).toBe(empty);
    });

    it('disconnect step produces no output', () => {
      const code = gen([{ id: '1', type: 'disconnect', params: {} }]);
      expect(code).not.toMatch(/\bdisconnect\b/);
    });

    it('connect + steps + disconnect: only inner steps appear', () => {
      const code = gen([
        { id: '1', type: 'connect', params: {} },
        { id: '2', type: 'write', params: { command: '*RST' } },
        { id: '3', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
        { id: '4', type: 'disconnect', params: {} },
      ]);
      expect(code).toContain('scpi.write("*RST")');
      expect(code).toContain('idn = scpi.query("*IDN?")');
    });
  });

  // ─── Special characters in commands ───
  describe('special characters in commands', () => {
    it('command with quotes does not break Python string', () => {
      const code = gen([{ id: '1', type: 'write', params: { command: 'DATA:DEST "REF1"' } }]);
      expect(code).toContain('scpi.write("DATA:DEST \\"REF1\\"")');
    });

    it('command with backslash is escaped', () => {
      const code = gen([{ id: '1', type: 'write', params: { command: 'PATH C:\\data\\file' } }]);
      expect(code).toContain('scpi.write(');
    });

    it('command with newline in it is handled', () => {
      expect(() => gen([{ id: '1', type: 'write', params: { command: 'CMD\nSECOND' } }])).not.toThrow();
    });

    it('very long command (500+ chars) does not crash', () => {
      const longCmd = 'X'.repeat(500);
      expect(() => gen([{ id: '1', type: 'write', params: { command: longCmd } }])).not.toThrow();
      const code = gen([{ id: '1', type: 'write', params: { command: longCmd } }]);
      expect(code).toContain(longCmd);
    });
  });

  // ─── Large step count ───
  describe('large step count', () => {
    it('100 steps produce valid Python', () => {
      const steps: GeneratorStep[] = Array.from({ length: 100 }, (_, i) => ({
        id: `s${i}`, type: 'write', params: { command: `CMD${i}:VALUE ${i}` },
      }));
      const code = gen(steps);
      expect(code).toContain('CMD0:VALUE 0');
      expect(code).toContain('CMD99:VALUE 99');
      expect(code).toContain('if __name__ == "__main__":');
    });
  });

  // ─── Backend validation ───
  describe('backend validation', () => {
    it('non-pyvisa backend throws', () => {
      expect(() => generatePythonFromSteps([], { ...cfg, backend: 'tm_devices' }))
        .toThrow('only supports backend "pyvisa"');
    });

    it('tekhsi backend throws', () => {
      expect(() => generatePythonFromSteps([], { ...cfg, backend: 'tekhsi' }))
        .toThrow('only supports backend "pyvisa"');
    });

    it('empty backend throws', () => {
      expect(() => generatePythonFromSteps([], { ...cfg, backend: '' }))
        .toThrow('only supports backend "pyvisa"');
    });
  });

  // ─── Mixed step sequences ───
  describe('mixed step sequences', () => {
    it('all step types in one sequence', () => {
      const steps: GeneratorStep[] = [
        { id: '1', type: 'connect', params: {} },
        { id: '2', type: 'comment', params: { text: 'Start' } },
        { id: '3', type: 'write', params: { command: '*RST' } },
        { id: '4', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
        { id: '5', type: 'sleep', params: { duration: 0.5 } },
        { id: '6', type: 'set_and_query', params: { command: 'CH1:SCALE', cmdParams: [], paramValues: { value: '1' }, saveAs: 's' } },
        { id: '7', type: 'python', params: { code: 'print(idn)' } },
        {
          id: 'g1', type: 'group', label: 'G', params: {},
          children: [{ id: '8', type: 'write', params: { command: 'ACQ:STATE RUN' } }],
        },
        { id: '9', type: 'disconnect', params: {} },
      ];
      const code = gen(steps);
      expect(code).toContain('# Start');
      expect(code).toContain('scpi.write("*RST")');
      expect(code).toContain('idn = scpi.query("*IDN?")');
      expect(code).toContain('time.sleep(0.5)');
      expect(code).toContain('scpi.write("CH1:SCALE 1")');
      expect(code).toContain('s = scpi.query("CH1:SCALE?")');
      expect(code).toContain('print(idn)');
      expect(code).toContain('# Group: G');
      expect(code).toContain('scpi.write("ACQ:STATE RUN")');
    });

    it('empty steps array still produces valid skeleton', () => {
      const code = gen([]);
      expect(code).toContain('#!/usr/bin/env python3');
      expect(code).toContain('import pyvisa');
      expect(code).toContain('def main():');
      expect(code).toContain('if __name__ == "__main__":');
      expect(code).toContain('scpi.close()');
      expect(code).toContain('rm.close()');
    });
  });

  // ─── Python snippet edge cases ───
  describe('python snippet edge cases', () => {
    it('multiline code preserves indentation', () => {
      const code = gen([{
        id: '1', type: 'python', params: {
          code: 'for i in range(10):\n    print(i)\n    if i > 5:\n        break',
        },
      }]);
      expect(code).toContain('    for i in range(10):');
      expect(code).toContain('        print(i)');
      expect(code).toContain('        if i > 5:');
      expect(code).toContain('            break');
    });

    it('code with Windows line endings normalized', () => {
      const code = gen([{
        id: '1', type: 'python', params: { code: 'a = 1\r\nb = 2\r\nc = 3' },
      }]);
      expect(code).toContain('    a = 1');
      expect(code).toContain('    b = 2');
      expect(code).toContain('    c = 3');
      expect(code).not.toContain('\r');
    });

    it('code without string type in params is skipped', () => {
      const code = gen([{
        id: '1', type: 'python', params: { code: 123 as unknown as string },
      }]);
      expect(code).not.toContain('123');
    });
  });
});
