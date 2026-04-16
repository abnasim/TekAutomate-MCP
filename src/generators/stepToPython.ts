/**
 * Minimal step → Python generator for PyVISA single-device.
 * Used by tests to verify generated code output. Can be extended to cover
 * more backends and step types; App.tsx continues to use its own generatePython until then.
 */

export interface GeneratorStep {
  id: string;
  type: string;
  label?: string;
  params?: Record<string, unknown>;
  children?: GeneratorStep[];
}

export interface GeneratorConfig {
  backend: string;
  host?: string;
  port?: number;
  connectionType?: 'tcpip' | 'socket' | 'usb' | 'gpib';
  timeout?: number;
  usbVendorId?: string;
  usbProductId?: string;
  usbSerial?: string;
  gpibBoard?: number;
  gpibAddress?: number;
}

export interface GeneratorOptions {
  enablePrintMessages?: boolean;
}

const defaultConfig: Partial<GeneratorConfig> = {
  connectionType: 'tcpip',
  host: '192.168.1.1',
  timeout: 5000,
};

/** Minimal SCPI substitution: {paramName} → value from paramValues. */
function substituteSCPI(
  scpi: string,
  paramDefs: Array<{ name: string; default?: string }> = [],
  paramValues: Record<string, unknown> = {}
): string {
  if (!scpi) return scpi;
  let result = scpi;
  paramDefs.forEach((p) => {
    const value =
      paramValues[p.name] ??
      paramValues[p.name.toLowerCase()] ??
      p.default ??
      '';
    if (value !== '' && value != null) {
      result = result.replace(new RegExp(`\\{${p.name}\\}`, 'gi'), String(value));
    }
  });
  return result;
}

function getVisaResourceString(config: GeneratorConfig): string {
  const c = config.connectionType || 'tcpip';
  if (c === 'tcpip') return `TCPIP::${config.host || '192.168.1.1'}::INSTR`;
  if (c === 'socket') return `TCPIP::${config.host}::${config.port || 5025}::SOCKET`;
  if (c === 'usb') {
    const serial = config.usbSerial ? `::${config.usbSerial}` : '';
    return `USB0::${config.usbVendorId}::${config.usbProductId}${serial}::INSTR`;
  }
  if (c === 'gpib') return `GPIB${config.gpibBoard ?? 0}::${config.gpibAddress ?? 1}::INSTR`;
  return `TCPIP::${config.host}::INSTR`;
}

function formatPythonSnippet(code: string, indent: string): string {
  if (!code) return '';
  const normalized = code
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => indent + line)
    .join('\n') + '\n';
}

/**
 * Generate Python script for PyVISA single-device with write, query, sleep, comment, python, group.
 */
export function generatePythonFromSteps(
  steps: GeneratorStep[],
  config: GeneratorConfig,
  options: GeneratorOptions = {}
): string {
  const cfg = { ...defaultConfig, ...config };
  if (cfg.backend !== 'pyvisa') {
    throw new Error('generatePythonFromSteps currently only supports backend "pyvisa"');
  }

  const enablePrintMessages = options.enablePrintMessages ?? false;
  const resourceStr = getVisaResourceString(cfg);
  const timeout = cfg.timeout ?? 5000;
  const connectionType = cfg.connectionType ?? 'tcpip';
  const readTermination = connectionType === 'socket' ? '\\n"  # Socket requires line termination' : 'None  # binary safe';

  const subst = (cmd: string, defs: Array<{ name: string; default?: string }> = [], vals: Record<string, unknown> = {}) =>
    substituteSCPI(cmd, defs, vals);

  function genSteps(items: GeneratorStep[], ind: string): string {
    let out = '';
    for (const s of items) {
      if (s.type === 'connect' || s.type === 'disconnect') continue;
      if (s.type === 'group') {
        out += `${ind}# Group: ${s.label || 'Group'}\n`;
        if (s.children) out += genSteps(s.children, ind);
        continue;
      }
      if (s.type === 'sleep') {
        const duration = Number(s.params?.duration);
        const safeDuration = Number.isFinite(duration) ? duration : 0;
        if (enablePrintMessages) out += `${ind}print("Sleeping for ${safeDuration}s")\n`;
        out += `${ind}time.sleep(${safeDuration})\n`;
        continue;
      }
      if (s.type === 'comment') {
        out += `${ind}# ${(s.params?.text as string) || (s.label || '')}\n`;
        continue;
      }
      if (s.type === 'python' && typeof s.params?.code === 'string') {
        if (enablePrintMessages) out += `${ind}print("${s.label || 'Executing Python code'}")\n`;
        out += formatPythonSnippet(s.params.code, ind);
        continue;
      }
      if (s.type === 'set_and_query') {
        const raw = subst(
          (s.params?.command as string) || '',
          (s.params?.cmdParams as Array<{ name: string; default?: string }>) || [],
          (s.params?.paramValues as Record<string, unknown>) || {}
        );
        const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
        const queryCmd = cmdHeader + '?';
        const paramValues = (s.params?.paramValues as Record<string, unknown>) || {};
        const valueParam = paramValues['value'] ?? paramValues['Value'] ?? '';
        let writeCmd = raw.replace(/\?$/, '');
        if (writeCmd === cmdHeader && valueParam) writeCmd = `${cmdHeader} ${valueParam}`;
        const varName = (s.params?.saveAs as string) || 'result';
        if (enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
        out += `${ind}scpi.write(${JSON.stringify(writeCmd)})\n`;
        out += `${ind}${varName} = scpi.query(${JSON.stringify(queryCmd)}).strip()\n`;
        out += `${ind}log_cmd(${JSON.stringify(queryCmd)}, ${varName})\n`;
        continue;
      }
      if (s.type === 'query') {
        const cmd = subst(
          (s.params?.command as string) || '',
          (s.params?.cmdParams as Array<{ name: string; default?: string }>) || [],
          (s.params?.paramValues as Record<string, unknown>) || {}
        );
        const varName = (s.params?.saveAs as string) || 'result';
        if (enablePrintMessages) out += `${ind}print("${s.label || 'Querying'}")\n`;
        out += `${ind}${varName} = scpi.query(${JSON.stringify(cmd)}).strip()\n`;
        out += `${ind}log_cmd(${JSON.stringify(cmd)}, ${varName})\n`;
        continue;
      }
      if (s.type === 'write') {
        const cmd = subst(
          (s.params?.command as string) || '',
          (s.params?.cmdParams as Array<{ name: string; default?: string }>) || [],
          (s.params?.paramValues as Record<string, unknown>) || {}
        );
        if (enablePrintMessages) out += `${ind}print("${s.label || 'Sending command'}")\n`;
        out += `${ind}scpi.write(${JSON.stringify(cmd)})\n`;
        out += `${ind}log_cmd(${JSON.stringify(cmd)}, "")\n`;
      }
    }
    return out;
  }

  const header = `#!/usr/bin/env python3
"""
Generated by TekAutomate
Backend: pyvisa
Host: ${cfg.host}
"""
import argparse, time, pathlib
`;

  const main = `
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--visa", default="${resourceStr}")
    p.add_argument("--timeout", type=float, default=${timeout})
    args = p.parse_args()
    
    print(f"Connecting via PyVISA to {args.visa}...")
    rm = pyvisa.ResourceManager()
    scpi = rm.open_resource(args.visa)
    scpi.timeout = int(args.timeout * 1000)
    scpi.write_termination = "\\n"
    scpi.read_termination = ${readTermination}
    
    idn = scpi.query("*IDN?").strip()
    print(f"[OK] Connected: {idn}")

    def log_cmd(cmd, resp):
        pass

` + genSteps(steps, '    ') + `
    try:
        err = scpi.query('ALLEV?').strip()
        log_cmd('ALLEV?', err)
    except Exception:
        pass
    scpi.close()
    rm.close()
    print("[OK] Complete")

if __name__ == "__main__":
    main()
`;

  return header + 'import pyvisa\n\n' + main;
}
