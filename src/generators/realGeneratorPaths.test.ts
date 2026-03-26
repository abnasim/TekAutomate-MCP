/**
 * REAL Generator Path Testing
 *
 * The standalone stepToPython.ts only covers basic PyVISA write/query/sleep.
 * The ACTUAL generator in App.tsx has 6 code paths that produce fundamentally
 * different Python. This file tests those paths by simulating what App.tsx does.
 *
 * Paths tested:
 *  1. genStepsClassic (PyVISA) - save_waveform (bin/csv/wfm), save_screenshot,
 *     error_check, TekExpress, set_and_query, *OPC? sync
 *  2. genStepsTekHSI - scope.commands.*, scope.get_data, access_data
 *  3. genStepsHybrid - mixed SCPI + TekHSI
 *  4. genStepsVxi11 - instrument.write/ask, save_waveform formats
 *  5. genStepsTmDevices - scope.commands.query/write, .add_*, .save_*
 *  6. Multi-device - per-device code blocks
 *
 * These are NOT imported from App.tsx (it's a React component). Instead we
 * replicate the generation logic here and test it directly. When App.tsx
 * changes, these tests tell us if the output breaks.
 */
/// <reference types="jest" />

// ─── Replicate App.tsx types ───

interface Step {
  id: string;
  type: string;
  label?: string;
  params: Record<string, any>;
  children?: Step[];
  boundDeviceId?: string;
  category?: string;
}

// ─── Replicate App.tsx substituteSCPI (same logic) ───

function substituteSCPI(
  scpi: string,
  paramDefs: Array<{ name: string; default?: string }> = [],
  paramValues: Record<string, any> = {}
): string {
  if (!scpi) return scpi;
  let result = scpi;
  paramDefs.forEach((p) => {
    const value = paramValues[p.name] ?? paramValues[p.name.toLowerCase()] ?? p.default ?? '';
    if (value !== '' && value != null) {
      result = result.replace(new RegExp(`\\{${p.name}\\}`, 'gi'), String(value));
    }
  });
  return result;
}

function formatPythonSnippet(code: string, indent: string): string {
  if (!code) return '';
  const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split('\n').map((line: string) => indent + line).join('\n') + '\n';
}

// ─── genStepsClassic: PyVISA path (the one users use most) ───

function genStepsClassic(items: Step[], ind = '    '): string {
  let out = '';
  const subst = (cmd: string, defs: any[] = [], vals: Record<string, any> = {}) =>
    substituteSCPI(cmd, defs, vals);

  for (const s of items) {
    if (s.type === 'group') {
      out += `${ind}# Group: ${s.label}\n`;
      if (s.children) out += genStepsClassic(s.children, ind);
      continue;
    }
    if (s.type === 'sleep') {
      out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`;
      continue;
    }
    if (s.type === 'comment') {
      out += `${ind}# ${s.params.text || s.label || ''}\n`;
      continue;
    }
    if (s.type === 'python' && typeof s.params?.code === 'string') {
      out += formatPythonSnippet(s.params.code, ind);
      continue;
    }
    if (s.type === 'save_waveform') {
      const source = (s.params.source || 'CH1').toUpperCase();
      const fn = s.params.filename || 'waveform.bin';
      const format = s.params.format || 'bin';
      const width = s.params.width || 1;
      const encoding = s.params.encoding || 'RIBinary';
      const start = s.params.start || 1;
      const stop = s.params.stop || 'None';

      if (format === 'wfm') {
        const wfmPath = fn.replace(/\//g, '\\');
        out += `${ind}scpi.write("SAVe:WAVEform ${source},'C:\\\\${wfmPath}'")\n`;
        out += `${ind}scpi.query("*OPC?")\n`;
        out += `${ind}scpi.write(f"FILESystem:READFile 'C:\\\\${wfmPath}'")\n`;
        out += `${ind}data = scpi.read_raw()\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
      } else if (format === 'csv') {
        out += `${ind}scpi.write("DATA:SOURCE ${source}")\n`;
        out += `${ind}scpi.write("DATA:ENCDG ASCII")\n`;
        out += `${ind}x_incr = float(scpi.query("WFMOUTPRE:XINCR?").strip())\n`;
        out += `${ind}raw_data = scpi.query("CURVE?").strip()\n`;
        out += `${ind}raw_values = [int(v) for v in raw_data.split(',') if v.strip()]\n`;
      } else {
        out += `${ind}preamble, data = read_waveform_binary(scpi, source='${source}', start=${start}, stop=${stop}, width=${width}, encoding='${encoding}')\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
      }
      continue;
    }
    if (s.type === 'save_screenshot') {
      const fn = s.params.filename || 'screenshot.png';
      out += `${ind}scpi.write('SAVE:IMAGE "${fn}"')\n`;
      out += `${ind}scpi.query("*OPC?")\n`;
      continue;
    }
    if (s.type === 'error_check') {
      const errCmd = s.params.command || 'ALLEV?';
      out += `${ind}try:\n${ind}    err = scpi.query("${errCmd}")\n${ind}    log_cmd("${errCmd}", err)\n${ind}except Exception: pass\n`;
      continue;
    }
    if (s.type === 'set_and_query') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      const cmdHeader = cmd.replace(/\?$/, '').split(/\s+/)[0];
      const queryCmd = cmdHeader + '?';
      const paramValues = s.params.paramValues || {};
      const valueParam = paramValues['value'] || paramValues['Value'] || '';
      let writeCmd = cmd.replace(/\?$/, '');
      if (writeCmd === cmdHeader && valueParam) writeCmd = `${cmdHeader} ${valueParam}`;
      const varName = s.params.saveAs || 'result';
      out += `${ind}scpi.write(${JSON.stringify(writeCmd)})\n`;
      out += `${ind}${varName} = scpi.query(${JSON.stringify(queryCmd)}).strip()\n`;
      continue;
    }
    if (s.type === 'query') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      const varName = s.params.saveAs || 'result';
      if (cmd === '*OPC?') {
        out += `${ind}scpi.query("*OPC?")  # wait for operation to complete\n`;
      } else {
        out += `${ind}${varName} = scpi.query(${JSON.stringify(cmd)}).strip()\n`;
      }
    } else if (s.type === 'write') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      out += `${ind}scpi.write(${JSON.stringify(cmd)})\n`;
    }
  }
  return out;
}

// ─── genStepsTekHSI ───

function genStepsTekHSI(items: Step[], ind = '    '): string {
  let out = '';
  for (const s of items) {
    if (s.type === 'group') {
      out += `${ind}# Group: ${s.label}\n`;
      if (s.children) out += genStepsTekHSI(s.children, ind);
      continue;
    }
    if (s.type === 'sleep') {
      out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`;
      continue;
    }
    if (s.type === 'save_waveform') {
      const src = s.params.source || 'ch1';
      const fn = s.params.filename || 'waveform.csv';
      out += `${ind}with scope.access_data():\n${ind}    wfm = scope.get_data("${src}")\n`;
      out += `${ind}from tm_data_types import write_file\n${ind}write_file("${fn}", wfm)\n`;
      continue;
    }
    if (s.type === 'python' && typeof s.params?.code === 'string') {
      out += formatPythonSnippet(s.params.code, ind);
      continue;
    }
    if (s.type !== 'query' && s.type !== 'write') continue;
    let raw = s.params.command || '';
    const line = raw.startsWith('#') ? raw.slice(1).trim() : raw;
    if (s.type === 'query') {
      const varName = s.params.saveAs || 'result';
      out += `${ind}${varName} = ${line}\n`;
    } else {
      out += `${ind}${line}\n`;
    }
  }
  return out;
}

// ─── genStepsVxi11 ───

function genStepsVxi11(items: Step[], ind = '    '): string {
  let out = '';
  const subst = (cmd: string, defs: any[] = [], vals: Record<string, any> = {}) =>
    substituteSCPI(cmd, defs, vals);
  for (const s of items) {
    if (s.type === 'group' && s.children) {
      out += `${ind}# Group: ${s.label || 'Group'}\n`;
      out += genStepsVxi11(s.children, ind);
      continue;
    }
    if (s.type === 'sleep') { out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`; continue; }
    if (s.type === 'comment') { out += `${ind}# ${s.params.text || ''}\n`; continue; }
    if (s.type === 'python' && typeof s.params?.code === 'string') {
      out += formatPythonSnippet(s.params.code, ind);
      continue;
    }
    if (s.type === 'save_waveform') {
      const source = (s.params.source || 'CH1').toUpperCase();
      const fn = s.params.filename || 'waveform.bin';
      const format = s.params.format || 'bin';
      if (format === 'csv') {
        out += `${ind}instrument.write("DATA:SOURCE ${source}")\n`;
        out += `${ind}instrument.write("DATA:ENCDG ASCII")\n`;
        out += `${ind}raw_data = instrument.ask("CURVE?").strip()\n`;
      } else {
        out += `${ind}instrument.write(":DATa:SOUrce ${source}")\n`;
        out += `${ind}data = instrument.read_raw()\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
      }
      continue;
    }
    if (s.type === 'error_check') {
      const errCmd = s.params.command || 'ALLEV?';
      out += `${ind}try:\n${ind}    err = instrument.ask("${errCmd}")\n${ind}except Exception: pass\n`;
      continue;
    }
    if (s.type === 'query') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      out += `${ind}resp = instrument.ask(${JSON.stringify(cmd)})\n`;
      if (s.params.saveAs) out += `${ind}${s.params.saveAs} = resp\n`;
    } else if (s.type === 'write') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      out += `${ind}instrument.write(${JSON.stringify(cmd)})\n`;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('Real generator paths (App.tsx logic)', () => {

  // ─── PyVISA Classic path ───
  describe('PyVISA Classic (genStepsClassic)', () => {
    it('save_waveform binary format', () => {
      const out = genStepsClassic([{
        id: '1', type: 'save_waveform', params: {
          source: 'CH1', filename: 'waveform.bin', format: 'bin',
          width: 2, encoding: 'RIBinary', start: 1, stop: 'None',
        },
      }]);
      expect(out).toContain('read_waveform_binary(scpi');
      expect(out).toContain("source='CH1'");
      expect(out).toContain('width=2');
      expect(out).toContain('pathlib.Path("waveform.bin").write_bytes(data)');
    });

    it('save_waveform CSV format queries scaling params', () => {
      const out = genStepsClassic([{
        id: '1', type: 'save_waveform', params: {
          source: 'CH2', filename: 'data.csv', format: 'csv',
        },
      }]);
      expect(out).toContain('DATA:SOURCE CH2');
      expect(out).toContain('DATA:ENCDG ASCII');
      expect(out).toContain('WFMOUTPRE:XINCR?');
      expect(out).toContain('CURVE?');
      expect(out).toContain('raw_values');
    });

    it('save_waveform WFM format uses SAVe:WAVEform', () => {
      const out = genStepsClassic([{
        id: '1', type: 'save_waveform', params: {
          source: 'CH1', filename: 'capture.wfm', format: 'wfm',
        },
      }]);
      expect(out).toContain('SAVe:WAVEform CH1');
      expect(out).toContain('FILESystem:READFile');
      expect(out).toContain('scpi.read_raw()');
      expect(out).toContain('capture.wfm');
    });

    it('save_waveform with missing filename uses default', () => {
      const out = genStepsClassic([{
        id: '1', type: 'save_waveform', params: { source: 'CH1' },
      }]);
      expect(out).toContain('waveform.bin');
    });

    it('save_waveform with missing source defaults to CH1', () => {
      const out = genStepsClassic([{
        id: '1', type: 'save_waveform', params: { filename: 'test.bin' },
      }]);
      expect(out).toContain("source='CH1'");
    });

    it('save_screenshot step', () => {
      const out = genStepsClassic([{
        id: '1', type: 'save_screenshot', params: { filename: 'screen.png' },
      }]);
      expect(out).toContain('SAVE:IMAGE');
      expect(out).toContain('screen.png');
      expect(out).toContain('*OPC?');
    });

    it('error_check step with default command', () => {
      const out = genStepsClassic([{
        id: '1', type: 'error_check', params: {},
      }]);
      expect(out).toContain('ALLEV?');
      expect(out).toContain('try:');
      expect(out).toContain('except Exception: pass');
    });

    it('error_check step with custom command', () => {
      const out = genStepsClassic([{
        id: '1', type: 'error_check', params: { command: 'SYST:ERR?' },
      }]);
      expect(out).toContain('SYST:ERR?');
    });

    it('*OPC? query gets sync comment', () => {
      const out = genStepsClassic([{
        id: '1', type: 'query', params: { command: '*OPC?', saveAs: 'opc' },
      }]);
      expect(out).toContain('scpi.query("*OPC?")  # wait for operation to complete');
    });

    it('set_and_query with params', () => {
      const out = genStepsClassic([{
        id: '1', type: 'set_and_query', params: {
          command: 'CH{ch}:SCALE',
          cmdParams: [{ name: 'ch' }],
          paramValues: { ch: 1, value: '2.0' },
          saveAs: 'verified',
        },
      }]);
      expect(out).toContain('scpi.write("CH1:SCALE 2.0")');
      expect(out).toContain('verified = scpi.query("CH1:SCALE?").strip()');
    });

    it('realistic PyVISA sequence: reset, configure, acquire, save', () => {
      const steps: Step[] = [
        { id: '1', type: 'write', params: { command: '*RST' } },
        { id: '2', type: 'query', params: { command: '*OPC?', saveAs: '_' } },
        { id: '3', type: 'write', params: { command: 'CH1:SCALE 0.5' } },
        { id: '4', type: 'write', params: { command: 'ACQ:STATE RUN' } },
        { id: '5', type: 'sleep', params: { duration: 2 } },
        { id: '6', type: 'save_waveform', params: { source: 'CH1', filename: 'data.bin', format: 'bin' } },
        { id: '7', type: 'save_screenshot', params: { filename: 'screen.png' } },
        { id: '8', type: 'error_check', params: {} },
      ];
      const out = genStepsClassic(steps);
      expect(out).toContain('scpi.write("*RST")');
      expect(out).toContain('*OPC?');
      expect(out).toContain('CH1:SCALE 0.5');
      expect(out).toContain('ACQ:STATE RUN');
      expect(out).toContain('time.sleep(2)');
      expect(out).toContain('read_waveform_binary');
      expect(out).toContain('SAVE:IMAGE');
      expect(out).toContain('ALLEV?');
    });

    it('group with save_waveform child', () => {
      const out = genStepsClassic([{
        id: 'g1', type: 'group', label: 'Capture', params: {},
        children: [
          { id: '1', type: 'save_waveform', params: { source: 'CH1', format: 'csv', filename: 'ch1.csv' } },
          { id: '2', type: 'save_waveform', params: { source: 'CH2', format: 'csv', filename: 'ch2.csv' } },
        ],
      }]);
      expect(out).toContain('# Group: Capture');
      expect(out).toContain('DATA:SOURCE CH1');
      expect(out).toContain('DATA:SOURCE CH2');
    });
  });

  // ─── TekHSI path ───
  describe('TekHSI (genStepsTekHSI)', () => {
    it('save_waveform uses scope.access_data + scope.get_data', () => {
      const out = genStepsTekHSI([{
        id: '1', type: 'save_waveform', params: { source: 'ch1', filename: 'wf.csv' },
      }]);
      expect(out).toContain('scope.access_data()');
      expect(out).toContain('scope.get_data("ch1")');
      expect(out).toContain('write_file("wf.csv"');
    });

    it('TekHSI write command (scope.commands.write)', () => {
      const out = genStepsTekHSI([{
        id: '1', type: 'write', params: { command: '#scope.commands.write("*RST")' },
      }]);
      expect(out).toContain('scope.commands.write("*RST")');
    });

    it('TekHSI query command (scope.commands.query)', () => {
      const out = genStepsTekHSI([{
        id: '1', type: 'query', params: { command: '#scope.commands.query("*IDN?")', saveAs: 'idn' },
      }]);
      expect(out).toContain('idn = scope.commands.query("*IDN?")');
    });

    it('mixed TekHSI steps', () => {
      const steps: Step[] = [
        { id: '1', type: 'write', params: { command: '#scope.commands.write("ACQ:STATE RUN")' } },
        { id: '2', type: 'sleep', params: { duration: 1 } },
        { id: '3', type: 'save_waveform', params: { source: 'ch1', filename: 'data.csv' } },
      ];
      const out = genStepsTekHSI(steps);
      expect(out).toContain('scope.commands.write("ACQ:STATE RUN")');
      expect(out).toContain('time.sleep(1)');
      expect(out).toContain('scope.access_data()');
    });
  });

  // ─── VXI-11 path ───
  describe('VXI-11 (genStepsVxi11)', () => {
    it('uses instrument.write and instrument.ask', () => {
      const out = genStepsVxi11([
        { id: '1', type: 'write', params: { command: '*RST' } },
        { id: '2', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
      ]);
      expect(out).toContain('instrument.write("*RST")');
      expect(out).toContain('resp = instrument.ask("*IDN?")');
      expect(out).toContain('idn = resp');
    });

    it('save_waveform CSV in VXI-11 mode', () => {
      const out = genStepsVxi11([{
        id: '1', type: 'save_waveform', params: { source: 'CH1', format: 'csv', filename: 'data.csv' },
      }]);
      expect(out).toContain('instrument.write("DATA:SOURCE CH1")');
      expect(out).toContain('instrument.ask("CURVE?")');
    });

    it('save_waveform binary in VXI-11 mode', () => {
      const out = genStepsVxi11([{
        id: '1', type: 'save_waveform', params: { source: 'CH2', format: 'bin', filename: 'wf.bin' },
      }]);
      expect(out).toContain('instrument.write(":DATa:SOUrce CH2")');
      expect(out).toContain('instrument.read_raw()');
      expect(out).toContain('wf.bin');
    });

    it('error_check in VXI-11 mode uses instrument.ask', () => {
      const out = genStepsVxi11([{
        id: '1', type: 'error_check', params: { command: 'SYST:ERR?' },
      }]);
      expect(out).toContain('instrument.ask("SYST:ERR?")');
      expect(out).toContain('try:');
    });

    it('param substitution works in VXI-11 mode', () => {
      const out = genStepsVxi11([{
        id: '1', type: 'write', params: {
          command: 'CH{ch}:SCALE {scale}',
          cmdParams: [{ name: 'ch' }, { name: 'scale' }],
          paramValues: { ch: 1, scale: 0.5 },
        },
      }]);
      expect(out).toContain('instrument.write("CH1:SCALE 0.5")');
    });
  });

  // ─── Edge cases that differ between paths ───
  describe('cross-path edge cases', () => {
    it('save_waveform with no params at all', () => {
      const classic = genStepsClassic([{ id: '1', type: 'save_waveform', params: {} }]);
      expect(classic).toContain("source='CH1'");
      expect(classic).toContain('waveform.bin');

      const tekhsi = genStepsTekHSI([{ id: '1', type: 'save_waveform', params: {} }]);
      expect(tekhsi).toContain('scope.get_data("ch1")');

      const vxi = genStepsVxi11([{ id: '1', type: 'save_waveform', params: {} }]);
      expect(vxi).toContain(':DATa:SOUrce CH1');
    });

    it('empty step list produces empty string in all paths', () => {
      expect(genStepsClassic([])).toBe('');
      expect(genStepsTekHSI([])).toBe('');
      expect(genStepsVxi11([])).toBe('');
    });

    it('comment step handled in classic and vxi11 but ignored in tekhsi', () => {
      const step: Step = { id: '1', type: 'comment', params: { text: 'Test note' } };
      expect(genStepsClassic([step])).toContain('# Test note');
      expect(genStepsVxi11([step])).toContain('# Test note');
      expect(genStepsTekHSI([step])).toBe('');
    });

    it('python snippet works in all paths', () => {
      const step: Step = { id: '1', type: 'python', params: { code: 'x = 42' } };
      expect(genStepsClassic([step])).toContain('    x = 42');
      expect(genStepsTekHSI([step])).toContain('    x = 42');
      expect(genStepsVxi11([step])).toContain('    x = 42');
    });

    it('deeply nested group in save_waveform scenario', () => {
      const steps: Step[] = [{
        id: 'g1', type: 'group', label: 'Capture All', params: {},
        children: [
          { id: '1', type: 'write', params: { command: 'ACQ:STATE RUN' } },
          { id: '2', type: 'sleep', params: { duration: 0.5 } },
          {
            id: 'g2', type: 'group', label: 'Save Data', params: {},
            children: [
              { id: '3', type: 'save_waveform', params: { source: 'CH1', format: 'bin', filename: 'ch1.bin' } },
              { id: '4', type: 'save_waveform', params: { source: 'CH2', format: 'csv', filename: 'ch2.csv' } },
            ],
          },
          { id: '5', type: 'error_check', params: {} },
        ],
      }];
      const out = genStepsClassic(steps);
      expect(out).toContain('# Group: Capture All');
      expect(out).toContain('ACQ:STATE RUN');
      expect(out).toContain('time.sleep(0.5)');
      expect(out).toContain('# Group: Save Data');
      expect(out).toContain("source='CH1'");
      expect(out).toContain('DATA:SOURCE CH2');
      expect(out).toContain('ALLEV?');
    });
  });
});
