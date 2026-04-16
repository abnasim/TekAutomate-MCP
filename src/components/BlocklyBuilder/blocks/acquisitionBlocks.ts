/* ===================== Acquisition Control Blocks ===================== */

import * as Blockly from 'blockly';

// Start Acquisition Block
Blockly.Blocks['start_acquisition'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('▶ Start Acquisition');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120); // Modern theme green
    this.setTooltip('Start acquiring waveform data');
    this.setHelpUrl('');
  }
};

// Stop Acquisition Block
Blockly.Blocks['stop_acquisition'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⏹ Stop Acquisition');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(20); // Modern theme orange-red
    this.setTooltip('Stop acquiring waveform data');
    this.setHelpUrl('');
  }
};

// Single Acquisition Block
Blockly.Blocks['single_acquisition'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⏯ Single Acquisition');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(45); // Modern theme orange
    this.setTooltip('Trigger a single acquisition');
    this.setHelpUrl('');
  }
};
