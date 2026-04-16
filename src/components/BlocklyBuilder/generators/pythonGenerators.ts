/* ===================== Python Code Generators ===================== */

import * as Blockly from 'blockly';
import { pythonGenerator, Order } from 'blockly/python';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { DeviceEntry } from '../types';
import { canPerformPSUOperation, DeviceType } from '../utils/deviceCapabilities';
import { convertSCPIToTmDevices } from '../../../utils/scpiToTmDevicesConverter';

type SetAndQueryMetadata = {
  kind: 'set_and_query';
  saveAs?: string;
  queryCommand?: string;
  params?: Record<string, any>;
};

function getSetAndQueryMetadata(block: Blockly.Block): SetAndQueryMetadata | null {
  try {
    if (!block.data) return null;
    const parsed = JSON.parse(block.data);
    const meta = parsed?.tekAutomator;
    if (meta?.kind === 'set_and_query') {
      return meta as SetAndQueryMetadata;
    }
  } catch {
    return null;
  }
  return null;
}

function inferSetAndQueryQueryCommand(command: string): string {
  const normalized = (command || '').trim();
  if (!normalized) return '';
  if (normalized.endsWith('?')) return normalized;

  const firstWhitespace = normalized.search(/\s/);
  if (firstWhitespace === -1) {
    return `${normalized}?`;
  }

  return `${normalized.slice(0, firstWhitespace)}?`;
}

/**
 * Convert SCPI command to tm_devices path format
 * Handles common SCPI patterns and converts them to tm_devices command tree paths
 */
function convertSCPIToTmDevicesPath(scpiCommand: string): {
  path: string;
  value?: string;
  success: boolean;
} {
  // Use the existing converter utility
  const result = convertSCPIToTmDevices(scpiCommand);
  
  if (!result.success) {
    return { path: '', success: false };
  }
  
  // Format the value appropriately for Python
  let formattedValue = result.value;
  if (formattedValue) {
    // Check if value is numeric
    const numericValue = parseFloat(formattedValue);
    if (!isNaN(numericValue) && formattedValue.match(/^-?\d*\.?\d+$/)) {
      // Keep numeric values as-is (no change needed)
    } else {
      // Quote string values
      formattedValue = `"${formattedValue}"`;
    }
  }
  
  return {
    path: result.path,
    value: formattedValue,
    success: true
  };
}

// Track current device context
let currentDeviceContext = '';

// Track device resources to prevent collisions
const deviceResources = new Map<string, string>();

// Track connected devices for cleanup
export const connectedDevices: string[] = [];

// Track device backends for proper cleanup (tm_devices vs pyvisa)
const deviceBackends = new Map<string, 'tm_devices' | 'pyvisa' | 'vxi11' | 'tekhsi' | 'hybrid'>();

// Export function to get device backends for cleanup
export function getDeviceBackends(): Map<string, 'tm_devices' | 'pyvisa' | 'vxi11' | 'tekhsi' | 'hybrid'> {
  return deviceBackends;
}

// Track which devices are actually used (have commands sent to them)
const usedDevices = new Set<string>();

// Device config map (set by BlocklyBuilder before generation)
// Maps DEVICE_NAME to IP/host for devices configured in UI
export const deviceConfig = new Map<string, { host?: string; ip?: string; resource?: string }>();

// Device info map (set by BlocklyBuilder before generation)
// Maps DEVICE_NAME to device type and backend for capability checking
export const deviceInfoMap = new Map<string, { deviceType?: DeviceType; backend?: string }>();

// Track variable assignments and their usage
const variableAssignments = new Map<string, Blockly.Block>();
const variableUsages = new Set<string>();

// Track blocks that should be skipped (combined with next block)
const blocksToSkip = new Set<Blockly.Block>();

// Reset tracking (call before each generation)
export function resetGeneratorState() {
  deviceResources.clear();
  connectedDevices.length = 0;
  deviceBackends.clear();
  usedDevices.clear();
  variableAssignments.clear();
  variableUsages.clear();
  blocksToSkip.clear();
  currentDeviceContext = '';
  // Note: deviceConfig and deviceInfoMap are NOT cleared - they're set by BlocklyBuilder and persist
}

// Set device config from UI (called by BlocklyBuilder before generation)
export function setDeviceConfig(config: Map<string, { host?: string; ip?: string; resource?: string }>) {
  deviceConfig.clear();
  config.forEach((value, key) => deviceConfig.set(key, value));
}

// Set device info from UI (called by BlocklyBuilder before generation)
export function setDeviceInfo(info: Map<string, { deviceType?: DeviceType; backend?: string }>) {
  deviceInfoMap.clear();
  info.forEach((value, key) => deviceInfoMap.set(key, value));
}

// Helper to get device type and backend for a device name
function getDeviceInfo(deviceName: string): { deviceType?: DeviceType; backend?: string } {
  const deviceNameLower = deviceName.toLowerCase();
  
  // PRIORITY 1: Check deviceBackends map (set from connect_scope block during generation)
  // This is the AUTHORITATIVE source because it comes from the actual Blockly workspace
  const backendFromBlock = deviceBackends.get(deviceName) || deviceBackends.get(deviceNameLower);
  if (backendFromBlock) {
    const info = deviceInfoMap.get(deviceNameLower);
    return { backend: backendFromBlock, deviceType: info?.deviceType };
  }
  
  // PRIORITY 2: Check deviceInfoMap (set from UI device configuration)
  // This is a fallback for when the connect_scope block hasn't been processed yet
  const info = deviceInfoMap.get(deviceNameLower);
  if (info && info.backend) {
    return info;
  }
  
  // Return empty object if not found (will default to PyVISA behavior)
  return info || {};
}

// Helper function to get device from DEVICE_CONTEXT field or walk back through blocks
function getDeviceVariable(block: Blockly.Block): string {
  // FIRST AND MOST IMPORTANT: Check if this block has an explicit DEVICE_CONTEXT field
  // This field is set in the XML and should take ABSOLUTE PRIORITY over any context tracking
  try {
    const deviceContext = block.getFieldValue('DEVICE_CONTEXT');
    // Check for valid device context (not empty, not unknown, not just parentheses)
    if (deviceContext && 
        typeof deviceContext === 'string' && 
        deviceContext.trim() !== '' && 
        deviceContext.trim() !== '(?)' && 
        deviceContext.trim() !== '?' &&
        deviceContext.trim() !== '()' &&
        !deviceContext.trim().startsWith('?')) {
      // Remove parentheses and whitespace: "(scope)" -> "scope", "(smu)" -> "smu"
      const cleanContext = deviceContext.replace(/[()]/g, '').trim();
      if (cleanContext && cleanContext !== '?' && cleanContext.length > 0) {
        // VALID EXPLICIT CONTEXT - USE IT!
        return cleanContext;
      }
    }
  } catch (e) {
    // Field doesn't exist, continue to fallback logic
  }
  
  // FALLBACK: Only if DEVICE_CONTEXT field was not present or invalid
  // Walk backwards through the block chain to find the most recent device context
  // This includes checking parent blocks (for nested structures like loops)
  let currentBlock: Blockly.Block | null = block.getPreviousBlock();
  
  // Also check parent block (for blocks inside loops or other structures)
  let parentBlock: Blockly.Block | null = block.getParent();
  while (parentBlock) {
    if (parentBlock.type === 'set_device_context') {
      const deviceName = parentBlock.getFieldValue('DEVICE');
      if (deviceName) {
        return deviceName;
      }
    }
    parentBlock = parentBlock.getParent();
  }
  
  while (currentBlock) {
    if (currentBlock.type === 'set_device_context') {
      // Found an explicit device switch
      const deviceName = currentBlock.getFieldValue('DEVICE');
      if (deviceName) {
        return deviceName;
      }
    }
    if (currentBlock.type === 'connect_scope') {
      const deviceName = currentBlock.getFieldValue('DEVICE_NAME');
      if (deviceName) {
        return deviceName;
      }
    }
    currentBlock = currentBlock.getPreviousBlock();
  }
  
  // Last resort: use the global currentDeviceContext
  return currentDeviceContext || 'scope';
}

// Connection Blocks

pythonGenerator.forBlock['connect_scope'] = function(block) {
  const deviceName = block.getFieldValue('DEVICE_NAME') || 'scope';
  const backend = block.getFieldValue('BACKEND');
  
  let code = '';
  let resource = '';
  
  if (backend === 'tm_devices') {
    // tm_devices uses DeviceManager with simple IP/hostname
    // Try field first, then stored hostValue_ from mutation, then device config
    let host = block.getFieldValue('HOST') || (block as any).hostValue_;
    // If not in XML or mutation, try device config (case-insensitive lookup)
    if (!host) {
      const deviceNameLower = deviceName.toLowerCase();
      // Try direct lookup first
      let deviceInfo = deviceConfig.get(deviceNameLower);
      if (!deviceInfo) {
        // Try finding by exact device type name match (psu, scope, smu, etc.)
        // This handles cases where XML uses "psu" but device alias is different
        // IMPORTANT: Must match exact device type, not just any common name
        const commonNames = ['scope', 'psu', 'smu', 'dmm', 'afg', 'awg'];
        if (commonNames.includes(deviceNameLower)) {
          // Look for exact match of device type name (e.g., "psu" must match "psu" key)
          deviceInfo = deviceConfig.get(deviceNameLower);
        }
      }
      host = deviceInfo?.host || deviceInfo?.ip;
    }
    // FAIL-FAST: No fallback, no warnings, throw error
    if (!host) {
      const availableDevices = Array.from(deviceConfig.keys()).join(', ') || 'none';
      throw new Error(`Device "${deviceName}" has no connection resource configured. HOST/IP must be set in XML block or device config. Available device configs: ${availableDevices}. Generation aborted.`);
    }
    resource = `tm_devices://${host}`;
    
    const devType = block.getFieldValue('DEV_TYPE') || 'SCOPE';
    const driver = block.getFieldValue('DRIVER_NAME') || ''; // Only use if explicitly set
    const alias = block.getFieldValue('DEVICE_ALIAS') || '';
    
    code += `# Connect to ${deviceName} using tm_devices\n`;
    
    // Build the add_device call based on device type
    // Only add type hint if driver is explicitly provided
    if (devType === 'SCOPE' || devType === 'TEKSCOPE_PC') {
      code += driver ? `${deviceName}: ${driver} = device_manager.add_scope("${host}"` : `${deviceName} = device_manager.add_scope("${host}"`;
    } else if (devType === 'SMU') {
      code += driver ? `${deviceName}: ${driver} = device_manager.add_smu("${host}"` : `${deviceName} = device_manager.add_smu("${host}"`;
    } else if (devType === 'AFG') {
      code += driver ? `${deviceName}: ${driver} = device_manager.add_afg("${host}"` : `${deviceName} = device_manager.add_afg("${host}"`;
    } else if (devType === 'AWG') {
      code += driver ? `${deviceName}: ${driver} = device_manager.add_awg("${host}"` : `${deviceName} = device_manager.add_awg("${host}"`;
    } else if (devType === 'DMM') {
      code += driver ? `${deviceName}: ${driver} = device_manager.add_dmm("${host}"` : `${deviceName} = device_manager.add_dmm("${host}"`;
    } else if (devType === 'PSU') {
      code += driver ? `${deviceName}: ${driver} = device_manager.add_psu("${host}"` : `${deviceName} = device_manager.add_psu("${host}"`;
    } else {
      code += `${deviceName} = device_manager.add_device("${host}"`;
    }
    
    if (alias) {
      code += `, alias="${alias}"`;
    }
    code += `)\n`;
    
    // tm_devices devices support .write() and .query() for SCPI commands (same as PyVISA)
    // Both backends use identical SCPI interface: device.write('COMMAND') and device.query('COMMAND?')
    code += `print(f"Connected to ${deviceName}: {${deviceName}.query('*IDN?').strip()}")\n\n`;
    
  } else {
    // Build resource string for other backends
    const connType = block.getFieldValue('CONN_TYPE');
    
    if (connType) {
      // User specified connection type - build resource string
      // Try field first, then stored hostValue_ from mutation, then device config
      let host = block.getFieldValue('HOST') || (block as any).hostValue_;
      // If not in XML or mutation, try device config (case-insensitive lookup)
      if (!host) {
        const deviceNameLower = deviceName.toLowerCase();
        // Try direct lookup first
        let deviceInfo = deviceConfig.get(deviceNameLower);
        if (!deviceInfo) {
          // Try finding by exact device type name match (psu, scope, smu, etc.)
          // IMPORTANT: Must match exact device type, not just any common name
          const commonNames = ['scope', 'psu', 'smu', 'dmm', 'afg', 'awg'];
          if (commonNames.includes(deviceNameLower)) {
            // Look for exact match of device type name (e.g., "psu" must match "psu" key)
            deviceInfo = deviceConfig.get(deviceNameLower);
          }
        }
        host = deviceInfo?.host || deviceInfo?.ip;
      }
      // FAIL-FAST: No fallback, no warnings, throw error
      if (!host && (connType === 'INSTR' || connType === 'SOCKET' || connType === 'USB')) {
        const availableDevices = Array.from(deviceConfig.keys()).join(', ') || 'none';
        throw new Error(`Device "${deviceName}" has no connection resource configured. HOST/IP must be set in XML block or device config. Available device configs: ${availableDevices}. Generation aborted.`);
      }
      const port = block.getFieldValue('PORT_NUM') || 4000;
      
      if (connType === 'INSTR') {
        resource = `TCPIP::${host}::INSTR`;
      } else if (connType === 'SOCKET') {
        resource = `TCPIP::${host}::${port}::SOCKET`;
      } else if (connType === 'USB') {
        resource = `USB::${host}::INSTR`;
      } else if (connType === 'GPIB') {
        resource = `GPIB::${port}::INSTR`;
      } else if (connType === 'ASRL') {
        resource = `ASRL${port}::INSTR`;
      }
    } else {
      // Fallback: check for legacy RESOURCE field
      resource = block.getFieldValue('RESOURCE');
      if (!resource || resource === 'null') {
        // Try IP field, then HOST field, then stored hostValue_ from mutation
        let ip = block.getFieldValue('IP') || block.getFieldValue('HOST') || (block as any).hostValue_;
        // If not in XML or mutation, try device config (case-insensitive lookup)
        if (!ip) {
          const deviceNameLower = deviceName.toLowerCase();
          // Try direct lookup first
          let deviceInfo = deviceConfig.get(deviceNameLower);
          if (!deviceInfo) {
            // Try finding by exact device type name match (psu, scope, smu, etc.)
            // IMPORTANT: Must match exact device type, not just any common name
            const commonNames = ['scope', 'psu', 'smu', 'dmm', 'afg', 'awg'];
            if (commonNames.includes(deviceNameLower)) {
              // Look for exact match of device type name (e.g., "psu" must match "psu" key)
              deviceInfo = deviceConfig.get(deviceNameLower);
            }
          }
          if (deviceInfo) {
            ip = deviceInfo.ip || deviceInfo.host;
            if (deviceInfo.resource) {
              resource = deviceInfo.resource;
            }
          }
        }
        // FAIL-FAST: No fallback, no warnings, throw error
        if (!resource && !ip) {
          const availableDevices = Array.from(deviceConfig.keys()).join(', ') || 'none';
          throw new Error(`Device "${deviceName}" has no connection resource configured. HOST/IP/RESOURCE must be set in XML block or device config. Available device configs: ${availableDevices}. Generation aborted.`);
        }
        if (!resource && ip) {
          resource = `TCPIP::${ip}::INSTR`;
        }
      }
    }
    
    // Check for duplicate resources
    const deviceEntries = Array.from(deviceResources.entries());
    for (const [existingDevice, existingResource] of deviceEntries) {
      if (existingResource === resource && existingDevice !== deviceName) {
        const availableDevices = Array.from(deviceConfig.keys()).join(', ') || 'none';
        // Provide clear, actionable error message
        throw new Error(
          `RESOURCE COLLISION DETECTED\n\n` +
          `Device "${deviceName}" and "${existingDevice}" are both trying to use the same connection:\n` +
          `  Resource: ${resource}\n\n` +
          `This means both devices are configured with the same IP address in your device settings.\n\n` +
          `HOW TO FIX:\n` +
          `1. Go to your device configuration in the UI\n` +
          `2. Ensure "${deviceName}" and "${existingDevice}" have different IP addresses\n` +
          `3. For example: "${deviceName}" → 192.168.1.10, "${existingDevice}" → 192.168.1.15\n\n` +
          `Available device configs: ${availableDevices}\n\n` +
          `Generation aborted. Please fix the device IP addresses and try again.`
        );
      }
    }
    
    // Store this device's resource
    deviceResources.set(deviceName, resource);
    
    // Get timeout (default 5000ms)
    const timeout = block.getFieldValue('TIMEOUT_MS') || 5000;
    
    code += `# Connect to ${deviceName} at ${resource}\n`;
    code += `try:\n`;
    
    if (backend === 'hybrid') {
      // Hybrid mode uses DeviceManager but different syntax
      code += `    from tm_devices import DeviceManager\n`;
      code += `    ${deviceName} = DeviceManager('${resource}')\n`;
      code += `    print(f"Connected to ${deviceName}: {${deviceName}.query('*IDN?').strip()}")\n`;
    } else if (backend === 'tekhsi') {
      const host = resource.split('::')[1] || '';
      const port = block.getFieldValue('PORT_NUM') || 4000;
      code += `    import tekhsi\n`;
      code += `    ${deviceName} = tekhsi.connect('${host}', ${port})\n`;
      code += `    print(f"Connected to ${deviceName} at ${host}:${port}")\n`;
    } else if (backend === 'vxi11') {
      const host = resource.split('::')[1] || '';
      code += `    import vxi11\n`;
      code += `    ${deviceName} = vxi11.Instrument('${host}')\n`;
      code += `    print(f"Connected to ${deviceName}: {${deviceName}.ask('*IDN?').strip()}")\n`;
    } else { // pyvisa (default)
      code += `    ${deviceName} = rm.open_resource('${resource}')\n`;
      code += `    ${deviceName}.timeout = ${timeout}\n`;
      code += `    print(f"Connected to ${deviceName}: {${deviceName}.query('*IDN?').strip()}")\n`;
    }
    
    code += `except Exception as e:\n`;
    code += `    print(f"Connection to ${deviceName} failed: {e}")\n`;
    code += `    raise\n\n`;
  }
  
  // Track connected device
  connectedDevices.push(deviceName);
  
  // Track device backend for proper cleanup
  // Store with both original case and lowercase for consistent lookup
  deviceBackends.set(deviceName, backend as 'tm_devices' | 'pyvisa' | 'vxi11' | 'tekhsi' | 'hybrid');
  deviceBackends.set(deviceName.toLowerCase(), backend as 'tm_devices' | 'pyvisa' | 'vxi11' | 'tekhsi' | 'hybrid');
  
  // Store device type and backend info for capability checking
  // Reuse variables already declared in function scope
  const deviceNameLower = deviceName.toLowerCase();
  if (!deviceInfoMap.has(deviceNameLower)) {
    // Get device type (may have been set earlier in tm_devices branch)
    const deviceType = block.getFieldValue('DEV_TYPE') || 'SCOPE';
    const deviceBackend = backend || 'pyvisa'; // Use existing backend variable from line 104
    // Store device info if not already stored (from UI config takes precedence)
    deviceInfoMap.set(deviceNameLower, {
      deviceType: deviceType as DeviceType,
      backend: deviceBackend
    });
  }
  
  // Store device name for context tracking
  currentDeviceContext = deviceName;
  
  return code;
};

pythonGenerator.forBlock['disconnect'] = function(block) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _device = getDeviceVariable(block);
  // Disconnect blocks should NOT remove from connectedDevices
  // Cleanup must close ALL devices that were opened, regardless of explicit disconnect blocks
  // This ensures symmetric cleanup: every connect -> exactly one close
  // Generate nothing - cleanup section will close all connected devices
  return '';
};

pythonGenerator.forBlock['set_device_context'] = function(block) {
  const deviceName = block.getFieldValue('DEVICE');
  currentDeviceContext = deviceName;
  
  // No code generated - context is tracked internally for subsequent blocks
  return '';
};

// ===================== TekExpress Blocks =====================
// TekExpress uses PyVISA SOCKET backend on port 5000
// CRITICAL: Never generate socket.sendall() - only SCPI via .write()/.query()

pythonGenerator.forBlock['connect_tekexpress'] = function(block) {
  const deviceName = block.getFieldValue('DEVICE_NAME') || 'tekexp';
  const host = block.getFieldValue('HOST') || 'localhost';
  const port = block.getFieldValue('PORT') || 5000;
  const timeout = block.getFieldValue('TIMEOUT') || 30000;
  
  // Track the connection
  connectedDevices.push(deviceName);
  deviceBackends.set(deviceName, 'pyvisa');  // TekExpress uses PyVISA SOCKET
  deviceResources.set(deviceName, `TCPIP::${host}::${port}::SOCKET`);
  
  // Generate PyVISA SOCKET connection code
  // Include ResourceManager initialization for TekExpress connections
  let code = `# Connect to TekExpress via PyVISA SOCKET\n`;
  code += `import pyvisa\n`;
  code += `_tekexp_rm = pyvisa.ResourceManager()\n`;
  code += `${deviceName} = _tekexp_rm.open_resource("TCPIP::${host}::${port}::SOCKET")\n`;
  code += `${deviceName}.write_termination = "\\n"\n`;
  code += `${deviceName}.read_termination = "\\n"\n`;
  code += `${deviceName}.timeout = ${timeout}\n`;
  code += `print(f"Connected to TekExpress at ${host}:${port}")\n\n`;
  
  return code;
};

pythonGenerator.forBlock['tekexp_write'] = function(block) {
  const command = block.getFieldValue('COMMAND') || '';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  // Generate write command - NO manual \n terminator
  // Handle embedded quotes by choosing appropriate outer quotes
  if (command.includes('"') && !command.includes("'")) {
    // Command has double quotes, use single quotes for outer
    return `tekexp.write('${command}')\n`;
  } else if (command.includes("'") && !command.includes('"')) {
    // Command has single quotes, use double quotes for outer
    return `tekexp.write("${command}")\n`;
  } else if (command.includes('"') && command.includes("'")) {
    // Command has both types of quotes, escape double quotes
    const escaped = command.replace(/"/g, '\\"');
    return `tekexp.write("${escaped}")\n`;
  } else {
    // No quotes in command, use double quotes
    return `tekexp.write("${command}")\n`;
  }
};

pythonGenerator.forBlock['tekexp_query'] = function(block) {
  const command = block.getFieldValue('COMMAND') || '';
  const variable = block.getFieldValue('VARIABLE') || 'result';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  // Track variable assignment AND usage (the generated print statement uses the variable)
  variableAssignments.set(variable, block);
  variableUsages.add(variable);  // Mark as used - the print statement uses it
  
  // Generate query command with print - handle embedded quotes
  let code = '';
  if (command.includes('"') && !command.includes("'")) {
    // Command has double quotes, use single quotes for outer
    code = `${variable} = tekexp.query('${command}').strip()\n`;
  } else if (command.includes("'") && !command.includes('"')) {
    // Command has single quotes, use double quotes for outer
    code = `${variable} = tekexp.query("${command}").strip()\n`;
  } else if (command.includes('"') && command.includes("'")) {
    // Command has both types of quotes, escape double quotes
    const escaped = command.replace(/"/g, '\\"');
    code = `${variable} = tekexp.query("${escaped}").strip()\n`;
  } else {
    // No quotes in command, use double quotes
    code = `${variable} = tekexp.query("${command}").strip()\n`;
  }
  // Always print the query result
  code += `print(f"TekExpress: {${variable}}")\n`;
  return code;
};

pythonGenerator.forBlock['tekexp_run'] = function(block) {
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write("TEKEXP:STATE RUN")\nprint("TekExpress measurement started")\n`;
};

pythonGenerator.forBlock['tekexp_wait_state'] = function(block) {
  const expected = block.getFieldValue('EXPECTED') || 'COMPLETE';
  const pollInterval = block.getFieldValue('POLL_INTERVAL') || 2;
  const timeout = block.getFieldValue('TIMEOUT') || 3600;
  const handlePopup = block.getFieldValue('HANDLE_POPUP') === 'TRUE';
  const popupResponse = block.getFieldValue('POPUP_RESPONSE') || 'OK';
  const logVariable = block.getFieldValue('LOG_VARIABLE') || '';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  // Track log variable if specified
  if (logVariable) {
    variableAssignments.set(logVariable, block);
    variableUsages.add(logVariable);
  }
  
  let code = `# Wait for TekExpress to reach ${expected} state\n`;
  code += `_tekexp_start_time = time.time()\n`;
  
  // Initialize log variable if specified
  if (logVariable) {
    code += `${logVariable} = []  # Store popup messages\n`;
  }
  
  code += `while True:\n`;
  code += `    _tekexp_state = tekexp.query("TEKEXP:STATE?").strip()\n`;
  code += `    print(f"TekExpress state: {_tekexp_state}")\n`;
  code += `    \n`;
  code += `    # Check for expected state\n`;
  code += `    if _tekexp_state == "${expected}":\n`;
  code += `        print("TekExpress reached expected state: ${expected}")\n`;
  code += `        break\n`;
  code += `    \n`;
  
  if (handlePopup) {
    code += `    # Handle popups during WAIT or ERROR states\n`;
    code += `    if _tekexp_state in ("WAIT", "ERROR"):\n`;
    code += `        _tekexp_popup = tekexp.query("TEKEXP:POPUP?")\n`;
    code += `        print(f"TekExpress popup: {_tekexp_popup}")\n`;
    
    if (logVariable) {
      code += `        ${logVariable}.append(_tekexp_popup)  # Log popup message\n`;
    }
    
    code += `        # Parse popup to get available responses\n`;
    code += `        try:\n`;
    code += `            _popup_parts = _tekexp_popup.split(";")\n`;
    code += `            if len(_popup_parts) >= 3:\n`;
    code += `                _responses = _popup_parts[2].replace("Responses:", "").strip().strip('"').split(",")\n`;
    code += `                # Use "${popupResponse}" if available, otherwise use first response\n`;
    code += `                if "${popupResponse}" in _responses:\n`;
    code += `                    _response = "${popupResponse}"\n`;
    code += `                else:\n`;
    code += `                    _response = _responses[0].strip() if _responses else "OK"\n`;
    code += `            else:\n`;
    code += `                _response = "${popupResponse}"\n`;
    code += `        except:\n`;
    code += `            _response = "${popupResponse}"\n`;
    code += `        tekexp.write(f'TEKEXP:POPUP "{_response}"')\n`;
    code += `        print(f"Responded to popup with: {_response}")\n`;
    code += `    \n`;
  }
  
  code += `    # Check timeout\n`;
  code += `    if time.time() - _tekexp_start_time > ${timeout}:\n`;
  code += `        raise TimeoutError("TekExpress did not reach ${expected} within ${timeout}s")\n`;
  code += `    \n`;
  code += `    time.sleep(${pollInterval})\n`;
  
  if (logVariable) {
    code += `\n# Print logged popup messages\n`;
    code += `if ${logVariable}:\n`;
    code += `    print(f"Logged {len(${logVariable})} popup messages:")\n`;
    code += `    for i, msg in enumerate(${logVariable}, 1):\n`;
    code += `        print(f"  {i}. {msg}")\n`;
  }
  
  code += `\n`;
  return code;
};

pythonGenerator.forBlock['tekexp_popup'] = function(block) {
  const response = block.getFieldValue('RESPONSE') || 'OK';
  const variable = block.getFieldValue('VARIABLE') || 'popup_msg';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  // Track variable assignment AND usage (the generated print statement uses the variable)
  variableAssignments.set(variable, block);
  variableUsages.add(variable);  // Mark as used - the print statement uses it
  
  let code = `# Handle TekExpress popup\n`;
  code += `${variable} = tekexp.query("TEKEXP:POPUP?")\n`;
  code += `print(f"Popup message: {${variable}}")\n`;
  code += `tekexp.write('TEKEXP:POPUP "${response}"')\n`;
  code += `print("Responded to popup with: ${response}")\n\n`;
  
  return code;
};

pythonGenerator.forBlock['tekexp_select_device'] = function(block) {
  const deviceName = block.getFieldValue('DEVICE_NAME') || 'Device';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write('TEKEXP:SELECT DEVICE,"${deviceName}"')\n`;
};

pythonGenerator.forBlock['tekexp_select_test'] = function(block) {
  const testName = block.getFieldValue('TEST_NAME') || '';
  // Use TRUE/FALSE consistently (not 1/0) per SCPI convention
  const enabled = block.getFieldValue('ENABLED') === 'TRUE' ? 'TRUE' : 'FALSE';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write('TEKEXP:SELECT TEST,"${testName}",${enabled}')\n`;
};

pythonGenerator.forBlock['tekexp_set_value'] = function(block) {
  const category = block.getFieldValue('CATEGORY') || 'GENERAL';
  const parameter = block.getFieldValue('PARAMETER') || '';
  const value = block.getFieldValue('VALUE') || '';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write('TEKEXP:VALUE ${category},"${parameter}","${value}"')\n`;
};

pythonGenerator.forBlock['tekexp_export_report'] = function(block) {
  const generateReport = block.getFieldValue('GENERATE_REPORT') === 'TRUE';
  const copyImages = block.getFieldValue('COPY_IMAGES') === 'TRUE';
  const destination = block.getFieldValue('DESTINATION') || '';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  let code = '';
  
  if (generateReport) {
    code += `# Generate TekExpress report\n`;
    code += `tekexp.write("TEKEXP:REPORT GENERATE")\n`;
    code += `print("Generated TekExpress report in session folder")\n`;
  }
  
  if (copyImages && destination && destination.trim()) {
    const destPath = destination.trim().replace(/\\/g, '/');
    code += `# Copy images to destination\n`;
    code += `tekexp.write('TEKEXP:COPYIMAGES "${destPath}"')\n`;
    code += `print(f"Copied test images to ${destPath}")\n`;
  }
  
  if (!code) {
    code = `# No report actions selected\n`;
  }
  
  code += `\n`;
  return code;
};

pythonGenerator.forBlock['tekexp_last_error'] = function(block) {
  const variable = block.getFieldValue('VARIABLE') || 'error_msg';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  // Track variable assignment AND usage (the generated code uses the variable in if/print)
  variableAssignments.set(variable, block);
  variableUsages.add(variable);  // Mark as used - the if statement and print use it
  
  let code = `${variable} = tekexp.query("TEKEXP:LASTERROR?")\n`;
  code += `if ${variable}:\n`;
  code += `    print(f"TekExpress error: {${variable}}")\n\n`;
  
  return code;
};

pythonGenerator.forBlock['tekexp_save_session'] = function(block) {
  const sessionName = block.getFieldValue('SESSION_NAME') || 'MySession';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  let code = `# Save TekExpress session\n`;
  code += `tekexp.write('TEKEXP:SETUP SAVE,"${sessionName}"')\n`;
  code += `print("Saved session: ${sessionName}")\n\n`;
  
  return code;
};

pythonGenerator.forBlock['tekexp_load_session'] = function(block) {
  const sessionName = block.getFieldValue('SESSION_NAME') || 'MySession';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  let code = `# Load TekExpress session\n`;
  code += `tekexp.write('TEKEXP:SETUP RECALL,"${sessionName}"')\n`;
  code += `print("Loaded session: ${sessionName}")\n`;
  code += `time.sleep(2)  # Wait for session to load\n\n`;
  
  return code;
};

pythonGenerator.forBlock['tekexp_query_result'] = function(block) {
  const testName = block.getFieldValue('TEST_NAME') || '';
  const variable = block.getFieldValue('VARIABLE') || 'test_result';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  // Track variable assignment and usage
  variableAssignments.set(variable, block);
  variableUsages.add(variable);
  
  let code = `# Query test result\n`;
  code += `${variable} = tekexp.query('TEKEXP:RESULT? "${testName}"')\n`;
  code += `print(f"Result for ${testName}: {${variable}}")\n\n`;
  
  return code;
};

pythonGenerator.forBlock['tekexp_set_mode'] = function(block) {
  const mode = block.getFieldValue('MODE') || 'USER-DEFINED';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write("TEKEXP:MODE ${mode}")\n`;
};

pythonGenerator.forBlock['tekexp_set_acquire_mode'] = function(block) {
  const acquireMode = block.getFieldValue('ACQUIRE_MODE') || 'LIVE';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write("TEKEXP:ACQUIRE_MODE ${acquireMode}")\n`;
};

pythonGenerator.forBlock['tekexp_select_suite'] = function(block) {
  const suiteName = block.getFieldValue('SUITE_NAME') || '';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write('TEKEXP:SELECT SUITE,"${suiteName}"')\n`;
};

pythonGenerator.forBlock['tekexp_select_version'] = function(block) {
  const versionName = block.getFieldValue('VERSION_NAME') || '';
  
  // Mark tekexp as used
  usedDevices.add('tekexp');
  
  return `tekexp.write('TEKEXP:SELECT VERSION,"${versionName}"')\n`;
};

// SCPI Blocks

// Validate command-to-device mapping
// Prevents semantic cross-instrument leakage (e.g., sending :MEASUREMENT: to SMU)
function validateCommandDeviceMapping(command: string, device: string, blockType: string): void {
  if (!command) return;
  
  const commandUpper = command.toUpperCase();
  const deviceLower = device.toLowerCase();
  
  // Get device type from deviceInfoMap
  const deviceInfo = getDeviceInfo(device);
  const deviceType = deviceInfo.deviceType;
  
  // Scope-only commands
  const scopeOnlyPatterns = [
    ':MEASUREMENT:', 'MEASUREMENT:', ':MEASU:', 'MEASU:',
    ':CH1:', ':CH2:', ':CH3:', ':CH4:', 'CH1:', 'CH2:', 'CH3:', 'CH4:',
    ':ACQUIRE:', 'ACQUIRE:', ':ACQ:', 'ACQ:',
    ':HORIZONTAL:', 'HORIZONTAL:', ':HOR:',
    ':TRIGGER:', 'TRIGGER:', ':TRIG:',
    ':SEARCH:', 'SEARCH:',
    ':SAVE:IMAGE', 'SAVE:IMAGE',
    ':WAVEFORM:', 'WAVEFORM:', ':WAV:',
    'CURVE?', ':CURVE?'
  ];
  
  // SMU/PSU-only commands
  const smuPsuOnlyPatterns = [
    ':SOURCE:', 'SOURCE:', ':SOUR:',
    ':OUTPUT', 'OUTPUT',
    ':SENSE:', 'SENSE:', ':SENS:',
    ':MEASURE:', 'MEASURE:' // Note: different from :MEASUREMENT: (scope)
  ];
  
  // Check if command is scope-only but device is not scope
  const isScopeCommand = scopeOnlyPatterns.some(pattern => commandUpper.includes(pattern));
  if (isScopeCommand && deviceType !== 'SCOPE' && !deviceLower.includes('scope') && !deviceLower.includes('mso') && !deviceLower.includes('dpo')) {
    throw new Error(
      `COMMAND-TO-DEVICE MAPPING ERROR\n\n` +
      `Command "${command}" is a scope-specific command, but target device is "${device}" (${deviceType || 'unknown type'}).\n\n` +
      `Scope commands include: :MEASUREMENT:, :CHx:, :ACQUIRE:, :TRIGGER:, :SEARCH:, etc.\n\n` +
      `HOW TO FIX:\n` +
      `1. Use set_device_context to switch to the scope device before this ${blockType} block\n` +
      `2. Or ensure the DEVICE_CONTEXT field is set to "(scope)" in the block properties\n\n` +
      `Generation aborted. Please fix the device context and try again.`
    );
  }
  
  // Check if command is SMU/PSU-only but device is not SMU/PSU
  const isSmuPsuCommand = smuPsuOnlyPatterns.some(pattern => commandUpper.includes(pattern));
  if (isSmuPsuCommand && deviceType !== 'SMU' && deviceType !== 'PSU' && 
      !deviceLower.includes('smu') && !deviceLower.includes('psu') && !deviceLower.includes('source')) {
    throw new Error(
      `COMMAND-TO-DEVICE MAPPING ERROR\n\n` +
      `Command "${command}" is an SMU/PSU-specific command, but target device is "${device}" (${deviceType || 'unknown type'}).\n\n` +
      `SMU/PSU commands include: :SOURCE:, :OUTPUT, :SENSE:, :MEASURE:, etc.\n\n` +
      `HOW TO FIX:\n` +
      `1. Use set_device_context to switch to the SMU/PSU device before this ${blockType} block\n` +
      `2. Or ensure the DEVICE_CONTEXT field is set to "(smu)" or "(psu)" in the block properties\n\n` +
      `Generation aborted. Please fix the device context and try again.`
    );
  }
}

pythonGenerator.forBlock['scpi_write'] = function(block) {
  // Check if this block should be skipped (combined with wait_for_opc)
  if (blocksToSkip.has(block)) {
    return '';
  }
  
  const rawCommand = block.getFieldValue('COMMAND');
  const device = getDeviceVariable(block);
  const setAndQueryMeta = getSetAndQueryMetadata(block);
  const isSetAndQuery = setAndQueryMeta?.kind === 'set_and_query';
  const queryCommand = setAndQueryMeta?.queryCommand || inferSetAndQueryQueryCommand(rawCommand || '');
  const saveAs = setAndQueryMeta?.saveAs || 'result';
  
  // Sanitize command - remove newlines and extra whitespace
  const command = rawCommand ? rawCommand.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  
  // Check if backend is tm_devices - convert SCPI to tm_devices style
  const deviceInfo = getDeviceInfo(device);
  if (deviceInfo.backend === 'tm_devices') {
    // Convert SCPI command to tm_devices path
    const converted = convertSCPIToTmDevicesPath(command);
    
    // Track device usage
    usedDevices.add(device);
    
    if (converted.success) {
      let code = `# tm_devices: ${device}.commands.${converted.path}.write(${converted.value || ''})\n`;
      if (converted.value) {
        code += `${device}.commands.${converted.path}.write(${converted.value})\n`;
      } else {
        code += `${device}.commands.${converted.path}.write()\n`;
      }
      if (isSetAndQuery && queryCommand) {
        const convertedQuery = convertSCPIToTmDevicesPath(queryCommand);
        if (convertedQuery.success) {
          code += `${saveAs} = ${device}.commands.${convertedQuery.path}.query()\n`;
        } else {
          code += `${saveAs} = ${device}.visa_resource.query('${queryCommand}').strip()\n`;
        }
        code += `print(f"${saveAs} = {${saveAs}}")\n`;
      }
      return code;
    } else {
      // Fallback: use visa_resource for unsupported commands
      let code = `# SCPI (via visa_resource): ${command}\n`;
      code += `${device}.visa_resource.write('${command}')\n`;
      if (isSetAndQuery && queryCommand) {
        code += `${saveAs} = ${device}.visa_resource.query('${queryCommand}').strip()\n`;
        code += `print(f"${saveAs} = {${saveAs}}")\n`;
      }
      return code;
    }
  }
  
  // VALIDATION: Check command-to-device mapping
  // Prevent semantic cross-instrument leakage
  validateCommandDeviceMapping(command, device, 'scpi_write');
  
  // Track device usage
  usedDevices.add(device);
  
  // Check if next block is wait_for_opc and this is an acquisition command
  const nextBlock = block.getNextBlock();
  if (nextBlock && nextBlock.type === 'wait_for_opc') {
    if (command && (command.includes('ACQuire:STATE ON') || command.includes('ACQUIRE:STATE RUN'))) {
      // Mark this block to be skipped - wait_for_opc will handle it
      blocksToSkip.add(block);
      return '';
    }
  }
  
  let code = `# SCPI Write: ${command} (to ${device})\n`;
  code += `${device}.write('${command}')\n`;
  if (isSetAndQuery && queryCommand) {
    code += `${saveAs} = ${device}.query('${queryCommand}').strip()\n`;
    code += `print(f"${saveAs} = {${saveAs}}")\n`;
  }
  return code;
};

pythonGenerator.forBlock['scpi_query'] = function(block) {
  const rawCommand = block.getFieldValue('COMMAND');
  const variable = block.getFieldValue('VARIABLE');
  const device = getDeviceVariable(block);
  
  // Sanitize command - remove newlines and extra whitespace
  const command = rawCommand ? rawCommand.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  
  // Check if backend is tm_devices - convert SCPI to tm_devices style
  const deviceInfo = getDeviceInfo(device);
  if (deviceInfo.backend === 'tm_devices') {
    // Convert SCPI command to tm_devices path
    const converted = convertSCPIToTmDevicesPath(command);
    
    // Track device usage
    usedDevices.add(device);
    
    if (converted.success) {
      let code = `# tm_devices: ${variable} = ${device}.commands.${converted.path}.query()\n`;
      code += `${variable} = ${device}.commands.${converted.path}.query()\n`;
      code += `print(f"${variable} = {${variable}}")\n`;
      return code;
    } else {
      // Fallback: use visa_resource for unsupported commands
      let code = `# SCPI Query (via visa_resource): ${command}\n`;
      code += `${variable} = ${device}.visa_resource.query('${command}').strip()\n`;
      code += `print(f"${variable} = {${variable}}")\n`;
      return code;
    }
  }
  
  // Track device usage
  usedDevices.add(device);
  
  // Detect if this is a numeric measurement query
  const isNumericQuery = command.toUpperCase().includes('VALUE') || 
                         command.toUpperCase().includes('MEAS') ||
                         command.toUpperCase().includes('FREQ') ||
                         command.toUpperCase().includes('AMPL') ||
                         command.toUpperCase().includes('VOLT') ||
                         command.toUpperCase().includes('CURR') ||
                         command.toUpperCase().includes('PK2PK') ||
                         command.toUpperCase().includes('RMS') ||
                         command.toUpperCase().includes('MEAN') ||
                         command.toUpperCase().includes('MAX') ||
                         command.toUpperCase().includes('MIN');
  
  let code = `# SCPI Query: ${command} (from ${device})\n`;
  if (isNumericQuery) {
    // Cast to float for numeric queries to enable proper comparisons
    code += `${variable} = float(${device}.query('${command}').strip())\n`;
  } else {
    code += `${variable} = ${device}.query('${command}').strip()\n`;
  }
  code += `print(f"${variable} = {${variable}}")\n`;
  return code;
};

// Legacy SCPI Write block (for backward compatibility with old XMLs)
pythonGenerator.forBlock['scpi_write_legacy'] = pythonGenerator.forBlock['scpi_write'];

// Legacy SCPI Query block (for backward compatibility with old XMLs)
pythonGenerator.forBlock['scpi_query_legacy'] = pythonGenerator.forBlock['scpi_query'];

pythonGenerator.forBlock['custom_command'] = function(block) {
  const commands = block.getFieldValue('COMMAND');
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  const lines = commands.split('\n').filter((l: string) => l.trim());
  let code = `# Custom SCPI commands (to ${device})\n`;
  
  for (const cmd of lines) {
    const trimmed = cmd.trim();
    if (trimmed.endsWith('?')) {
      code += `response = ${device}.query('${trimmed}')\n`;
      code += `print(f"Response: {response.strip()}")\n`;
    } else {
      code += `${device}.write('${trimmed}')\n`;
    }
  }
  
  return code;
};

// Channel Blocks

pythonGenerator.forBlock['configure_channel'] = function(block) {
  const channel = block.getFieldValue('CHANNEL');
  const scale = block.getFieldValue('SCALE');
  const offset = block.getFieldValue('OFFSET');
  const coupling = block.getFieldValue('COUPLING');
  const termination = block.getFieldValue('TERMINATION');
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  let code = `# Configure ${channel} on ${device}\n`;
  code += `${device}.write('${channel}:SCALE ${scale}')\n`;
  code += `${device}.write('${channel}:OFFSET ${offset}')\n`;
  code += `${device}.write('${channel}:COUPLING ${coupling}')\n`;
  if (termination) {
    code += `${device}.write('${channel}:TERMINATION ${termination}')\n`;
  }
  
  return code;
};

pythonGenerator.forBlock['enable_channel'] = function(block) {
  const channel = block.getFieldValue('CHANNEL');
  const state = block.getFieldValue('STATE') === 'TRUE' ? 'ON' : 'OFF';
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  let code = `# Enable/Disable ${channel} on ${device}\n`;
  code += `${device}.write('SELECT:${channel} ${state}')\n`;
  
  return code;
};

// Acquisition Blocks

pythonGenerator.forBlock['start_acquisition'] = function(block) {
  const device = getDeviceVariable(block);
  usedDevices.add(device);
  let code = `# Start acquisition on ${device}\n`;
  code += `${device}.write('ACQUIRE:STATE RUN')\n`;
  return code;
};

pythonGenerator.forBlock['stop_acquisition'] = function(block) {
  const device = getDeviceVariable(block);
  usedDevices.add(device);
  let code = `# Stop acquisition on ${device}\n`;
  code += `${device}.write('ACQUIRE:STATE STOP')\n`;
  return code;
};

pythonGenerator.forBlock['single_acquisition'] = function(block) {
  // Check if this block should be skipped (combined with wait_for_opc)
  if (blocksToSkip.has(block)) {
    return '';
  }
  
  const device = getDeviceVariable(block);
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  // Check if next block is wait_for_opc - if so, combine them
  const nextBlock = block.getNextBlock();
  if (nextBlock && nextBlock.type === 'wait_for_opc') {
    // Mark this block to be skipped (will be combined with wait_for_opc)
    blocksToSkip.add(block);
    // Return empty - wait_for_opc will handle the combined command
    return '';
  }
  
  // Standalone single acquisition
  let code = `# Single acquisition on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
      code += `${device}.commands.acquire.stopafter.write("SEQuence")\n`;
      code += `${device}.commands.acquire.state.write("ON")\n`;
      // Wait for completion using OPC
      code += `if ${device}.commands.opc.query().strip() == "1":\n`;
    code += `    pass  # Acquisition complete\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${device}.write('ACQUIRE:STOPAFTER SEQUENCE')\n`;
    code += `${device}.write('ACQUIRE:STATE ON;*OPC?')\n`;
    code += `${device}.read()  # Block until acquisition complete\n`;
  }
  
  return code;
};

// Data Blocks

pythonGenerator.forBlock['save_waveform'] = function(block) {
  const source = block.getFieldValue('SOURCE');
  const filename = block.getFieldValue('FILENAME');
  const format = block.getFieldValue('FORMAT');
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  // Determine if filename needs f-string interpolation
  const needsFString = filename.includes('{');
  
  // Extract variable names from filename for usage tracking
  if (needsFString) {
    const varMatches = filename.match(/\{(\w+)\}/g);
    if (varMatches) {
      varMatches.forEach((match: string): void => {
        const varName = match.slice(1, -1); // Remove {}
        variableUsages.add(varName);
      });
    }
  }
  
  // Determine file extension based on format
  const extMap: { [key: string]: string } = { 'CSV': 'csv', 'BIN': 'bin', 'WFM': 'wfm', 'MAT': 'mat' };
  const ext = extMap[format] || 'bin';
  
  // Check if filename already has extension
  const hasExt = filename.endsWith('.csv') || filename.endsWith('.bin') || filename.endsWith('.wfm') || filename.endsWith('.mat');
  const baseName = hasExt ? filename.replace(/\.(csv|bin|wfm|mat)$/i, '') : filename;
  const finalFilename = needsFString ? `f"${baseName}.${ext}"` : `"${baseName}.${ext}"`;
  
  let code = '';
  
  // WFM/MAT: Scope writes the file using SAVE:WAVEFORM
  if (format === 'WFM' || format === 'MAT') {
    // Use /Temp/ which works on both Windows and Linux scopes
    const scopeTempPath = '/Temp';
    const scopePath = `${scopeTempPath}/${baseName}.${ext}`;
    code += `# Save ${source} as ${format} (scope-native with full metadata)\n`;
    code += `# Ensure temp directory exists on scope\n`;
    code += `try:\n`;
    code += `    ${device}.write('FILESYSTEM:MKDIR "${scopeTempPath}"')\n`;
    code += `except:\n`;
    code += `    pass  # Directory may already exist\n`;
    code += `# Wait for any pending operations (e.g., acquisition) to complete\n`;
    code += `${device}.query('*OPC?')\n`;
    code += `${device}.write('SAVE:WAVEFORM ${source},"${scopePath}"')\n`;
    code += `time.sleep(1.0)  # Wait for save to complete (file operation)\n`;
    code += `# Download from scope to local\n`;
    code += `${device}.write('FILESYSTEM:READFILE "${scopePath}"')\n`;
    code += `data = ${device}.read_raw()\n`;
    code += `with open(${finalFilename}, 'wb') as f:\n`;
    code += `    f.write(data)\n`;
    code += `print(f"Saved ${source} as ${format}: ${baseName}.${ext}")\n`;
    code += `# Clean up scope temp file\n`;
    code += `${device}.write('FILESYSTEM:DELETE "${scopePath}"')\n`;
  }
  // CSV: PC pulls data via CURVE?, scales with WFMOUTPRE
  else if (format === 'CSV' || format === 'ASCII') {
    code += `# Save ${source} as CSV (PC transfer with scaling)\n`;
    code += `${device}.write('DATA:SOURCE ${source}')\n`;
    code += `${device}.write('DATA:ENCDG ASCII')\n`;
    code += `# Get waveform scaling parameters\n`;
    code += `x_incr = float(${device}.query('WFMOUTPRE:XINCR?').strip())\n`;
    code += `x_zero = float(${device}.query('WFMOUTPRE:XZERO?').strip())\n`;
    code += `y_mult = float(${device}.query('WFMOUTPRE:YMULT?').strip())\n`;
    code += `y_off = float(${device}.query('WFMOUTPRE:YOFF?').strip())\n`;
    code += `y_zero = float(${device}.query('WFMOUTPRE:YZERO?').strip())\n`;
    code += `# Get raw waveform data\n`;
    code += `raw_data = ${device}.query('CURVE?').strip()\n`;
    code += `# Parse and scale the data\n`;
    code += `raw_values = [int(v) for v in raw_data.split(',') if v.strip()]\n`;
    code += `fname = ${finalFilename}\n`;
    code += `with open(fname, 'w') as f:\n`;
    code += `    f.write('Time (s),Amplitude (V)\\n')  # CSV header\n`;
    code += `    for i, raw_val in enumerate(raw_values):\n`;
    code += `        time_val = x_zero + i * x_incr\n`;
    code += `        amplitude = (raw_val - y_off) * y_mult + y_zero\n`;
    code += `        f.write(f'{time_val:.9e},{amplitude:.6e}\\n')\n`;
    code += `print(f"Saved {len(raw_values)} points to {fname}")\n`;
  }
  // BIN: PC pulls data via read_waveform_binary (fast, raw)
  else {
    code += `# Save ${source} as binary (fast PC transfer)\n`;
    code += `fname = ${finalFilename}\n`;
    code += `preamble, waveform_data = read_waveform_binary(${device}, source='${source}')\n`;
    code += `with open(fname, 'wb') as f:\n`;
    code += `    f.write(waveform_data)\n`;
    code += `print(f"Saved {preamble['num_points']:,} points to {fname}")\n`;
  }
  
  return code;
};

pythonGenerator.forBlock['save_screenshot'] = function(block) {
  let filenameInput = block.getFieldValue('FILENAME') || 'screenshot';
  const format = block.getFieldValue('FORMAT') || 'PNG';
  // Try to get SCOPE_TYPE from field first, then from mutation attribute
  let scopeType = block.getFieldValue('SCOPE_TYPE');
  if (!scopeType) {
    // Check if there's a mutation element with scope_type attribute
    const mutationDom = block.mutationToDom?.();
    if (mutationDom) {
      scopeType = mutationDom.getAttribute('scope_type');
    }
  }
  // Normalize: accept 'Legacy', 'LEGACY', 'legacy' etc.
  if (scopeType && scopeType.toUpperCase() === 'LEGACY') {
    scopeType = 'LEGACY';
  } else {
    scopeType = 'MODERN';
  }
  const localFolder = block.getFieldValue('LOCAL_FOLDER') || './screenshots';
  const device = getDeviceVariable(block);
  
  // FAIL-FAST: Check if backend is tm_devices (should have been caught by validation, but double-check)
  // Check deviceBackends first (set from connect_scope block during generation) - this is the authoritative source
  // Only fall back to deviceInfoMap (from UI) if deviceBackends doesn't have the device
  const backendFromBlock = deviceBackends.get(device) || deviceBackends.get(device.toLowerCase());
  const backendFromUI = getDeviceInfo(device).backend;
  const backend = backendFromBlock || backendFromUI;
  
  if (backend === 'tm_devices') {
    // Provide helpful error message indicating where the tm_devices backend came from
    const source = backendFromBlock ? 'Connect block in workspace' : 'UI device configuration';
    throw new Error(
      `FORBIDDEN BLOCK DETECTED: save_screenshot with tm_devices backend\n\n` +
      `Device "${device}" uses tm_devices backend (source: ${source}), but save_screenshot block was found.\n` +
      `This should have been caught by backend validation. Please use tm_devices_save_screenshot block instead.\n\n` +
      `HOW TO FIX:\n` +
      `1. If you want to use save_screenshot: Change the Connect block's Backend dropdown to "PyVISA"\n` +
      `2. If you want to use tm_devices: Replace save_screenshot with tm_devices_save_screenshot block\n\n` +
      `Generation aborted.`
    );
  }
  
  // Track device usage
  usedDevices.add(device);
  
  // Handle variable interpolation: ${var} -> {var} for f-strings
  let filenameBase = filenameInput.replace(/\$\{(\w+)\}/g, '{$1}');
  
  // Extract just the filename if a full path was provided
  // This handles cases where user enters "C:\path\to\file.png" or "C:/path/to/file.png"
  if (filenameBase.includes('/') || filenameBase.includes('\\')) {
    const parts = filenameBase.replace(/\\/g, '/').split('/');
    filenameBase = parts[parts.length - 1] || 'screenshot';
  }
  
  const hasVariables = /\{(\w+)/.test(filenameBase);
  
  // Track variable usage from filename
  if (hasVariables) {
    const varMatches = filenameBase.match(/\{(\w+)/g);
    if (varMatches) {
      varMatches.forEach((match: string) => {
        const varName = match.slice(1);
        variableUsages.add(varName);
      });
    }
  }
  
  // Check if extension already present
  const hasExtension = /\.(png|jpg|jpeg|bmp)$/i.test(filenameBase);
  const ext = format.toLowerCase();
  const localFilename = hasExtension ? filenameBase : `${filenameBase}.${ext}`;
  
  let code = '';
  
  if (scopeType === 'MODERN') {
    // MODERN scopes (MSO5/6 Series) - use SAVE:IMAGE command
    code = `# Save screenshot from ${device} (Modern MSO5/6 - SAVE:IMAGE method)\n`;
    code += `import os\n`;
    code += `os.makedirs("${localFolder}", exist_ok=True)\n`;
    
    // Scope-side temp path (always use forward slashes)
    const scopeTempPath = 'C:/Temp/TekAutomate_Temp.png';
    
    if (hasVariables) {
      code += `_ss_basename = f"${localFilename}"\n`;
      code += `_ss_local = f"${localFolder}/{_ss_basename}"\n`;
    } else {
      code += `_ss_basename = "${localFilename}"\n`;
      code += `_ss_local = "${localFolder}/${localFilename}"\n`;
    }
    
    // Fixed scope-side temp path
    code += `_ss_scope_temp = "${scopeTempPath}"\n`;
    
    // Ensure temp directory exists on scope
    code += `try:\n`;
    code += `    ${device}.write('FILESYSTEM:MKDIR "C:/Temp"')\n`;
    code += `except:\n`;
    code += `    pass  # Directory may already exist\n`;
    
    // Capture and save image on scope
    code += `${device}.write('SAVE:IMAGE:COMPOSITION NORMAL')\n`;
    code += `${device}.write(f'SAVE:IMAGE "{_ss_scope_temp}"')\n`;
    code += `if str(${device}.query('*OPC?')).strip() != '1':\n`;
    code += `    raise RuntimeError('SAVE:IMAGE did not complete')\n`;
    
    // Transfer file from scope to PC
    code += `_old_timeout = ${device}.timeout\n`;
    code += `try:\n`;
    code += `    ${device}.timeout = 30000  # 30 seconds for file transfer\n`;
    code += `    ${device}.write(f'FILESYSTEM:READFILE "{_ss_scope_temp}"')\n`;
    code += `    _ss_data = ${device}.read_raw()\n`;
    code += `finally:\n`;
    code += `    ${device}.timeout = _old_timeout  # Restore original timeout\n`;
    code += `with open(_ss_local, 'wb') as f:\n`;
    code += `    f.write(_ss_data)\n`;
    
    // Delete temp file from scope
    code += `${device}.write(f'FILESYSTEM:DELETE "{_ss_scope_temp}"')\n`;
    code += `${device}.query('*OPC?')\n`;
    code += `print(f"Saved screenshot to {_ss_local}")\n`;
    
  } else {
    // LEGACY scopes (MSO/DPO 5k/7k/70k Series) - use HARDCOPY command
    // Proven working method from TekAutomate Steps UI
    code = `# Save screenshot from ${device} (Legacy 5k/7k/70k - HARDCOPY method)\n`;
    code += `import os\n`;
    code += `os.makedirs("${localFolder}", exist_ok=True)\n`;
    
    // Scope-side temp path (C:/TekScope/Temp/ is proven to work)
    const scopeTempPath = 'C:/TekScope/Temp/screenshot.png';
    
    if (hasVariables) {
      code += `_ss_basename = f"${localFilename}"\n`;
      code += `_ss_local = f"${localFolder}/{_ss_basename}"\n`;
    } else {
      code += `_ss_basename = "${localFilename}"\n`;
      code += `_ss_local = "${localFolder}/${localFilename}"\n`;
    }
    
    code += `_ss_scope_temp = "${scopeTempPath}"\n`;
    
    // Create directories on scope (critical for legacy scopes)
    code += `try:\n`;
    code += `    ${device}.write('FILESYSTEM:MKDIR "C:/TekScope"')\n`;
    code += `except:\n`;
    code += `    pass\n`;
    code += `try:\n`;
    code += `    ${device}.write('FILESYSTEM:MKDIR "C:/TekScope/Temp"')\n`;
    code += `except:\n`;
    code += `    pass\n`;
    
    // Configure and trigger hardcopy (proven working sequence)
    code += `${device}.write('HARDCOPY:PORT FILE')\n`;
    code += `${device}.write('HARDCOPY:FORMAT ${format.toUpperCase()}')\n`;
    code += `${device}.write(f'HARDCOPY:FILENAME "{_ss_scope_temp}"')\n`;
    code += `${device}.write('HARDCOPY START')\n`;
    code += `if str(${device}.query('*OPC?')).strip() != '1':\n`;
    code += `    raise RuntimeError('HARDCOPY START did not complete')\n`;
    
    // Transfer file from scope to PC
    code += `_old_timeout = ${device}.timeout\n`;
    code += `try:\n`;
    code += `    ${device}.timeout = 30000  # 30 seconds for file transfer\n`;
    code += `    ${device}.write(f'FILESYSTEM:READFILE "{_ss_scope_temp}"')\n`;
    code += `    _ss_data = ${device}.read_raw()\n`;
    code += `finally:\n`;
    code += `    ${device}.timeout = _old_timeout  # Restore original timeout\n`;
    code += `with open(_ss_local, 'wb') as f:\n`;
    code += `    f.write(_ss_data)\n`;
    
    // Delete temp file from scope
    code += `${device}.write(f'FILESYSTEM:DELETE "{_ss_scope_temp}"')\n`;
    code += `${device}.query('*OPC?')\n`;
    code += `print(f"Saved screenshot to {_ss_local}")\n`;
  }
  
  return code;
};

// Recall Block - Smart recall for settings/sessions/waveforms
pythonGenerator.forBlock['recall'] = function(block) {
  const recallType = block.getFieldValue('RECALL_TYPE') || 'FACTORY';
  const filePath = block.getFieldValue('FILE_PATH') || '';
  const reference = block.getFieldValue('REFERENCE') || 'REF1';
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  let code = '';
  
  switch (recallType) {
    case 'FACTORY':
      code = `# Recall factory defaults on ${device}\n`;
      code += `${device}.write('RECALL:SETUP FACTORY')\n`;
      code += `print("Recalled factory defaults")\n`;
      break;
      
    case 'SETUP':
      code = `# Recall setup (.SET) from ${filePath}\n`;
      code += `${device}.write('RECALL:SETUP "${filePath}"')\n`;
      code += `print("Recalled setup from ${filePath}")\n`;
      break;
      
    case 'SESSION':
      code = `# Recall session (.TSS) from ${filePath}\n`;
      code += `${device}.write('RECALL:SESSION "${filePath}"')\n`;
      code += `time.sleep(2)  # Wait for session to load\n`;
      code += `print("Recalled session from ${filePath}")\n`;
      break;
      
    case 'WAVEFORM':
      code = `# Recall waveform to ${reference} from ${filePath}\n`;
      code += `${device}.write('RECALL:WAVEFORM "${filePath}",${reference}')\n`;
      code += `print("Recalled waveform to ${reference} from ${filePath}")\n`;
      break;
  }
  
  return code;
};

// Save Block - Smart save for settings/sessions/waveforms
pythonGenerator.forBlock['save'] = function(block) {
  const saveType = block.getFieldValue('SAVE_TYPE') || 'SETUP';
  const filePath = block.getFieldValue('FILE_PATH') || '';
  const source = block.getFieldValue('SOURCE') || 'CH1';
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  let code = '';
  
  switch (saveType) {
    case 'SETUP':
      code = `# Save setup (.SET) to ${filePath}\n`;
      code += `${device}.write('SAVE:SETUP "${filePath}"')\n`;
      code += `print("Saved setup to ${filePath}")\n`;
      break;
      
    case 'SESSION':
      code = `# Save session (.TSS) to ${filePath}\n`;
      code += `${device}.write('SAVE:SESSION "${filePath}"')\n`;
      code += `time.sleep(2)  # Wait for session to save\n`;
      code += `print("Saved session to ${filePath}")\n`;
      break;
      
    case 'WAVEFORM':
      code = `# Save waveform from ${source} to ${filePath}\n`;
      code += `${device}.write('SAVE:WAVEFORM ${source},"${filePath}"')\n`;
      code += `print("Saved waveform from ${source} to ${filePath}")\n`;
      break;
      
    case 'IMAGE':
      // For image, delegate to the more comprehensive save_screenshot logic
      // or use simple SAVE:IMAGE command
      code = `# Save screenshot to ${filePath}\n`;
      code += `${device}.write('SAVE:IMAGE "${filePath}"')\n`;
      code += `print("Saved screenshot to ${filePath}")\n`;
      break;
  }
  
  return code;
};

// Timing Blocks

pythonGenerator.forBlock['wait_seconds'] = function(block) {
  const seconds = block.getFieldValue('SECONDS');
  
  let code = `# Wait ${seconds} seconds\n`;
  code += `time.sleep(${seconds})\n`;
  
  return code;
};

pythonGenerator.forBlock['wait_for_opc'] = function(block) {
  const timeout = block.getFieldValue('TIMEOUT');
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  // Check if previous block was single_acquisition (which should be combined)
  let prevBlock: Blockly.Block | null = block.getPreviousBlock();
  let acquisitionCommand = '';
  
  while (prevBlock) {
    // Check for single_acquisition block
    if (prevBlock.type === 'single_acquisition') {
      acquisitionCommand = 'single';
      // Mark previous block to skip (already handled)
      blocksToSkip.add(prevBlock);
      break;
    }
    if (prevBlock.type === 'scpi_write') {
      const command = prevBlock.getFieldValue('COMMAND');
      if (command && (command.includes('ACQuire:STATE ON') || command.includes('ACQUIRE:STATE RUN'))) {
        acquisitionCommand = command;
        // Mark previous block to skip
        blocksToSkip.add(prevBlock);
        break;
      }
    }
    // Skip over set_device_context, wait_seconds, and other non-SCPI blocks
    if (prevBlock.type !== 'set_device_context' && prevBlock.type !== 'wait_seconds' && prevBlock.type !== 'variables_set' && prevBlock.type !== 'acquisition_reset') {
      break;
    }
    prevBlock = prevBlock.getPreviousBlock();
  }
  
  if (acquisitionCommand === 'single') {
    // For single acquisition, combine with blocking OPC
    let code = `# Single acquisition and wait for completion on ${device}\n`;
    
    if (backend === 'tm_devices') {
      // Use tm_devices command tree
      // NOTE: OPC query after acquisition start ensures command queue completion.
      // For single sequence acquisitions, this typically indicates acquisition completion,
      // but OPC is a fallback - acquisition lifecycle should ideally be block-driven.
      code += `${device}.commands.acquire.stopafter.write("SEQuence")\n`;
      code += `${device}.commands.acquire.state.write("ON")\n`;
      code += `if ${device}.commands.opc.query().strip() == "1":\n`;
      code += `    pass  # Acquisition complete\n`;
    } else {
      // Use raw SCPI for PyVISA and other backends
      code += `${device}.write('ACQUIRE:STOPAFTER SEQUENCE')\n`;
      code += `${device}.write('ACQUIRE:STATE ON;*OPC?')\n`;
      code += `${device}.read()  # Block until acquisition complete\n`;
    }
    
    return code;
  } else if (acquisitionCommand) {
    // For other acquisition commands, combine with blocking OPC
    let code = `# Start acquisition and wait for completion on ${device}\n`;
    
    if (backend === 'tm_devices') {
      // Use tm_devices command tree
      code += `${device}.commands.acquire.state.write("ON")\n`;
      code += `if ${device}.commands.opc.query().strip() == "1":\n`;
      code += `    pass  # Acquisition complete\n`;
    } else {
      // Use raw SCPI for PyVISA and other backends
      code += `${device}.write('ACQuire:STATE ON;*OPC?')\n`;
      code += `${device}.read()  # Block until acquisition complete\n`;
    }
    
    return code;
  } else {
    // For other commands, use standard OPC waiting
    if (backend === 'tm_devices') {
      // tm_devices: Use command tree
      // NOTE: OPC query guarantees command queue completion, not necessarily acquisition completion.
      // For FastFrame and single sequence acquisitions, this often works, but acquisition lifecycle
      // should ideally be driven by higher-level blocks. OPC is a fallback, not a guarantee.
      // TODO: Consider implementing acquisition-specific completion detection in the future.
      let code = `# Wait for operation complete on ${device}\n`;
      code += `if ${device}.commands.opc.query().strip() == "1":\n`;
      code += `    pass  # Operation complete\n`;
      return code;
    } else {
      // PyVISA: Use polling pattern
      let code = `# Wait for operation complete on ${device}\n`;
      code += `start_time = time.time()\n`;
      code += `while time.time() - start_time < ${timeout}:\n`;
      code += `    if ${device}.query('*OPC?').strip() == '1':\n`;
      code += `        break\n`;
      code += `    time.sleep(0.1)\n`;
      code += `else:\n`;
      code += `    print("Warning: OPC timeout on ${device}")\n`;
      return code;
    }
  }
};

// Control Blocks

// Override controls_for to handle both integer and float loops correctly
pythonGenerator.forBlock['controls_for'] = function(block) {
  const varId = block.getFieldValue('VAR');
  const varModel = block.workspace.getVariableById(varId);
  const varName = varModel ? varModel.getName() : 'i';
  
  const fromCode = pythonGenerator.valueToCode(block, 'FROM', Order.NONE) || '0';
  const toCode = pythonGenerator.valueToCode(block, 'TO', Order.NONE) || '10';
  const byCode = pythonGenerator.valueToCode(block, 'BY', Order.NONE) || '1';
  
  // Check if we need float-safe loop (Python's range() only accepts integers)
  const fromValue = parseFloat(fromCode);
  const toValue = parseFloat(toCode);
  const byValue = parseFloat(byCode);
  const needsFloatLoop = !Number.isInteger(fromValue) || !Number.isInteger(toValue) || !Number.isInteger(byValue);
  
  let loopCode = '';
  const branch = pythonGenerator.statementToCode(block, 'DO');
  
  if (needsFloatLoop) {
    // Generate float-safe while loop
    // This handles cases like: for v in range(0.5, 2.5 + 1, 0.5)
    loopCode = `${varName} = ${fromCode}\n`;
    loopCode += `while ${varName} <= ${toCode}:\n`;
    loopCode += branch;
    loopCode += `    ${varName} += ${byCode}\n`;
  } else {
    // Integer loop: use standard Python range()
    const byValueInt = Math.round(byValue);
    if (byValueInt === 1) {
      loopCode = `for ${varName} in range(${Math.round(fromValue)}, ${Math.round(toValue)} + 1):\n${branch}`;
    } else {
      loopCode = `for ${varName} in range(${Math.round(fromValue)}, ${Math.round(toValue)} + 1, ${byValueInt}):\n${branch}`;
    }
  }
  
  return loopCode;
};

// Variable Blocks - Track assignments for validation

// Override variables_get to prevent None initialization
// Blockly's default generator initializes all variables to None, which we don't want
pythonGenerator.forBlock['variables_get'] = function(block) {
  const varId = block.getFieldValue('VAR');
  const varModel = block.workspace.getVariableById(varId);
  let varName = varModel ? varModel.getName() : 'var';
  
  // Use safe name if original shadows Python built-in
  if (PYTHON_RESERVED.has(varName)) {
    varName = `${varName}_var`;
  }
  
  // Track variable usage
  variableUsages.add(varName);
  
  // Return just the variable name (no initialization)
  return [varName, Order.ATOMIC];
};

// Python built-ins and reserved words that should not be shadowed
const PYTHON_RESERVED = new Set([
  // Built-in functions
  'format', 'print', 'input', 'open', 'type', 'id', 'len', 'range', 'list', 'dict', 'set', 'str', 'int', 'float', 'bool',
  'sum', 'min', 'max', 'abs', 'round', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter', 'any', 'all',
  'iter', 'next', 'slice', 'object', 'super', 'property', 'classmethod', 'staticmethod', 'getattr', 'setattr', 'hasattr',
  'isinstance', 'issubclass', 'callable', 'repr', 'hash', 'dir', 'vars', 'globals', 'locals', 'exec', 'eval', 'compile',
  'bytes', 'bytearray', 'memoryview', 'complex', 'tuple', 'frozenset', 'file', 'bin', 'hex', 'oct', 'ord', 'chr', 'ascii',
  // Keywords
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None'
]);

// Override variables_set to track variable assignments
pythonGenerator.forBlock['variables_set'] = function(block) {
  // Get variable name from VAR field (which contains variable ID)
  const varId = block.getFieldValue('VAR');
  // Get actual variable name from workspace
  const varModel = block.workspace.getVariableById(varId);
  let varName = varModel ? varModel.getName() : 'var';
  
  // Check for Python reserved/built-in name conflicts
  if (PYTHON_RESERVED.has(varName)) {
    // Auto-prefix with underscore to avoid shadowing
    const safeVarName = `${varName}_var`;
    console.warn(`Variable "${varName}" shadows Python built-in. Using "${safeVarName}" instead.`);
    varName = safeVarName;
  }
  
  // Track this variable assignment
  variableAssignments.set(varName, block);
  
  // Generate code using Blockly's standard approach
  const valueCode = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE) || '0';
  return `${varName} = ${valueCode}\n`;
};

// Utility Blocks

pythonGenerator.forBlock['comment_block'] = function(block) {
  const comment = block.getFieldValue('COMMENT');
  const lines = comment.split('\n');
  
  let code = '';
  for (const line of lines) {
    code += `# ${line}\n`;
  }
  
  return code;
};

pythonGenerator.forBlock['python_code'] = function(block) {
  let pythonCode = block.getFieldValue('CODE');
  
  // DO NOT convert \n to actual newlines - they should remain as escape sequences
  // in Python string literals (e.g., f.write("data\n") should stay as-is)
  // The user's code may contain legitimate \n escape sequences in strings
  
  // Extract variable names used in code for usage tracking
  // Match {variable} and {variable:format} patterns in f-strings
  // Handles: {i}, {i:02d}, {value:.2f}, {name!r}, {name!r:>10}
  const fStringRegex = /\{(\w+)(?:![^:}])?(?::[^}]*)?\}/g;
  let fStringMatch;
  while ((fStringMatch = fStringRegex.exec(pythonCode)) !== null) {
    const varName = fStringMatch[1]; // First capture group is the variable name
    variableUsages.add(varName);
  }
  
  // Track device usage in python_code blocks (e.g., psu.write(...), scope.query(...), scope.save_screenshot(...))
  const deviceNames = new Set(['scope', 'psu', 'smu', 'dmm', 'afg', 'awg', 'rm', 'device_manager', 'tekexp']);
  const deviceUsagePattern = new RegExp(`\\b(${Array.from(deviceNames).join('|')})\\.(write|query|read|read_raw|close|save_screenshot|commands|ch|horizontal|trigger|acquisition|meas)`, 'gi');
  const deviceMatches = pythonCode.match(deviceUsagePattern);
  if (deviceMatches) {
    deviceMatches.forEach((match: string) => {
      const deviceMatch = match.match(/\b(scope|psu|smu|dmm|afg|awg)\b/i);
      if (deviceMatch) {
        usedDevices.add(deviceMatch[1].toLowerCase());
      }
    });
  }
  
  // Also check for variable references in expressions (e.g., voltage in psu.write(f"VOLTage {voltage}"))
  // Match variable names that are not device names or Python keywords
  const pythonKeywords = new Set(['if', 'for', 'while', 'def', 'class', 'import', 'from', 'return', 'print', 'time', 'open', 'with', 'as', 'try', 'except', 'finally', 'else', 'elif', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'f', 'strip', 'split', 'join', 'format', 'int', 'float', 'str']);
  
  // Match variable-like identifiers (but exclude device names and keywords)
  // Use word boundaries to avoid matching parts of longer words
  const varRefMatches = pythonCode.match(/\b([a-z_][a-z0-9_]*)\b/gi);
  if (varRefMatches) {
    // Get all assigned variable names (case-insensitive lookup)
    const assignedVarNames = Array.from(variableAssignments.keys());
    const assignedVarNamesLower = new Map<string, string>(); // Map lowercase -> original
    assignedVarNames.forEach(name => {
      assignedVarNamesLower.set(name.toLowerCase(), name);
    });
    
    varRefMatches.forEach((match: string): void => {
      const varNameLower = match.toLowerCase();
      // Check if it's a tracked variable (was assigned) and not a keyword/device
      if (assignedVarNamesLower.has(varNameLower)) {
        if (!pythonKeywords.has(varNameLower) && !deviceNames.has(varNameLower)) {
          // Add the original variable name (preserve case from assignment)
          const originalVarName = assignedVarNamesLower.get(varNameLower);
          if (originalVarName) {
            variableUsages.add(originalVarName);
          }
        }
      }
    });
  }
  
  // Check if this block is being used as a value (expression) or statement
  const parent = block.getParent();
  const isValueBlock = parent && block.outputConnection && block.outputConnection.targetConnection;
  
  if (isValueBlock) {
    // Return as expression tuple: [code, order]
    // Use ATOMIC order since it's a single expression
    return [pythonCode, Order.ATOMIC];
  } else {
    // Return as statement - split by newlines and add proper formatting
    const lines = pythonCode.split('\n');
    return lines.join('\n') + '\n';
  }
};

// tm_devices High-Level Blocks

pythonGenerator.forBlock['tm_devices_save_screenshot'] = function(block) {
  const device = getDeviceVariable(block);
  let filenameInput = block.getFieldValue('FILENAME') || 'screenshot';
  const format = block.getFieldValue('FORMAT') || 'PNG';
  const colors = block.getFieldValue('COLORS') || 'NORMAL';
  const localFolder = block.getFieldValue('LOCAL_FOLDER') || '';
  const deviceFolder = block.getFieldValue('DEVICE_FOLDER') || '';
  const keepDeviceFile = block.getFieldValue('KEEP_DEVICE_FILE') === 'TRUE';
  
  // Track device usage
  usedDevices.add(device);
  
  // Check if filename already has extension
  const extension = format.toLowerCase();
  const hasExtension = /\.(png|jpg|jpeg|bmp)$/i.test(filenameInput);
  
  // Handle variable interpolation: ${var} or {var} syntax
  // Convert ${var} to {var} for Python f-string compatibility
  let filenameBase = filenameInput.replace(/\$\{(\w+)\}/g, '{$1}');
  const hasVariables = /\{(\w+)/.test(filenameBase);
  
  // Track variable usage from filename
  if (hasVariables) {
    const varMatches = filenameBase.match(/\{(\w+)/g);
    if (varMatches) {
      varMatches.forEach((match: string) => {
        const varName = match.slice(1); // Remove {
        variableUsages.add(varName);
      });
    }
  }
  
  // Build filename with extension (don't add if already present)
  let filename = hasExtension ? filenameBase : `${filenameBase}.${extension}`;
  
  let code = `# Save Screenshot (tm_devices)\n`;
  code += `${device}.save_screenshot(`;
  
  // Build parameters
  const params: string[] = [];
  
  // filename - use f-string if it has variables
  if (hasVariables) {
    params.push(`f"${filename}"`);
  } else {
    params.push(`"${filename}"`);
  }
  
  // colors (only if not default)
  if (colors !== 'NORMAL') {
    params.push(`colors="${colors}"`);
  }
  
  // local_folder
  if (localFolder) {
    params.push(`local_folder="${localFolder}"`);
  }
  
  // device_folder
  if (deviceFolder) {
    params.push(`device_folder="${deviceFolder}"`);
  }
  
  // keep_device_file (only if True)
  if (keepDeviceFile) {
    params.push(`keep_device_file=True`);
  }
  
  code += params.join(', ');
  code += `)\n`;
  
  return code;
};

// Generic tm_devices Write Block
pythonGenerator.forBlock['tm_devices_write'] = function(block) {
  const device = getDeviceVariable(block);
  const path = block.getFieldValue('PATH') || 'ch[1].scale';
  let value = block.getFieldValue('VALUE') || '';
  
  // Track device usage
  usedDevices.add(device);
  
  // Handle empty value - some commands take no arguments (SCPICmdWriteNoArguments)
  if (value.trim() === '') {
    let code = `# tm_devices: ${device}.commands.${path}.write()\n`;
    code += `${device}.commands.${path}.write()\n`;
    return code;
  }
  
  // Determine if value is a string or number/variable
  // If it starts with a quote, keep as-is
  // If it's a number, keep as-is
  // Otherwise treat as string
  let formattedValue: string;
  const isQuoted = /^["'].*["']$/.test(value);
  const isNumber = /^-?\d*\.?\d+$/.test(value);
  const isBool = /^(true|false)$/i.test(value);
  const isVariable = /^\{?\w+\}?$/.test(value) && !isNumber && !isBool;
  
  if (isQuoted) {
    formattedValue = value;
  } else if (isNumber) {
    formattedValue = value;
  } else if (isBool) {
    formattedValue = value.toUpperCase() === 'TRUE' ? 'True' : 'False';
  } else if (isVariable && value.startsWith('{') && value.endsWith('}')) {
    // f-string variable like {i}
    const varName = value.slice(1, -1);
    variableUsages.add(varName);
    formattedValue = `f"${value}"`;
  } else {
    // Treat as string - add quotes
    formattedValue = `"${value}"`;
  }
  
  let code = `# tm_devices: ${device}.commands.${path}.write(${formattedValue})\n`;
  code += `${device}.commands.${path}.write(${formattedValue})\n`;
  
  return code;
};

// Generic tm_devices Query Block
pythonGenerator.forBlock['tm_devices_query'] = function(block) {
  const device = getDeviceVariable(block);
  const path = block.getFieldValue('PATH') || 'ch[1].scale';
  const varId = block.getFieldValue('VARIABLE');
  const varModel = block.workspace.getVariableById(varId);
  // Field is TextInput: value is the variable name. Lookup by ID may fail when ID is e.g. "vpp_id" but value is "vpp".
  const varName = (varModel ? varModel.getName() : (varId || 'result')) || 'result';
  
  // Track device usage
  usedDevices.add(device);
  
  // Track variable assignment and usage
  variableAssignments.set(varName, block);
  variableUsages.add(varName);
  
  let code = `# tm_devices: ${device}.commands.${path}.query()\n`;
  code += `${varName} = ${device}.commands.${path}.query()\n`;
  code += `print(f"${path}: {${varName}}")\n`;
  
  return code;
};

// tm_devices Save Session Block
pythonGenerator.forBlock['tm_devices_save_session'] = function(block) {
  const device = getDeviceVariable(block);
  let filename = block.getFieldValue('FILENAME') || 'session.tss';
  
  usedDevices.add(device);
  
  // Handle variable interpolation: ${var} or {var} syntax
  // Convert ${var} to {var} for Python f-string compatibility
  filename = filename.replace(/\$\{(\w+)\}/g, '{$1}');
  const hasVariables = /\{(\w+)/.test(filename);
  
  // Track variable usage from filename
  if (hasVariables) {
    const varMatches = filename.match(/\{(\w+)/g);
    if (varMatches) {
      varMatches.forEach((match: string) => {
        const varName = match.slice(1); // Remove {
        variableUsages.add(varName);
      });
    }
  }
  
  let code = `# Save Session\n`;
  if (hasVariables) {
    code += `${device}.commands.save.session.write(f"${filename}")\n`;
    code += `print(f"Session saved: ${filename}")\n`;
  } else {
    code += `${device}.commands.save.session.write("${filename}")\n`;
    code += `print(f"Session saved: ${filename}")\n`;
  }
  
  return code;
};

// tm_devices Recall Session Block
pythonGenerator.forBlock['tm_devices_recall_session'] = function(block) {
  const device = getDeviceVariable(block);
  let filename = block.getFieldValue('FILENAME') || 'session.tss';
  
  usedDevices.add(device);
  
  // Handle variable interpolation
  filename = filename.replace(/\$\{(\w+)\}/g, '{$1}');
  const hasVariables = /\{(\w+)/.test(filename);
  
  if (hasVariables) {
    const varMatches = filename.match(/\{(\w+)/g);
    if (varMatches) {
      varMatches.forEach((match: string) => {
        variableUsages.add(match.slice(1));
      });
    }
  }
  
  let code = `# Recall Session\n`;
  if (hasVariables) {
    code += `${device}.recall_session(f"${filename}")\n`;
  } else {
    code += `${device}.recall_session("${filename}")\n`;
  }
  code += `print(f"Session recalled: ${filename}")\n`;
  
  return code;
};

// tm_devices Save Waveform Block
pythonGenerator.forBlock['tm_devices_save_waveform'] = function(block) {
  const device = getDeviceVariable(block);
  const source = block.getFieldValue('SOURCE') || 'CH1';
  let filename = block.getFieldValue('FILENAME') || 'waveform.wfm';
  
  usedDevices.add(device);
  
  // Handle variable interpolation
  filename = filename.replace(/\$\{(\w+)\}/g, '{$1}');
  const hasVariables = /\{(\w+)/.test(filename);
  
  if (hasVariables) {
    const varMatches = filename.match(/\{(\w+)/g);
    if (varMatches) {
      varMatches.forEach((match: string) => {
        variableUsages.add(match.slice(1));
      });
    }
  }
  
  let code = `# Save Waveform (tm_devices)\n`;
  if (hasVariables) {
    code += `${device}.commands.save.waveform.write(f'${source},"{filename}"')\n`;
  } else {
    code += `${device}.commands.save.waveform.write('${source},"${filename}"')\n`;
  }
  code += `print(f"Waveform saved: ${source} -> ${filename}")\n`;
  
  return code;
};

// tm_devices Recall Reference Block
pythonGenerator.forBlock['tm_devices_recall_reference'] = function(block) {
  const device = getDeviceVariable(block);
  let filename = block.getFieldValue('FILENAME') || 'waveform.wfm';
  const refNum = block.getFieldValue('REF_NUM') || '1';
  
  usedDevices.add(device);
  
  // Handle variable interpolation
  filename = filename.replace(/\$\{(\w+)\}/g, '{$1}');
  const hasVariables = /\{(\w+)/.test(filename);
  
  if (hasVariables) {
    const varMatches = filename.match(/\{(\w+)/g);
    if (varMatches) {
      varMatches.forEach((match: string) => {
        variableUsages.add(match.slice(1));
      });
    }
  }
  
  let code = `# Recall Reference\n`;
  if (hasVariables) {
    code += `${device}.recall_reference(f"${filename}", ${refNum})\n`;
  } else {
    code += `${device}.recall_reference("${filename}", ${refNum})\n`;
  }
  code += `print(f"Reference recalled: ${filename} -> REF${refNum}")\n`;
  
  return code;
};

// tm_devices Reset Block
pythonGenerator.forBlock['tm_devices_reset'] = function(block) {
  const device = getDeviceVariable(block);
  
  usedDevices.add(device);
  
  let code = `# Reset Scope\n`;
  code += `${device}.reset()\n`;
  code += `print("Scope reset to defaults")\n`;
  
  return code;
};

// tm_devices Channel On/Off Block
pythonGenerator.forBlock['tm_devices_channel_on_off'] = function(block) {
  const device = getDeviceVariable(block);
  const channel = block.getFieldValue('CHANNEL') || 'CH1';
  const state = block.getFieldValue('STATE') || 'ON';
  
  usedDevices.add(device);
  
  let code = `# Turn ${channel} ${state}\n`;
  if (state === 'ON') {
    code += `${device}.turn_channel_on("${channel}")\n`;
  } else {
    code += `${device}.turn_channel_off("${channel}")\n`;
  }
  code += `print(f"${channel} turned ${state}")\n`;
  
  return code;
};

// tm_devices Add Math Block
pythonGenerator.forBlock['tm_devices_add_math'] = function(block) {
  const device = getDeviceVariable(block);
  const math = block.getFieldValue('MATH') || 'MATH1';
  const source = block.getFieldValue('SOURCE') || 'CH1';
  
  usedDevices.add(device);
  
  let code = `# Add Math Channel\n`;
  code += `${device}.add_new_math("${math}", "${source}")\n`;
  code += `print(f"Added ${math} from ${source}")\n`;
  
  return code;
};

// tm_devices Set and Check Block
pythonGenerator.forBlock['tm_devices_set_and_check'] = function(block) {
  const device = getDeviceVariable(block);
  const command = block.getFieldValue('COMMAND') || ':HORIZONTAL:SCALE';
  let value = block.getFieldValue('VALUE') || '100e-9';
  
  usedDevices.add(device);
  
  // Determine if value is numeric or string
  const isNumber = /^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(value);
  const formattedValue = isNumber ? value : `"${value}"`;
  
  let code = `# Set and Check\n`;
  code += `${device}.set_and_check("${command}", ${formattedValue})\n`;
  code += `print(f"Set ${command} = ${value}")\n`;
  
  return code;
};

// FastFrame Blocks

pythonGenerator.forBlock['fastframe_enable'] = function(block) {
  const device = getDeviceVariable(block);
  const state = block.getFieldValue('STATE');
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Enable FastFrame mode on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
    code += `${device}.commands.horizontal.fastframe.state.write("${state}")\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${device}.write(':HORIZONTAL:FASTFRAME:STATE ${state}')\n`;
  }
  
  return code;
};

pythonGenerator.forBlock['fastframe_set_count'] = function(block) {
  const device = getDeviceVariable(block);
  const countCode = pythonGenerator.valueToCode(block, 'COUNT', Order.NONE) || '50';
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Set FastFrame count on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
    code += `${device}.commands.horizontal.fastframe.count.write(${countCode})\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${device}.write(f':HORIZONTAL:FASTFRAME:COUNT {${countCode}}')\n`;
  }
  
  return code;
};

pythonGenerator.forBlock['fastframe_select_frame'] = function(block) {
  const device = getDeviceVariable(block);
  const channel = block.getFieldValue('CHANNEL');
  const frameCode = pythonGenerator.valueToCode(block, 'FRAME', Order.NONE) || '1';
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Select FastFrame ${frameCode} for ${channel} on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
    // Note: Channel selection may vary by model, using standard pattern
    code += `${device}.commands.horizontal.fastframe.selected.${channel.toLowerCase()}.write(${frameCode})\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${device}.write(f':HORIZONTAL:FASTFRAME:SELECTED:${channel} {${frameCode}}')\n`;
  }
  
  return code;
};

// Search Blocks

pythonGenerator.forBlock['search_configure_edge'] = function(block) {
  const device = getDeviceVariable(block);
  const searchNum = block.getFieldValue('SEARCH_NUM');
  const source = block.getFieldValue('SOURCE');
  const slope = block.getFieldValue('SLOPE');
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Configure edge search ${searchNum} on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
    code += `${device}.commands.search.search${searchNum}.edge.source.write("${source}")\n`;
    code += `${device}.commands.search.search${searchNum}.edge.slope.write("${slope}")\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${device}.write(':SEARCH:SEARCH${searchNum}:EDGE:SOURCE ${source}')\n`;
    code += `${device}.write(':SEARCH:SEARCH${searchNum}:EDGE:SLOPE ${slope}')\n`;
  }
  
  return code;
};

pythonGenerator.forBlock['search_query_total'] = function(block) {
  const device = getDeviceVariable(block);
  const searchNum = block.getFieldValue('SEARCH_NUM');
  const varId = block.getFieldValue('VARIABLE');
  const varModel = block.workspace.getVariableById(varId);
  const varName = varModel ? varModel.getName() : 'search_total';
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Query search ${searchNum} total on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
    code += `${varName} = ${device}.commands.search.search${searchNum}.total.query()\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${varName} = ${device}.query(':SEARCH:SEARCH${searchNum}:TOTAL?').strip()\n`;
  }
  
  code += `print(f"Search ${searchNum} total: {${varName}}")\n`;
  return code;
};

// Measurement Blocks

pythonGenerator.forBlock['measurement_immediate'] = function(block) {
  const device = getDeviceVariable(block);
  const type = block.getFieldValue('TYPE');
  const source = block.getFieldValue('SOURCE');
  const varId = block.getFieldValue('VARIABLE');
  const varModel = block.workspace.getVariableById(varId);
  const varName = varModel ? varModel.getName() : 'measurement';
  
  // Track device usage
  usedDevices.add(device);
  
  // Track variable assignment and usage
  variableAssignments.set(varName, block);
  variableUsages.add(varName);
  
  // Get device backend to determine proper method
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Immediate ${type} measurement on ${source} from ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree for immediate measurements
    code += `${device}.commands.measurement.immed.type.write("${type}")\n`;
    code += `${device}.commands.measurement.immed.source.write("${source}")\n`;
    code += `${varName} = float(${device}.commands.measurement.immed.value.query())\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends
    code += `${device}.write(':MEASUREMENT:IMMED:TYPE ${type}')\n`;
    code += `${device}.write(':MEASUREMENT:IMMED:SOURCE ${source}')\n`;
    code += `${varName} = float(${device}.query(':MEASUREMENT:IMMED:VALUE?').strip())\n`;
  }
  
  code += `print(f"${type} on ${source}: {${varName}}")\n`;
  return code;
};

// Acquisition Reset Block

pythonGenerator.forBlock['acquisition_reset'] = function(block) {
  const device = getDeviceVariable(block);
  
  // Track device usage
  usedDevices.add(device);
  
  // Get device backend to determine proper method
  // Check deviceBackends first (most reliable), then deviceInfoMap
  const backend = deviceBackends.get(device) || getDeviceInfo(device).backend;
  
  let code = `# Reset acquisition state on ${device}\n`;
  
  if (backend === 'tm_devices') {
    // Use tm_devices command tree
    code += `${device}.commands.acquire.state.write("OFF")\n`;
  } else {
    // Use raw SCPI for PyVISA and other backends (default)
    code += `${device}.write('ACQuire:STATE OFF')\n`;
  }
  
  return code;
};

// Validate backend compatibility BEFORE generation
export function validateBackendCompatibility(workspace: Blockly.Workspace): void {
  const forbiddenBlocks = new Map<string, string[]>();
  
  // Get all blocks in workspace
  const allBlocks = workspace.getAllBlocks(false);
  
  // Track which devices use which backends
  const deviceBackendMap = new Map<string, string>();
  
  // First pass: identify device backends
  for (const block of allBlocks) {
    if (block.type === 'connect_scope') {
      const deviceName = block.getFieldValue('DEVICE_NAME') || 'scope';
      const backend = block.getFieldValue('BACKEND');
      deviceBackendMap.set(deviceName.toLowerCase(), backend);
    }
  }
  
  // Second pass: check for forbidden blocks
  for (const block of allBlocks) {
    const blockType = block.type;
    
    // Get device context for this block
    let deviceName = '';
    try {
      const deviceContext = block.getFieldValue('DEVICE_CONTEXT');
      if (deviceContext && deviceContext !== '') {
        deviceName = deviceContext.replace(/[()]/g, '').toLowerCase();
      } else {
        // Walk back to find device context
        let currentBlock: Blockly.Block | null = block.getPreviousBlock();
        while (currentBlock) {
          if (currentBlock.type === 'set_device_context') {
            deviceName = (currentBlock.getFieldValue('DEVICE') || 'scope').toLowerCase();
            break;
          }
          if (currentBlock.type === 'connect_scope') {
            deviceName = (currentBlock.getFieldValue('DEVICE_NAME') || 'scope').toLowerCase();
            break;
          }
          currentBlock = currentBlock.getPreviousBlock();
        }
      }
    } catch (e) {
      // No device context field
    }
    
    const backend = deviceName ? deviceBackendMap.get(deviceName) : '';
    
    // Check for forbidden blocks when backend is tm_devices
    // NOTE: scpi_write and scpi_query are NOW ALLOWED - they get auto-converted to tm_devices style
    if (backend === 'tm_devices') {
      // scpi_write and scpi_query are now auto-converted, so they're allowed
      // if (blockType === 'scpi_write' || blockType === 'scpi_query') { ... }
      
      if (blockType === 'save_screenshot') {
        // save_screenshot is forbidden for tm_devices (must use tm_devices_save_screenshot)
        if (!forbiddenBlocks.has(deviceName)) {
          forbiddenBlocks.set(deviceName, []);
        }
        forbiddenBlocks.get(deviceName)!.push(blockType);
      }
      if (blockType === 'save_waveform') {
        // save_waveform is forbidden for tm_devices
        if (!forbiddenBlocks.has(deviceName)) {
          forbiddenBlocks.set(deviceName, []);
        }
        forbiddenBlocks.get(deviceName)!.push(blockType);
      }
    }
  }
  
  // If any forbidden blocks found, throw error
  if (forbiddenBlocks.size > 0) {
    const errorMessages: string[] = [];
    errorMessages.push('BACKEND CAPABILITY VIOLATION DETECTED\n');
    errorMessages.push('The following blocks are FORBIDDEN when using tm_devices backend:\n');
    
    const forbiddenEntries = Array.from(forbiddenBlocks.entries());
    for (let i = 0; i < forbiddenEntries.length; i++) {
      const [device, blocks] = forbiddenEntries[i];
      errorMessages.push(`\nDevice "${device}" (backend: tm_devices):`);
      for (let j = 0; j < blocks.length; j++) {
        const blockType = blocks[j];
        if (blockType === 'save_screenshot') {
          errorMessages.push(`  ❌ save_screenshot - Use tm_devices_save_screenshot block instead`);
        } else if (blockType === 'save_waveform') {
          errorMessages.push(`  ❌ save_waveform - Requires raw SCPI and is only supported with PyVISA backend`);
        }
      }
    }
    
    errorMessages.push('\nHOW TO FIX:');
    errorMessages.push('1. Use tm_devices_save_screenshot instead of save_screenshot');
    errorMessages.push('2. For save_waveform, switch backend to PyVISA or remove the block');
    errorMessages.push('\nNote: scpi_write/scpi_query blocks are now auto-converted to tm_devices style.');
    errorMessages.push('\nGeneration aborted. Please fix the block configuration and try again.');
    
    throw new Error(errorMessages.join('\n'));
  }
}

// Validate variable usage after generation
export function validateVariableUsage(): void {
  const unusedVars: string[] = [];
  
  const assignmentEntries = Array.from(variableAssignments.entries());
  for (const [varName] of assignmentEntries) {
    // Check if variable is used (case-insensitive check)
    const varNameLower = varName.toLowerCase();
    const isUsed = Array.from(variableUsages).some(usedVar => usedVar.toLowerCase() === varNameLower);
    
    if (!isUsed) {
      // Check if it's a loop variable (i, j, k are typically loop counters)
      if (varName !== 'i' && varName !== 'j' && varName !== 'k') {
        unusedVars.push(varName);
      }
    }
  }
  
  if (unusedVars.length > 0) {
    throw new Error(
      `UNUSED VARIABLES DETECTED\n\n` +
      `The following variables are assigned but never used:\n` +
      `  ${unusedVars.join(', ')}\n\n` +
      `HOW TO FIX:\n` +
      `1. Use these variables in python_code blocks (e.g., psu.write(f"VOLTage {voltage}"))\n` +
      `2. Use them in save_waveform filenames (e.g., "data_{voltage}V.csv")\n` +
      `3. Or remove the variable assignment blocks if they're not needed\n\n` +
      `Generation aborted. Please use or remove these variables and try again.`
    );
  }
}

// Validate that all connected devices are actually used
export function validateDeviceUsage(): void {
  const unusedDevices: string[] = [];
  const unusedDevicesWithCapabilities: Array<{ device: string; capabilities: string[] }> = [];
  
  for (const device of connectedDevices) {
    if (!usedDevices.has(device)) {
      const info = getDeviceInfo(device);
      const deviceType = info.deviceType || 'SCOPE';
      
      // Check if device can fulfill PSU role (SMU can be used as PSU)
      const canBePSU = canPerformPSUOperation(deviceType);
      const capabilities: string[] = [];
      
      if (canBePSU) {
        capabilities.push('voltage sourcing (PSU role)');
      }
      
      unusedDevices.push(device);
      unusedDevicesWithCapabilities.push({ device, capabilities });
    }
  }
  
  if (unusedDevices.length > 0) {
    let errorMsg = `UNUSED DEVICES DETECTED\n\n`;
    errorMsg += `The following devices are connected but never used:\n`;
    
    unusedDevicesWithCapabilities.forEach(({ device, capabilities }) => {
      errorMsg += `  - ${device}`;
      if (capabilities.length > 0) {
        errorMsg += ` (can perform: ${capabilities.join(', ')})`;
      }
      errorMsg += `\n`;
    });
    
    errorMsg += `\nHOW TO FIX:\n`;
    errorMsg += `1. Add SCPI commands, queries, or operations that use these devices\n`;
    errorMsg += `2. For PSU-capable devices (SMU/PSU), you can:\n`;
    errorMsg += `   - Use "SCPI Write" block with commands like "VOLTage {voltage}"\n`;
    errorMsg += `   - Use "python_code" block with device.write() or device.commands.*\n`;
    errorMsg += `3. Or remove the connection blocks if these devices aren't needed\n\n`;
    errorMsg += `Generation aborted. Please use or remove these devices and try again.`;
    
    throw new Error(errorMsg);
  }
}

// Export the generator
export { pythonGenerator };
