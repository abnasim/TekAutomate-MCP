/**
 * Extracted generator logic from App.tsx.
 *
 * This is the REAL code that produces the Python users actually export.
 * App.tsx should import and call these functions. Tests import them directly.
 *
 * Each genSteps* function mirrors the corresponding closure in App.tsx but
 * accepts dependencies as parameters instead of capturing from React state.
 */

// ─── Types (mirrored from App.tsx) ───

export type Backend = 'pyvisa' | 'tm_devices' | 'vxi11' | 'tekhsi' | 'hybrid';
export type ConnectionType = 'tcpip' | 'socket' | 'usb' | 'gpib';

export interface CommandParam {
  name: string;
  type: string;
  default?: any;
  required?: boolean;
  options?: string[];
  description?: string;
}

export interface Step {
  id: string;
  type: string;
  label: string;
  params: Record<string, any>;
  children?: Step[];
  category?: string;
  boundDeviceId?: string;
}

export interface ExportOpts {
  scriptName: string;
  waveformFormat: 'bin' | 'wfm' | 'csv';
  waveformFilename: string;
  saveCsv: boolean;
  csvName: string;
  enablePerformanceOptimization: boolean;
  exportMeasurements: boolean;
  measurementsFilename: string;
}

export interface GeneratorContext {
  enablePrintMessages: boolean;
  xopt: ExportOpts;
}

export const DEFAULT_XOPT: ExportOpts = {
  scriptName: 'tek_automation.py',
  waveformFormat: 'bin',
  waveformFilename: 'waveform.bin',
  saveCsv: true,
  csvName: 'tek_log.csv',
  enablePerformanceOptimization: false,
  exportMeasurements: false,
  measurementsFilename: 'measurements.csv',
};

export const DEFAULT_CONTEXT: GeneratorContext = {
  enablePrintMessages: false,
  xopt: DEFAULT_XOPT,
};

// ─── Shared helpers ───

export function substituteSCPI(
  scpi: string,
  paramDefs: CommandParam[] = [],
  paramValues: Record<string, any> = {}
): string {
  if (!scpi) return scpi;
  let result = scpi;
  const getParamValue = (name: string) =>
    paramValues[name] ??
    paramValues[name.toLowerCase()] ??
    paramValues[name.charAt(0).toLowerCase() + name.slice(1)];

  paramDefs.forEach((p) => {
    const value = getParamValue(p.name) ?? p.default ?? '';
    if (value !== '' && value !== null && value !== undefined) {
      result = result.replace(new RegExp(`\\{${p.name}\\}`, 'g'), String(value));
    }
  });

  // Resolve inline header choices like TRIGger:{A|B|B:RESET}
  const choicePattern = /\{([^}]+)\}/g;
  result = result.replace(choicePattern, (match, choices, offset, fullString) => {
    const firstSpace = fullString.indexOf(' ');
    const isInHeader = firstSpace === -1 || offset < firstSpace;
    if (!isInHeader) return match;

    const options = String(choices).split('|').map((opt) => opt.trim()).filter(Boolean);
    if (options.length <= 1) return match;
    const candidates: string[] = [];
    ['trigger_type', 'trigger', 'trig', 'value', 'Value', 'source', 'channel', 'math', 'reference', 'ref', 'bus', 'measurement']
      .forEach((k) => {
        const v = paramValues[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') candidates.push(String(v));
      });
    paramDefs.forEach((p) => {
      if (!p.options || p.options.length !== options.length) return;
      const pSet = [...p.options].map((o) => o.toLowerCase()).sort().join('|');
      const oSet = [...options].map((o) => o.toLowerCase()).sort().join('|');
      if (pSet !== oSet) return;
      const v = getParamValue(p.name) ?? p.default;
      if (v !== undefined && v !== null && String(v).trim() !== '') candidates.unshift(String(v));
    });

    const tryResolve = (option: string, candidate: string): string | null => {
      if (option.toLowerCase() === candidate.toLowerCase()) return option;
      if (!option.includes('<x>')) return null;
      const prefix = option.split('<x>')[0] || '';
      if (candidate.toUpperCase().startsWith(prefix.toUpperCase())) {
        const num = candidate.match(/\d+/)?.[0] || '1';
        return option.replace(/<x>/gi, num);
      }
      if (/^\d+$/.test(candidate)) return option.replace(/<x>/gi, candidate);
      return null;
    };

    for (const candidate of candidates) {
      for (const option of options) {
        const resolved = tryResolve(option, candidate);
        if (resolved) return resolved;
      }
    }

    const first = options[0] || '';
    if (first.includes('<x>')) {
      const num =
        String(paramValues['x'] ?? '').match(/\d+/)?.[0] ||
        String(paramValues['channel'] ?? '').match(/\d+/)?.[0] ||
        String(paramValues['source'] ?? '').match(/\d+/)?.[0] ||
        '1';
      return first.replace(/<x>/gi, num);
    }
    return first;
  });

  // Resolve remaining <x> placeholders in mnemonics using common index params.
  result = result.replace(/([A-Z]+)<x>([_A-Z0-9]*)/gi, (full, prefix, suffix) => {
    const key = String(prefix || '').toLowerCase();
    const value =
      paramValues[key] ??
      paramValues['x'] ??
      paramValues['channel'] ??
      paramValues['bus'] ??
      paramValues['measurement'] ??
      paramValues['math'] ??
      paramValues['reference'] ??
      paramValues['source'];
    const num = String(value ?? '').match(/\d+/)?.[0] || '1';
    return `${prefix}${num}${suffix || ''}`;
  });

  return result;
}

export function formatPythonSnippet(code: string, indent: string): string {
  if (!code) return '';
  const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line: string) => indent + line)
    .join('\n') + '\n';
}

// ─── genStepsClassic: PyVISA / tm_devices classic path ───

export function genStepsClassic(
  items: Step[],
  ctx: GeneratorContext = DEFAULT_CONTEXT,
  ind = '    ',
  sweepContext?: { varName: string; value: string }
): string {
  let out = '';
  let hasStateRun = false;
  const subst = (cmd: string, defs: CommandParam[] = [], vals: Record<string, any> = {}) =>
    substituteSCPI(cmd, defs, vals);

  for (const s of items) {
    if (s.type === 'group') {
      out += `${ind}# Group: ${s.label}\n`;
      if (s.children) out += genStepsClassic(s.children, ctx, ind, sweepContext);
      continue;
    }
    if (s.type === 'sleep') {
      if (ctx.enablePrintMessages) out += `${ind}print("Sleeping for ${s.params.duration}s")\n`;
      out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`;
      continue;
    }
    if (s.type === 'comment') {
      const commentText = s.params.text || s.label || '';
      out += `${ind}# ${commentText}\n`;
      continue;
    }
    if (s.type === 'python' && typeof s.params?.code === 'string') {
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Executing Python code'}")\n`;
      out += formatPythonSnippet(s.params.code, ind);
      continue;
    }
    if (s.type === 'save_waveform') {
      const source = (s.params.source || 'CH1').toUpperCase();
      const fn = s.params.filename || ctx.xopt.waveformFilename;
      const format = s.params.format || ctx.xopt.waveformFormat;
      const width = s.params.width || 1;
      const encoding = s.params.encoding || 'RIBinary';
      const start = s.params.start || 1;
      const stop = s.params.stop || 'None';
      const cmd = s.params.command || 'CURVe?';

      if (ctx.enablePrintMessages) {
        out += `${ind}print("Saving waveform from ${source} to ${fn}")\n`;
      }
      if (format === 'wfm') {
        const wfmPath = fn.replace(/\//g, '\\');
        out += `${ind}scpi.write("SAVe:WAVEform ${source},'C:\\\\${wfmPath}'")\n`;
        out += `${ind}scpi.query("*OPC?")\n`;
        out += `${ind}scpi.write(f"FILESystem:READFile 'C:\\\\${wfmPath}'")\n`;
        out += `${ind}data = scpi.read_raw()\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
        out += `${ind}log_cmd('FILESystem:READFile', data)\n`;
        out += `${ind}print(f"  Saved .wfm file: {len(data):,} bytes")\n`;
      } else if (format === 'csv') {
        out += `${ind}# Configure data source\n`;
        out += `${ind}scpi.write("DATA:SOURCE ${source}")\n`;
        out += `${ind}scpi.write("DATA:ENCDG ASCII")\n`;
        out += `${ind}# Get waveform scaling parameters\n`;
        out += `${ind}x_incr = float(scpi.query("WFMOUTPRE:XINCR?").strip())\n`;
        out += `${ind}x_zero = float(scpi.query("WFMOUTPRE:XZERO?").strip())\n`;
        out += `${ind}y_mult = float(scpi.query("WFMOUTPRE:YMULT?").strip())\n`;
        out += `${ind}y_off = float(scpi.query("WFMOUTPRE:YOFF?").strip())\n`;
        out += `${ind}y_zero = float(scpi.query("WFMOUTPRE:YZERO?").strip())\n`;
        out += `${ind}# Get raw waveform data\n`;
        out += `${ind}raw_data = scpi.query("CURVE?").strip()\n`;
        out += `${ind}raw_values = [int(v) for v in raw_data.split(',') if v.strip()]\n`;
        out += `${ind}# Write scaled CSV with proper headers\n`;
        out += `${ind}with open(${JSON.stringify(fn)}, 'w') as f:\n`;
        out += `${ind}    f.write('Time (s),Amplitude (V)\\n')\n`;
        out += `${ind}    for i, raw_val in enumerate(raw_values):\n`;
        out += `${ind}        time_val = x_zero + i * x_incr\n`;
        out += `${ind}        amplitude = (raw_val - y_off) * y_mult + y_zero\n`;
        out += `${ind}        f.write(f'{time_val:.9e},{amplitude:.6e}\\n')\n`;
        out += `${ind}log_cmd('CURVE?', f'{len(raw_values)} points')\n`;
        out += `${ind}print(f"  Saved CSV: {len(raw_values):,} points to ${fn}")\n`;
      } else {
        if (cmd.includes('FILESYSTEM:READFILE')) {
          out += `${ind}scpi.write(${JSON.stringify(cmd)})\n${ind}data = scpi.read_raw()\n${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
        } else if (cmd === 'CURVe?' || cmd.startsWith('CURV') || !cmd) {
          out += `${ind}# Read waveform from ${source} as binary\n`;
          out += `${ind}preamble, data = read_waveform_binary(scpi, source='${source}', start=${start}, stop=${stop}, width=${width}, encoding='${encoding}')\n`;
          out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
          out += `${ind}log_cmd('CURVe?', data)\n`;
          out += `${ind}print(f"  Waveform: {len(data):,} bytes, {preamble.get('num_points', 0):,} points")\n`;
        } else {
          out += `${ind}scpi.write(${JSON.stringify(cmd)})\n${ind}data = scpi.query_binary_values('', datatype='B', container=bytes)\n${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n${ind}log_cmd(${JSON.stringify(cmd)}, data)\n`;
        }
      }
      continue;
    }
    if (s.type === 'save_screenshot') {
      const fn = s.params.filename || 'screenshot.png';
      const method = s.params.method || 'pc_transfer';
      if (ctx.enablePrintMessages) out += `${ind}print("Saving screenshot to ${fn}")\n`;
      if (method === 'pc_transfer') {
        out += `${ind}scpi.write('SAVE:IMAGE "C:/Temp/screen.png"')\n`;
        out += `${ind}if str(scpi.query("*OPC?")).strip() != '1':\n`;
        out += `${ind}    raise RuntimeError('SAVE:IMAGE did not complete')\n`;
        out += `${ind}_old_timeout = scpi.timeout\n`;
        out += `${ind}try:\n`;
        out += `${ind}    scpi.timeout = 30000\n`;
        out += `${ind}    scpi.write('FILESYSTEM:READFILE "C:/Temp/screen.png"')\n`;
        out += `${ind}    data = scpi.read_raw()\n`;
        out += `${ind}finally:\n`;
        out += `${ind}    scpi.timeout = _old_timeout\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
        out += `${ind}scpi.write('FILESYSTEM:DELETE "C:/Temp/screen.png"')\n`;
        out += `${ind}scpi.query("*OPC?")\n`;
      } else {
        out += `${ind}scpi.write('SAVE:IMAGE "${fn}"')\n`;
        out += `${ind}scpi.query("*OPC?")\n`;
      }
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
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
      out += `${ind}scpi.write(${JSON.stringify(writeCmd)})\n`;
      out += `${ind}${varName} = scpi.query(${JSON.stringify(queryCmd)}).strip()\n`;
      out += `${ind}log_cmd(${JSON.stringify(queryCmd)}, ${varName})\n`;
      out += `${ind}print(f"  ${queryCmd}: {${varName}}")\n`;
      continue;
    }
    if (s.type !== 'query' && s.type !== 'write') continue;

    let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
    const isTmDevicesCommand = cmd.includes('.commands.') || cmd.includes('.add_') || cmd.includes('.save_') ||
      cmd.includes('.turn_') || cmd.includes('.set_and_check') || cmd.includes('.get_');
    const useTek = cmd.startsWith('TEKEXP:');
    const devVar = useTek ? 'tek' : 'scpi';

    if (s.type === 'query') {
      const varName = s.params.saveAs || 'result';
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Querying'}")\n`;
      if (cmd === '*OPC?') {
        out += `${ind}${devVar}.query("*OPC?")  # wait for operation to complete\n`;
      } else if (isTmDevicesCommand) {
        out += `${ind}${varName} = ${cmd}\n${ind}print(f"  ${varName}: {${varName}}")\n`;
      } else {
        out += `${ind}${varName} = ${devVar}.query(${JSON.stringify(cmd)}).strip()\n`;
        out += `${ind}log_cmd(${JSON.stringify(cmd)}, ${varName})\n`;
        out += `${ind}print(f"  ${cmd}: {${varName}}")\n`;
      }
      if (cmd === 'TEKEXP:STATE?' && hasStateRun) {
        out += `${ind}while ${devVar}.query("TEKEXP:STATE?").strip('"') != 'READY':\n${ind}    state = ${devVar}.query("TEKEXP:STATE?").strip('"')\n${ind}    if state == 'RUNNING':\n${ind}        time.sleep(2)\n`;
      }
    } else {
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Sending command'}")\n`;
      if (isTmDevicesCommand) {
        out += `${ind}${cmd}\n`;
      } else {
        out += `${ind}${devVar}.write(${JSON.stringify(cmd)})\n`;
      }
      if (cmd === 'TEKEXP:STATE RUN') hasStateRun = true;
    }
  }
  return out;
}

// ─── genStepsTekHSI ───

export function genStepsTekHSI(
  items: Step[],
  ctx: GeneratorContext = DEFAULT_CONTEXT,
  ind = '    '
): string {
  let out = '';
  const subst = (cmd: string, defs: CommandParam[] = [], vals: Record<string, any> = {}) =>
    substituteSCPI(cmd, defs, vals);

  for (const s of items) {
    if (s.type === 'group') {
      out += `${ind}# Group: ${s.label}\n`;
      if (s.children) out += genStepsTekHSI(s.children, ctx, ind);
      continue;
    }
    if (s.type === 'sleep') {
      if (ctx.enablePrintMessages) out += `${ind}print("Sleeping for ${s.params.duration}s")\n`;
      out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`;
      continue;
    }
    if (s.type === 'save_waveform') {
      const src = s.params.source || 'ch1';
      const fn = s.params.filename || 'waveform.csv';
      if (ctx.enablePrintMessages) out += `${ind}print("Saving waveform from ${src} to ${fn}")\n`;
      out += `${ind}with scope.access_data():\n${ind}    wfm = scope.get_data("${src}")\n`;
      out += `${ind}from tm_data_types import write_file\n${ind}write_file("${fn}", wfm)\n`;
      continue;
    }
    if (s.type === 'python' && typeof s.params?.code === 'string') {
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Executing Python code'}")\n`;
      out += formatPythonSnippet(s.params.code, ind);
      continue;
    }
    if (s.type === 'set_and_query') {
      let raw = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
      const queryCmd = cmdHeader + '?';
      const paramValues = s.params.paramValues || {};
      const valueParam = paramValues['value'] || paramValues['Value'] || '';
      let writeCmd = raw.replace(/\?$/, '');
      if (writeCmd === cmdHeader && valueParam) writeCmd = `${cmdHeader} ${valueParam}`;
      const varName = s.params.saveAs || 'result';
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
      out += `${ind}scope.commands.write("${writeCmd}")\n`;
      out += `${ind}${varName} = scope.commands.query("${queryCmd}")\n`;
      continue;
    }
    if (s.type !== 'query' && s.type !== 'write') continue;

    let raw = subst(s.params.command || '', s.params.cmdParams || [], s.params.paramValues || {});
    const line = raw.startsWith('#') ? raw.slice(1).trim() : raw;
    if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Executing TekHSI command'}")\n`;
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

export function genStepsVxi11(
  items: Step[],
  ctx: GeneratorContext = DEFAULT_CONTEXT,
  ind = '    '
): string {
  let out = '';
  const subst = (cmd: string, defs: CommandParam[] = [], vals: Record<string, any> = {}) =>
    substituteSCPI(cmd, defs, vals);

  for (const s of items) {
    if (s.type === 'group' && s.children) {
      out += `${ind}# Group: ${s.label || 'Group'}\n`;
      out += genStepsVxi11(s.children, ctx, ind);
      continue;
    }
    if (s.type === 'sleep') {
      out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`;
      continue;
    }
    if (s.type === 'comment') {
      out += `${ind}# ${s.params.text || ''}\n`;
      continue;
    }
    if (s.type === 'python' && typeof s.params?.code === 'string') {
      out += formatPythonSnippet(s.params.code, ind);
      continue;
    }
    if (s.type === 'save_waveform') {
      const source = (s.params.source || 'CH1').toUpperCase();
      const fn = s.params.filename || ctx.xopt.waveformFilename;
      const format = s.params.format || ctx.xopt.waveformFormat;
      if (format === 'wfm') {
        const wfmPath = fn.replace(/\//g, '\\');
        out += `${ind}instrument.write(f"SAVe:WAVEform ${source},'C:\\\\${wfmPath}'")\n`;
        out += `${ind}instrument.ask("*OPC?")\n`;
        out += `${ind}instrument.write(f"FILESystem:READFile 'C:\\\\${wfmPath}'")\n`;
        out += `${ind}data = instrument.read_raw()\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
      } else if (format === 'csv') {
        out += `${ind}instrument.write("DATA:SOURCE ${source}")\n`;
        out += `${ind}instrument.write("DATA:ENCDG ASCII")\n`;
        out += `${ind}x_incr = float(instrument.ask("WFMOUTPRE:XINCR?"))\n`;
        out += `${ind}raw_data = instrument.ask("CURVE?").strip()\n`;
        out += `${ind}raw_values = [int(v) for v in raw_data.split(',') if v.strip()]\n`;
      } else {
        out += `${ind}instrument.write(":DATa:SOUrce ${source}")\n`;
        out += `${ind}instrument.write(":WAVeform:FORMat RIBinary")\n`;
        out += `${ind}instrument.write(":WAVeform:DATA?")\n`;
        out += `${ind}data = instrument.read_raw()\n`;
        out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
      }
      continue;
    }
    if (s.type === 'error_check') {
      const errCmd = s.params.command || 'ALLEV?';
      out += `${ind}try:\n${ind}    err = instrument.ask("${errCmd}")\n${ind}    log_cmd("${errCmd}", err)\n${ind}except Exception: pass\n`;
      continue;
    }
    if (s.type === 'set_and_query') {
      let raw = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
      const queryCmd = cmdHeader + '?';
      const paramValues = s.params.paramValues || {};
      const valueParam = paramValues['value'] || paramValues['Value'] || '';
      let writeCmd = raw.replace(/\?$/, '');
      if (writeCmd === cmdHeader && valueParam) writeCmd = `${cmdHeader} ${valueParam}`;
      const varName = s.params.saveAs || 'result';
      if (ctx.enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
      out += `${ind}instrument.write(${JSON.stringify(writeCmd)})\n`;
      out += `${ind}${varName} = instrument.ask(${JSON.stringify(queryCmd)})\n`;
      out += `${ind}log_cmd(${JSON.stringify(queryCmd)}, ${varName})\n`;
      continue;
    }
    if (s.type === 'query') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      out += `${ind}resp = instrument.ask(${JSON.stringify(cmd)})\n`;
      if (s.params.saveAs) out += `${ind}${s.params.saveAs} = resp\n`;
      out += `${ind}log_cmd(${JSON.stringify(cmd)}, resp)\n`;
    } else if (s.type === 'write') {
      let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
      out += `${ind}instrument.write(${JSON.stringify(cmd)})\n`;
      out += `${ind}log_cmd(${JSON.stringify(cmd)}, "")\n`;
    }
  }
  return out;
}
