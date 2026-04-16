/* ===================== tm_devices Device Types and Drivers ===================== */

// Channel count mapping for oscilloscope models
// Format: driver name -> number of analog channels
export const DEVICE_CHANNEL_COUNTS: Record<string, number> = {
  // MSO 2 Series - 4 channels
  'MSO2': 4,
  'MSO2A': 4,
  // MSO 4 Series - 4 or 6 channels
  'MSO4': 4,
  'MSO4B': 4,
  'MSO44': 4,
  'MSO44B': 4,
  'MSO46': 6,
  'MSO46B': 6,
  // MSO 5 Series - 4, 6, or 8 channels
  'MSO5': 4,
  'MSO5B': 4,
  'MSO5LP': 4,
  'MSO54': 4,
  'MSO54B': 4,
  'MSO56': 6,
  'MSO56B': 6,
  'MSO58': 8,
  'MSO58B': 8,
  // MSO 6 Series - 4, 6, or 8 channels
  'MSO6': 8,  // Default to 8 for generic MSO6
  'MSO6B': 8, // Default to 8 for generic MSO6B
  'MSO64': 4,
  'MSO64B': 4,
  'MSO66': 6,
  'MSO66B': 6,
  'MSO68': 8,
  'MSO68B': 8,
  // Legacy DPO/MSO 5K/7K/70K - typically 4 channels
  'DPO5K': 4,
  'DPO7K': 4,
  'DPO70K': 4,
  'MSO70KDX': 4,
  'MSO70KC': 4,
  // MDO Series - 4 channels
  'MDO3000': 4,
  'MDO4000': 4,
  'MDO4000B': 4,
  'MDO4000C': 4,
  // Default for unknown models
  'default': 4
};

// Helper function to get channel count for a device driver
export function getChannelCount(driver: string | undefined): number {
  if (!driver) return DEVICE_CHANNEL_COUNTS['default'];
  
  // Try exact match first
  if (DEVICE_CHANNEL_COUNTS[driver]) {
    return DEVICE_CHANNEL_COUNTS[driver];
  }
  
  // Try uppercase
  const upperDriver = driver.toUpperCase();
  if (DEVICE_CHANNEL_COUNTS[upperDriver]) {
    return DEVICE_CHANNEL_COUNTS[upperDriver];
  }
  
  // Try to extract model number pattern (e.g., MSO68B -> check MSO68B, MSO68, MSO6B, MSO6)
  // Pattern: MSO/DPO + optional digits + optional letter suffix
  const match = driver.match(/^(MSO|DPO|MDO)(\d+)?([A-Z])?/i);
  if (match) {
    const prefix = match[1].toUpperCase();
    const modelNum = match[2] || '';
    const suffix = match[3]?.toUpperCase() || '';
    
    // Try progressively shorter matches
    const variants = [
      `${prefix}${modelNum}${suffix}`,  // MSO68B
      `${prefix}${modelNum}`,            // MSO68
      `${prefix}${suffix}`,              // MSO6B (if modelNum was part of it)
    ];
    
    for (const variant of variants) {
      if (DEVICE_CHANNEL_COUNTS[variant]) {
        return DEVICE_CHANNEL_COUNTS[variant];
      }
    }
  }
  
  return DEVICE_CHANNEL_COUNTS['default'];
}

// Generate channel options array for dropdowns
export function generateChannelOptions(channelCount: number): [string, string][] {
  const options: [string, string][] = [];
  for (let i = 1; i <= channelCount; i++) {
    options.push([`CH${i}`, `CH${i}`]);
  }
  return options;
}

export const TM_DEVICE_TYPES = {
  SCOPE: {
    label: 'Oscilloscope',
    drivers: ['MSO2', 'MSO2A', 'MSO4', 'MSO4B', 'MSO5', 'MSO5B', 'MSO5LP', 'MSO6', 'MSO6B', 'MSO70KDX', 'MSO70KC', 'DPO5K', 'DPO7K', 'DPO70K', 'MDO3000', 'MDO4000', 'MDO4000B', 'MDO4000C']
  },
  AWG: {
    label: 'Arbitrary Waveform Generator',
    drivers: ['AWG5K', 'AWG5KC', 'AWG7K', 'AWG7KC', 'AWG70KA', 'AWG70KB']
  },
  AFG: {
    label: 'Arbitrary Function Generator',
    drivers: ['AFG3K', 'AFG3KB', 'AFG3KC', 'AFG31K']
  },
  PSU: {
    label: 'Power Supply',
    drivers: ['PSU2200', 'PSU2220', 'PSU2230', 'PSU2231', 'PSU2280', 'PSU2281']
  },
  SMU: {
    label: 'Source Measure Unit',
    drivers: ['SMU2400', 'SMU2450', 'SMU2460', 'SMU2461', 'SMU2470', 'SMU2601B', 'SMU2602B', 'SMU2604B', 'SMU2606B', 'SMU2611B', 'SMU2612B', 'SMU2614B', 'SMU2634B', 'SMU2635B', 'SMU2636B', 'SMU2651A', 'SMU2657A']
  },
  DMM: {
    label: 'Digital Multimeter',
    drivers: ['DMM6500', 'DMM7510', 'DMM7512']
  },
  DAQ: {
    label: 'Data Acquisition',
    drivers: ['DAQ6510']
  },
  MT: {
    label: 'Margin Tester',
    drivers: ['MT1000']
  },
  MF: {
    label: 'Mainframe',
    drivers: ['MF4000']
  },
  SS: {
    label: 'Switch System',
    drivers: ['SS3706A']
  },
  TEKSCOPE_PC: {
    label: 'TekScope PC',
    drivers: ['TekScopePC']
  }
} as const;

export type DeviceType = keyof typeof TM_DEVICE_TYPES;
