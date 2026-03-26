/* ===================== SCPI Command Blocks ===================== */

import * as Blockly from 'blockly';

// Helper to find the current device context by walking back through blocks
// Prioritizes set_device_context blocks over connect_scope blocks
// Returns the MOST RECENT (closest) set_device_context, not the oldest!
function getDeviceContext(block: Blockly.Block): string {
  let currentBlock: Blockly.Block | null = block.getPreviousBlock();
  let lastConnectScope: string | null = null;
  
  // Walk backwards through the chain to find the most recent device context
  while (currentBlock) {
    if (currentBlock.type === 'set_device_context') {
      // Found an explicit device switch - return immediately!
      // This is the MOST RECENT one (closest to the current block)
      const deviceName = currentBlock.getFieldValue('DEVICE');
      if (deviceName) {
        return deviceName;
      }
    } else if (currentBlock.type === 'connect_scope') {
      // Found a connection block - save it but keep looking for set_device_context
      const deviceName = currentBlock.getFieldValue('DEVICE_NAME');
      if (deviceName && !lastConnectScope) {
        lastConnectScope = deviceName;
      }
    }
    currentBlock = currentBlock.getPreviousBlock();
  }
  
  // No set_device_context found, return connect_scope if found, otherwise '?'
  if (lastConnectScope) {
    return lastConnectScope;
  }
  return '?';
}

// SCPI Write Block (LEGACY - kept for backward compatibility with old XMLs)
// New blocks should use scpi_write_enhanced instead
Blockly.Blocks['scpi_write_legacy'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('📺 SCPI Write')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput()
        .appendField('Command:')
        .appendField(new Blockly.FieldTextInput('CH1:SCALE 1.0'), 'COMMAND');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(210); // Modern theme blue
    this.setTooltip('Send SCPI command to current connected device\nRight-click to browse available commands');
    this.setHelpUrl('');
    
    // Track if workspace is still loading
    this.workspaceLoadComplete_ = false;
    
    // Store a reference to trigger command browser
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      const blockId = this.id;
      const currentCommand = this.getFieldValue('COMMAND') || '';
      options.push({
        text: '📖 Browse SCPI Commands',
        enabled: true,
        callback: function() {
          // Trigger custom event to open command explorer
          const event = new CustomEvent('openSCPIExplorer', { 
            detail: { blockId: blockId, fieldName: 'COMMAND', currentCommand: currentCommand }
          });
          window.dispatchEvent(event);
        }
      });
      
      // Add conversion to tm_devices option
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
    
    // Update device context on:
    // 1. Block MOVE (user drags any block - might change the chain)
    // 2. Block CREATE/DELETE (adds/removes set_device_context or connect_scope)
    // 3. Block CHANGE (field changes on set_device_context or connect_scope)
    const shouldUpdate = 
      (event.type === Blockly.Events.BLOCK_MOVE) ||
      (event.type === Blockly.Events.BLOCK_CREATE) ||
      (event.type === Blockly.Events.BLOCK_DELETE) ||
      (event.type === Blockly.Events.BLOCK_CHANGE);
    
    if (!shouldUpdate) {
      return;
    }
    
    // Preserve existing device context if it's already set to a valid value (not default)
    // This prevents overwriting device context that was set from XML import
    const currentLabel = this.getFieldValue('DEVICE_CONTEXT');
    const isDefaultValue = currentLabel === '(scope)' || currentLabel === '(?)';
    
    // On BLOCK_MOVE, check if block is properly connected before updating
    if (event.type === Blockly.Events.BLOCK_MOVE) {
      // If block already has a valid device context set (from XML), preserve it
      if (!isDefaultValue) {
        return;
      }
      
      // For default values, check if block is properly connected before updating
      // Use a small delay to ensure block is fully reconnected
      setTimeout(() => {
        if (!this.workspace || this.isDisposed()) return;
        
        const deviceName = getDeviceContext(this);
        const newLabel = `(${deviceName})`;
        const updatedLabel = this.getFieldValue('DEVICE_CONTEXT');
        
        // Only update if still default and device context changed
        if ((updatedLabel === '(scope)' || updatedLabel === '(?)') && updatedLabel !== newLabel) {
          this.setFieldValue(newLabel, 'DEVICE_CONTEXT');
          
          // Color code based on device
          if (deviceName === 'scope') {
            this.setColour(210); // Blue
          } else if (deviceName === 'psu' || deviceName === 'smu') {
            this.setColour(0); // Red
          } else if (deviceName === 'dmm') {
            this.setColour(120); // Green
          } else {
            this.setColour(230); // Gray
          }
        }
      }, 50);
      return;
    }
    
    // For non-MOVE events, update device context based on chain
    const deviceName = getDeviceContext(this);
    const newLabel = `(${deviceName})`;
    
    if (currentLabel !== newLabel) {
      this.setFieldValue(newLabel, 'DEVICE_CONTEXT');
      
      // Color code based on device
      if (deviceName === 'scope') {
        this.setColour(210); // Blue
      } else if (deviceName === 'psu' || deviceName === 'smu') {
        this.setColour(0); // Red
      } else if (deviceName === 'dmm') {
        this.setColour(120); // Green
      } else {
        this.setColour(230); // Gray
      }
    }
  }
};

// SCPI Query Block (LEGACY - kept for backward compatibility with old XMLs)
// New blocks should use scpi_query_enhanced instead
Blockly.Blocks['scpi_query_legacy'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('📺 SCPI Query')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput()
        .appendField('Command:')
        .appendField(new Blockly.FieldTextInput('*IDN?'), 'COMMAND');
    this.appendDummyInput()
        .appendField('Save to:')
        .appendField(new Blockly.FieldTextInput('result'), 'VARIABLE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230); // Modern theme indigo
    this.setTooltip('Query SCPI command and save result to variable\nRight-click to browse available commands');
    this.setHelpUrl('');
    
    // Track if workspace is still loading
    this.workspaceLoadComplete_ = false;
    
    // Store a reference to trigger command browser
    this.customContextMenu = function(this: Blockly.Block, options: any[]) {
      const blockId = this.id;
      const currentCommand = this.getFieldValue('COMMAND') || '';
      options.push({
        text: '📖 Browse SCPI Commands',
        enabled: true,
        callback: function() {
          // Trigger custom event to open command explorer
          const event = new CustomEvent('openSCPIExplorer', { 
            detail: { blockId: blockId, fieldName: 'COMMAND', currentCommand: currentCommand }
          });
          window.dispatchEvent(event);
        }
      });
      
      // Add conversion to tm_devices option
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
    
    // Update device context on:
    // 1. Block MOVE (user drags any block - might change the chain)
    // 2. Block CREATE/DELETE (adds/removes set_device_context or connect_scope)
    // 3. Block CHANGE (field changes on set_device_context or connect_scope)
    const shouldUpdate = 
      (event.type === Blockly.Events.BLOCK_MOVE) ||
      (event.type === Blockly.Events.BLOCK_CREATE) ||
      (event.type === Blockly.Events.BLOCK_DELETE) ||
      (event.type === Blockly.Events.BLOCK_CHANGE);
    
    if (!shouldUpdate) {
      return;
    }
    
    // Preserve existing device context if it's already set to a valid value (not default)
    // This prevents overwriting device context that was set from XML import
    const currentLabel = this.getFieldValue('DEVICE_CONTEXT');
    const isDefaultValue = currentLabel === '(scope)' || currentLabel === '(?)';
    
    // On BLOCK_MOVE, check if block is properly connected before updating
    if (event.type === Blockly.Events.BLOCK_MOVE) {
      // If block already has a valid device context set (from XML), preserve it
      if (!isDefaultValue) {
        return;
      }
      
      // For default values, check if block is properly connected before updating
      // Use a small delay to ensure block is fully reconnected
      setTimeout(() => {
        if (!this.workspace || this.isDisposed()) return;
        
        const deviceName = getDeviceContext(this);
        const newLabel = `(${deviceName})`;
        const updatedLabel = this.getFieldValue('DEVICE_CONTEXT');
        
        // Only update if still default and device context changed
        if ((updatedLabel === '(scope)' || updatedLabel === '(?)') && updatedLabel !== newLabel) {
          this.setFieldValue(newLabel, 'DEVICE_CONTEXT');
          
          // Color code based on device
          if (deviceName === 'scope') {
            this.setColour(230); // Indigo
          } else if (deviceName === 'psu' || deviceName === 'smu') {
            this.setColour(0); // Red
          } else if (deviceName === 'dmm') {
            this.setColour(120); // Green
          } else {
            this.setColour(230); // Gray
          }
        }
      }, 50);
      return;
    }
    
    // For non-MOVE events, update device context based on chain
    const deviceName = getDeviceContext(this);
    const newLabel = `(${deviceName})`;
    
    if (currentLabel !== newLabel) {
      this.setFieldValue(newLabel, 'DEVICE_CONTEXT');
      
      // Color code based on device
      if (deviceName === 'scope') {
        this.setColour(230); // Indigo
      } else if (deviceName === 'psu' || deviceName === 'smu') {
        this.setColour(0); // Red
      } else if (deviceName === 'dmm') {
        this.setColour(120); // Green
      } else {
        this.setColour(230); // Gray
      }
    }
  }
};

// Custom Command Block - Shows device context
Blockly.Blocks['custom_command'] = {
  init: function() {
    this.appendDummyInput('DEVICE_LABEL')
        .appendField('📺 Custom SCPI')
        .appendField(new Blockly.FieldLabelSerializable('(scope)'), 'DEVICE_CONTEXT');
    this.appendDummyInput()
        .appendField(new Blockly.FieldTextInput('*RST'), 'COMMAND');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(260); // Modern theme purple
    this.setTooltip('Execute custom SCPI command (advanced)');
    this.setHelpUrl('');
  },
  onchange: function(event: any) {
    if (!this.workspace || this.isInFlyout) return;
    
    // Don't auto-update device context during XML import/deserialization
    if (event.type === Blockly.Events.BLOCK_CREATE || 
        event.type === Blockly.Events.BLOCK_CHANGE ||
        event.type === Blockly.Events.FINISHED_LOADING) {
      return;
    }
    
    // Only auto-update on block move
    if (event.type !== Blockly.Events.BLOCK_MOVE) {
      return;
    }
    
    // Update device context label only if not already set from XML
    const currentContext = this.getFieldValue('DEVICE_CONTEXT');
    if (currentContext && currentContext !== '(scope)' && currentContext !== '(?)') {
      return;
    }
    
    const deviceName = getDeviceContext(this);
    this.setFieldValue(`(${deviceName})`, 'DEVICE_CONTEXT');
    
    // Color code based on device
    if (deviceName === 'scope') {
      this.setColour(260); // Purple
    } else if (deviceName === 'psu') {
      this.setColour(0); // Red
    } else if (deviceName === 'dmm') {
      this.setColour(120); // Green
    } else {
      this.setColour(230); // Gray
    }
  }
};


// Helper function no longer needed since we removed device dropdowns
export function updateSCPIDeviceDropdowns(devices: any[]) {
  // Kept for backwards compatibility but not used
  return function() {
    return [];
  };
}
