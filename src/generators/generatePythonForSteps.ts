import { formatPythonSnippet, substituteSCPI, type CommandParam } from './appGenerator';

type Backend = 'pyvisa' | 'tm_devices' | 'vxi11' | 'tekhsi' | 'hybrid' | 'socket';
type ConnectionType = 'tcpip' | 'socket' | 'usb' | 'gpib';

export interface DeviceEntry {
  id: string;
  alias?: string;
  backend?: Backend;
  connectionType?: ConnectionType;
  host?: string;
  port?: number;
  enabled?: boolean;
}

export interface StepLike {
  id: string;
  type: string;
  label?: string;
  params?: Record<string, any>;
  children?: StepLike[];
}

function pyResourceForDevice(d: DeviceEntry): string {
  const connectionType = d.connectionType || 'tcpip';
  const host = d.host || '127.0.0.1';
  if (connectionType === 'socket') {
    return `TCPIP::${host}::${d.port || 5025}::SOCKET`;
  }
  if (connectionType === 'usb') {
    return 'USB0::0x0699::0x0000::INSTR';
  }
  if (connectionType === 'gpib') {
    return 'GPIB0::1::INSTR';
  }
  return `TCPIP::${host}::INSTR`;
}

function normalizeSteps(steps: StepLike[]): StepLike[] {
  return steps.map((s) => {
    const step: StepLike = {
      ...s,
      params: s.params || {},
      children: s.children ? normalizeSteps(s.children) : undefined,
    };
    if (step.type === 'tm_device_command') {
      const code = String(step.params?.code || '').trim();
      return {
        ...step,
        type: 'write',
        params: { command: code },
      };
    }
    return step;
  });
}

function decodeEscapedNewlinesOutsideQuotes(code: string): string {
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const prev = i > 0 ? code[i - 1] : '';
    const next = i + 1 < code.length ? code[i + 1] : '';

    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === '\\' && next === 'n') {
      out += '\n';
      i += 1;
      continue;
    }

    out += ch;
  }
  return out;
}

interface EmitContext {
  mode: 'pyvisa' | 'tm_devices' | 'vxi11' | 'socket';
  isRawSocket?: boolean;
  host?: string;
  port?: number;
}

function emitSteps(
  steps: StepLike[],
  modeOrCtx: 'pyvisa' | 'tm_devices' | 'vxi11' | 'socket' | EmitContext,
  indent = '    '
): string {
  const ctx: EmitContext = typeof modeOrCtx === 'string' ? { mode: modeOrCtx } : modeOrCtx;
  const { mode, isRawSocket = false, host = '127.0.0.1', port = 4000 } = ctx;
  const isPureSocket = mode === 'socket';
  let out = '';
  const scpiVar = mode === 'vxi11' ? 'instrument' : mode === 'tm_devices' ? 'visa' : 'scpi';

  for (const s of steps) {
    const params = s.params || {};

    if (s.type === 'connect' || s.type === 'disconnect') continue;
    if (s.type === 'group') {
      out += `${indent}# Group: ${s.label || 'Group'}\n`;
      if (s.children?.length) out += emitSteps(s.children, ctx, indent);
      continue;
    }
    if (s.type === 'comment') {
      out += `${indent}# ${params.text || s.label || ''}\n`;
      continue;
    }
    if (s.type === 'sleep') {
      out += `${indent}time.sleep(${Number(params.duration) || 0})\n`;
      continue;
    }
    if (s.type === 'python' && typeof params.code === 'string') {
      out += formatPythonSnippet(
        decodeEscapedNewlinesOutsideQuotes(
          String(params.code)
            .replace(/\\r\\n/g, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
        ),
        indent
      );
      continue;
    }
    if (s.type === 'sweep') {
      const varName = String(params.variableName || 'x');
      const start = Number(params.start ?? 0);
      const stop = Number(params.stop ?? 0);
      const step = Number(params.step ?? 1);
      out += `${indent}${varName} = ${start}\n`;
      out += `${indent}while ${varName} <= ${stop}:\n`;
      if (s.children?.length) out += emitSteps(s.children, ctx, `${indent}    `);
      out += `${indent}    ${varName} += ${step}\n`;
      continue;
    }
    if (s.type === 'save_screenshot') {
      const filename = String(params.filename || 'screenshot.png');
      const scopeType = String(params.scopeType || 'modern').toLowerCase();
      out += `${indent}import os\n`;
      out += `${indent}os.makedirs('./screenshots', exist_ok=True)\n`;
      if (isPureSocket) {
        // Pure socket backend — SocketInstr handles the full screenshot flow
        out += `${indent}# Pure socket screenshot via SocketInstr.fetch_screen()\n`;
        out += `${indent}_img_data = ${scpiVar}.fetch_screen("C:/Temp/screenshot.png")\n`;
        out += `${indent}pathlib.Path(${JSON.stringify('./screenshots/' + filename)}).write_bytes(_img_data)\n`;
        out += `${indent}print(f"  Screenshot saved: ./screenshots/${filename} ({len(_img_data):,} bytes)")\n`;
      } else if (isRawSocket) {
        // PyVISA socket connection: trigger SAVE:IMAGE via pyvisa, then use SocketInstr to read binary
        out += `${indent}${scpiVar}.write('SAVE:IMAGE:COMPOSITION NORMAL')\n`;
        out += `${indent}${scpiVar}.write('SAVE:IMAGE "C:/Temp/screenshot.png"')\n`;
        out += `${indent}${scpiVar}.query('*OPC?')\n`;
        out += `${indent}${scpiVar}.close()  # release TCP port for SocketInstr\n`;
        out += `${indent}_sock = SocketInstr(${JSON.stringify(host)}, ${port})\n`;
        out += `${indent}_img_data = _sock.fetch_screen("C:/Temp/screenshot.png")\n`;
        out += `${indent}_sock.close()\n`;
        out += `${indent}${scpiVar} = rm.open_resource(${JSON.stringify(`TCPIP::${host}::${port}::SOCKET`)})\n`;
        out += `${indent}pathlib.Path(${JSON.stringify('./screenshots/' + filename)}).write_bytes(_img_data)\n`;
        out += `${indent}print(f"  Screenshot saved: ./screenshots/${filename} ({len(_img_data):,} bytes)")\n`;
      } else if (scopeType === 'legacy') {
        out += `${indent}${scpiVar}.write('HARDCopy:PORT FILE')\n`;
        out += `${indent}${scpiVar}.write('HARDCopy STARt')\n`;
      } else {
        out += `${indent}${scpiVar}.write('SAVE:IMAGE:COMPOSITION NORMAL')\n`;
        out += `${indent}${scpiVar}.write('SAVE:IMAGE "C:/Temp/screenshot.png"')\n`;
        out += `${indent}if str(${scpiVar}.query('*OPC?')).strip() != '1': raise RuntimeError('SAVE:IMAGE did not complete')\n`;
        out += `${indent}_old_timeout = ${scpiVar}.timeout\n`;
        out += `${indent}_old_rterm = ${scpiVar}.read_termination\n`;
        out += `${indent}try:\n`;
        out += `${indent}    ${scpiVar}.timeout = 30000\n`;
        out += `${indent}    ${scpiVar}.read_termination = None\n`;
        out += `${indent}    data = ${scpiVar}.query_binary_values('FILESYSTEM:READFILE "C:/Temp/screenshot.png"', datatype='B', container=bytes)\n`;
        out += `${indent}finally:\n`;
        out += `${indent}    ${scpiVar}.timeout = _old_timeout\n`;
        out += `${indent}    ${scpiVar}.read_termination = _old_rterm\n`;
        out += `${indent}pathlib.Path(${JSON.stringify('./screenshots/' + filename)}).write_bytes(data)\n`;
        out += `${indent}${scpiVar}.write('FILESYSTEM:DELETE "C:/Temp/screenshot.png"')\n`;
        out += `${indent}${scpiVar}.query('*OPC?')\n`;
        out += `${indent}print(f"  Screenshot saved: ./screenshots/${filename}")\n`;
      }
      continue;
    }
    if (s.type === 'save_waveform') {
      const source = String(params.source || 'CH1').toUpperCase();
      const filename = String(params.filename || 'waveform.bin');
      out += `${indent}${scpiVar}.write("DATA:SOURCE ${source}")\n`;
      out += `${indent}${scpiVar}.write("DATA:ENCDG RIBinary")\n`;
      out += `${indent}${scpiVar}.write("CURVE?")\n`;
      if (isPureSocket) {
        out += `${indent}data = ${scpiVar}.read_bin_wave()\n`;
      } else {
        out += `${indent}data = ${scpiVar}.read_raw()\n`;
      }
      out += `${indent}pathlib.Path(${JSON.stringify(filename)}).write_bytes(data)\n`;
      continue;
    }
    if (s.type === 'recall') {
      const recallType = String(params.recallType || 'SESSION').toUpperCase();
      const filePath = String(params.filePath || '');
      if (recallType === 'FACTORY') {
        out += `${indent}${scpiVar}.write('*RST')\n`;
      } else {
        out += `${indent}${scpiVar}.write(${JSON.stringify(`RECALL:${recallType} "${filePath}"`)})\n`;
      }
      continue;
    }
    if (s.type === 'error_check') {
      const cmd = String(params.command || 'ALLEV?');
      out += `${indent}try:\n`;
      out += `${indent}    err = ${scpiVar}.query(${JSON.stringify(cmd)}).strip()\n`;
      out += `${indent}    log_cmd(${JSON.stringify(cmd)}, err)\n`;
      out += `${indent}except Exception:\n`;
      out += `${indent}    pass\n`;
      continue;
    }
    if (s.type === 'set_and_query') {
      const raw = substituteSCPI(
        String(params.command || ''),
        (params.cmdParams || []) as CommandParam[],
        params.paramValues || {}
      );
      const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
      const queryCmd = `${cmdHeader}?`;
      const valueParam = (params.paramValues || {}).value || (params.paramValues || {}).Value;
      const writeCmd = /\s/.test(raw) ? raw : valueParam ? `${cmdHeader} ${valueParam}` : raw;
      const varName = String(params.saveAs || 'result');
      out += `${indent}${scpiVar}.write(${JSON.stringify(writeCmd)})\n`;
      out += `${indent}${varName} = ${scpiVar}.query(${JSON.stringify(queryCmd)}).strip()\n`;
      continue;
    }
    if (s.type === 'query') {
      const cmd = substituteSCPI(
        String(params.command || ''),
        (params.cmdParams || []) as CommandParam[],
        params.paramValues || {}
      );
      const varName = String(params.saveAs || 'result');
      out += `${indent}${varName} = ${scpiVar}.query(${JSON.stringify(cmd)}).strip()\n`;
      continue;
    }
    if (s.type === 'write') {
      const cmd = substituteSCPI(
        String(params.command || ''),
        (params.cmdParams || []) as CommandParam[],
        params.paramValues || {}
      );
      if (mode === 'tm_devices' && (cmd.includes('.commands.') || cmd.includes('.add_') || cmd.includes('.save_'))) {
        out += `${indent}${cmd}\n`;
      } else if (mode === 'tm_devices') {
        out += `${indent}${scpiVar}.write(${JSON.stringify(cmd)})\n`;
      } else {
        out += `${indent}${scpiVar}.write(${JSON.stringify(cmd)})\n`;
      }
      continue;
    }
  }

  return out;
}

export function generatePythonForSteps(stepsInput: unknown[], devicesInput: unknown[]): string {
  const steps = normalizeSteps((stepsInput || []) as StepLike[]);
  const devices = ((devicesInput || []) as DeviceEntry[]).filter((d) => d && d.enabled !== false);
  const primary = devices[0] || { id: 'dev1', alias: 'scope', backend: 'pyvisa', host: '127.0.0.1' };
  const backend = (primary.backend || 'pyvisa') as Backend;
  const hasTekExp = JSON.stringify(steps).toUpperCase().includes('TEKEXP:');

  const header = `#!/usr/bin/env python3\nimport time\nimport pathlib\n`;

  if (backend === 'tm_devices') {
    const host = primary.host || '127.0.0.1';
    const alias = primary.alias || 'scope';
    const body = emitSteps(steps, 'tm_devices', '        ');
    return (
      header +
      `from tm_devices import DeviceManager\n\n` +
      `def log_cmd(cmd, resp):\n    pass\n\n` +
      `def main():\n` +
      `    with DeviceManager(verbose=False) as dm:\n` +
      `        ${alias} = dm.add_scope("${host}")\n` +
      `        visa = ${alias}.visa_resource\n` +
      body +
      `        ${alias}.close()\n\n` +
      `if __name__ == "__main__":\n    main()\n`
    );
  }

  if (backend === 'vxi11') {
    const host = primary.host || '127.0.0.1';
    const body = emitSteps(steps, 'vxi11');
    return (
      header +
      `import vxi11\n\n` +
      `def log_cmd(cmd, resp):\n    pass\n\n` +
      `def main():\n` +
      `    instrument = vxi11.Instrument("${host}")\n` +
      body +
      `    instrument.close()\n\n` +
      `if __name__ == "__main__":\n    main()\n`
    );
  }

  // Pure socket backend
  if (backend === 'socket') {
    const socketHost = primary.host || '127.0.0.1';
    const socketPort = primary.port || 4000;
    const body = emitSteps(steps, { mode: 'socket', host: socketHost, port: socketPort });
    return (
      header +
      `import socket, re, sys\nfrom socket_instr import SocketInstr\n` +
      `\n` +
      `def log_cmd(cmd, resp):\n    pass\n\n` +
      `def main():\n` +
      `    scpi = SocketInstr(${JSON.stringify(socketHost)}, ${socketPort})\n` +
      body +
      `    scpi.close()\n` +
      `\nif __name__ == "__main__":\n    main()\n`
    );
  }

  const isRawSocket = (primary.connectionType || '') === 'socket';
  const socketHost = primary.host || '127.0.0.1';
  const socketPort = primary.port || 4000;

  const body = emitSteps(steps, {
    mode: 'pyvisa',
    isRawSocket,
    host: socketHost,
    port: socketPort,
  });

  // PyVISA path (used for all connection types including socket)
  const pyImports = `import pyvisa\n` + (isRawSocket ? `from socket_instr import SocketInstr\n` : '');
  let connectionBlock = `    rm = pyvisa.ResourceManager()\n`;
  const aliases = devices.length ? devices : [primary];
  aliases.forEach((d, idx) => {
    const alias = (d.alias || `scope${idx + 1}`).replace(/[^A-Za-z0-9_]/g, '_');
    const resource = pyResourceForDevice(d);
    connectionBlock += `    ${alias} = rm.open_resource(${JSON.stringify(resource)})\n`;
  });
  const mainAlias = (aliases[0].alias || 'scope').replace(/[^A-Za-z0-9_]/g, '_');
  connectionBlock += `    scpi = ${mainAlias}\n`;
  if (hasTekExp) {
    connectionBlock += `    tek = rm.open_resource("TCPIP0::${primary.host || '127.0.0.1'}::5000::SOCKET")\n`;
  }
  let closeBlock = '';
  aliases.forEach((d, idx) => {
    const alias = (d.alias || `scope${idx + 1}`).replace(/[^A-Za-z0-9_]/g, '_');
    closeBlock += `    ${alias}.close()\n`;
  });
  if (hasTekExp) closeBlock += `    tek.close()\n`;
  closeBlock += `    rm.close()\n`;

  return (
    header +
    pyImports +
    `\n` +
    `def log_cmd(cmd, resp):\n    pass\n\n` +
    `def main():\n` +
    connectionBlock +
    body +
    closeBlock +
    `\nif __name__ == "__main__":\n    main()\n`
  );
}
