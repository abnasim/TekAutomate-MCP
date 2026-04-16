/* ===================== Block to Step Converter ===================== */

import * as Blockly from 'blockly';
import { Step, DeviceEntry } from '../types';

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

/**
 * Convert Blockly blocks to Steps (opposite direction of stepToBlock)
 * This enables exporting from Blockly back to Steps UI
 */
export function convertBlocksToSteps(
  workspace: Blockly.Workspace,
  devices: DeviceEntry[] = []
): Step[] {
  console.log('Converting Blockly blocks to Steps...');
  
  const steps: Step[] = [];
  const topBlocks = workspace.getTopBlocks(true);
  
  for (const block of topBlocks) {
    const convertedSteps = convertBlockChainToSteps(block, '', devices);
    steps.push(...convertedSteps);
  }
  
  console.log('Converted to steps:', steps);
  console.log('Total steps:', steps.length);
  // Log Python steps with loops
  steps.forEach((step, idx) => {
    if (step.type === 'python' && step.params?.code && (step.params.code.includes('for ') || step.params.code.includes('while '))) {
      console.log(`Step ${idx}: Python loop "${step.label}"`);
    }
  });
  return steps;
}

/**
 * Convert a chain of connected blocks to steps
 * @param block - Starting block in the chain
 * @param currentDevice - Current device context (device alias/name)
 * @param devices - Available devices list for resolving device IDs
 */
function convertBlockChainToSteps(block: Blockly.Block | null, currentDevice: string, devices: DeviceEntry[]): Step[] {
  const steps: Step[] = [];
  let currentBlock = block;
  let stepIndex = 0;
  let deviceContext = currentDevice;
  
  while (currentBlock) {
    // Update device context if this block sets it
    if (currentBlock.type === 'set_device_context') {
      deviceContext = currentBlock.getFieldValue('DEVICE') || deviceContext;
    } else if (currentBlock.type === 'connect_scope') {
      deviceContext = currentBlock.getFieldValue('DEVICE_NAME') || deviceContext;
    }
    
    const step = convertBlockToStep(currentBlock, stepIndex, deviceContext, devices);
    if (step) {
      steps.push(step);
      stepIndex++;
    }
    
    // Move to next block in chain (sibling, not child)
    // Loop blocks can have next blocks after them, so we continue
    currentBlock = currentBlock.getNextBlock();
  }
  
  return steps;
}

/**
 * Convert a single Blockly block to a Step object
 * @param block - The Blockly block to convert
 * @param index - Step index for unique ID generation
 * @param currentDevice - Current device context (for device binding)
 * @param devices - Available devices list for resolving device IDs
 */
function convertBlockToStep(block: Blockly.Block, index: number, currentDevice: string = '', devices: DeviceEntry[] = []): Step | null {
  const blockType = block.type;
  // Use block.id in the exported step id to guarantee uniqueness across multiple
  // top-level chains. The previous Date.now()+index approach could collide.
  const id = `step_${Date.now()}_${index}_${block.id}`;
  
  // Helper to find device by alias/name and return its ID (case-insensitive)
  const findDeviceId = (alias: string): string | undefined => {
    if (!alias) return undefined;
    const aliasLower = alias.toLowerCase();
    const device = devices.find(d => 
      d.alias?.toLowerCase() === aliasLower || 
      d.id === alias ||
      d.id?.toLowerCase() === aliasLower
    );
    return device?.id;
  };
  
  // Helper to get device name for binding
  const getDeviceForBinding = (): string | undefined => {
    if (blockType === 'set_device_context') {
      const deviceName = block.getFieldValue('DEVICE') || '';
      return findDeviceId(deviceName) || deviceName;
    }
    // For other blocks, use current device context if set
    if (currentDevice) {
      return findDeviceId(currentDevice) || currentDevice;
    }
    return undefined;
  };
  
  switch (blockType) {
    case 'connect_scope': {
      const deviceName = block.getFieldValue('DEVICE_NAME') || 'scope';
      const deviceId = findDeviceId(deviceName);
      
      // Get backend: prioritize device config, then block field, then default
      // This ensures the configured backend is preserved during round-trip conversion
      const deviceConfig = devices.find(d => 
        d.alias === deviceName || 
        d.id === deviceName ||
        d.alias?.toLowerCase() === deviceName.toLowerCase() ||
        d.id?.toLowerCase() === deviceName.toLowerCase()
      );
      const backend = deviceConfig?.backend || block.getFieldValue('BACKEND') || 'pyvisa';
      
      const connType = block.getFieldValue('CONN_TYPE') || 'TCPIP';
      const host = block.getFieldValue('HOST') || block.getFieldValue('IP') || deviceConfig?.host || '192.168.1.100';
      const visaBackend = block.getFieldValue('VISA_BACKEND_TYPE') || '@py';
      const timeout = block.getFieldValue('TIMEOUT_MS') || '5000';
      
      const params: any = {
        host: host,
        backend: backend,
        alias: deviceName,
        device: deviceName,
        connectionType: connType,
        visaBackend: visaBackend,
        timeout: parseInt(timeout)
      };
      
      // Set instrumentId if device was found
      if (deviceId) {
        params.instrumentId = deviceId;
        params.instrumentIds = [];
      }
      
      return {
        id,
        type: 'connect',
        label: `Connect to ${deviceName} (${backend})`,
        params
      };
    }
    
    // TekExpress connection
    case 'connect_tekexpress': {
      const deviceName = block.getFieldValue('DEVICE_NAME') || 'tekexp';
      const host = block.getFieldValue('HOST') || '127.0.0.1';
      const port = block.getFieldValue('PORT') || '5000';
      
      return {
        id,
        type: 'connect',
        label: `Connect TekExpress: ${host}:${port}`,
        params: {
          host: host,
          port: parseInt(port),
          backend: 'tekexpress',
          alias: deviceName,
          device: deviceName
        }
      };
    }
      
    case 'disconnect':
      return {
        id,
        type: 'disconnect',
        label: 'Disconnect',
        params: {}
      };
      
    // TekExpress blocks
    case 'tekexp_write': {
      const command = block.getFieldValue('COMMAND') || '';
      return {
        id,
        type: 'write',
        label: `TekExp Write: ${command.substring(0, 40)}`,
        params: {
          command: command,
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_query': {
      const command = block.getFieldValue('COMMAND') || '';
      const variable = block.getFieldValue('VARIABLE') || 'result';
      return {
        id,
        type: 'query',
        label: `TekExp Query: ${command.substring(0, 40)}`,
        params: {
          command: command,
          saveAs: variable,
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_run': {
      return {
        id,
        type: 'write',
        label: 'TekExpress Run',
        params: {
          command: 'TEKEXP:RUN',
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_wait_state': {
      const targetState = block.getFieldValue('STATE') || 'COMPLETE';
      const timeout = block.getFieldValue('TIMEOUT') || '300';
      return {
        id,
        type: 'python',
        label: `Wait for TekExpress: ${targetState}`,
        params: {
          code: `# Wait for TekExpress state: ${targetState}\nimport time\n_timeout = ${timeout}\n_start = time.time()\nwhile time.time() - _start < _timeout:\n    _state = tekexp.query('TEKEXP:STATE?').strip()\n    if _state == '${targetState}':\n        break\n    if _state == 'ERROR':\n        raise Exception('TekExpress error')\n    time.sleep(1)`
        }
      };
    }
    
    case 'tekexp_popup': {
      const action = block.getFieldValue('ACTION') || 'YES';
      const variable = block.getFieldValue('VARIABLE') || 'popup_msg';
      return {
        id,
        type: 'python',
        label: `TekExpress Popup: ${action}`,
        params: {
          code: `# Handle TekExpress popup\n${variable} = tekexp.query('TEKEXP:POPUP?').strip()\nif ${variable}:\n    tekexp.write('TEKEXP:POPUP ${action}')`
        }
      };
    }
    
    case 'tekexp_select_device': {
      const deviceType = block.getFieldValue('DEVICE_TYPE') || 'DUT';
      const deviceName = block.getFieldValue('DEVICE') || '';
      return {
        id,
        type: 'write',
        label: `TekExp Select Device: ${deviceType}`,
        params: {
          command: `TEKEXP:SELECT DEVICE,"${deviceType}","${deviceName}"`,
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_select_test': {
      const testName = block.getFieldValue('TEST_NAME') || '';
      const value = block.getFieldValue('VALUE') || 'TRUE';
      return {
        id,
        type: 'write',
        label: `TekExp Select Test: ${testName}`,
        params: {
          command: `TEKEXP:SELECT TEST,"${testName}",${value}`,
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_set_value': {
      const parameter = block.getFieldValue('PARAMETER') || '';
      const value = block.getFieldValue('VALUE') || '';
      return {
        id,
        type: 'write',
        label: `TekExp Set: ${parameter}`,
        params: {
          command: `TEKEXP:VALUE "${parameter}","${value}"`,
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_export_report': {
      const format = block.getFieldValue('FORMAT') || 'PDF';
      const path = block.getFieldValue('PATH') || '';
      return {
        id,
        type: 'write',
        label: `TekExp Export Report: ${format}`,
        params: {
          command: `TEKEXP:EXPORT REPORT,"${format}","${path}"`,
          backend: 'tekexpress'
        }
      };
    }
    
    case 'tekexp_last_error': {
      const variable = block.getFieldValue('VARIABLE') || 'error_msg';
      return {
        id,
        type: 'query',
        label: 'TekExpress Last Error',
        params: {
          command: 'TEKEXP:LASTERROR?',
          saveAs: variable,
          backend: 'tekexpress'
        }
      };
    }
      
    case 'scpi_write': {
      const device = getDeviceForBinding();
      const command = block.getFieldValue('COMMAND') || '';
      const setAndQueryMeta = getSetAndQueryMetadata(block);
      if (setAndQueryMeta?.kind === 'set_and_query') {
        const params = {
          ...(setAndQueryMeta.params || {}),
          command,
          saveAs: setAndQueryMeta.saveAs || setAndQueryMeta.params?.saveAs || 'result',
          queryCommand: setAndQueryMeta.queryCommand || setAndQueryMeta.params?.queryCommand
        };
        const step: Step = {
          id,
          type: 'set_and_query',
          label: `Set+Query: ${command}`,
          params
        };
        if (device) {
          step.boundDeviceId = device;
        }
        return step;
      }

      const step: Step = {
        id,
        type: 'write',
        label: `SCPI Write: ${command}`,
        params: {
          command
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
      
    case 'scpi_query': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'query',
        label: `SCPI Query: ${block.getFieldValue('COMMAND')}`,
        params: {
          command: block.getFieldValue('COMMAND') || '',
          saveAs: block.getFieldValue('VARIABLE') || 'result'
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
      
    case 'wait_seconds':
      return {
        id,
        type: 'sleep',
        label: `Wait ${block.getFieldValue('SECONDS')}s`,
        params: {
          duration: parseFloat(block.getFieldValue('SECONDS')) || 1
        }
      };
      
    case 'wait_for_opc': {
      const deviceId = getDeviceForBinding();
      // Get device name for Python code (use currentDevice context or fallback)
      const deviceName = currentDevice || 'scope';
      const timeout = block.getFieldValue('TIMEOUT') || '10';
      // Use atomic OPC approach - set timeout, send *OPC?, then read (blocks until complete)
      const step: Step = {
        id,
        type: 'python',
        label: 'Wait for OPC',
        params: {
          code: `# Atomic OPC wait on ${deviceName}\n${deviceName}.timeout = ${timeout} * 1000  # Set timeout in ms\n${deviceName}.write('*OPC?')\n${deviceName}.read()  # Blocks until operation complete`
        }
      };
      if (deviceId) {
        step.boundDeviceId = deviceId;
      }
      return step;
    }
      
    case 'comment_block':
      return {
        id,
        type: 'comment',
        label: 'Comment',
        params: {
          text: block.getFieldValue('COMMENT') || ''
        }
      };
      
    case 'enable_channel': {
      const device = getDeviceForBinding();
      const channel = block.getFieldValue('CHANNEL') || 'CH1';
      const state = block.getFieldValue('STATE') || 'ON';
      // Use canonical ON/OFF (not TRUE/FALSE)
      const canonicalState = state === 'TRUE' ? 'ON' : (state === 'FALSE' ? 'OFF' : state);
      const step: Step = {
        id,
        type: 'write',
        label: `Enable ${channel}: ${canonicalState}`,
        params: {
          command: `SELECT:${channel} ${canonicalState}`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'configure_channel': {
      const device = getDeviceForBinding();
      const channel = block.getFieldValue('CHANNEL') || 'CH1';
      const scale = block.getFieldValue('SCALE') || '1.0';
      const offset = block.getFieldValue('OFFSET') || '0';
      const coupling = block.getFieldValue('COUPLING') || 'DC';
      const termination = block.getFieldValue('TERMINATION') || 'ONEMEG';
      // Return as Python step with multiple commands
      let code = `# Configure ${channel}\n${currentDevice || 'scope'}.write('${channel}:SCALE ${scale}')\n${currentDevice || 'scope'}.write('${channel}:OFFSET ${offset}')\n${currentDevice || 'scope'}.write('${channel}:COUPLING ${coupling}')`;
      if (termination) {
        code += `\n${currentDevice || 'scope'}.write('${channel}:TERMINATION ${termination}')`;
      }
      const step: Step = {
        id,
        type: 'python',
        label: `Configure ${channel}`,
        params: {
          code
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'acquisition_reset': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'write',
        label: 'Reset Acquisition',
        params: {
          command: 'ACQuire:STATE OFF'
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'single_acquisition': {
      const device = getDeviceForBinding();
      const deviceName = currentDevice || 'scope';
      // Single acquisition setup - separate wait_for_opc block handles completion
      const step: Step = {
        id,
        type: 'python',
        label: 'Single Acquisition',
        params: {
          code: `# Single acquisition setup\n${deviceName}.write('ACQUIRE:STOPAFTER SEQUENCE')\n${deviceName}.write('ACQUIRE:STATE ON')`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'start_acquisition': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'write',
        label: 'Start Acquisition',
        params: {
          command: 'ACQuire:STATE RUN'
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'stop_acquisition': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'write',
        label: 'Stop Acquisition',
        params: {
          command: 'ACQuire:STATE STOP'
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'save_screenshot': {
      const device = getDeviceForBinding();
      const filename = block.getFieldValue('FILENAME') || 'screenshot.png';
      const format = block.getFieldValue('FORMAT') || 'PNG';
      const deviceName = currentDevice || 'scope';
      const step: Step = {
        id,
        type: 'python',
        label: `Save Screenshot: ${filename}`,
        params: {
          code: `# Save screenshot\n${deviceName}.write('SAVE:IMAGE "${filename}"')\n${deviceName}.write('SAVE:IMAGE:FILEFORMAT ${format}')\n${deviceName}.write('SAVE:IMAGE:START')`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'custom_command': {
      const device = getDeviceForBinding();
      const command = block.getFieldValue('COMMAND') || '';
      const step: Step = {
        id,
        type: 'write',
        label: `Custom: ${command.substring(0, 30)}...`,
        params: {
          command: command
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    // tm_devices specific blocks - use tm_device_command step type
    case 'tm_devices_save_screenshot': {
      const device = getDeviceForBinding();
      const filename = block.getFieldValue('FILENAME') || 'screenshot.png';
      const format = block.getFieldValue('FORMAT') || 'PNG';
      const localFolder = block.getFieldValue('LOCAL_FOLDER') || '';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Save Screenshot: ${filename}`,
        params: {
          commandPath: 'save_screenshot',
          args: `"${filename}"`,
          format: format,
          localFolder: localFolder
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    // tm_devices generic write
    case 'tm_devices_write': {
      const device = getDeviceForBinding();
      const path = block.getFieldValue('PATH') || '';
      const value = block.getFieldValue('VALUE') || '';
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _deviceName = currentDevice || 'scope';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `tm_devices Write: ${path}`,
        params: {
          commandPath: `commands.${path}.write`,
          args: value ? `${value}` : ''
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    // tm_devices generic query
    case 'tm_devices_query': {
      const device = getDeviceForBinding();
      const path = block.getFieldValue('PATH') || '';
      const variable = block.getFieldValue('VARIABLE') || 'result';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `tm_devices Query: ${path}`,
        params: {
          commandPath: `commands.${path}.query`,
          saveAs: variable
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    // tm_devices convenience blocks
    case 'tm_devices_save_session': {
      const device = getDeviceForBinding();
      const filename = block.getFieldValue('FILENAME') || 'session.tss';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Save Session: ${filename}`,
        params: {
          commandPath: 'commands.save.session.write',
          args: `"${filename}"`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_recall_session': {
      const device = getDeviceForBinding();
      const filename = block.getFieldValue('FILENAME') || 'session.tss';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Recall Session: ${filename}`,
        params: {
          commandPath: 'recall_session',
          args: `"${filename}"`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_save_waveform': {
      const device = getDeviceForBinding();
      const source = block.getFieldValue('SOURCE') || 'CH1';
      const filename = block.getFieldValue('FILENAME') || 'waveform.wfm';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Save Waveform ${source}: ${filename}`,
        params: {
          commandPath: 'commands.save.waveform.write',
          args: `"${source}", "${filename}"`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_recall_reference': {
      const device = getDeviceForBinding();
      const filename = block.getFieldValue('FILENAME') || 'ref.wfm';
      const refNum = block.getFieldValue('REF_NUM') || '1';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Recall Reference: ${filename}`,
        params: {
          commandPath: 'recall_reference',
          args: `"${filename}", ${refNum}`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_reset': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: 'Reset Device',
        params: {
          commandPath: 'reset',
          args: ''
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_channel_on_off': {
      const device = getDeviceForBinding();
      const channel = block.getFieldValue('CHANNEL') || '1';
      const state = block.getFieldValue('STATE') || 'ON';
      const method = state === 'ON' ? 'turn_channel_on' : 'turn_channel_off';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Channel ${channel}: ${state}`,
        params: {
          commandPath: method,
          args: `"CH${channel}"`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_add_math': {
      const device = getDeviceForBinding();
      const deviceName = device || 'scope';
      const mathNum = block.getFieldValue('MATH_NUM') || '1';
      const source = block.getFieldValue('SOURCE') || 'CH1';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Add Math ${mathNum}: ${source}`,
        params: {
          code: `${deviceName}.add_new_math("MATH${mathNum}", "${source}")`,
          commandPath: 'add_new_math',
          args: `"MATH${mathNum}", "${source}"`,
          description: `Add Math ${mathNum} with source ${source}`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'tm_devices_set_and_check': {
      const device = getDeviceForBinding();
      const deviceName = device || 'scope';
      const command = block.getFieldValue('COMMAND') || '';
      const value = block.getFieldValue('VALUE') || '';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Set & Check: ${command}`,
        params: {
          code: `${deviceName}.set_and_check("${command}", "${value}")`,
          commandPath: 'set_and_check',
          args: `"${command}", "${value}"`,
          description: `Set ${command} to ${value} and verify`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'fastframe_enable': {
      const device = getDeviceForBinding();
      const deviceName = device || 'scope';
      const state = block.getFieldValue('STATE') || 'ON';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `FastFrame: ${state}`,
        params: {
          code: `${deviceName}.commands.horizontal.fastframe.state.write("${state}")`,
          commandPath: 'commands.horizontal.fastframe.state.write',
          args: `"${state}"`,
          description: `Enable/disable FastFrame acquisition`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'fastframe_set_count': {
      const device = getDeviceForBinding();
      const deviceName = device || 'scope';
      const count = block.getFieldValue('COUNT') || '10';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `FastFrame Count: ${count}`,
        params: {
          code: `${deviceName}.commands.horizontal.fastframe.count.write(${count})`,
          commandPath: 'commands.horizontal.fastframe.count.write',
          args: count,
          description: `Set FastFrame count to ${count}`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'fastframe_select_frame': {
      const device = getDeviceForBinding();
      const deviceName = device || 'scope';
      const channel = block.getFieldValue('CHANNEL') || 'CH1';
      // Get frame value - could be a number or variable
      const frameInput = block.getInputTargetBlock('FRAME');
      let frameValue = '1';
      if (frameInput) {
        frameValue = convertExpressionToPython(frameInput);
      }
      const commandPath = `commands.horizontal.fastframe.selected.${channel.toLowerCase()}.write`;
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Select Frame for ${channel}`,
        params: {
          code: `${deviceName}.${commandPath}(${frameValue})`,
          commandPath: commandPath,
          args: frameValue,
          description: `Select frame ${frameValue} for ${channel}`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'search_configure_edge': {
      const device = getDeviceForBinding();
      const searchNum = block.getFieldValue('SEARCH_NUM') || '1';
      const source = block.getFieldValue('SOURCE') || 'CH1';
      const slope = block.getFieldValue('SLOPE') || 'RISE';
      // This needs multiple commands, so use Python step
      const deviceName = currentDevice || 'scope';
      const step: Step = {
        id,
        type: 'python',
        label: `Configure Edge Search ${searchNum}`,
        params: {
          code: `# Configure edge search ${searchNum}\n${deviceName}.commands.search.search${searchNum}.edge.source.write("${source}")\n${deviceName}.commands.search.search${searchNum}.edge.slope.write("${slope}")`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'search_query_total': {
      const device = getDeviceForBinding();
      const searchNum = block.getFieldValue('SEARCH_NUM') || '1';
      const variable = block.getFieldValue('VARIABLE') || 'hits';
      const step: Step = {
        id,
        type: 'tm_device_command',
        label: `Query Search ${searchNum} Total`,
        params: {
          commandPath: `commands.search.search${searchNum}.total.query`,
          saveAs: variable
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
    
    case 'measurement_immediate': {
      const device = getDeviceForBinding();
      const measType = block.getFieldValue('TYPE') || 'PK2PK';
      const source = block.getFieldValue('SOURCE') || 'CH1';
      const variable = block.getFieldValue('VARIABLE') || 'measurement';
      const deviceName = currentDevice || 'scope';
      // Measurement requires multiple commands, use Python step
      const step: Step = {
        id,
        type: 'python',
        label: `Measure ${measType} on ${source}`,
        params: {
          code: `# Immediate ${measType} measurement on ${source}\n${deviceName}.write(":MEASUREMENT:IMMED:TYPE ${measType}")\n${deviceName}.write(":MEASUREMENT:IMMED:SOURCE ${source}")\n${variable} = float(${deviceName}.query(":MEASUREMENT:IMMED:VALUE?").strip())\nprint(f"${measType} on ${source}: {${variable}}")`
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
      
    case 'python_code': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'python',
        label: 'Python Code',
        params: {
          code: block.getFieldValue('CODE') || ''
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
      
    case 'save_waveform': {
      const device = getDeviceForBinding();
      const step: Step = {
        id,
        type: 'save_waveform',
        label: `Save Waveform: ${block.getFieldValue('FILENAME')}`,
        params: {
          source: block.getFieldValue('SOURCE') || 'CH1',
          filename: block.getFieldValue('FILENAME') || 'waveform',
          format: block.getFieldValue('FORMAT') || 'CSV'
        }
      };
      if (device) {
        step.boundDeviceId = device;
      }
      return step;
    }
      
    case 'controls_repeat_ext':
    case 'controls_repeat': {
      // Repeat loop - convert to Python step for cross-compatibility
      const timesInput = block.getInputTargetBlock('TIMES');
      let iterations = 10;
      
      if (timesInput) {
        if (timesInput.type === 'math_number') {
          iterations = parseInt(timesInput.getFieldValue('NUM')) || 10;
        } else {
          // Try to evaluate expression
          const expr = convertExpressionToPython(timesInput);
          try {
            iterations = parseInt(expr) || 10;
          } catch {
            iterations = 10;
          }
        }
      }
      
      // Get child blocks inside the loop (preserve device context)
      const doBlock = block.getInputTargetBlock('DO');
      const children = doBlock ? convertBlockChainToSteps(doBlock, currentDevice, devices) : [];
      
      console.log(`[BlockToStep] Repeat loop: ${iterations} iterations, ${children.length} children`);
      console.log(`[BlockToStep] Children:`, children.map(c => ({ type: c.type, label: c.label })));
      
      // Convert children to Python code
      const childCode = convertStepsToPythonCode(children, devices, '    ');
      
      // Generate Python loop code
      const pythonCode = `# Repeat ${iterations} times\nfor i in range(${iterations}):\n${childCode}`;
      
      return {
        id,
        type: 'python',
        label: `Repeat ${iterations} times`,
        params: {
          code: pythonCode
        }
      };
    }
      
    case 'controls_for': {
      // For loop with index variable - convert to Python step for cross-compatibility
      const varId = block.getFieldValue('VAR') || 'i';
      // Get actual variable name from workspace
      const varModel = block.workspace.getVariableById(varId);
      const varName = varModel ? varModel.getName() : 'i';
      
      const fromInput = block.getInputTargetBlock('FROM');
      const toInput = block.getInputTargetBlock('TO');
      const byInput = block.getInputTargetBlock('BY');
      
      let fromValue = 0;
      let toValue = 10;
      let byValue = 1;
      
      if (fromInput && fromInput.type === 'math_number') {
        fromValue = parseFloat(fromInput.getFieldValue('NUM')) || 0;
      } else if (fromInput) {
        // Try to evaluate expression
        const fromExpr = convertExpressionToPython(fromInput);
        try {
          fromValue = parseFloat(fromExpr) || 0;
        } catch {
          fromValue = 0;
        }
      }
      
      if (toInput && toInput.type === 'math_number') {
        toValue = parseFloat(toInput.getFieldValue('NUM')) || 10;
      } else if (toInput) {
        const toExpr = convertExpressionToPython(toInput);
        try {
          toValue = parseFloat(toExpr) || 10;
        } catch {
          toValue = 10;
        }
      }
      
      if (byInput && byInput.type === 'math_number') {
        byValue = parseFloat(byInput.getFieldValue('NUM')) || 1;
      } else if (byInput) {
        const byExpr = convertExpressionToPython(byInput);
        try {
          byValue = parseFloat(byExpr) || 1;
        } catch {
          byValue = 1;
        }
      }
      
      // Get child blocks inside the loop (preserve device context)
      const doBlock = block.getInputTargetBlock('DO');
      const children = doBlock ? convertBlockChainToSteps(doBlock, currentDevice, devices) : [];
      
      console.log(`[BlockToStep] For loop: ${varName} from ${fromValue} to ${toValue} step ${byValue}, ${children.length} children`);
      console.log(`[BlockToStep] Children:`, children.map(c => ({ type: c.type, label: c.label })));
      
      // Convert children to Python code
      const childCode = convertStepsToPythonCode(children, devices, '    ');
      
      // Generate Python for loop code
      // Blockly "from X to Y" is inclusive, so we use range(from, to+1, step)
      let pythonCode = '';
      if (byValue === 1 && fromValue === 0) {
        // Simple case: for i in range(to+1)
        pythonCode = `# For loop: ${varName} from ${fromValue} to ${toValue} step ${byValue}\nfor ${varName} in range(${Math.floor(toValue) + 1}):\n${childCode}`;
      } else {
        // General case: for i in range(from, to+1, step)
        pythonCode = `# For loop: ${varName} from ${fromValue} to ${toValue} step ${byValue}\nfor ${varName} in range(${Math.floor(fromValue)}, ${Math.floor(toValue) + 1}, ${Math.floor(byValue)}):\n${childCode}`;
      }
      
      return {
        id,
        type: 'python',
        label: `For ${varName} = ${fromValue} to ${toValue} step ${byValue}`,
        params: {
          code: pythonCode
        }
      };
    }
      
    case 'set_device_context':
      // Device context is handled by updating currentDevice in convertBlockChainToSteps
      // Return null to skip adding a step (device binding is applied to subsequent steps)
      return null;
      
    case 'variables_set': {
      // Variable assignment - convert to Python step
      const varId = block.getFieldValue('VAR');
      // Get actual variable name from workspace
      const varModel = block.workspace.getVariableById(varId);
      const varName = varModel ? varModel.getName() : 'var';
      
      const valueBlock = block.getInputTargetBlock('VALUE');
      let pythonCode = `${varName} = `;
      
      if (valueBlock) {
        pythonCode += convertExpressionToPython(valueBlock);
      } else {
        pythonCode += '0';
      }
      
      return {
        id,
        type: 'python',
        label: `Set ${varName}`,
        params: {
          code: pythonCode
        }
      };
    }
    
    case 'controls_if': {
      // If/else conditional - convert to Python step
      // Get the number of else-if and else clauses from mutation
      const elseifCount = (block as any).elseifCount_ || 0;
      const hasElse = (block as any).elseCount_ === 1;
      
      let pythonCode = '';
      
      // Main IF clause
      const ifCondition = block.getInputTargetBlock('IF0');
      const ifBody = block.getInputTargetBlock('DO0');
      const conditionStr = ifCondition ? convertExpressionToPython(ifCondition) : 'True';
      
      pythonCode += `if ${conditionStr}:\n`;
      if (ifBody) {
        const ifSteps = convertBlockChainToSteps(ifBody, currentDevice, devices);
        const ifCode = convertStepsToPythonCode(ifSteps, devices, '    ');
        pythonCode += ifCode || '    pass\n';
      } else {
        pythonCode += '    pass\n';
      }
      
      // ELIF clauses
      for (let i = 1; i <= elseifCount; i++) {
        const elifCondition = block.getInputTargetBlock(`IF${i}`);
        const elifBody = block.getInputTargetBlock(`DO${i}`);
        const elifCondStr = elifCondition ? convertExpressionToPython(elifCondition) : 'True';
        
        pythonCode += `elif ${elifCondStr}:\n`;
        if (elifBody) {
          const elifSteps = convertBlockChainToSteps(elifBody, currentDevice, devices);
          const elifCode = convertStepsToPythonCode(elifSteps, devices, '    ');
          pythonCode += elifCode || '    pass\n';
        } else {
          pythonCode += '    pass\n';
        }
      }
      
      // ELSE clause
      if (hasElse) {
        const elseBody = block.getInputTargetBlock('ELSE');
        pythonCode += `else:\n`;
        if (elseBody) {
          const elseSteps = convertBlockChainToSteps(elseBody, currentDevice, devices);
          const elseCode = convertStepsToPythonCode(elseSteps, devices, '    ');
          pythonCode += elseCode || '    pass\n';
        } else {
          pythonCode += '    pass\n';
        }
      }
      
      return {
        id,
        type: 'python',
        label: 'If/Else',
        params: {
          code: pythonCode.trim()
        }
      };
    }
    
    case 'controls_whileUntil': {
      // While/Until loop - convert to Python step
      const mode = block.getFieldValue('MODE') || 'WHILE';
      const conditionBlock = block.getInputTargetBlock('BOOL');
      const doBlock = block.getInputTargetBlock('DO');
      
      let condition = conditionBlock ? convertExpressionToPython(conditionBlock) : 'True';
      if (mode === 'UNTIL') {
        condition = `not (${condition})`;
      }
      
      const children = doBlock ? convertBlockChainToSteps(doBlock, currentDevice, devices) : [];
      const childCode = convertStepsToPythonCode(children, devices, '    ');
      
      const pythonCode = `while ${condition}:\n${childCode || '    pass\\n'}`;
      
      return {
        id,
        type: 'python',
        label: `${mode === 'WHILE' ? 'While' : 'Until'} loop`,
        params: {
          code: pythonCode.trim()
        }
      };
    }
      
    default:
      // Unknown block type - create a comment
      console.warn(`Unknown block type: ${blockType}`);
      return {
        id,
        type: 'comment',
        label: `Unsupported: ${blockType}`,
        params: {
          text: `Block type "${blockType}" is not yet supported for export to Steps`
        }
      };
  }
}

/**
 * Convert child steps to Python code for loop body
 */
function convertStepsToPythonCode(childSteps: Step[], devices: DeviceEntry[], indent: string = '    '): string {
  // Helper to get device alias from ID
  const getDeviceAlias = (deviceId?: string): string => {
    if (!deviceId) return 'scope';
    const device = devices.find(d => d.id === deviceId);
    return device?.alias || deviceId || 'scope';
  };
  
  let code = '';
  
  for (const step of childSteps) {
    switch (step.type) {
      case 'write':
        if (step.params.command) {
          const device = getDeviceAlias(step.boundDeviceId);
          code += `${indent}${device}.write('${step.params.command}')\n`;
        }
        break;
        
      case 'query':
        if (step.params.command) {
          const device = getDeviceAlias(step.boundDeviceId);
          const saveAs = step.params.saveAs || 'result';
          code += `${indent}${saveAs} = ${device}.query('${step.params.command}').strip()\n`;
        }
        break;
        
      case 'sleep':
        if (step.params.duration) {
          code += `${indent}time.sleep(${step.params.duration})\n`;
        }
        break;
        
      case 'python':
        if (step.params.code) {
          // Indent existing Python code
          const lines = step.params.code.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              code += `${indent}${line}\n`;
            } else {
              code += '\n';
            }
          }
        }
        break;
        
      case 'comment':
        if (step.params.text) {
          code += `${indent}# ${step.params.text}\n`;
        }
        break;
        
      case 'save_waveform':
        if (step.params.command || step.params.source) {
          const device = getDeviceAlias(step.boundDeviceId);
          const source = (step.params.source || 'CH1').toUpperCase();
          const filename = step.params.filename || 'waveform.csv';
          const format = (step.params.format || 'CSV').toUpperCase();
          
          // WFM/MAT: Scope writes the file using SAVE:WAVEFORM
          if (format === 'WFM' || format === 'MAT') {
            const ext = format.toLowerCase();
            const baseName = filename.replace(/\.(wfm|mat|bin|csv)$/i, '');
            const scopePath = `C:/TekScope/data/${baseName}.${ext}`;
            code += `${indent}# Save ${source} as ${format} (scope-native)\n`;
            code += `${indent}${device}.write('SAVE:WAVEFORM ${source},"${scopePath}"')\n`;
            code += `${indent}${device}.query('*OPC?')  # Wait for save\n`;
            code += `${indent}${device}.write('FILESYSTEM:READFILE "${scopePath}"')\n`;
            code += `${indent}data = ${device}.read_raw()\n`;
            code += `${indent}with open('${baseName}.${ext}', 'wb') as f:\n`;
            code += `${indent}    f.write(data)\n`;
            code += `${indent}${device}.write('FILESYSTEM:DELETE "${scopePath}"')\n`;
            code += `${indent}print(f"Saved ${source} as ${format}: ${baseName}.${ext}")\n`;
          }
          // CSV: PC pulls data via CURVE?, scales with WFMOUTPRE
          else if (format === 'CSV' || format === 'ASCII') {
            code += `${indent}# Save ${source} as CSV (PC transfer with scaling)\n`;
            code += `${indent}${device}.write('DATA:SOURCE ${source}')\n`;
            code += `${indent}${device}.write('DATA:ENCDG ASCII')\n`;
            code += `${indent}x_incr = float(${device}.query('WFMOUTPRE:XINCR?').strip())\n`;
            code += `${indent}x_zero = float(${device}.query('WFMOUTPRE:XZERO?').strip())\n`;
            code += `${indent}y_mult = float(${device}.query('WFMOUTPRE:YMULT?').strip())\n`;
            code += `${indent}y_off = float(${device}.query('WFMOUTPRE:YOFF?').strip())\n`;
            code += `${indent}y_zero = float(${device}.query('WFMOUTPRE:YZERO?').strip())\n`;
            code += `${indent}raw_data = ${device}.query('CURVE?').strip()\n`;
            code += `${indent}raw_values = [int(v) for v in raw_data.split(',') if v.strip()]\n`;
            code += `${indent}with open('${filename}', 'w') as f:\n`;
            code += `${indent}    f.write('Time (s),Amplitude (V)\\n')\n`;
            code += `${indent}    for i, raw_val in enumerate(raw_values):\n`;
            code += `${indent}        time_val = x_zero + i * x_incr\n`;
            code += `${indent}        amplitude = (raw_val - y_off) * y_mult + y_zero\n`;
            code += `${indent}        f.write(f'{time_val:.9e},{amplitude:.6e}\\n')\n`;
            code += `${indent}print(f"Saved {len(raw_values)} points to ${filename}")\n`;
          }
          // BIN: PC pulls data via read_waveform_binary (fast, raw)
          else {
            code += `${indent}# Save ${source} as binary (fast PC transfer)\n`;
            code += `${indent}preamble, waveform_data = read_waveform_binary(${device}, source='${source}')\n`;
            code += `${indent}with open('${filename}', 'wb') as f:\n`;
            code += `${indent}    f.write(waveform_data)\n`;
            code += `${indent}print(f"Saved {preamble['num_points']:,} points to ${filename}")\n`;
          }
        }
        break;
        
      case 'group':
        // Recursively handle nested groups
        if (step.children) {
          code += convertStepsToPythonCode(step.children, devices, indent);
        }
        break;
        
      case 'tm_device_command':
        // tm_devices command - generate command tree call
        if (step.params.commandPath) {
          const device = getDeviceAlias(step.boundDeviceId);
          const args = step.params.args || '';
          if (step.params.saveAs) {
            code += `${indent}${step.params.saveAs} = ${device}.${step.params.commandPath}(${args})\n`;
          } else {
            code += `${indent}${device}.${step.params.commandPath}(${args})\n`;
          }
        }
        break;
        
      default:
        code += `${indent}# ${step.type} step\n`;
    }
  }
  
  return code;
}

/**
 * Convert a value/expression block to Python code
 */
function convertExpressionToPython(block: Blockly.Block): string {
  switch (block.type) {
    case 'math_number':
      return block.getFieldValue('NUM') || '0';
      
    case 'variables_get': {
      const varId = block.getFieldValue('VAR');
      // Get actual variable name from workspace
      const varModel = block.workspace.getVariableById(varId);
      return varModel ? varModel.getName() : 'var';
    }
    
    case 'math_arithmetic': {
      const op = block.getFieldValue('OP');
      const aBlock = block.getInputTargetBlock('A');
      const bBlock = block.getInputTargetBlock('B');
      
      const a = aBlock ? convertExpressionToPython(aBlock) : '0';
      const b = bBlock ? convertExpressionToPython(bBlock) : '0';
      
      const opMap: { [key: string]: string } = {
        'ADD': '+',
        'MINUS': '-',
        'MULTIPLY': '*',
        'DIVIDE': '/',
        'POWER': '**'
      };
      
      return `(${a} ${opMap[op] || '+'} ${b})`;
    }
    
    case 'text':
      return `"${block.getFieldValue('TEXT') || ''}"`;
    
    case 'logic_compare': {
      const op = block.getFieldValue('OP');
      const aBlock = block.getInputTargetBlock('A');
      const bBlock = block.getInputTargetBlock('B');
      
      const a = aBlock ? convertExpressionToPython(aBlock) : '0';
      const b = bBlock ? convertExpressionToPython(bBlock) : '0';
      
      const opMap: { [key: string]: string } = {
        'EQ': '==',
        'NEQ': '!=',
        'LT': '<',
        'LTE': '<=',
        'GT': '>',
        'GTE': '>='
      };
      
      return `(${a} ${opMap[op] || '=='} ${b})`;
    }
    
    case 'logic_operation': {
      const op = block.getFieldValue('OP');
      const aBlock = block.getInputTargetBlock('A');
      const bBlock = block.getInputTargetBlock('B');
      
      const a = aBlock ? convertExpressionToPython(aBlock) : 'True';
      const b = bBlock ? convertExpressionToPython(bBlock) : 'True';
      
      const opMap: { [key: string]: string } = {
        'AND': 'and',
        'OR': 'or'
      };
      
      return `(${a} ${opMap[op] || 'and'} ${b})`;
    }
    
    case 'logic_negate': {
      const boolBlock = block.getInputTargetBlock('BOOL');
      const boolExpr = boolBlock ? convertExpressionToPython(boolBlock) : 'True';
      return `not (${boolExpr})`;
    }
    
    case 'logic_boolean': {
      const bool = block.getFieldValue('BOOL');
      return bool === 'TRUE' ? 'True' : 'False';
    }
    
    case 'text_join': {
      // Handle text concatenation
      const itemCount = (block as any).itemCount_ || 2;
      const parts: string[] = [];
      for (let i = 0; i < itemCount; i++) {
        const itemBlock = block.getInputTargetBlock(`ADD${i}`);
        if (itemBlock) {
          parts.push(convertExpressionToPython(itemBlock));
        }
      }
      return parts.length > 0 ? `str(${parts.join(') + str(')})` : '""';
    }
      
    default:
      return '0';
  }
}

/**
 * Export the converter
 */
export { convertBlockToStep, convertExpressionToPython };
