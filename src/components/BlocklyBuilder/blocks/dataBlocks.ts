/* ===================== Data Blocks ===================== */

import * as Blockly from 'blockly';
import { getChannelCount, generateChannelOptions } from '../constants/tmDeviceTypes';
import { getActiveDeviceDriver } from './channelBlocks';

// Dynamic source dropdown generator for waveform blocks
// Includes channels (based on device) plus MATH channels
function dynamicSourceDropdown(): [string, string][] {
  const channelCount = getChannelCount(getActiveDeviceDriver());
  const options = generateChannelOptions(channelCount);
  // Add MATH channels
  options.push(['MATH1', 'MATH1'], ['MATH2', 'MATH2'], ['MATH3', 'MATH3'], ['MATH4', 'MATH4']);
  return options;
}

// Save Waveform Block with expandable settings - Shows device context
Blockly.Blocks['save_waveform'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('💾 Save Waveform')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput()
        .appendField('Source:')
        .appendField(new Blockly.FieldDropdown(dynamicSourceDropdown), 'SOURCE');
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('waveform'), 'FILENAME');
    this.appendDummyInput()
        .appendField('Format:')
        .appendField(new Blockly.FieldDropdown([
          ['CSV', 'CSV'],
          ['Binary', 'BIN'],
          ['Waveform (.wfm)', 'WFM'],
          ['MATLAB (.mat)', 'MAT']
        ]), 'FORMAT');
    
    this.showAdvanced_ = false;
    this.workspaceLoadComplete_ = false;
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(260); // Modern theme violet
    this.setTooltip('Save waveform data to file\nRight-click for advanced settings');
    this.setHelpUrl('');
    
    // Add context menu for advanced settings
    this.customContextMenu = function(this: any, options: any[]) {
      const block = this;
      options.push({
        text: block.showAdvanced_ ? '➖ Hide Advanced Settings' : '➕ Show Advanced Settings',
        enabled: true,
        callback: function() {
          block.showAdvanced_ = !block.showAdvanced_;
          block.updateShape_();
        }
      });
    };
  },
  onchange: function(event: any) {
    if (!this.workspace || this.isInFlyout) return;
    
    // Mark workspace as fully loaded after FINISHED_LOADING event
    if (event.type === Blockly.Events.FINISHED_LOADING) {
      (this as any).workspaceLoadComplete_ = true;
      return;
    }
    
    // NEVER auto-update until workspace is fully loaded
    if (!(this as any).workspaceLoadComplete_) {
      return;
    }
    
    // Only auto-update on explicit block MOVE (user dragging)
    if (event.type !== Blockly.Events.BLOCK_MOVE || event.blockId !== this.id) {
      return;
    }
    
    // Preserve existing device context if it's already set to a valid value (not default)
    // This prevents overwriting device context that was set from XML import
    const currentLabel = this.getFieldValue('DEVICE_CONTEXT');
    const isDefaultValue = currentLabel === '(scope)' || currentLabel === '(?)';
    
    // On BLOCK_MOVE, preserve existing device context if it's already set to a valid value
    // Only update if it's the default value "(scope)" or unknown "(?)"
    if (!isDefaultValue) {
      // Block already has a valid device context set (from XML), preserve it
      return;
    }
    
    // Helper to find device context - prioritizes set_device_context over connect_scope
    const getDeviceContext = (block: Blockly.Block): string => {
      let currentBlock: Blockly.Block | null = block.getPreviousBlock();
      let lastSetDeviceContext: string | null = null;
      let lastConnectScope: string | null = null;
      
      // Walk backwards through the entire chain to find the most recent device context
      while (currentBlock) {
        if (currentBlock.type === 'set_device_context') {
          const deviceName = currentBlock.getFieldValue('DEVICE');
          if (deviceName) {
            lastSetDeviceContext = deviceName;
          }
        } else if (currentBlock.type === 'connect_scope') {
          const deviceName = currentBlock.getFieldValue('DEVICE_NAME');
          if (deviceName && !lastSetDeviceContext) {
            lastConnectScope = deviceName;
          }
        }
        currentBlock = currentBlock.getPreviousBlock();
      }
      
      if (lastSetDeviceContext) return lastSetDeviceContext;
      if (lastConnectScope) return lastConnectScope;
      return '?';
    };
    
    // Update device context based on chain
    const deviceName = getDeviceContext(this);
    this.setFieldValue(`(${deviceName})`, 'DEVICE_CONTEXT');
    
    // Color code based on device
    if (deviceName === 'scope') {
      this.setColour(260); // Violet
    } else if (deviceName === 'psu' || deviceName === 'smu') {
      this.setColour(0); // Red
    } else if (deviceName === 'dmm') {
      this.setColour(120); // Green
    } else {
      this.setColour(260); // Violet
    }
  },
  updateShape_: function() {
    // Remove advanced inputs if they exist
    if (this.getInput('ENCODING')) {
      this.removeInput('ENCODING');
    }
    if (this.getInput('BYTE_ORDER')) {
      this.removeInput('BYTE_ORDER');
    }
    if (this.getInput('COMPRESSION')) {
      this.removeInput('COMPRESSION');
    }
    
    // Add advanced inputs if enabled
    if (this.showAdvanced_) {
      this.appendDummyInput('ENCODING')
          .appendField('Encoding:')
          .appendField(new Blockly.FieldDropdown([
            ['ASCII', 'ASCII'],
            ['Binary', 'BINARY'],
            ['RPBinary', 'RPBINARY'],
            ['FPBinary', 'FPBINARY']
          ]), 'ENCODING_TYPE');
      
      this.appendDummyInput('BYTE_ORDER')
          .appendField('Byte Order:')
          .appendField(new Blockly.FieldDropdown([
            ['LSB First', 'LSB'],
            ['MSB First', 'MSB']
          ]), 'BYTE_ORDER_TYPE');
      
      this.appendDummyInput('COMPRESSION')
          .appendField('Compression:')
          .appendField(new Blockly.FieldCheckbox('FALSE'), 'COMPRESS');
    }
  },
  mutationToDom: function() {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('show_advanced', this.showAdvanced_ ? 'true' : 'false');
    return container;
  },
  domToMutation: function(xmlElement: Element) {
    this.showAdvanced_ = xmlElement.getAttribute('show_advanced') === 'true';
    this.updateShape_();
  }
};

// Save Screenshot Block (PyVISA only - for tm_devices use tm_devices_save_screenshot)
Blockly.Blocks['save_screenshot'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📷 Save Screenshot (PyVISA)');
    this.appendDummyInput('DEVICE_CONTEXT_INPUT')
        .appendField('Device:')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput()
        .appendField('Scope Type:')
        .appendField(new Blockly.FieldDropdown([
          ['Modern (MSO5/6 Series)', 'MODERN'],
          ['Legacy (5k/7k/70k Series)', 'LEGACY']
        ]), 'SCOPE_TYPE');
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('screenshot'), 'FILENAME');
    this.appendDummyInput()
        .appendField('Format:')
        .appendField(new Blockly.FieldDropdown([
          ['PNG', 'PNG'],
          ['BMP', 'BMP'],
          ['JPEG', 'JPEG']
        ]), 'FORMAT');
    this.appendDummyInput()
        .appendField('Local Folder:')
        .appendField(new Blockly.FieldTextInput('./screenshots'), 'LOCAL_FOLDER');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290);
    this.setTooltip('Save screenshot using PyVISA (not tm_devices).\n' +
      'Modern (MSO5/6): Uses SAVE:IMAGE command\n' +
      'Legacy (5k/7k/70k): Uses HARDCOPY command\n' +
      'For tm_devices backend, use "Save Screenshot (tm_devices)" block instead.');
    this.setHelpUrl('');
  },
  // Support mutation for backward compatibility with GPT-generated XML
  mutationToDom: function() {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('scope_type', this.getFieldValue('SCOPE_TYPE') || 'MODERN');
    return container;
  },
  domToMutation: function(xmlElement: Element) {
    // Read scope_type from mutation and set the field
    const scopeType = xmlElement.getAttribute('scope_type');
    if (scopeType) {
      // Normalize: Legacy, LEGACY, legacy all become LEGACY
      const normalized = scopeType.toUpperCase() === 'LEGACY' ? 'LEGACY' : 'MODERN';
      this.setFieldValue(normalized, 'SCOPE_TYPE');
    }
  }
};

/**
 * Recall Block - Smart block for recalling settings/sessions/waveforms
 * Makes it clear what type of file you're recalling:
 * - Factory: Reset to factory defaults (no file needed)
 * - Setup (.SET): Recall instrument settings only
 * - Session (.TSS): Recall full session (settings + waveforms + measurements)
 * - Waveform: Recall a saved waveform to a reference
 */
Blockly.Blocks['recall'] = {
  init: function() {
    this.appendDummyInput('HEADER')
        .appendField('📂 Recall');
    this.appendDummyInput('DEVICE_CONTEXT_INPUT')
        .appendField('Device:')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput('TYPE_INPUT')
        .appendField('Recall Type:')
        .appendField(new Blockly.FieldDropdown([
          ['🔄 Factory Defaults', 'FACTORY'],
          ['⚙️ Setup (.SET) - Settings only', 'SETUP'],
          ['📦 Session (.TSS) - Full session', 'SESSION'],
          ['📈 Waveform to Reference', 'WAVEFORM']
        ], this.onTypeChange_.bind(this)), 'RECALL_TYPE');
    
    // File path input (hidden for Factory)
    this.appendDummyInput('FILE_INPUT')
        .appendField('File Path:')
        .appendField(new Blockly.FieldTextInput(''), 'FILE_PATH');
    
    // Reference input (only for Waveform)
    this.appendDummyInput('REF_INPUT')
        .appendField('To Reference:')
        .appendField(new Blockly.FieldDropdown([
          ['REF1', 'REF1'],
          ['REF2', 'REF2'],
          ['REF3', 'REF3'],
          ['REF4', 'REF4']
        ]), 'REFERENCE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(45); // Orange for file operations
    this.setTooltip('Recall saved data to the instrument.\n\n' +
      '• Factory Defaults: Reset all settings (RECALL:SETUP FACTORY)\n' +
      '• Setup (.SET): Recall settings only (RECALL:SETUP "file.set")\n' +
      '• Session (.TSS): Recall full session including waveforms (RECALL:SESSION "file.tss")\n' +
      '• Waveform: Recall waveform to reference (RECALL:WAVEFORM "file.wfm",REF1)');
    this.setHelpUrl('');
    
    // Initialize visibility
    this.updateShape_();
  },
  
  onTypeChange_: function(newValue: string) {
    this.updateShape_();
    return newValue;
  },
  
  updateShape_: function() {
    const recallType = this.getFieldValue('RECALL_TYPE') || 'FACTORY';
    
    // Show/hide file path input
    const fileInput = this.getInput('FILE_INPUT');
    if (fileInput) {
      fileInput.setVisible(recallType !== 'FACTORY');
    }
    
    // Show/hide reference input (only for WAVEFORM)
    const refInput = this.getInput('REF_INPUT');
    if (refInput) {
      refInput.setVisible(recallType === 'WAVEFORM');
    }
    
    // Update file path placeholder based on type
    const filePathField = this.getField('FILE_PATH');
    if (filePathField) {
      if (recallType === 'SETUP') {
        (filePathField as any).setValue((filePathField as any).getValue() || 'C:/Users/Public/Tektronix/TekScope/Setups/MySetup.set');
      } else if (recallType === 'SESSION') {
        (filePathField as any).setValue((filePathField as any).getValue() || 'C:/Users/Public/Tektronix/TekScope/Sessions/MySession.tss');
      } else if (recallType === 'WAVEFORM') {
        (filePathField as any).setValue((filePathField as any).getValue() || 'C:/Users/Public/Tektronix/TekScope/Waveforms/MyWaveform.wfm');
      }
    }
    
    // Force re-render
    if (this.rendered) {
      this.render();
    }
  },
  
  mutationToDom: function() {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('recall_type', this.getFieldValue('RECALL_TYPE') || 'FACTORY');
    return container;
  },
  
  domToMutation: function(xmlElement: Element) {
    const recallType = xmlElement.getAttribute('recall_type');
    if (recallType) {
      this.setFieldValue(recallType, 'RECALL_TYPE');
    }
    this.updateShape_();
  }
};

/**
 * Save Block - Smart block for saving settings/sessions/waveforms
 * Complements the Recall block
 */
Blockly.Blocks['save'] = {
  init: function() {
    this.appendDummyInput('HEADER')
        .appendField('💾 Save');
    this.appendDummyInput('DEVICE_CONTEXT_INPUT')
        .appendField('Device:')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput('TYPE_INPUT')
        .appendField('Save Type:')
        .appendField(new Blockly.FieldDropdown([
          ['⚙️ Setup (.SET) - Settings only', 'SETUP'],
          ['📦 Session (.TSS) - Full session', 'SESSION'],
          ['📈 Waveform from Channel/Ref', 'WAVEFORM'],
          ['📷 Screenshot', 'IMAGE']
        ], this.onTypeChange_.bind(this)), 'SAVE_TYPE');
    
    // File path input
    this.appendDummyInput('FILE_INPUT')
        .appendField('File Path:')
        .appendField(new Blockly.FieldTextInput(''), 'FILE_PATH');
    
    // Source input (only for Waveform)
    this.appendDummyInput('SOURCE_INPUT')
        .appendField('From Source:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4'],
          ['REF1', 'REF1'],
          ['REF2', 'REF2'],
          ['MATH1', 'MATH1']
        ]), 'SOURCE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(45); // Orange for file operations
    this.setTooltip('Save data from the instrument.\n\n' +
      '• Setup (.SET): Save settings only (SAVE:SETUP "file.set")\n' +
      '• Session (.TSS): Save full session including waveforms (SAVE:SESSION "file.tss")\n' +
      '• Waveform: Save waveform from source (SAVE:WAVEFORM CH1,"file.wfm")\n' +
      '• Screenshot: Save screen image (SAVE:IMAGE "file.png")');
    this.setHelpUrl('');
    
    // Initialize visibility
    this.updateShape_();
  },
  
  onTypeChange_: function(newValue: string) {
    this.updateShape_();
    return newValue;
  },
  
  updateShape_: function() {
    const saveType = this.getFieldValue('SAVE_TYPE') || 'SETUP';
    
    // Show/hide source input (only for WAVEFORM)
    const sourceInput = this.getInput('SOURCE_INPUT');
    if (sourceInput) {
      sourceInput.setVisible(saveType === 'WAVEFORM');
    }
    
    // Update file path placeholder based on type
    const filePathField = this.getField('FILE_PATH');
    if (filePathField) {
      const currentValue = (filePathField as any).getValue();
      if (!currentValue || currentValue.includes('MySetup') || currentValue.includes('MySession') || 
          currentValue.includes('MyWaveform') || currentValue.includes('screenshot')) {
        if (saveType === 'SETUP') {
          (filePathField as any).setValue('C:/Users/Public/Tektronix/TekScope/Setups/MySetup.set');
        } else if (saveType === 'SESSION') {
          (filePathField as any).setValue('C:/Users/Public/Tektronix/TekScope/Sessions/MySession.tss');
        } else if (saveType === 'WAVEFORM') {
          (filePathField as any).setValue('C:/Users/Public/Tektronix/TekScope/Waveforms/MyWaveform.wfm');
        } else if (saveType === 'IMAGE') {
          (filePathField as any).setValue('C:/Temp/screenshot.png');
        }
      }
    }
    
    // Force re-render
    if (this.rendered) {
      this.render();
    }
  },
  
  mutationToDom: function() {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('save_type', this.getFieldValue('SAVE_TYPE') || 'SETUP');
    return container;
  },
  
  domToMutation: function(xmlElement: Element) {
    const saveType = xmlElement.getAttribute('save_type');
    if (saveType) {
      this.setFieldValue(saveType, 'SAVE_TYPE');
    }
    this.updateShape_();
  }
};
