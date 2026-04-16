/**
 * Template fixture tests (plan 3c): Load built-in template steps, generate Python,
 * assert output contains expected SCPI/patterns. Ensures templates never silently produce wrong code.
 */
/// <reference types="jest" />

import * as fs from 'fs';
import * as path from 'path';
import { generatePythonFromSteps } from './stepToPython';
import type { GeneratorStep, GeneratorConfig } from './stepToPython';

const TEMPLATES_DIR = path.join(process.cwd(), 'public', 'templates');
const baseConfig: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

function loadTemplateFile(filename: string): { name: string; steps: GeneratorStep[]; backend?: string }[] {
  const filePath = path.join(TEMPLATES_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const templates = data.templates || [];
  return templates.map((t: { name: string; steps: unknown[]; backend?: string }) => ({
    name: t.name,
    steps: (t.steps || []) as GeneratorStep[],
    backend: t.backend,
  }));
}

describe('Template fixture → generated code', () => {
  it('public/templates directory and basic.json exist', () => {
    expect(fs.existsSync(TEMPLATES_DIR)).toBe(true);
    expect(fs.existsSync(path.join(TEMPLATES_DIR, 'basic.json'))).toBe(true);
  });

  describe('Hello Scope template', () => {
    let helloScope: { name: string; steps: GeneratorStep[]; backend?: string } | undefined;
    beforeAll(() => {
      const templates = loadTemplateFile('basic.json');
      helloScope = templates.find((t) => t.name === 'Hello Scope');
    });

    it('generates Python containing *IDN? and *OPT? and idn, options variables', () => {
      expect(helloScope).toBeDefined();
      expect(helloScope!.steps.length).toBeGreaterThan(0);
      const code = generatePythonFromSteps(helloScope!.steps, { ...baseConfig, backend: 'pyvisa' });
      expect(code).toContain('*IDN?');
      expect(code).toContain('*OPT?');
      expect(code).toContain('idn');
      expect(code).toContain('options');
      expect(code).toContain('scpi.query');
      expect(code).toContain('if __name__ == "__main__":');
    });
  });

  describe('Single Waveform Capture template (write, query, sleep steps)', () => {
    let wf: { name: string; steps: GeneratorStep[]; backend?: string } | undefined;
    beforeAll(() => {
      const templates = loadTemplateFile('basic.json');
      wf = templates.find((t) => t.name === 'Single Waveform Capture');
    });

    it('generates Python containing ACQuire:STATE and HORizontal and time.sleep', () => {
      expect(wf).toBeDefined();
      const code = generatePythonFromSteps(wf!.steps, baseConfig);
      expect(code).toContain('ACQuire:STATE');
      expect(code).toContain('HORizontal');
      expect(code).toContain('time.sleep');
      expect(code).toContain('scpi.write');
    });
  });

  describe('Quick Steps UI Demo (mixed step types)', () => {
    let demo: { name: string; steps: GeneratorStep[]; backend?: string } | undefined;
    beforeAll(() => {
      const templates = loadTemplateFile('basic.json');
      demo = templates.find((t) => t.name === 'Quick Steps UI Demo');
    });

    it('generates Python containing CH1:SCALE and *IDN? and set_and_query pattern', () => {
      expect(demo).toBeDefined();
      const code = generatePythonFromSteps(demo!.steps, baseConfig);
      expect(code).toContain('CH1:SCALE');
      expect(code).toContain('*IDN?');
      expect(code).toContain('scpi.write');
      expect(code).toContain('scpi.query');
    });
  });

  it('basic.json and advanced.json load and have at least one template with steps', () => {
    ['basic.json', 'advanced.json'].forEach((file) => {
      const filePath = path.join(TEMPLATES_DIR, file);
      expect(fs.existsSync(filePath)).toBe(true);
      const templates = loadTemplateFile(file);
      const withSteps = templates.filter((t) => t.steps && t.steps.length > 0);
      expect(withSteps.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('built-in python steps do not import bare time inside main scope', () => {
    const templates = loadTemplateFile('basic.json');
    const pythonSteps = templates.flatMap((t) => t.steps.filter((s: any) => s.type === 'python'));
    const bareTimeImport = /(^|\n)import time(\n|$)/;
    pythonSteps.forEach((step: any) => {
      const code = String(step?.params?.code || '');
      expect(
        bareTimeImport.test(code),
      ).toBe(false);
    });
  });
});
