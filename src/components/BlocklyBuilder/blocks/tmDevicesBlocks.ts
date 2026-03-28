/* ===================== tm_devices High-Level Blocks ===================== */

import * as Blockly from 'blockly';

const TM_DEVICES_COLOR = 210; // Blue-purple to distinguish from raw SCPI

// Helper to get device context field (reusable across blocks)
function appendDeviceContextField(this: Blockly.Block) {
  this.appendDummyInput('DEVICE_CONTEXT_INPUT')
      .appendField('Device:')
      .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
}

// Save Screenshot Block (tm_devices native method)
Blockly.Blocks['tm_devices_save_screenshot'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📸 Save Screenshot (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('screenshot'), 'FILENAME');
    this.appendDummyInput()
        .appendField('Format:')
        .appendField(new Blockly.FieldDropdown([
          ['PNG', 'PNG'],
          ['JPEG', 'JPEG'],
          ['BMP', 'BMP']
        ]), 'FORMAT');
    this.appendDummyInput()
        .appendField('Colors:')
        .appendField(new Blockly.FieldDropdown([
          ['Normal', 'NORMAL'],
          ['Inverted', 'INVERTED']
        ]), 'COLORS');
    this.appendDummyInput()
        .appendField('Local Folder:')
        .appendField(new Blockly.FieldTextInput('./screenshots'), 'LOCAL_FOLDER');
    this.appendDummyInput()
        .appendField('Device Folder:')
        .appendField(new Blockly.FieldTextInput(''), 'DEVICE_FOLDER');
    this.appendDummyInput()
        .appendField('Keep Device File:')
        .appendField(new Blockly.FieldCheckbox('FALSE'), 'KEEP_DEVICE_FILE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Captures a screenshot using the instrument\'s native method.\nFilename will have format extension added automatically (e.g., screenshot.png).\nLocal Folder: where to save on PC. Device Folder: temp location on scope.');
    this.setHelpUrl('');
  }
};

// FastFrame Enable Block
Blockly.Blocks['fastframe_enable'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚡ FastFrame Enable');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('State:')
        .appendField(new Blockly.FieldDropdown([
          ['ON', 'ON'],
          ['OFF', 'OFF']
        ]), 'STATE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Enable or disable FastFrame acquisition mode');
    this.setHelpUrl('');
  }
};

// FastFrame Set Count Block
Blockly.Blocks['fastframe_set_count'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚡ FastFrame Count');
    appendDeviceContextField.call(this);
    this.appendValueInput('COUNT')
        .setCheck('Number')
        .appendField('Count:');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Set the number of FastFrame frames to capture (1-10000)');
    this.setHelpUrl('');
  }
};

// FastFrame Select Frame Block
Blockly.Blocks['fastframe_select_frame'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚡ FastFrame Select Frame');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Channel:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4']
        ]), 'CHANNEL');
    this.appendValueInput('FRAME')
        .setCheck('Number')
        .appendField('Frame:');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Select a specific FastFrame for processing');
    this.setHelpUrl('');
  }
};

// Search Configure Edge Block
Blockly.Blocks['search_configure_edge'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔍 Search Configure Edge');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Search:')
        .appendField(new Blockly.FieldDropdown([
          ['Search 1', '1'],
          ['Search 2', '2']
        ]), 'SEARCH_NUM');
    this.appendDummyInput()
        .appendField('Source:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4']
        ]), 'SOURCE');
    this.appendDummyInput()
        .appendField('Slope:')
        .appendField(new Blockly.FieldDropdown([
          ['Falling', 'FALL'],
          ['Rising', 'RISE']
        ]), 'SLOPE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Configure edge search on a channel');
    this.setHelpUrl('');
  }
};

// Search Query Total Block
Blockly.Blocks['search_query_total'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔍 Search Query Total');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Search:')
        .appendField(new Blockly.FieldDropdown([
          ['Search 1', '1'],
          ['Search 2', '2']
        ]), 'SEARCH_NUM');
    this.appendDummyInput()
        .appendField('Store in:')
        .appendField(new Blockly.FieldTextInput('search_total'), 'VARIABLE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Query the total number of search results found');
    this.setHelpUrl('');
  }
};

// Measurement Immediate Block
Blockly.Blocks['measurement_immediate'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📊 Immediate Measurement');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Type:')
        .appendField(new Blockly.FieldDropdown([
          ['Peak-to-Peak', 'PK2PK'],
          ['RMS', 'RMS'],
          ['Frequency', 'FREQUENCY'],
          ['Period', 'PERIOD'],
          ['Mean', 'MEAN'],
          ['Amplitude', 'AMPLITUDE']
        ]), 'TYPE');
    this.appendDummyInput()
        .appendField('Source:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4']
        ]), 'SOURCE');
    this.appendDummyInput()
        .appendField('Store in:')
        .appendField(new Blockly.FieldTextInput('measurement'), 'VARIABLE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Perform an immediate measurement and store the result');
    this.setHelpUrl('');
  }
};

// Acquisition Reset Block
Blockly.Blocks['acquisition_reset'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔄 Reset Acquisition');
    appendDeviceContextField.call(this);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120); // Green
    this.setTooltip('Reset acquisition state (ACQuire:STATE OFF) - required before starting new acquisition');
    this.setHelpUrl('');
  }
};

// ===================== Generic tm_devices Command Blocks =====================

// tm_devices Write Block - Generic write command using command tree path
Blockly.Blocks['tm_devices_write'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚙️ tm_devices Write');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Path:')
        .appendField(new Blockly.FieldTextInput(''), 'PATH');
    this.appendDummyInput()
        .appendField('Value:')
        .appendField(new Blockly.FieldTextInput(''), 'VALUE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip(function(this: Blockly.Block) {
      const path = this.getFieldValue('PATH') || '';
      const value = this.getFieldValue('VALUE') || '';
      if (path) {
        const fullPath = `scope.commands.${path}.write(${value || 'value'})`;
        return `tm_devices Write: ${path}\n` +
          `Full call: ${fullPath}\n` +
          `Right-click to browse commands.`;
      }
      return 'tm_devices Write — set Path and Value.\nRight-click to browse commands.';
    }.bind(this));
    this.setHelpUrl('');
    
    // Add context menu to browse tm_devices commands
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      const block = this;
      const currentPath = block.getFieldValue('PATH') || '';
      options.push({
        text: '📖 Browse tm_devices Commands',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('openTmDevicesExplorer', { 
            detail: { blockId: block.id, fieldName: 'PATH', currentPath: currentPath }
          });
          window.dispatchEvent(event);
        }
      });
      
      // Add conversion to SCPI option
      options.push({
        text: '🔄 Convert to SCPI Command',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('convertToSCPI', {
            detail: { blockId: block.id }
          });
          window.dispatchEvent(event);
        }
      });
    };
  }
};

// tm_devices Query Block - Generic query command using command tree path
Blockly.Blocks['tm_devices_query'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚙️ tm_devices Query');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Path:')
        .appendField(new Blockly.FieldTextInput(''), 'PATH');
    this.appendDummyInput()
        .appendField('Store in:')
        .appendField(new Blockly.FieldTextInput('result'), 'VARIABLE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip(function(this: Blockly.Block) {
      const path = this.getFieldValue('PATH') || '';
      const variable = this.getFieldValue('VARIABLE') || 'result';
      if (path) {
        const fullPath = `${variable} = scope.commands.${path}.query()`;
        return `tm_devices Query: ${path}\n` +
          `Full call: ${fullPath}\n` +
          `Right-click to browse commands.`;
      }
      return 'tm_devices Query — set Path and variable name.\nRight-click to browse commands.';
    }.bind(this));
    this.setHelpUrl('');
    
    // Add context menu to browse tm_devices commands
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      const block = this;
      const currentPath = block.getFieldValue('PATH') || '';
      options.push({
        text: '📖 Browse tm_devices Commands',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('openTmDevicesExplorer', { 
            detail: { blockId: block.id, fieldName: 'PATH', currentPath: currentPath }
          });
          window.dispatchEvent(event);
        }
      });
      
      // Add conversion to SCPI option
      options.push({
        text: '🔄 Convert to SCPI Command',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('convertToSCPI', {
            detail: { blockId: block.id }
          });
          window.dispatchEvent(event);
        }
      });
    };
  }
};

// ===================== tm_devices Convenience Method Blocks =====================

// Save Session Block
Blockly.Blocks['tm_devices_save_session'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('💾 Save Session (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('session.tss'), 'FILENAME');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Save the current scope session to a .tss file.\nUses: scope.commands.save.session.write(filename)');
    this.setHelpUrl('');
  }
};

// Recall Session Block
Blockly.Blocks['tm_devices_recall_session'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📂 Recall Session (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('session.tss'), 'FILENAME');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Recall a saved scope session from a .tss file.\nUses: scope.recall_session(filename)');
    this.setHelpUrl('');
  }
};

// Save Waveform Block (tm_devices native)
Blockly.Blocks['tm_devices_save_waveform'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('💾 Save Waveform (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Source:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4'],
          ['MATH1', 'MATH1'],
          ['REF1', 'REF1']
        ]), 'SOURCE');
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('waveform.wfm'), 'FILENAME');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Save waveform data to a .wfm file on the scope.\nUses: scope.commands.save.waveform.write(source, filename)');
    this.setHelpUrl('');
  }
};

// Recall Reference Block
Blockly.Blocks['tm_devices_recall_reference'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📂 Recall Reference (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Filename:')
        .appendField(new Blockly.FieldTextInput('waveform.wfm'), 'FILENAME');
    this.appendDummyInput()
        .appendField('Reference:')
        .appendField(new Blockly.FieldDropdown([
          ['REF1', '1'],
          ['REF2', '2'],
          ['REF3', '3'],
          ['REF4', '4']
        ]), 'REF_NUM');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Recall a waveform file into a reference channel.\nUses: scope.recall_reference(filename, ref_num)');
    this.setHelpUrl('');
  }
};

// Reset Scope Block
Blockly.Blocks['tm_devices_reset'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔄 Reset Scope (tm_devices)');
    appendDeviceContextField.call(this);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Reset the scope to default settings.\nUses: scope.reset()');
    this.setHelpUrl('');
  }
};

// Turn Channel On/Off Block
Blockly.Blocks['tm_devices_channel_on_off'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📺 Channel On/Off (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Channel:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4'],
          ['CH5', 'CH5'],
          ['CH6', 'CH6'],
          ['CH7', 'CH7'],
          ['CH8', 'CH8']
        ]), 'CHANNEL');
    this.appendDummyInput()
        .appendField('State:')
        .appendField(new Blockly.FieldDropdown([
          ['ON', 'ON'],
          ['OFF', 'OFF']
        ]), 'STATE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Turn a channel on or off.\nUses: scope.turn_channel_on(channel) or scope.turn_channel_off(channel)');
    this.setHelpUrl('');
  }
};

// Add Math Channel Block
Blockly.Blocks['tm_devices_add_math'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('➕ Add Math (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Math:')
        .appendField(new Blockly.FieldDropdown([
          ['MATH1', 'MATH1'],
          ['MATH2', 'MATH2'],
          ['MATH3', 'MATH3'],
          ['MATH4', 'MATH4']
        ]), 'MATH');
    this.appendDummyInput()
        .appendField('Source:')
        .appendField(new Blockly.FieldDropdown([
          ['CH1', 'CH1'],
          ['CH2', 'CH2'],
          ['CH3', 'CH3'],
          ['CH4', 'CH4']
        ]), 'SOURCE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Add a new math channel based on source.\nUses: scope.add_new_math(math, source)');
    this.setHelpUrl('');
  }
};

// Set and Check Block
Blockly.Blocks['tm_devices_set_and_check'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('✅ Set & Check (tm_devices)');
    appendDeviceContextField.call(this);
    this.appendDummyInput()
        .appendField('Command:')
        .appendField(new Blockly.FieldTextInput(':HORIZONTAL:SCALE'), 'COMMAND');
    this.appendDummyInput()
        .appendField('Value:')
        .appendField(new Blockly.FieldTextInput('100e-9'), 'VALUE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TM_DEVICES_COLOR);
    this.setTooltip('Set a value and verify it was applied correctly.\nUses: scope.set_and_check(command, value)\nRaises error if value doesn\'t match.');
    this.setHelpUrl('');
  }
};
