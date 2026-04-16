/* ===================== Enhanced SCPI Blocks with Parameter Dropdowns ===================== */

import * as Blockly from 'blockly';
import { parseSCPI } from '../../../utils/scpiParser';
import { detectEditableParameters, replaceParameter } from '../../../utils/scpiParameterDetector';
import { lookupCommand, CommandParam } from '../utils/commandRegistry';

// Color constants for better differentiation
const WRITE_COLOR = 160;  // Green-teal for Write commands (sending data)
const QUERY_COLOR = 260;  // Purple for Query commands (receiving data)
const MAX_DROPDOWN_OPTIONS = 20;

function supportsManualIndexedEntry(param: any): boolean {
  const options = Array.isArray(param?.validOptions) ? param.validOptions.map((o: any) => String(o || '').trim()) : [];
  if (options.length < 2) return false;

  // Enable freeform entry for index-like enum sets (e.g. MATH1..4, CH1..4, REF1..8).
  const indexed = options.every((opt: string) => /^[A-Za-z_]+[0-9]+$/.test(opt));
  if (!indexed) return false;

  const prefixes = new Set(options.map((opt: string) => opt.replace(/[0-9]+$/, '').toUpperCase()));
  return prefixes.size === 1;
}

function getConcreteDefaultForParam(metaParam: CommandParam): string {
  const options = Array.isArray(metaParam.options) ? metaParam.options : [];
  const concreteOption = options.find((opt) => {
    const v = String(opt || '').trim();
    return v && !/<[^>]+>/.test(v) && !/[{}|]/.test(v);
  });
  if (concreteOption) return String(concreteOption).trim();

  if (metaParam.default !== undefined && metaParam.default !== null) {
    const d = String(metaParam.default).trim();
    if (d && !/<[^>]+>/.test(d)) return d;
  }

  const type = (metaParam.type || '').toLowerCase();
  if (type.includes('bool')) return 'ON';
  if (type.includes('int') || type.includes('number') || type.includes('float') || type.includes('numeric')) return '1';
  return '1';
}

function getCompactParamLabel(param: any, fallback: string): string {
  const raw = String(param?.description || '').trim();
  if (!raw) return fallback;
  if (/^one of:/i.test(raw)) return fallback;
  const cleaned = raw
    .replace(/^one of:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length > 22) return `${cleaned.slice(0, 19)}...`;
  return cleaned;
}

/**
 * SCPI Write Block with Parameter Dropdowns
 * Shows raw command AND editable parameters as dropdowns (like Steps UI)
 * This is now the default scpi_write block!
 */
Blockly.Blocks['scpi_write'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('✏️ SCPI Write')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    
    // Command input
    this.appendDummyInput('COMMAND_INPUT')
        .appendField('Final:')
        .appendField(new Blockly.FieldTextInput('CH1:SCALE 1.0', this.onCommandChange_.bind(this)), 'COMMAND');
    
    // Parameter inputs will be added dynamically
    this.parameterInputs_ = [];
    this.currentCommand_ = '';
    this.isUpdating_ = false;
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(WRITE_COLOR);
    this.setTooltip('Send SCPI command to instrument (Write = Set values)');
    this.setHelpUrl('');
    
    // Custom context menu
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      const blockId = this.id;
      const currentCommand = this.getFieldValue('COMMAND') || '';
      options.push({
        text: '📖 Browse SCPI Commands',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('openSCPIExplorer', { 
            detail: { blockId: blockId, fieldName: 'COMMAND', currentCommand: currentCommand }
          });
          window.dispatchEvent(event);
        }
      });
      
      options.push({
        text: '🔄 Convert to tm_devices Command',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('convertToTmDevices', {
            detail: { blockId: blockId }
          });
          window.dispatchEvent(event);
        }
      });
      
      options.push({
        text: '🔄 Refresh Parameters',
        enabled: true,
        callback: () => {
          if (this.workspace) {
            const block = this.workspace.getBlockById(blockId);
            if (block && (block as any).updateParameters) {
              (block as any).currentCommand_ = ''; // Force refresh
              (block as any).updateParameters();
            }
          }
        }
      });
    };
    
    // Initialize parameters after a short delay to ensure block is fully created
    setTimeout(() => {
      if (this && !this.isDisposed()) {
        this.updateParameters();
      }
    }, 100);
  },
  
  // Called when command field changes
  onCommandChange_: function(newValue: string) {
    // Schedule parameter update
    setTimeout(() => {
      if (this && !this.isDisposed()) {
        this.updateParameters();
      }
    }, 50);
    return newValue;
  },
  
  // Update parameter inputs based on current command
  updateParameters: function() {
    if (this.isUpdating_) return;
    
    let command = this.getFieldValue('COMMAND');
    if (!command || command === this.currentCommand_) {
      return; // No change
    }
    
    this.isUpdating_ = true;
    this.currentCommand_ = command;
    
    // Remove existing parameter inputs
    for (const inputName of this.parameterInputs_) {
      if (this.getInput(inputName)) {
        this.removeInput(inputName);
      }
    }
    this.parameterInputs_ = [];
    
      // Parse command and detect parameters
      try {
      let parsed = parseSCPI(command);
      let params = detectEditableParameters(parsed);
      
      // Look up command metadata from registry for additional options
      const cmdMetadata = lookupCommand(command);
      const cmdParams: CommandParam[] = cmdMetadata?.params || [];
      
      if (params.length === 0 && cmdParams.length === 0) {
        this.isUpdating_ = false;
        return; // No parameters to show
      }

      // Hydrate bare headers with concrete defaults so parameter inputs appear like Steps UI.
      if (params.length === 0 && cmdParams.length > 0) {
        const hasExplicitArgs = /\s+/.test(command.trim());
        if (!hasExplicitArgs) {
          const hydratedValues = cmdParams.map((p) => getConcreteDefaultForParam(p)).filter(Boolean);
          if (hydratedValues.length > 0) {
            const hydratedCommand = `${command.trim()} ${hydratedValues.join(' ')}`.replace(/\s+/g, ' ').trim();
            this.setFieldValue(hydratedCommand, 'COMMAND');
            command = hydratedCommand;
            this.currentCommand_ = hydratedCommand;
            parsed = parseSCPI(command);
            params = detectEditableParameters(parsed);
          }
        }
      }
      
      // Update currentValue for each param based on actual command content
      params = params.map(param => {
        const actualValue = command.slice(param.startIndex, param.endIndex);
        // If the command has a concrete value (not <x>), use that as currentValue
        if (!actualValue.includes('<x>')) {
          return {
            ...param,
            currentValue: actualValue
          };
        }
        return param;
      });
      
      // Merge options from command registry into detected params
      // The registry has the authoritative list of valid options from the command database
      params = params.map((param, idx) => {
        // Find matching param from command metadata by index or type
        const metaParam = cmdParams[idx];
        if (metaParam && metaParam.options && metaParam.options.length > 0) {
          // Check if current value is a file path or quoted string
          // If so, don't override with dropdown options (user specified a custom value)
          const currentVal = param.currentValue || '';
          const isFilePath = currentVal.includes('/') || currentVal.includes('\\') || 
                            currentVal.includes('"') || currentVal.includes("'") ||
                            (currentVal.includes(':') && currentVal.length > 3); // e.g., "C:/..."
          
          if (isFilePath) {
            // Keep as text input for file paths - don't add dropdown options
            return param;
          }
          
          // Check if options include <custom> or similar - means user can enter custom value
          // In this case, if current value doesn't match any option, it's a custom value
          const hasCustomOption = metaParam.options.some(opt => 
            opt.includes('<custom>') || opt.includes('<file') || opt.includes('<path')
          );
          
          // Filter out placeholder options like {ON|OFF}, <custom>, <file_path>
          const validOptions = metaParam.options.filter(opt => 
            !opt.includes('{') && !opt.includes('<') && opt.trim() !== ''
          );
          
          // If there's a custom option and current value doesn't match valid options,
          // treat it as a custom value (don't show dropdown)
          if (hasCustomOption && currentVal) {
            const matchesOption = validOptions.some(opt => 
              opt.toUpperCase() === currentVal.toUpperCase()
            );
            if (!matchesOption) {
              // Current value is custom - keep as text input
              return param;
            }
          }
          
          if (validOptions.length > 0) {
            return {
              ...param,
              validOptions: validOptions,
              description: metaParam.description || param.description,
              parameterName: metaParam.name || ''
            };
          }
        }
        return param;
      });
      
      // If we have command metadata params but no detected params, create params from metadata
      if (params.length === 0 && cmdParams.length > 0) {
        // Extract current argument values from command
        const argMatch = command.match(/\s+(.+)$/);
        const argString = argMatch ? argMatch[1] : '';
        
        // Don't split on spaces inside quotes - handle quoted file paths
        const argValues: string[] = [];
        let currentArg = '';
        let inQuotes = false;
        for (const char of argString) {
          if (char === '"' || char === "'") {
            inQuotes = !inQuotes;
            currentArg += char;
          } else if ((char === ' ' || char === ',') && !inQuotes) {
            if (currentArg.trim()) {
              argValues.push(currentArg.trim());
            }
            currentArg = '';
          } else {
            currentArg += char;
          }
        }
        if (currentArg.trim()) {
          argValues.push(currentArg.trim());
        }
        
        // Check if the argument looks like a file path - if so, don't add dropdown
        const firstArg = argValues[0] || '';
        const isFilePath = firstArg.includes('/') || firstArg.includes('\\') || 
                          firstArg.includes('"') || firstArg.includes("'") ||
                          (firstArg.includes(':') && firstArg.length > 3);
        
        if (!isFilePath) {
          cmdParams.forEach((metaParam, idx) => {
            if (metaParam.options && metaParam.options.length > 0) {
              // Check if options include <custom> - means user can enter custom value
              const hasCustomOption = metaParam.options.some(opt => 
                opt.includes('<custom>') || opt.includes('<file') || opt.includes('<path')
              );
              
              const validOptions = metaParam.options.filter(opt => 
                !opt.includes('{') && !opt.includes('<') && opt.trim() !== ''
              );
              
              // If there's a custom option and current value doesn't match valid options,
              // treat it as a custom value (don't show dropdown)
              const currentArgValue = argValues[idx] || '';
              if (hasCustomOption && currentArgValue) {
                const matchesOption = validOptions.some(opt => 
                  opt.toUpperCase() === currentArgValue.toUpperCase()
                );
                if (!matchesOption) {
                  // Current value is custom - skip adding dropdown
                  return;
                }
              }
              
              if (validOptions.length > 0) {
                const newParam: any = {
                  position: idx,
                  type: 'enumeration' as any,
                  currentValue: argValues[idx] || validOptions[0],
                  validOptions: validOptions,
                  startIndex: 0,
                  endIndex: 0,
                  description: metaParam.description || metaParam.name,
                  parameterName: metaParam.name || ''
                };
                params.push(newParam);
              }
            }
          });
        }
      }
      
      // Store params for later use
      (this as any).detectedParams_ = params;
      
      // Add parameter inputs
      params.forEach((param, idx) => {
        const inputName = `PARAM_${idx}`;
        this.parameterInputs_.push(inputName);
        
        const input = this.appendDummyInput(inputName);
        const label = this.getParameterLabel(param, idx);
        input.appendField('  ' + label + ':');
        
        // Create dropdown or text input based on parameter type
        const useManualIndexedEntry = supportsManualIndexedEntry(param);
        if (param.validOptions && param.validOptions.length > 0 && param.validOptions.length <= MAX_DROPDOWN_OPTIONS && !useManualIndexedEntry) {
          // Create dropdown with options
          const options: [string, string][] = param.validOptions.map(opt => [opt, opt]);
          const currentValue = param.currentValue || param.validOptions[0];
          
          const dropdown = new Blockly.FieldDropdown(options as any, (newValue: string) => {
            this.onParameterChange_(idx, newValue);
            return newValue;
          });
          
          // Set the current value - try exact match first, then case-insensitive
          try {
            if (param.validOptions.includes(currentValue)) {
              dropdown.setValue(currentValue);
            } else {
              // Try case-insensitive match
              const match = param.validOptions.find(opt => 
                opt.toUpperCase() === currentValue.toUpperCase()
              );
              if (match) {
                dropdown.setValue(match);
              }
            }
          } catch (e) {
            // Ignore setValue errors during initialization
          }
          
          input.appendField(dropdown, `PARAM_VALUE_${idx}`);
        } else {
          // Create text input for numeric/custom values, large enums, and indexed enums
          // (lets users type MATH6/MATH7 while preserving MATH1..4 defaults from the library).
          const currentValue = param.currentValue || '';
          const textInput = new Blockly.FieldTextInput(currentValue, (newValue: string) => {
            this.onParameterChange_(idx, newValue);
            return newValue;
          });
          
          input.appendField(textInput, `PARAM_VALUE_${idx}`);
        }
        
        // Add description hint only when it adds information (avoid duplicate text like
        // "Enumeration value: ... Enumeration value").
        if (param.description && param.description.length < 30) {
          const normalizedLabel = String(label || '').trim().toLowerCase();
          const normalizedDesc = String(param.description || '').trim().toLowerCase();
          if (normalizedDesc && normalizedDesc !== normalizedLabel) {
            input.appendField(new Blockly.FieldLabelSerializable(param.description), `PARAM_DESC_${idx}`);
          }
        }
      });
      
      // Force Blockly to recalculate block shape after adding inputs
      // Keep command input at the bottom to prioritize parameter editing first.
      if (this.getInput('COMMAND_INPUT')) {
        this.moveInputBefore('COMMAND_INPUT', null);
      }
      if (this.rendered) {
        this.render();
      }
    } catch (error) {
      console.error('Error parsing SCPI command:', error);
    }
    
    this.isUpdating_ = false;
  },
  
  // Called when a parameter value changes
  onParameterChange_: function(paramIdx: number, newValue: string) {
    if (this.isUpdating_) return;
    
    const params = (this as any).detectedParams_;
    if (!params || !params[paramIdx]) return;
    
    const param = params[paramIdx];
    const currentCommand = this.getFieldValue('COMMAND');
    
    try {
      const newCommand = replaceParameter(currentCommand, param, newValue);
      if (newCommand !== currentCommand) {
        this.isUpdating_ = true;
        this.setFieldValue(newCommand, 'COMMAND');
        this.currentCommand_ = newCommand;
        
        // Update the stored param's currentValue and indices
        const parsed = parseSCPI(newCommand);
        const newParams = detectEditableParameters(parsed);
        if (newParams.length > 0) {
          (this as any).detectedParams_ = newParams.map(p => {
            const actualValue = newCommand.slice(p.startIndex, p.endIndex);
            if (!actualValue.includes('<x>')) {
              return { ...p, currentValue: actualValue };
            }
            return p;
          });
        }
        
        this.isUpdating_ = false;
      }
    } catch (error) {
      console.error('Error updating command:', error);
      this.isUpdating_ = false;
    }
  },
  
  // Get label for parameter based on type
  getParameterLabel: function(param: any, idx: number): string {
    const command = this.getFieldValue('COMMAND') || '';
    const upperCmd = command.toUpperCase();
    const explicitName = String(param?.parameterName || '').trim();
    if (explicitName) {
      return explicitName.charAt(0).toUpperCase() + explicitName.slice(1);
    }

    if (param.mnemonicType) {
      switch (param.mnemonicType) {
        case 'channel': return 'Channel';
        case 'bus': return 'Bus';
        case 'measurement': return 'Measurement';
        case 'reference': return 'Reference';
        case 'math': return 'Math';
        case 'cursor': return 'Cursor';
        case 'search': return 'Search';
        case 'power': return 'Power';
        case 'source': return 'Source';
        case 'digital_bit': return 'Digital Bit';
        case 'zoom': return 'Zoom';
        case 'plot': return 'Plot';
        case 'histogram': return 'Histogram';
        case 'mask': return 'Mask';
        case 'callout': return 'Callout';
        case 'area': return 'Area';
        default: return getCompactParamLabel(param, `Param ${idx + 1}`);
      }
    }
    
    // Check for common argument types
    if (upperCmd.includes(':TYPE')) return 'Type';
    if (upperCmd.includes(':SOURCE')) return 'Source';
    if (upperCmd.includes(':MEAS')) return 'Measurement';
    if (param.type === 'numeric') {
      // Try to infer label from command context
      if (upperCmd.includes('SCALE')) return 'Scale (V/div)';
      if (upperCmd.includes('POSITION')) return 'Position';
      if (upperCmd.includes('OFFSET')) return 'Offset';
      if (upperCmd.includes('BANDWIDTH')) return 'Bandwidth';
      if (upperCmd.includes('FREQUENCY')) return 'Frequency';
      if (upperCmd.includes('AMPLITUDE')) return 'Amplitude';
      if (upperCmd.includes('VOLTAGE')) return 'Voltage';
      if (upperCmd.includes('CURRENT')) return 'Current';
      if (upperCmd.includes('TIME')) return 'Time';
      if (upperCmd.includes('DELAY')) return 'Delay';
      if (upperCmd.includes('LEVEL')) return 'Level';
      if (upperCmd.includes('THRESHOLD')) return 'Threshold';
      return 'Value';
    }
    
    return getCompactParamLabel(param, `Param ${idx + 1}`);
  },
  
  onchange: function(event: any) {
    if (!this.workspace || this.isInFlyout) return;
    
    // Update device context display
    if (event.type === Blockly.Events.BLOCK_MOVE || 
        event.type === Blockly.Events.BLOCK_CREATE ||
        event.type === Blockly.Events.FINISHED_LOADING) {
      this.updateDeviceContext_();
    }
  },
  
  updateDeviceContext_: function() {
    // Find device context from connected blocks
    const context = this.getDeviceContext_();
    const contextField = this.getField('DEVICE_CONTEXT');
    if (contextField) {
      contextField.setValue(`(${context})`);
    }
  },
  
  getDeviceContext_: function(): string {
    let currentBlock: Blockly.Block | null = this.getPreviousBlock();
    while (currentBlock) {
      if (currentBlock.type === 'set_device_context') {
        return currentBlock.getFieldValue('DEVICE') || 'scope';
      }
      if (currentBlock.type === 'connect_scope') {
        return currentBlock.getFieldValue('DEVICE_NAME') || 'scope';
      }
      currentBlock = currentBlock.getPreviousBlock();
    }
    return 'scope';
  }
};

/**
 * SCPI Query Block with Parameter Dropdowns
 * This is now the default scpi_query block!
 */
Blockly.Blocks['scpi_query'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('❓ SCPI Query')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    
    // Command input (no ? suffix - added automatically)
    this.appendDummyInput('COMMAND_INPUT')
        .appendField('Final:')
        .appendField(new Blockly.FieldTextInput('*IDN', this.onCommandChange_.bind(this)), 'COMMAND');
    
    // Variable input for storing result
    this.appendDummyInput('VARIABLE_INPUT')
        .appendField('Save to:')
        .appendField(new Blockly.FieldTextInput('result'), 'VARIABLE');
    
    // Parameter inputs will be added dynamically
    this.parameterInputs_ = [];
    this.currentCommand_ = '';
    this.isUpdating_ = false;
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(QUERY_COLOR);
    this.setTooltip('Query SCPI command from instrument (Query = Get values)');
    this.setHelpUrl('');
    
    // Custom context menu
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      const blockId = this.id;
      const currentCommand = this.getFieldValue('COMMAND') || '';
      options.push({
        text: '📖 Browse SCPI Commands',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('openSCPIExplorer', { 
            detail: { blockId: blockId, fieldName: 'COMMAND', currentCommand: currentCommand }
          });
          window.dispatchEvent(event);
        }
      });
      
      options.push({
        text: '🔄 Convert to tm_devices Command',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('convertToTmDevices', {
            detail: { blockId: blockId }
          });
          window.dispatchEvent(event);
        }
      });
      
      options.push({
        text: '🔄 Refresh Parameters',
        enabled: true,
        callback: () => {
          if (this.workspace) {
            const block = this.workspace.getBlockById(blockId);
            if (block && (block as any).updateParameters) {
              (block as any).currentCommand_ = ''; // Force refresh
              (block as any).updateParameters();
            }
          }
        }
      });
    };
    
    // Initialize parameters after a short delay
    setTimeout(() => {
      if (this && !this.isDisposed()) {
        this.updateParameters();
      }
    }, 100);
  },
  
  // Reuse methods from scpi_write
  onCommandChange_: (Blockly.Blocks['scpi_write'] as any).onCommandChange_,
  updateParameters: (Blockly.Blocks['scpi_write'] as any).updateParameters,
  onParameterChange_: (Blockly.Blocks['scpi_write'] as any).onParameterChange_,
  getParameterLabel: (Blockly.Blocks['scpi_write'] as any).getParameterLabel,
  updateDeviceContext_: (Blockly.Blocks['scpi_write'] as any).updateDeviceContext_,
  getDeviceContext_: (Blockly.Blocks['scpi_write'] as any).getDeviceContext_,
  
  onchange: function(event: any) {
    if (!this.workspace || this.isInFlyout) return;
    
    // Update device context display
    if (event.type === Blockly.Events.BLOCK_MOVE || 
        event.type === Blockly.Events.BLOCK_CREATE ||
        event.type === Blockly.Events.FINISHED_LOADING) {
      this.updateDeviceContext_();
    }
  }
};

/**
 * Custom SCPI Command Block (for advanced users)
 * Allows entering any raw SCPI command without parameter parsing
 */
Blockly.Blocks['custom_command'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('⚡ Custom SCPI')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    
    this.appendDummyInput('COMMAND_INPUT')
        .appendField('Raw:')
        .appendField(new Blockly.FieldTextInput('*RST'), 'COMMAND');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(45); // Orange for custom/advanced
    this.setTooltip('Send raw SCPI command (no parameter parsing)');
    this.setHelpUrl('');
  },
  
  onchange: function(event: any) {
    if (!this.workspace || this.isInFlyout) return;
    
    if (event.type === Blockly.Events.BLOCK_MOVE || 
        event.type === Blockly.Events.BLOCK_CREATE ||
        event.type === Blockly.Events.FINISHED_LOADING) {
      // Update device context
      const context = this.getDeviceContext_();
      const contextField = this.getField('DEVICE_CONTEXT');
      if (contextField) {
        contextField.setValue(`(${context})`);
      }
    }
  },
  
  getDeviceContext_: function(): string {
    let currentBlock: Blockly.Block | null = this.getPreviousBlock();
    while (currentBlock) {
      if (currentBlock.type === 'set_device_context') {
        return currentBlock.getFieldValue('DEVICE') || 'scope';
      }
      if (currentBlock.type === 'connect_scope') {
        return currentBlock.getFieldValue('DEVICE_NAME') || 'scope';
      }
      currentBlock = currentBlock.getPreviousBlock();
    }
    return 'scope';
  }
};
