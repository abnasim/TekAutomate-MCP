/**
 * Real-world regression: generated Python is syntactically valid and runs without runtime errors (no hardware).
 * - Syntax: py_compile validates generated code.
 * - Runtime: run with mock PyVISA so no real instrument is needed.
 */
/// <reference types="jest" />

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from './stepToPython';

const baseConfig: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

const TEMP_DIR = path.join(process.cwd(), 'test-results');
const MOCK_PYVISA_PATH = path.join(process.cwd(), 'scripts', 'mock_pyvisa');

function pythonAvailable(): boolean {
  try {
    execSync('python --version', { stdio: 'pipe' });
    return true;
  } catch {
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

function getPythonCommand(): string {
  try {
    execSync('python --version', { stdio: 'pipe' });
    return 'python';
  } catch {
    return 'python3';
  }
}

describe('Generated Python runtime validation', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  });

  describe('syntax validation (py_compile)', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'write', params: { command: 'CH1:SCALE 1' } },
      { id: '2', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
      { id: '3', type: 'sleep', params: { duration: 0.1 } },
    ];

    it('generated Python compiles without syntax errors', function () {
      if (!pythonAvailable()) {
        console.warn('Python not found; skipping py_compile test');
        return;
      }
      const code = generatePythonFromSteps(steps, baseConfig);
      const tempFile = path.join(TEMP_DIR, 'generated_syntax_check.py');
      fs.writeFileSync(tempFile, code, 'utf-8');
      expect(() => {
        execSync(`${getPythonCommand()} -m py_compile ${tempFile}`, {
          stdio: 'pipe',
          cwd: process.cwd(),
        });
      }).not.toThrow();
    });
  });

  describe('runtime execution with mock PyVISA (no hardware)', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'write', params: { command: 'CH1:SCALE 1' } },
      { id: '2', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
    ];

    it('generated Python runs without runtime errors when using mock PyVISA', function () {
      if (!pythonAvailable()) {
        console.warn('Python not found; skipping runtime mock test');
        return;
      }
      if (!fs.existsSync(path.join(MOCK_PYVISA_PATH, 'pyvisa', '__init__.py'))) {
        console.warn('scripts/mock_pyvisa not found; skipping runtime mock test');
        return;
      }
      const code = generatePythonFromSteps(steps, baseConfig);
      const tempFile = path.join(TEMP_DIR, 'generated_runtime_mock.py');
      fs.writeFileSync(tempFile, code, 'utf-8');
      const env = {
        ...process.env,
        PYTHONPATH: MOCK_PYVISA_PATH,
        PYTHONIOENCODING: 'utf-8',
      };
      expect(() => {
        execSync(`${getPythonCommand()} "${tempFile}"`, {
          stdio: 'pipe',
          cwd: process.cwd(),
          env,
        });
      }).not.toThrow();
    });
  });
});
