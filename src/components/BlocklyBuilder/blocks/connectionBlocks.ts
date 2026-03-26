/* ===================== Connection Blocks ===================== */

import * as Blockly from 'blockly';
import { TM_DEVICE_TYPES } from '../constants/tmDeviceTypes';

// Connect to Instrument Block
Blockly.Blocks['connect_scope'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔌 Connect to Instrument');
    this.appendDummyInput()
        .appendField('Name:')
        .appendField(new Blockly.FieldTextInput('scope'), 'DEVICE_NAME');
    this.appendDummyInput()
        .appendField('Backend:')
        .appendField(new Blockly.FieldDropdown([
          ['PyVISA', 'pyvisa'],
          ['tm_devices', 'tm_devices'],
          ['TekHSI', 'tekhsi'],
          ['Hybrid', 'hybrid'],
          ['VXI-11', 'vxi11']
        ], this.onBackendChange.bind(this)), 'BACKEND');
    
    this.showAdvanced_ = false;
    this.currentBackend_ = 'pyvisa';
    this.currentConnType_ = 'INSTR'; // Track connection type for PyVISA
    this.currentDevType_ = 'SCOPE'; // Track device type for tm_devices
    this.isUpdatingShape_ = false; // Flag to prevent infinite recursion in onChange callbacks
    this.isLoadingFromXml_ = false; // Flag to prevent restoring values during XML load
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120); // Modern theme green
    this.setTooltip('Connect to instrument with a specific name (e.g., scope, psu, dmm)\nRight-click for advanced settings');
    this.setHelpUrl('');
    this.data = 'deviceName'; // Store for context tracking
    
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
  onBackendChange: function(newValue: string) {
    this.currentBackend_ = newValue;
    // Update block color based on backend
    this.updateColorForBackend_(newValue);
    if (this.showAdvanced_) {
      this.updateShape_();
    }
    return newValue;
  },
  updateColorForBackend_: function(backend: string) {
    // Set color based on backend for visual distinction
    switch(backend) {
      case 'tm_devices':
        this.setColour(270); // Purple for tm_devices
        break;
      case 'tekhsi':
        this.setColour(30); // Orange for TekHSI
        break;
      case 'hybrid':
        this.setColour(60); // Yellow for Hybrid
        break;
      case 'vxi11':
        this.setColour(180); // Teal for VXI-11
        break;
      case 'pyvisa':
      default:
        this.setColour(120); // Green for PyVISA (default)
        break;
    }
  },
  onDeviceTypeChange: function(newValue: string) {
    // Prevent infinite recursion when programmatically setting field values
    if (this.isUpdatingShape_) {
      return newValue;
    }
    
    // Store the new device type before re-rendering
    this.currentDevType_ = newValue;
    
    // Re-render the shape to update driver list for tm_devices
    if (this.showAdvanced_ && this.currentBackend_ === 'tm_devices') {
      this.updateShape_();
    }
    return newValue;
  },
  onConnectionTypeChange: function(newValue: string) {
    // Prevent infinite recursion when programmatically setting field values
    if (this.isUpdatingShape_) {
      return newValue;
    }
    
    // Store the new connection type before re-rendering
    this.currentConnType_ = newValue;
    
    // Re-render the shape to show/hide PORT field
    if (this.showAdvanced_) {
      this.updateShape_();
    }
    this.updateResourceString_();
    return newValue;
  },
  updateResourceString_: function() {
    // Auto-generate RESOURCE string based on connection type
    const connType = this.getFieldValue('CONN_TYPE') || 'INSTR';
    const host = this.getFieldValue('HOST') || '192.168.1.10';
    const port = this.getFieldValue('PORT_NUM') || 4000;
    
    let resource = '';
    if (connType === 'INSTR') {
      resource = `TCPIP::${host}::INSTR`;
    } else if (connType === 'SOCKET') {
      resource = `TCPIP::${host}::${port}::SOCKET`;
    } else if (connType === 'USB') {
      resource = `USB::${host}::INSTR`;
    } else if (connType === 'GPIB') {
      resource = `GPIB::${port}::INSTR`;
    } else if (connType === 'ASRL') {
      resource = `ASRL${port}::INSTR`;
    }
    
    // Store the generated resource string
    this.resourceString_ = resource;
  },
  updateShape_: function() {
    // Don't update shape if block is not attached to a workspace yet,
    // not rendered, or is in the flyout (toolbox preview)
    if (!this.workspace || !this.rendered || this.isInFlyout) {
      return;
    }
    
    // Additional safety check: ensure the block has an SVG group
    // This prevents errors during view transitions when the DOM is being rebuilt
    try {
      if (!this.getSvgRoot()) {
        return;
      }
    } catch (e) {
      // Block is not in a valid rendering state
      return;
    }
    
    // Set flag to prevent onChange callbacks from triggering during shape update
    this.isUpdatingShape_ = true;
    
    try {
      // Save current field values before removing inputs
      const savedValues: any = {};
      const fieldsToSave = ['HOST', 'PORT_NUM', 'CONN_TYPE', 'DEV_TYPE', 'DRIVER_NAME', 'DEVICE_ALIAS', 'VISA_BACKEND_TYPE', 'TIMEOUT_MS', 'TIMEOUT_SEC'];
      fieldsToSave.forEach(fieldName => {
        try {
          const value = this.getFieldValue(fieldName);
          if (value !== null && value !== undefined) {
            savedValues[fieldName] = value;
          }
        } catch (e) {
          // Field doesn't exist
        }
      });
      
      // Remove all advanced inputs
      const inputsToRemove = ['CONNECTION_TYPE', 'HOST_IP', 'PORT', 'DEVICE_TYPE', 'DRIVER', 'VISA_BACKEND', 'RESOURCE_STRING', 'TIMEOUT', 'ALIAS'];
      inputsToRemove.forEach(inputName => {
        if (this.getInput(inputName)) {
          this.removeInput(inputName);
        }
      });
      
      // Add advanced inputs based on backend
      if (this.showAdvanced_) {
        const backend = this.currentBackend_ || this.getFieldValue('BACKEND');
        
        if (backend === 'pyvisa' || backend === 'hybrid') {
          // PyVISA specific settings with connection type
          const currentConnType = this.currentConnType_ || 'INSTR';
          
          this.appendDummyInput('CONNECTION_TYPE')
              .appendField('Connection:')
              .appendField(new Blockly.FieldDropdown([
                ['TCPIP INSTR', 'INSTR'],
                ['TCPIP SOCKET', 'SOCKET'],
                ['USB', 'USB'],
                ['GPIB', 'GPIB'],
                ['Serial', 'ASRL']
              ], this.onConnectionTypeChange.bind(this)), 'CONN_TYPE');
          
          // Set the connection type field to match our internal state
          this.setFieldValue(currentConnType, 'CONN_TYPE');
          
          const hostValue = savedValues['HOST'] || this.hostValue_ || '192.168.1.10';
          this.appendDummyInput('HOST_IP')
              .appendField('Host/IP:')
              .appendField(new Blockly.FieldTextInput(hostValue), 'HOST');
          // Store the value for mutation serialization
          this.hostValue_ = hostValue;
          
          // Only show PORT for connection types that need it
          if (currentConnType === 'SOCKET' || currentConnType === 'GPIB' || currentConnType === 'ASRL') {
            const portValue = savedValues['PORT_NUM'] || 4000;
            this.appendDummyInput('PORT')
                .appendField('Port:')
                .appendField(new Blockly.FieldNumber(portValue, 1, 65535), 'PORT_NUM');
          }
          
          const visaBackendValue = savedValues['VISA_BACKEND_TYPE'] || '@ni';
          this.appendDummyInput('VISA_BACKEND')
              .appendField('VISA Backend:')
              .appendField(new Blockly.FieldDropdown([
                ['NI-VISA', '@ni'],
                ['PyVISA-py', '@py'],
                ['Default', '@default']
              ]), 'VISA_BACKEND_TYPE');
          this.setFieldValue(visaBackendValue, 'VISA_BACKEND_TYPE');
          
          const timeoutValue = savedValues['TIMEOUT_MS'] || 5000;
          this.appendDummyInput('TIMEOUT')
              .appendField('Timeout (ms):')
              .appendField(new Blockly.FieldNumber(timeoutValue, 100, 60000), 'TIMEOUT_MS');
          
          // Auto-generate resource string
          this.updateResourceString_();
        } else if (backend === 'tm_devices') {
          // tm_devices uses simple IP/hostname - no resource strings or ports
          // Use saved value if available, then stored mutation value, otherwise use default
          const hostValue = savedValues['HOST'] || this.hostValue_ || '192.168.0.1';
          this.appendDummyInput('HOST_IP')
              .appendField('IP/Hostname:')
              .appendField(new Blockly.FieldTextInput(hostValue), 'HOST');
          // Store the value for mutation serialization
          this.hostValue_ = hostValue;
          
          // Use currentDevType_ to determine which device type should be selected
          const currentDevType = this.currentDevType_ || 'SCOPE';
          
          this.appendDummyInput('DEVICE_TYPE')
              .appendField('Device Type:')
              .appendField(new Blockly.FieldDropdown([
                ['Oscilloscope', 'SCOPE'],
                ['TekScope PC', 'TEKSCOPE_PC'],
                ['Power Supply', 'PSU'],
                ['SMU', 'SMU'],
                ['DMM', 'DMM'],
                ['AFG', 'AFG'],
                ['AWG', 'AWG'],
                ['DAQ', 'DAQ']
              ], this.onDeviceTypeChange.bind(this)), 'DEV_TYPE');
          
          // Set the device type field to match our internal state
          this.setFieldValue(currentDevType, 'DEV_TYPE');
          
          // Build driver dropdown based on currentDevType_ (not getFieldValue which is stale)
          const driverList: readonly string[] = TM_DEVICE_TYPES[currentDevType as keyof typeof TM_DEVICE_TYPES]?.drivers || ['MSO6B'];
          const driverOptions: [string, string][] = driverList.map(driver => [driver, driver] as [string, string]);
          
          // Use saved driver value if available and valid for current device type
          const savedDriver = savedValues['DRIVER_NAME'] as string;
          const driverValue = savedDriver && driverList.includes(savedDriver) 
            ? savedDriver 
            : driverList[0];
          this.appendDummyInput('DRIVER')
              .appendField('Driver:')
              .appendField(new Blockly.FieldDropdown(driverOptions), 'DRIVER_NAME');
          // Set the driver after creating the dropdown
          if (driverValue) {
            this.setFieldValue(driverValue, 'DRIVER_NAME');
          }
          
          const aliasValue = savedValues['DEVICE_ALIAS'] || '';
          this.appendDummyInput('ALIAS')
              .appendField('Alias (optional):')
              .appendField(new Blockly.FieldTextInput(aliasValue), 'DEVICE_ALIAS');
        } else if (backend === 'tekhsi') {
          // TekHSI specific settings
          this.appendDummyInput('HOST_IP')
              .appendField('Host/IP:')
              .appendField(new Blockly.FieldTextInput('192.168.1.10'), 'HOST');
          
          this.appendDummyInput('PORT')
              .appendField('Port:')
              .appendField(new Blockly.FieldNumber(4000, 0, 65535), 'PORT_NUM');
          
          this.appendDummyInput('TIMEOUT')
              .appendField('Timeout (s):')
              .appendField(new Blockly.FieldNumber(5, 1, 60), 'TIMEOUT_SEC');
        } else if (backend === 'vxi11') {
          // VXI-11 specific settings
          this.appendDummyInput('HOST_IP')
              .appendField('Host/IP:')
              .appendField(new Blockly.FieldTextInput('192.168.1.10'), 'HOST');
          
          this.appendDummyInput('TIMEOUT')
              .appendField('Timeout (s):')
              .appendField(new Blockly.FieldNumber(10, 1, 60), 'TIMEOUT_SEC');
        }
      }
    } finally {
      // Clear flag after shape update completes
      this.isUpdatingShape_ = false;
    }
  }, // updateShape_ method
  mutationToDom: function() {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('show_advanced', this.showAdvanced_ ? 'true' : 'false');
    container.setAttribute('current_backend', this.currentBackend_ || 'pyvisa');
    container.setAttribute('current_dev_type', this.currentDevType_ || 'SCOPE');
    container.setAttribute('current_conn_type', this.currentConnType_ || 'INSTR');
    
    // Save HOST value in mutation so it survives even when advanced settings are hidden
    // Try to get from field first, then from stored value
    const host = this.getFieldValue('HOST') || this.hostValue_ || '';
    if (host) {
      container.setAttribute('host', host);
    }
    
    return container;
  },
  domToMutation: function(xmlElement: Element) {
    this.showAdvanced_ = xmlElement.getAttribute('show_advanced') === 'true';
    this.currentBackend_ = xmlElement.getAttribute('current_backend') || 'pyvisa';
    this.currentDevType_ = xmlElement.getAttribute('current_dev_type') || 'SCOPE';
    this.currentConnType_ = xmlElement.getAttribute('current_conn_type') || 'INSTR';
    
    // Restore HOST from mutation data - this is critical for code generation
    const host = xmlElement.getAttribute('host');
    if (host) {
      this.hostValue_ = host;
    }
    
    // Update block color based on backend
    this.updateColorForBackend_(this.currentBackend_);
    
    // CRITICAL FIX: Set the BACKEND dropdown field value to match the restored backend
    // This ensures the UI shows the correct backend (tm_devices, pyvisa, etc.)
    // Use setTimeout to ensure the field exists before setting
    setTimeout(() => {
      try {
        if (this.getField('BACKEND')) {
          this.setFieldValue(this.currentBackend_, 'BACKEND');
        }
      } catch (e) {
        console.warn('Could not restore backend field value:', e);
      }
    }, 10);
    
    // DON'T call updateShape_() here during XML load
    // Blockly will call it after the block is fully initialized via the rendered event
    // Just store the state and let the block render with its initial shape
  },
  saveExtraState: function() {
    // Save all internal state including HOST
    const host = this.getFieldValue('HOST') || this.hostValue_ || '';
    const state: any = {
      showAdvanced: this.showAdvanced_,
      currentBackend: this.currentBackend_,
      currentDevType: this.currentDevType_,
      currentConnType: this.currentConnType_,
      host: host
    };
    
    return state;
  },
  loadExtraState: function(state: any) {
    this.showAdvanced_ = state.showAdvanced || false;
    this.currentBackend_ = state.currentBackend || 'pyvisa';
    this.currentDevType_ = state.currentDevType || this.currentDevType_ || 'SCOPE';
    this.currentConnType_ = state.currentConnType || this.currentConnType_ || 'INSTR';
    this.hostValue_ = state.host || '';
    
    // Update block color based on backend
    this.updateColorForBackend_(this.currentBackend_);
    
    // Set the BACKEND dropdown field value to match the restored backend
    setTimeout(() => {
      try {
        if (this.getField('BACKEND')) {
          this.setFieldValue(this.currentBackend_, 'BACKEND');
        }
      } catch (e) {
        console.warn('Could not restore backend field value:', e);
      }
    }, 10);
    
    // Only update shape if advanced settings should be shown
    if (this.showAdvanced_) {
      // Defer to ensure block is fully rendered
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (this.workspace && this.rendered && !this.isInFlyout) {
            this.updateShape_();
          }
        }, 50);
      });
    }
  },
  // Getter for HOST value - used by code generator when field doesn't exist
  getHostValue: function() {
    // Try field first, then stored value
    const fieldHost = this.getFieldValue('HOST');
    return fieldHost || this.hostValue_ || '';
  }
};

// Disconnect Block
Blockly.Blocks['disconnect'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🔌 Disconnect');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(0); // Modern theme red
    this.setTooltip('Disconnect from instrument(s)');
    this.setHelpUrl('');
  }
};

// Set Device Context Block
Blockly.Blocks['set_device_context'] = {
  init: function() {
    this.appendDummyInput()
        .appendField('🎯 Use Device:')
        .appendField(new Blockly.FieldDropdown(this.getDeviceOptions.bind(this)), 'DEVICE');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(45); // Modern theme orange
    this.setTooltip('Switch to a different device for subsequent SCPI commands (e.g., scope, psu, dmm)');
    this.setHelpUrl('');
    
    // Store device from XML
    this.deviceFromXml_ = null;
  },
  getDeviceOptions: function() {
    // Walk back through blocks to find all connected devices
    const devices: string[][] = [['scope', 'scope']]; // Default option
    
    if (!this.workspace) {
      return devices;
    }
    
    const allBlocks = this.workspace.getAllBlocks(false);
    const connectedDevices = new Set<string>();
    
    for (const block of allBlocks) {
      if (block.type === 'connect_scope') {
        const deviceName = block.getFieldValue('DEVICE_NAME');
        if (deviceName) {
          connectedDevices.add(deviceName);
        }
      }
    }
    
    // Return list of connected devices or default
    if (connectedDevices.size > 0) {
      return Array.from(connectedDevices).map(device => [device, device]);
    }
    
    return devices;
  },
  // Restore device from XML (field may not exist yet; retry a few times)
  domToMutation: function(xmlElement: Element) {
    const device = xmlElement.getAttribute('device');
    if (device) {
      (this as any).deviceFromXml_ = device;
      let attempts = 0;
      const maxAttempts = 10;
      const setDeviceWhenReady = () => {
        if (this.getField('DEVICE')) {
          try {
            this.setFieldValue(device, 'DEVICE');
          } catch (e) {
            console.warn('Could not set device from XML:', e);
          }
          return;
        }
        if (++attempts < maxAttempts) setTimeout(setDeviceWhenReady, 50);
      };
      setTimeout(setDeviceWhenReady, 50);
    }
  },
  // Save device to XML
  mutationToDom: function() {
    const container = Blockly.utils.xml.createElement('mutation');
    const device = this.getFieldValue('DEVICE');
    if (device) {
      container.setAttribute('device', device);
    }
    return container;
  }
};

// Helper function to update device dropdowns dynamically
export function updateDeviceDropdowns(devices: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getOptions = () => devices.map(d => [d.alias, d.id]);
  
  // Return a function for the dropdown menu
  return function() {
    const options = devices.map(d => [d.alias, d.id]);
    if (options.length === 0) {
      return [['No devices', 'default']];
    }
    return options;
  };
}
