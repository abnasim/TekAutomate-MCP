/* ===================== Step to Block Converter ===================== */

import * as Blockly from 'blockly';
import { Step, DeviceEntry } from '../types';

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

function stripMatchingQuotes(value: string): string {
  const v = (value || '').trim();
  if (!v) return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

type ParsedTmCode = {
  method: string;
  path: string;
  arg?: string;
  variable?: string;
};

function parseTmDevicesCode(code: string): ParsedTmCode | null {
  const raw = (code || '').trim();
  if (!raw) return null;

  // Query with assignment: result = scope.commands.path.query()
  const queryAssign = raw.match(/^\s*([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*\.commands\.(.+)\.query\(\)\s*$/);
  if (queryAssign) {
    return {
      method: 'query',
      path: queryAssign[2],
      variable: queryAssign[1]
    };
  }

  // Generic method call: scope.commands.path.method(args)
  const methodCall = raw.match(/^\s*[A-Za-z_]\w*\.commands\.(.+)\.([A-Za-z_]\w*)\(([\s\S]*)\)\s*$/);
  if (methodCall) {
    const path = methodCall[1];
    const method = methodCall[2];
    const args = methodCall[3].trim();
    return {
      method,
      path,
      arg: args
    };
  }

  return null;
}

/**
 * Parse Python loop code to extract loop information
 */
function parsePythonLoop(code: string): { type: 'repeat' | 'for'; varName?: string; iterations?: number; from?: number; to?: number; step?: number; bodyCode?: string } | null {
  // Match: for i in range(5): or for i in range(0, 5, 1):
  const forLoopMatch = code.match(/for\s+(\w+)\s+in\s+range\(([^)]+)\):/);
  if (forLoopMatch) {
    const varName = forLoopMatch[1];
    const rangeArgs = forLoopMatch[2].split(',').map(s => s.trim());
    
    let from = 0, to = 0, step = 1;
    if (rangeArgs.length === 1) {
      // range(5) -> 0 to 4
      to = parseInt(rangeArgs[0]) - 1;
    } else if (rangeArgs.length === 2) {
      // range(0, 5) -> 0 to 4
      from = parseInt(rangeArgs[0]);
      to = parseInt(rangeArgs[1]) - 1;
    } else if (rangeArgs.length === 3) {
      // range(0, 5, 1) -> 0 to 4 step 1
      from = parseInt(rangeArgs[0]);
      to = parseInt(rangeArgs[1]) - 1;
      step = parseInt(rangeArgs[2]);
    }
    
    // Extract body code (everything after the for loop line, dedented)
    const lines = code.split('\n');
    const loopLineIndex = lines.findIndex(l => l.includes('for ') && l.includes(' in range'));
    if (loopLineIndex >= 0) {
      const bodyLines = lines.slice(loopLineIndex + 1);
      // Remove common indentation (4 spaces)
      // eslint-disable-next-line no-regex-spaces
      const bodyCode = bodyLines.map(l => l.replace(/^    /, '')).join('\n').trim();
      
      // Determine if it's a simple repeat or a for loop
      if (from === 0 && step === 1 && varName === 'i') {
        return { type: 'repeat', iterations: to + 1, bodyCode };
      } else {
        return { type: 'for', varName, from, to, step, bodyCode };
      }
    }
  }
  
  return null;
}

/**
 * Create a Blockly loop block from parsed loop information
 */
function createLoopBlockFromInfo(
  loopInfo: { type: 'repeat' | 'for'; varName?: string; iterations?: number; from?: number; to?: number; step?: number },
  workspace: Blockly.Workspace
): Blockly.Block | null {
  if (loopInfo.type === 'repeat' && loopInfo.iterations !== undefined) {
    const loopBlock = workspace.newBlock('controls_repeat_ext');
    const timesInput = loopBlock.getInput('TIMES');
    if (timesInput) {
      const numberBlock = workspace.newBlock('math_number');
      numberBlock.setFieldValue(loopInfo.iterations, 'NUM');
      if (numberBlock.outputConnection && timesInput.connection) {
        timesInput.connection.connect(numberBlock.outputConnection);
      }
    }
    return loopBlock;
  } else if (loopInfo.type === 'for' && loopInfo.varName && loopInfo.from !== undefined && loopInfo.to !== undefined && loopInfo.step !== undefined) {
    const loopBlock = workspace.newBlock('controls_for');
    
    // Set variable name
    const varModel = workspace.getVariable(loopInfo.varName, '');
    if (!varModel) {
      workspace.createVariable(loopInfo.varName);
    }
    loopBlock.setFieldValue(loopInfo.varName, 'VAR');
    
    // Set FROM value
    const fromInput = loopBlock.getInput('FROM');
    if (fromInput) {
      const fromBlock = workspace.newBlock('math_number');
      fromBlock.setFieldValue(loopInfo.from, 'NUM');
      if (fromBlock.outputConnection && fromInput.connection) {
        fromInput.connection.connect(fromBlock.outputConnection);
      }
    }
    
    // Set TO value
    const toInput = loopBlock.getInput('TO');
    if (toInput) {
      const toBlock = workspace.newBlock('math_number');
      toBlock.setFieldValue(loopInfo.to, 'NUM');
      if (toBlock.outputConnection && toInput.connection) {
        toInput.connection.connect(toBlock.outputConnection);
      }
    }
    
    // Set BY value
    const byInput = loopBlock.getInput('BY');
    if (byInput) {
      const byBlock = workspace.newBlock('math_number');
      byBlock.setFieldValue(loopInfo.step, 'NUM');
      if (byBlock.outputConnection && byInput.connection) {
        byInput.connection.connect(byBlock.outputConnection);
      }
    }
    
    return loopBlock;
  }
  
  return null;
}

/**
 * Parse Python code to steps (simplified - just extracts basic commands)
 */
function parsePythonCodeToSteps(code: string, devices: DeviceEntry[]): Step[] {
  const steps: Step[] = [];
  const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Match: device.write('command')
    const writeMatch = trimmed.match(/(\w+)\.write\(['"]([^'"]+)['"]\)/);
    if (writeMatch) {
      const deviceAlias = writeMatch[1];
      const command = writeMatch[2];
      const device = devices.find(d => d.alias === deviceAlias || d.id === deviceAlias);
      steps.push({
        id: `step_${Date.now()}_${Math.random()}`,
        type: 'write',
        label: `Write: ${command}`,
        params: { command },
        boundDeviceId: device?.id
      });
      continue;
    }
    
    // Match: var = device.query('command')
    const queryMatch = trimmed.match(/(\w+)\s*=\s*(\w+)\.query\(['"]([^'"]+)['"]\)/);
    if (queryMatch) {
      const varName = queryMatch[1];
      const deviceAlias = queryMatch[2];
      const command = queryMatch[3];
      const device = devices.find(d => d.alias === deviceAlias || d.id === deviceAlias);
      steps.push({
        id: `step_${Date.now()}_${Math.random()}`,
        type: 'query',
        label: `Query: ${command}`,
        params: { command, saveAs: varName },
        boundDeviceId: device?.id
      });
      continue;
    }
    
    // Match: time.sleep(duration)
    const sleepMatch = trimmed.match(/time\.sleep\(([^)]+)\)/);
    if (sleepMatch) {
      const duration = parseFloat(sleepMatch[1]);
      steps.push({
        id: `step_${Date.now()}_${Math.random()}`,
        type: 'sleep',
        label: `Sleep: ${duration}s`,
        params: { duration }
      });
      continue;
    }
    
    // Default: treat as Python code
    if (trimmed) {
      steps.push({
        id: `step_${Date.now()}_${Math.random()}`,
        type: 'python',
        label: 'Python Code',
        params: { code: trimmed }
      });
    }
  }
  
  return steps;
}

/**
 * Convert Builder steps to Blockly blocks (one-way import)
 * This allows users to import their linear steps and enhance them with loops/conditions
 */
export function convertStepsToBlocks(
  steps: Step[],
  workspace: Blockly.Workspace,
  devices: DeviceEntry[]
): void {
  console.log('convertStepsToBlocks called with:', { steps, devices, workspace });
  
  // Clear workspace first
  workspace.clear();
  console.log('Workspace cleared');
  
  let prevBlock: Blockly.Block | null = null;
  let yPosition = 20; // Starting Y position
  const xPosition = 20; // Fixed X position
  
  // Convert each step to a block
  for (const step of steps) {
    console.log('Converting step:', step);
    
    // Handle Python steps that contain loops - parse and convert to Blockly loops
    if (step.type === 'python' && step.params?.code) {
      const loopInfo = parsePythonLoop(step.params.code);
      if (loopInfo) {
        const loopBlock = createLoopBlockFromInfo(loopInfo, workspace);
        if (loopBlock) {
          // Position the loop block
          loopBlock.moveBy(xPosition, yPosition);
          yPosition += 100;
          
          // Link to previous block
          if (prevBlock && prevBlock.nextConnection && loopBlock.previousConnection) {
            prevBlock.nextConnection.connect(loopBlock.previousConnection);
          }
          
          // Parse and convert loop body to blocks
          if (loopInfo.bodyCode) {
            const bodySteps = parsePythonCodeToSteps(loopInfo.bodyCode, devices);
            const doInput = loopBlock.getInput('DO');
            if (doInput && doInput.connection) {
              const doConnection = doInput.connection;
              let childPrevBlock: Blockly.Block | null = null;
              for (const bodyStep of bodySteps) {
                const childBlock = convertStepToBlock(bodyStep, workspace, devices);
                if (childBlock) {
                  const prevConn = childBlock.previousConnection;
                  if (prevConn) {
                    childBlock.moveBy(xPosition + 40, yPosition);
                    if (!childPrevBlock) {
                      doConnection.connect(prevConn);
                      childPrevBlock = childBlock;
                    } else if (childPrevBlock.nextConnection) {
                      childPrevBlock.nextConnection.connect(prevConn);
                      childPrevBlock = childBlock;
                    }
                    yPosition += 60;
                  }
                }
              }
            }
          }
          
          prevBlock = loopBlock;
          continue;
        }
      }
    }
    
    // Regular step conversion
    const block = convertStepToBlock(step, workspace, devices);
    console.log('Created block:', block);
    
    if (block) {
      // Position the block
      block.moveBy(xPosition, yPosition);
      yPosition += 80; // Move down for next block
      console.log('Block positioned at:', xPosition, yPosition - 80);
      
      // Link to previous block
      if (prevBlock && prevBlock.nextConnection && block.previousConnection) {
        prevBlock.nextConnection.connect(block.previousConnection);
        console.log('Linked block to previous');
      }
      prevBlock = block;
    }
    
    // Handle nested steps (children in groups - groups are flattened)
    if (step.type === 'group' && step.children && step.children.length > 0) {
      console.log('Processing group children:', step.children.length);
      for (const child of step.children) {
        const childBlock = convertStepToBlock(child, workspace, devices);
        if (childBlock) {
          // Position child block
          childBlock.moveBy(xPosition, yPosition);
          yPosition += 80;
          console.log('Child block positioned at:', xPosition, yPosition - 80);
          
          if (prevBlock && prevBlock.nextConnection && childBlock.previousConnection) {
            prevBlock.nextConnection.connect(childBlock.previousConnection);
            prevBlock = childBlock;
          }
        }
      }
    }
  }
  
  console.log('Conversion complete. Total blocks:', workspace.getAllBlocks(false).length);
  
  // Force workspace to render all blocks properly (only for WorkspaceSvg)
  if ((workspace as any).rendered) {
    // Disable events during rendering to avoid triggering onChange handlers
    const eventsEnabled = Blockly.Events.isEnabled();
    Blockly.Events.disable();
    
    try {
      // Initialize and render each block
      workspace.getAllBlocks(false).forEach(block => {
        if ((block as any).initSvg) {
          (block as any).initSvg();
        }
        if ((block as any).render) {
          (block as any).render();
        }
      });
      
      // Re-enable events
      if (eventsEnabled) {
        Blockly.Events.enable();
      }
      
      // Force a complete workspace render after blocks are ready
      setTimeout(() => {
        if ((workspace as any).render) {
          (workspace as any).render();
        }
        
        // Zoom to fit all blocks
        if ((workspace as any).zoomToFit) {
          (workspace as any).zoomToFit();
        }
        
        // Trigger a resize event to force redraw
        if ((workspace as any).resize) {
          (workspace as any).resize();
        }
      }, 150);
    } catch (error) {
      console.error('Error rendering blocks:', error);
      if (eventsEnabled) {
        Blockly.Events.enable();
      }
    }
  }
  
  console.log('Blocks imported and rendered successfully');
}


/**
 * Convert a single step to a Blockly block
 */
function convertStepToBlock(
  step: Step,
  workspace: Blockly.Workspace,
  devices: DeviceEntry[]
): Blockly.Block | null {
  let block: Blockly.Block | null = null;
  
  switch (step.type) {
    case 'connect':
      block = workspace.newBlock('connect_scope');
      
      // Set device name
      const deviceName = step.params.alias || step.params.device || 'scope';
      block.setFieldValue(deviceName, 'DEVICE_NAME');
      
      // Try to find the device in the devices array to get full config
      let deviceConfig = devices.find(d => d.alias === deviceName || d.id === deviceName);
      
      // Set backend - try device config first, then step params
      const backend = deviceConfig?.backend || step.params.backend || 'pyvisa';
      block.setFieldValue(backend, 'BACKEND');
      
      // Enable advanced settings to expose connection fields
      (block as any).showAdvanced_ = true;
      (block as any).currentBackend_ = backend;
      
      // Set connection type if available
      if (deviceConfig?.connectionType) {
        const connTypeMap: Record<string, string> = {
          'tcpip': 'INSTR',
          'socket': 'SOCKET',
          'usb': 'USB',
          'gpib': 'GPIB'
        };
        (block as any).currentConnType_ = connTypeMap[deviceConfig.connectionType] || 'INSTR';
      }
      
      // Set device type if available
      if (deviceConfig?.deviceType) {
        (block as any).currentDevType_ = deviceConfig.deviceType;
      }
      
      // Update shape to render fields for the backend
      (block as any).updateShape_();
      
      // Extract IP/host address from multiple sources
      let ipAddress = step.params.host || step.params.ip || deviceConfig?.host || '192.168.1.100';
      
      // Try to extract IP from instrumentId if it's a TCPIP resource string
      if (!deviceConfig?.host && !step.params.host && !step.params.ip && step.params.instrumentId) {
        const match = step.params.instrumentId.match(/TCPIP(?:0)?::([^:]+)/i);
        if (match) {
          ipAddress = match[1];
        }
      }
      
      // Also check instrumentIds array
      if (!deviceConfig?.host && !step.params.host && !step.params.ip && step.params.instrumentIds && step.params.instrumentIds.length > 0) {
        const match = step.params.instrumentIds[0].match(/TCPIP(?:0)?::([^:]+)/i);
        if (match) {
          ipAddress = match[1];
        }
      }
      
      // Store the host value for code generation (critical fix)
      (block as any).hostValue_ = ipAddress;
      
      // Set the appropriate fields based on backend
      if (backend === 'pyvisa' || backend === 'hybrid') {
        // For PyVISA, try to set multiple fields after shape is updated
        // Capture block in const to satisfy TypeScript null check
        const connectionBlock = block;
        setTimeout(() => {
          if (!connectionBlock) return;
          if (connectionBlock.getField('HOST')) {
            connectionBlock.setFieldValue(ipAddress, 'HOST');
          }
          // Set connection type if field exists
          if (connectionBlock.getField('CONN_TYPE') && (connectionBlock as any).currentConnType_) {
            connectionBlock.setFieldValue((connectionBlock as any).currentConnType_, 'CONN_TYPE');
          }
          // Set timeout if available
          if (connectionBlock.getField('TIMEOUT_MS') && deviceConfig?.timeout) {
            connectionBlock.setFieldValue(deviceConfig.timeout.toString(), 'TIMEOUT_MS');
          }
        }, 50);
      } else if (backend === 'tm_devices' || backend === 'tekhsi' || backend === 'vxi11') {
        // For these backends, set HOST and other fields
        // Capture block in const to satisfy TypeScript null check
        const connectionBlock = block;
        setTimeout(() => {
          if (!connectionBlock) return;
          if (connectionBlock.getField('HOST')) {
            connectionBlock.setFieldValue(ipAddress, 'HOST');
          }
          // Set device type if field exists
          if (connectionBlock.getField('DEV_TYPE') && (connectionBlock as any).currentDevType_) {
            connectionBlock.setFieldValue((connectionBlock as any).currentDevType_, 'DEV_TYPE');
          }
          // Set driver if available
          if (connectionBlock.getField('DRIVER_NAME') && deviceConfig?.deviceDriver) {
            connectionBlock.setFieldValue(deviceConfig.deviceDriver, 'DRIVER_NAME');
          }
          // Set timeout if available
          if (connectionBlock.getField('TIMEOUT_SEC') && deviceConfig?.timeout) {
            // Convert ms to seconds for tm_devices
            connectionBlock.setFieldValue((deviceConfig.timeout / 1000).toString(), 'TIMEOUT_SEC');
          }
        }, 50);
      }
      break;
      
    case 'disconnect':
      block = workspace.newBlock('disconnect');
      break;
      
    case 'write':
      block = workspace.newBlock('scpi_write');
      if (step.params.command) {
        block.setFieldValue(step.params.command, 'COMMAND');
      }
      // Set device if bound
      if (step.boundDeviceId) {
        const device = devices.find(d => d.id === step.boundDeviceId);
        if (device) {
          block.setFieldValue(device.id, 'DEVICE');
        }
      }
      break;
      
    case 'query':
      block = workspace.newBlock('scpi_query');
      if (step.params.command) {
        block.setFieldValue(step.params.command, 'COMMAND');
      }
      if (step.params.saveAs) {
        block.setFieldValue(step.params.saveAs, 'VARIABLE');
      }
      // Set device if bound
      if (step.boundDeviceId) {
        const device = devices.find(d => d.id === step.boundDeviceId);
        if (device) {
          block.setFieldValue(device.id, 'DEVICE');
        }
      }
      break;
      
    case 'sleep':
      block = workspace.newBlock('wait_seconds');
      if (step.params.duration) {
        block.setFieldValue(step.params.duration, 'SECONDS');
      }
      break;
      
    case 'comment':
      block = workspace.newBlock('comment_block');
      if (step.params.text) {
        block.setFieldValue(step.params.text, 'COMMENT');
      }
      break;
      
    case 'python':
      block = workspace.newBlock('python_code');
      if (step.params.code) {
        block.setFieldValue(step.params.code, 'CODE');
      }
      break;
      
    case 'save_waveform':
      block = workspace.newBlock('save_waveform');
      if (step.params.source) {
        block.setFieldValue(step.params.source, 'SOURCE');
      }
      if (step.params.filename) {
        block.setFieldValue(step.params.filename, 'FILENAME');
      }
      if (step.params.format) {
        block.setFieldValue(step.params.format, 'FORMAT');
      }
      break;
      
    case 'save_screenshot':
      block = workspace.newBlock('save_screenshot');
      if (step.params.filename) {
        block.setFieldValue(step.params.filename, 'FILENAME');
      }
      if (step.params.scopeType) {
        // Map scopeType to SCOPE_TYPE field
        const scopeTypeMap: Record<string, string> = {
          'modern': 'MODERN',
          'legacy': 'LEGACY'
        };
        block.setFieldValue(scopeTypeMap[step.params.scopeType] || 'MODERN', 'SCOPE_TYPE');
      }
      break;
      
    case 'recall':
      block = workspace.newBlock('recall');
      if (step.params.recallType) {
        block.setFieldValue(step.params.recallType, 'RECALL_TYPE');
      }
      if (step.params.filePath) {
        block.setFieldValue(step.params.filePath, 'FILE_PATH');
      }
      if (step.params.reference) {
        block.setFieldValue(step.params.reference, 'REFERENCE');
      }
      break;
      
    case 'set_and_query':
      // Preserve set_and_query semantics on the block so roundtrip/export can restore it.
      block = workspace.newBlock('scpi_write');
      if (step.params.command) {
        block.setFieldValue(step.params.command, 'COMMAND');
      }
      if (step.boundDeviceId) {
        const device = devices.find(d => d.id === step.boundDeviceId);
        if (device) {
          block.setFieldValue(device.id, 'DEVICE');
        }
      }
      block.data = JSON.stringify({
        tekAutomator: {
          kind: 'set_and_query',
          saveAs: step.params.saveAs || 'result',
          queryCommand: step.params.queryCommand || inferSetAndQueryQueryCommand(step.params.command || ''),
          params: step.params
        }
      });
      break;
      
    case 'error_check':
      // Convert error_check to a query block
      block = workspace.newBlock('scpi_query');
      if (step.params.command) {
        block.setFieldValue(step.params.command, 'COMMAND');
      }
      block.setFieldValue('errors', 'VARIABLE');
      break;
      
    case 'tm_device_command':
      // Convert tm_device_command to tm_devices blocks when possible.
      // Fallback to python_code only for unsupported method shapes.
      {
        const code = String(step.params.code || '').trim();
        const parsed = parseTmDevicesCode(code);

        if (parsed && parsed.method === 'write') {
          block = workspace.newBlock('tm_devices_write');
          block.setFieldValue(parsed.path, 'PATH');
          block.setFieldValue(stripMatchingQuotes(parsed.arg || step.params.value || ''), 'VALUE');
        } else if (parsed && parsed.method === 'verify') {
          // verify(value) maps best to write-like UI block with value
          block = workspace.newBlock('tm_devices_write');
          block.setFieldValue(parsed.path, 'PATH');
          block.setFieldValue(stripMatchingQuotes(parsed.arg || step.params.value || ''), 'VALUE');
        } else if (parsed && parsed.method === 'query') {
          block = workspace.newBlock('tm_devices_query');
          block.setFieldValue(parsed.path, 'PATH');
          block.setFieldValue(parsed.variable || step.params.saveAs || 'result', 'VARIABLE');
        } else if (step.params.commandPath) {
          const rawPath = String(step.params.commandPath).replace(/^commands\./, '');
          if (rawPath.endsWith('.query')) {
            block = workspace.newBlock('tm_devices_query');
            block.setFieldValue(rawPath.replace(/\.query$/, ''), 'PATH');
            block.setFieldValue(step.params.saveAs || 'result', 'VARIABLE');
          } else if (rawPath.endsWith('.write')) {
            block = workspace.newBlock('tm_devices_write');
            block.setFieldValue(rawPath.replace(/\.write$/, ''), 'PATH');
            block.setFieldValue(stripMatchingQuotes(step.params.args || step.params.value || ''), 'VALUE');
          }
        }

        if (!block) {
          block = workspace.newBlock('python_code');
          if (code) {
            block.setFieldValue(code, 'CODE');
          }
        }

        // Preserve device context if available
        if (step.boundDeviceId) {
          const device = devices.find(d => d.id === step.boundDeviceId);
          if (device && (block.type === 'tm_devices_write' || block.type === 'tm_devices_query')) {
            try {
              block.setFieldValue(device.alias || device.id, 'DEVICE');
            } catch {
              // Ignore if block does not expose DEVICE field
            }
          }
        }
      }
      break;
      
    case 'group':
      // Groups are flattened - their children become sequential blocks
      // This is handled by the parent loop checking step.children
      return null;
      
      
    default:
      // Unknown step type - create a comment
      block = workspace.newBlock('comment_block');
      block.setFieldValue(`Unsupported step type: ${step.type}\nLabel: ${step.label}`, 'COMMENT');
      break;
  }
  
  // Note: Don't call initSvg() here - blocks will be initialized when added to workspace
  
  return block;
}
