/* ===================== Channel Configuration Blocks ===================== */

import * as Blockly from 'blockly';
import { getChannelCount, generateChannelOptions } from '../constants/tmDeviceTypes';

// Store the active device driver for dynamic channel options
// This is set by BlocklyBuilder when the workspace is initialized or device changes
let activeDeviceDriver: string | undefined;

export function setActiveDeviceDriver(driver: string | undefined) {
  activeDeviceDriver = driver;
}

export function getActiveDeviceDriver(): string | undefined {
  return activeDeviceDriver;
}

// Dynamic channel dropdown generator function
// Returns channel options based on the active device driver
function dynamicChannelDropdown(): [string, string][] {
  const channelCount = getChannelCount(activeDeviceDriver);
  return generateChannelOptions(channelCount);
}

// Configure Channel Block
Blockly.Blocks['configure_channel'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📺 Configure Channel')
        .appendField('Channel:')
        .appendField(new Blockly.FieldDropdown(dynamicChannelDropdown), 'CHANNEL');
    this.appendDummyInput()
        .appendField('Scale:')
        .appendField(new Blockly.FieldNumber(1.0, 0.001, 100), 'SCALE')
        .appendField('V');
    this.appendDummyInput()
        .appendField('Offset:')
        .appendField(new Blockly.FieldNumber(0, -10, 10), 'OFFSET')
        .appendField('V');
    this.appendDummyInput()
        .appendField('Coupling:')
        .appendField(new Blockly.FieldDropdown([
          ['DC', 'DC'],
          ['AC', 'AC'],
          ['GND', 'GND']
        ]), 'COUPLING');
    this.appendDummyInput()
        .appendField('Termination:')
        .appendField(new Blockly.FieldDropdown([
          ['1 MΩ', 'ONEMEG'],
          ['50 Ω', 'FIFTY']
        ]), 'TERMINATION');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(195); // Modern theme cyan
    this.setTooltip('Configure channel settings (scale, offset, coupling, termination).\nChannel options are based on the connected instrument model.');
    this.setHelpUrl('');
  }
};

// Enable Channel Block
Blockly.Blocks['enable_channel'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('📺 Enable Channel')
        .appendField('Channel:')
        .appendField(new Blockly.FieldDropdown(dynamicChannelDropdown), 'CHANNEL')
        .appendField('State:')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'STATE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(180); // Modern theme teal
    this.setTooltip('Enable or disable a channel.\nChannel options are based on the connected instrument model.');
    this.setHelpUrl('');
  }
};
