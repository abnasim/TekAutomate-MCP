/* ===================== Device Capability System ===================== */

/**
 * Device capabilities define what operations a device type can perform.
 * This allows treating device types as roles that can be fulfilled by different physical devices.
 * 
 * Example: PSU role can be fulfilled by:
 * - SMU (using tm_devices API)
 * - Bench PSU (using SCPI commands)
 */

export type DeviceCapability = 
  | 'set_voltage'      // Can set output voltage
  | 'measure_voltage'  // Can measure voltage
  | 'set_current'      // Can set current limit
  | 'measure_current'  // Can measure current
  | 'enable_output'    // Can enable/disable output
  | 'acquire'          // Can acquire waveforms
  | 'save_waveform'    // Can save waveform data
  | 'save_screenshot'  // Can save screenshots
  | 'generate_signal'  // Can generate signals
  | 'measure_frequency' // Can measure frequency
  | 'measure_amplitude'; // Can measure amplitude

export type DeviceType = 'SCOPE' | 'AWG' | 'AFG' | 'PSU' | 'SMU' | 'DMM' | 'DAQ' | 'MT' | 'MF' | 'SS';

/**
 * Device capability mapping.
 * Defines what operations each device type can perform.
 */
export const DeviceCapabilities: Record<DeviceType, DeviceCapability[]> = {
  SCOPE: ['acquire', 'save_waveform', 'save_screenshot', 'measure_frequency', 'measure_amplitude'],
  AWG: ['generate_signal'],
  AFG: ['generate_signal'],
  PSU: ['set_voltage', 'set_current', 'enable_output'], // Bench PSU capabilities
  SMU: ['set_voltage', 'measure_voltage', 'set_current', 'measure_current', 'enable_output'], // SMU can do everything PSU can, plus measurement
  DMM: ['measure_voltage', 'measure_current', 'measure_frequency'],
  DAQ: ['measure_voltage', 'measure_current'],
  MT: ['set_voltage', 'measure_voltage'],
  MF: [], // Mainframe capabilities depend on installed cards
  SS: []  // Switch system capabilities depend on configuration
};

/**
 * Role-to-device-type mapping.
 * Defines which device types can fulfill which roles.
 */
export const RoleFulfillment: Record<string, DeviceType[]> = {
  'psu': ['SMU', 'PSU'],      // PSU role can be fulfilled by SMU or PSU
  'voltage_source': ['SMU', 'PSU'], // Voltage source role
  'current_source': ['SMU'],   // Current source role (SMU only)
  'voltage_measure': ['SMU', 'DMM', 'SCOPE'], // Voltage measurement
  'current_measure': ['SMU', 'DMM'], // Current measurement
  'waveform_capture': ['SCOPE'], // Waveform capture
  'signal_generation': ['AWG', 'AFG'] // Signal generation
};

/**
 * Check if a device type has a specific capability.
 */
export function hasCapability(deviceType: DeviceType, capability: DeviceCapability): boolean {
  return DeviceCapabilities[deviceType]?.includes(capability) ?? false;
}

/**
 * Check if a device type can fulfill a specific role.
 */
export function canFulfillRole(deviceType: DeviceType, role: string): boolean {
  const roleLower = role.toLowerCase();
  return RoleFulfillment[roleLower]?.includes(deviceType) ?? false;
}

/**
 * Get the best implementation method for a capability on a device type.
 * Returns 'tm_devices' for devices that support it, 'scpi' otherwise.
 */
export function getImplementationMethod(
  deviceType: DeviceType, 
  capability: DeviceCapability,
  backend: 'pyvisa' | 'tm_devices' | 'vxi11' | 'tekhsi' | 'hybrid'
): 'tm_devices' | 'scpi' {
  // If backend is tm_devices and device type supports tm_devices, use tm_devices API
  if (backend === 'tm_devices' && ['SMU', 'SCOPE', 'DMM', 'AWG', 'AFG', 'PSU'].includes(deviceType)) {
    return 'tm_devices';
  }
  // Otherwise use SCPI
  return 'scpi';
}

/**
 * Get the appropriate command pattern for a capability on a device.
 * Returns the command structure based on device type and backend.
 */
export function getCommandPattern(
  deviceType: DeviceType,
  capability: DeviceCapability,
  backend: 'pyvisa' | 'tm_devices' | 'vxi11' | 'tekhsi' | 'hybrid',
  deviceName: string
): string {
  const method = getImplementationMethod(deviceType, capability, backend);
  
  if (method === 'tm_devices') {
    // Use tm_devices Pythonic API
    switch (capability) {
      case 'set_voltage':
        if (deviceType === 'SMU') {
          // SMU: use source_voltage property or commands.source.voltage
          return `${deviceName}.commands.source.voltage.write({value})`;
        } else if (deviceType === 'PSU') {
          // PSU: use SCPI via tm_devices
          return `${deviceName}.write(f"VOLTage {value}")`;
        }
        break;
      case 'enable_output':
        if (deviceType === 'SMU') {
          return `${deviceName}.commands.source.output.write({value})`;
        } else if (deviceType === 'PSU') {
          return `${deviceName}.write(f"OUTPut {value}")`;
        }
        break;
      case 'measure_current':
        if (deviceType === 'SMU') {
          return `${deviceName}.commands.measure.current.read()`;
        }
        break;
      case 'measure_voltage':
        if (deviceType === 'SMU') {
          return `${deviceName}.commands.measure.voltage.read()`;
        }
        break;
    }
  }
  
  // Default to SCPI commands
  switch (capability) {
    case 'set_voltage':
      return `${deviceName}.write(f"VOLTage {value}")`;
    case 'enable_output':
      return `${deviceName}.write(f"OUTPut {value}")`;
    case 'measure_current':
      return `${deviceName}.query("MEASure:CURRent?")`;
    case 'measure_voltage':
      return `${deviceName}.query("MEASure:VOLTage?")`;
    default:
      return `${deviceName}.write("{command}")`;
  }
}

/**
 * Check if a device can perform a PSU operation (voltage sourcing).
 * This is the key function that allows SMU to fulfill PSU role.
 */
export function canPerformPSUOperation(deviceType: DeviceType): boolean {
  return canFulfillRole(deviceType, 'psu') || hasCapability(deviceType, 'set_voltage');
}
