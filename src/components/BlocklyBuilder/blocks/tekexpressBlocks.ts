/* ===================== TekExpress Blocks ===================== */
/**
 * TekExpress Blockly Blocks
 * 
 * These blocks support TekExpress compliance test applications (USB4Tx, PCIe, Thunderbolt)
 * using PyVISA SOCKET backend on port 5000.
 * 
 * CRITICAL RULE: TekExpress commands are SCPI strings sent over PyVISA SOCKET;
 * NEVER generate socket.sendall() code, only SCPI via .write()/.query() methods.
 */

import * as Blockly from 'blockly';

// Connect to TekExpress Block
Blockly.Blocks['connect_tekexpress'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔌 Connect to TekExpress');
    this.appendDummyInput()
        .appendField('Name:')
        .appendField(new Blockly.FieldTextInput('tekexp'), 'DEVICE_NAME');
    this.appendDummyInput()
        .appendField('Host:')
        .appendField(new Blockly.FieldTextInput('localhost'), 'HOST');
    this.appendDummyInput()
        .appendField('Port:')
        .appendField(new Blockly.FieldNumber(5000, 1, 65535), 'PORT');
    this.appendDummyInput()
        .appendField('Timeout (ms):')
        .appendField(new Blockly.FieldNumber(30000, 1000, 600000), 'TIMEOUT');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Connect to TekExpress application via PyVISA SOCKET (port 5000)\nUses TCPIP::host::port::SOCKET resource string');
    this.setHelpUrl('');
    this.data = 'tekexp'; // Store for context tracking
  }
};

// TekExpress SCPI Write Block
Blockly.Blocks['tekexp_write'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📝 TekExpress Write')
        .appendField(new Blockly.FieldTextInput('TEKEXP:ACQUIRE_MODE LIVE'), 'COMMAND');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Send SCPI command to TekExpress via .write() method\nDo NOT include \\n terminator - handled automatically\nRight-click to browse TekExpress commands');
    this.setHelpUrl('');
    
    // Add context menu to browse TekExpress commands
    const blockId = this.id;
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      options.push({
        text: '📖 Browse TekExpress Commands',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('openTekExpressExplorer', { 
            detail: { blockId: blockId, fieldName: 'COMMAND' }
          });
          window.dispatchEvent(event);
        }
      });
    };
  }
};

// TekExpress SCPI Query Block
Blockly.Blocks['tekexp_query'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('❓ TekExpress Query')
        .appendField(new Blockly.FieldTextInput('TEKEXP:STATE?'), 'COMMAND');
    this.appendDummyInput()
        .appendField('Save to:')
        .appendField(new Blockly.FieldTextInput('result'), 'VARIABLE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Query TekExpress via .query() method and save result to variable\nDo NOT include \\n terminator - handled automatically\nRight-click to browse TekExpress commands');
    this.setHelpUrl('');
    
    // Add context menu to browse TekExpress commands
    const blockId = this.id;
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      options.push({
        text: '📖 Browse TekExpress Commands',
        enabled: true,
        callback: function() {
          const event = new CustomEvent('openTekExpressExplorer', { 
            detail: { blockId: blockId, fieldName: 'COMMAND' }
          });
          window.dispatchEvent(event);
        }
      });
    };
  }
};

// TekExpress Run Block
Blockly.Blocks['tekexp_run'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('▶️ TekExpress Run');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Start TekExpress measurement (sends TEKEXP:STATE RUN)');
    this.setHelpUrl('');
  }
};

// TekExpress Wait State Block
Blockly.Blocks['tekexp_wait_state'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⏳ TekExpress Wait for State');
    this.appendDummyInput()
        .appendField('Expected:')
        .appendField(new Blockly.FieldDropdown([
          ['COMPLETE', 'COMPLETE'],
          ['READY', 'READY'],
          ['DONE', 'DONE'],
          ['RUNNING', 'RUNNING'],
          ['IDLE', 'IDLE']
        ]), 'EXPECTED');
    this.appendDummyInput()
        .appendField('Poll Interval (s):')
        .appendField(new Blockly.FieldNumber(2, 0.5, 60), 'POLL_INTERVAL');
    this.appendDummyInput()
        .appendField('Timeout (s):')
        .appendField(new Blockly.FieldNumber(3600, 10, 36000), 'TIMEOUT');
    this.appendDummyInput()
        .appendField('Handle Popups:')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'HANDLE_POPUP');
    this.appendDummyInput()
        .appendField('Popup Response:')
        .appendField(new Blockly.FieldDropdown([
          ['OK', 'OK'],
          ['Cancel', 'Cancel'],
          ['Yes', 'Yes'],
          ['No', 'No'],
          ['Retry', 'Retry'],
          ['Abort', 'Abort']
        ]), 'POPUP_RESPONSE');
    this.appendDummyInput()
        .appendField('Log popups to:')
        .appendField(new Blockly.FieldTextInput(''), 'LOG_VARIABLE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Poll TEKEXP:STATE? until expected state is reached\n' +
      'Handle Popups: Auto-respond to popups during execution\n' +
      'Popup Response: What to respond to popups (OK, Cancel, Yes, No, etc.)\n' +
      'Log popups to: Variable to store popup messages (leave empty to skip)\n' +
      'NOTE: TekExpress does NOT support *OPC? - must use state polling');
    this.setHelpUrl('');
  }
};

// TekExpress Popup Handler Block
Blockly.Blocks['tekexp_popup'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('💬 TekExpress Popup');
    this.appendDummyInput()
        .appendField('Response:')
        .appendField(new Blockly.FieldTextInput('OK'), 'RESPONSE');
    this.appendDummyInput()
        .appendField('Save message to:')
        .appendField(new Blockly.FieldTextInput('popup_msg'), 'VARIABLE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Query TEKEXP:POPUP? and respond with TEKEXP:POPUP "response"\nUsed for handling user interaction dialogs during tests');
    this.setHelpUrl('');
  }
};

// TekExpress Select Device Block
Blockly.Blocks['tekexp_select_device'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📱 TekExpress Select Device');
    this.appendDummyInput()
        .appendField('Device:')
        .appendField(new Blockly.FieldTextInput('Device'), 'DEVICE_NAME');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Select device in TekExpress (TEKEXP:SELECT DEVICE,"name")');
    this.setHelpUrl('');
  }
};

// TekExpress Select Test Block
Blockly.Blocks['tekexp_select_test'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🧪 TekExpress Select Test');
    this.appendDummyInput()
        .appendField('Test Name:')
        .appendField(new Blockly.FieldTextInput('UI-Unit Interval'), 'TEST_NAME');
    this.appendDummyInput()
        .appendField('Enable:')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'ENABLED');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Select/enable test in TekExpress (TEKEXP:SELECT TEST,"name",1/0)');
    this.setHelpUrl('');
  }
};

// TekExpress Set Value Block
Blockly.Blocks['tekexp_set_value'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚙️ TekExpress Set Value');
    this.appendDummyInput()
        .appendField('Category:')
        .appendField(new Blockly.FieldDropdown([
          ['GENERAL', 'GENERAL'],
          ['DUT', 'DUT'],
          ['ACQUIRE', 'ACQUIRE'],
          ['ANALYZE', 'ANALYZE']
        ]), 'CATEGORY');
    this.appendDummyInput()
        .appendField('Parameter:')
        .appendField(new Blockly.FieldTextInput('DUTID'), 'PARAMETER');
    this.appendDummyInput()
        .appendField('Value:')
        .appendField(new Blockly.FieldTextInput('DUT001'), 'VALUE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Set TekExpress parameter value (TEKEXP:VALUE CATEGORY,"param","value")');
    this.setHelpUrl('');
  }
};

// TekExpress Export Report Block
Blockly.Blocks['tekexp_export_report'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📊 TekExpress Generate Report');
    this.appendDummyInput()
        .appendField('Generate Report:')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'GENERATE_REPORT');
    this.appendDummyInput()
        .appendField('Copy images:')
        .appendField(new Blockly.FieldCheckbox('FALSE'), 'COPY_IMAGES');
    this.appendDummyInput()
        .appendField('Destination:')
        .appendField(new Blockly.FieldTextInput('C:/TekExpressResults'), 'DESTINATION');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Generate TekExpress report and optionally copy images\n' +
      'TEKEXP:REPORT GENERATE - generates report in session folder\n' +
      'TEKEXP:COPYIMAGES path - copies images to destination');
    this.setHelpUrl('');
  }
};

// TekExpress Get Last Error Block
Blockly.Blocks['tekexp_last_error'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⚠️ TekExpress Get Last Error');
    this.appendDummyInput()
        .appendField('Save to:')
        .appendField(new Blockly.FieldTextInput('error_msg'), 'VARIABLE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Query last TekExpress error (TEKEXP:LASTERROR?)');
    this.setHelpUrl('');
  }
};

// TekExpress Save Session Block
Blockly.Blocks['tekexp_save_session'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('💾 TekExpress Save Session');
    this.appendDummyInput()
        .appendField('Session Name:')
        .appendField(new Blockly.FieldTextInput('MySession'), 'SESSION_NAME');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Save current TekExpress session (TEKEXP:SETUP SAVE,"name")');
    this.setHelpUrl('');
  }
};

// TekExpress Load Session Block
Blockly.Blocks['tekexp_load_session'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📂 TekExpress Load Session');
    this.appendDummyInput()
        .appendField('Session Name:')
        .appendField(new Blockly.FieldTextInput('MySession'), 'SESSION_NAME');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Load TekExpress session (TEKEXP:SETUP RECALL,"name")');
    this.setHelpUrl('');
  }
};

// TekExpress Query Result Block
Blockly.Blocks['tekexp_query_result'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📈 TekExpress Query Result');
    this.appendDummyInput()
        .appendField('Test Name:')
        .appendField(new Blockly.FieldTextInput('UI-Unit Interval'), 'TEST_NAME');
    this.appendDummyInput()
        .appendField('Save to:')
        .appendField(new Blockly.FieldTextInput('test_result'), 'VARIABLE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Query test result (TEKEXP:RESULT? "test name")');
    this.setHelpUrl('');
  }
};

// TekExpress Set Mode Block
Blockly.Blocks['tekexp_set_mode'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔧 TekExpress Set Mode');
    this.appendDummyInput()
        .appendField('Mode:')
        .appendField(new Blockly.FieldDropdown([
          ['USER-DEFINED', 'USER-DEFINED'],
          ['COMPLIANCE', 'COMPLIANCE'],
          ['LIVE', 'LIVE']
        ]), 'MODE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Set TekExpress execution mode (TEKEXP:MODE mode)');
    this.setHelpUrl('');
  }
};

// TekExpress Set Acquire Mode Block
Blockly.Blocks['tekexp_set_acquire_mode'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📡 TekExpress Acquire Mode');
    this.appendDummyInput()
        .appendField('Mode:')
        .appendField(new Blockly.FieldDropdown([
          ['LIVE', 'LIVE'],
          ['PRE-RECORDED', 'PRE-RECORDED']
        ]), 'ACQUIRE_MODE');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Set acquire mode (TEKEXP:ACQUIRE_MODE mode)\nLIVE = capture from instrument\nPRE-RECORDED = use saved waveforms');
    this.setHelpUrl('');
  }
};

// TekExpress Select Suite Block
Blockly.Blocks['tekexp_select_suite'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📋 TekExpress Select Suite');
    this.appendDummyInput()
        .appendField('Suite:')
        .appendField(new Blockly.FieldTextInput('Transmitter'), 'SUITE_NAME');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Select test suite (TEKEXP:SELECT SUITE,"name")');
    this.setHelpUrl('');
  }
};

// TekExpress Select Version Block
Blockly.Blocks['tekexp_select_version'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📌 TekExpress Select Version');
    this.appendDummyInput()
        .appendField('Version:')
        .appendField(new Blockly.FieldTextInput('USB3.1 Gen1'), 'VERSION_NAME');
    
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290); // Purple for TekExpress
    this.setTooltip('Select version/generation (TEKEXP:SELECT VERSION,"name")');
    this.setHelpUrl('');
  }
};
