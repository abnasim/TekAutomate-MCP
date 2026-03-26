/* ===================== Timing Blocks ===================== */

import * as Blockly from 'blockly';

// Wait Seconds Block
Blockly.Blocks['wait_seconds'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⏱ Wait')
        .appendField(new Blockly.FieldNumber(1, 0.001, 3600), 'SECONDS')
        .appendField('seconds');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230); // Modern theme slate/gray
    this.setTooltip('Pause execution for specified time');
    this.setHelpUrl('');
  }
};

// Wait for OPC Block - Shows device context
Blockly.Blocks['wait_for_opc'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('⏱ Wait for OPC')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput()
        .appendField('Timeout:')
        .appendField(new Blockly.FieldNumber(5, 0.1, 60), 'TIMEOUT')
        .appendField('seconds');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230); // Modern theme gray
    this.setTooltip('Wait for operation complete (*OPC?) with timeout');
    this.setHelpUrl('');
    
    // Track if workspace is still loading
    this.workspaceLoadComplete_ = false;
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
      this.setColour(230); // Gray
    } else if (deviceName === 'psu' || deviceName === 'smu') {
      this.setColour(0); // Red
    } else if (deviceName === 'dmm') {
      this.setColour(120); // Green
    } else {
      this.setColour(230); // Gray
    }
  }
};
