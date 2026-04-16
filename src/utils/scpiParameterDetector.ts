/**
 * SCPI Parameter Detector
 * 
 * Detects editable/parameterizable parts of SCPI commands:
 * - Channel mnemonics (CH1 → CH2, REF1, MATH1, etc.)
 * - Bus mnemonics (B1 → B2, B3, etc.)
 * - Measurement mnemonics (MEAS1 → MEAS2, etc.)
 * - Numeric arguments with ranges
 * - Enumeration arguments with options
 */

import { ParsedSCPI, EditableParameter, EditableParameterType, MnemonicType } from '../types/scpi';

/**
 * Detect editable parameters in a parsed SCPI command
 * 
 * @param parsed - Parsed SCPI structure
 * @returns Array of editable parameters found
 */
export function detectEditableParameters(parsed: ParsedSCPI): EditableParameter[] {
  const editableParams: EditableParameter[] = [];

  // Skip editable parameter detection for TekExpress commands
  // TekExpress commands use a different structure where path elements (like DEVICE, TEST)
  // are part of the command path, not editable parameters
  // Parameters are handled through the Command Parameters section instead
  const isTekExp = parsed.originalCommand?.toUpperCase().startsWith('TEKEXP:') || false;
  if (isTekExp) {
    return editableParams; // Return empty - TekExpress uses Command Parameters only
  }

  // Check mnemonics for variable patterns
  parsed.mnemonics.forEach((mnemonic, index) => {
    const param = detectMnemonicParameter(mnemonic, index, parsed);
    if (param) {
      editableParams.push(param);
    }
  });

  // Check arguments for editable values
  parsed.arguments.forEach((arg, index) => {
    const param = detectArgumentParameter(arg, index, parsed);
    if (param) {
      editableParams.push(param);
    }
  });

  return editableParams;
}

/**
 * Detect if a mnemonic contains an editable parameter
 */
function detectMnemonicParameter(
  mnemonic: string,
  mnemonicIndex: number,
  parsed: ParsedSCPI
): EditableParameter | null {
  // Pattern matching for variable mnemonics (including <x> placeholders)
  const patterns: Array<{
    regex: RegExp;
    type: EditableParameterType;
    mnemonicType?: MnemonicType; // Optional for non-standard patterns
    getOptions: (match: string) => string[];
  }> = [
    {
      // Match CH<x> or CH1, CH2, etc. (including suffixes like _DALL, _D0, _D<x>, etc.)
      regex: /^CH(<x>|\d+)(?:_[A-Z0-9<x>]+)?$/i,
      type: 'channel',
      mnemonicType: 'channel',
      getOptions: (match) => {
        // Extract the base part (CH<x> or CH1)
        const baseMatch = match.match(/^CH(<x>|\d+)/i);
        if (!baseMatch) return generateChannelOptions(1);
        
        const base = baseMatch[0];
        // Extract suffix if present (e.g., _DALL, _D0, _D<x>)
        const suffixMatch = match.match(/_([A-Z0-9<x>]+)$/i);
        let suffix = '';
        if (suffixMatch) {
          suffix = `_${suffixMatch[1]}`;
          // If suffix contains <x>, replace it with 0 for digital bits (D0-D7)
          if (suffix.includes('<x>')) {
            suffix = suffix.replace('<x>', '0'); // Default to D0
          }
        }
        
        if (base.includes('<x>')) {
          return generateChannelOptions(1, suffix);
        }
        const num = parseInt(base.match(/\d+/)![0]);
        return generateChannelOptions(num, suffix);
      },
    },
    {
      // Match REF<x> or REF1, REF2, etc. (including suffixes like _DALL, _D<x>, etc.)
      regex: /^REF(<x>|\d+)(?:_[A-Z0-9]+)?$/i,
      type: 'reference',
      mnemonicType: 'reference',
      getOptions: (match) => {
        // Extract the base part (REF<x> or REF1)
        const baseMatch = match.match(/^REF(<x>|\d+)/i);
        if (!baseMatch) return generateReferenceOptions(1);
        
        const base = baseMatch[0];
        if (base.includes('<x>')) {
          // Extract suffix if present (e.g., _DALL)
          const suffixMatch = match.match(/_([A-Z0-9]+)$/i);
          const suffix = suffixMatch ? `_${suffixMatch[1]}` : '';
          return generateReferenceOptions(1, suffix);
        }
        const num = parseInt(base.match(/\d+/)![0]);
        const suffixMatch = match.match(/_([A-Z0-9]+)$/i);
        const suffix = suffixMatch ? `_${suffixMatch[1]}` : '';
        return generateReferenceOptions(num, suffix);
      },
    },
    {
      regex: /^MATH(<x>|\d+)$/i,
      type: 'math',
      mnemonicType: 'math',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateMathOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateMathOptions(num);
      },
    },
    {
      // Match B<x> or B1, B2, etc. (also handle BUS<x>)
      regex: /^B(<x>|\d+)$/i,
      type: 'bus',
      mnemonicType: 'bus',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateBusOptions(1); // B1-B8
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateBusOptions(num);
      },
    },
    {
      regex: /^BUS(<x>|\d+)$/i,
      type: 'bus',
      mnemonicType: 'bus',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateBusOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateBusOptions(num);
      },
    },
    {
      regex: /^MEAS(<x>|\d+)$/i,
      type: 'measurement',
      mnemonicType: 'measurement',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateMeasurementOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateMeasurementOptions(num);
      },
    },
    {
      regex: /^CURSOR(<x>|\d+)$/i,
      type: 'cursor',
      mnemonicType: 'cursor',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateCursorOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateCursorOptions(num);
      },
    },
    {
      regex: /^ZOOM(<x>|\d+)$/i,
      type: 'zoom',
      mnemonicType: 'zoom',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateZoomOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateZoomOptions(num);
      },
    },
    {
      regex: /^SEARCH(<x>|\d+)$/i,
      type: 'search',
      mnemonicType: 'search',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateSearchOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateSearchOptions(num);
      },
    },
    {
      // Match POWer<x> or POWer1, POWer2, etc. (Power measurements)
      regex: /^POWer(<x>|\d+)$/i,
      type: 'power',
      mnemonicType: 'power',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generatePowerOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generatePowerOptions(num);
      },
    },
    {
      // Match WAVEView<x> or WAVEView1 (Waveform View)
      regex: /^WAVEView(<x>|\d+)$/i,
      type: 'view',
      mnemonicType: 'view',
      getOptions: (match) => {
        // WAVEView<x> where x must be equal to 1
        return ['WAVEView1'];
      },
    },
    {
      // Match PLOTView<x> or PLOTView1, PLOTView2, etc. (Plot View)
      regex: /^PLOTView(<x>|\d+)$/i,
      type: 'plot',
      mnemonicType: 'plot',
      getOptions: (match) => {
        // PLOTView<x> supports 1-4 based on examples showing PLOTView3
        if (match.includes('<x>')) {
          return generatePlotViewOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generatePlotViewOptions(num);
      },
    },
    {
      // Match HISTogram<x> or HISTogram1, HISTogram2, etc. (Histogram)
      regex: /^HISTogram(<x>|\d+)$/i,
      type: 'histogram',
      mnemonicType: 'histogram',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateHistogramOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateHistogramOptions(num);
      },
    },
    {
      // Match CALLOUT<x> or CALLOUT1, CALLOUT2, etc. (Callout)
      regex: /^CALLOUT(<x>|\d+)$/i,
      type: 'callout',
      mnemonicType: 'callout',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateCalloutOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateCalloutOptions(num);
      },
    },
    {
      // Match MASK<x> or MASK1, MASK2, etc. (Mask)
      regex: /^MASK(<x>|\d+)$/i,
      type: 'mask',
      mnemonicType: 'mask',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateMaskOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateMaskOptions(num);
      },
    },
    {
      // Match D<x> or D0, D1, etc. (Digital bit, 0-7)
      regex: /^D(<x>|\d+)$/i,
      type: 'digital_bit',
      mnemonicType: 'digital_bit',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateDigitalBitOptions(0);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateDigitalBitOptions(num);
      },
    },
    {
      // Match AREA<x> or AREA1, AREA2, etc.
      regex: /^AREA(<x>|\d+)$/i,
      type: 'area',
      mnemonicType: 'area',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateAreaOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateAreaOptions(num);
      },
    },
    {
      // Match MATHFFTView<x> or MATHFFTView1 (Math FFT View)
      regex: /^MATHFFTView(<x>|\d+)$/i,
      type: 'view',
      mnemonicType: 'view',
      getOptions: (match) => {
        // MATHFFTView<x> where x is 1-8 (expanding to match other view limits)
        if (match.includes('<x>')) {
          return generateMathFFTViewOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateMathFFTViewOptions(num);
      },
    },
    {
      // Match REFFFTView<x> or REFFFTView1 (Reference FFT View)
      regex: /^REFFFTView(<x>|\d+)$/i,
      type: 'view',
      mnemonicType: 'view',
      getOptions: (match) => {
        // REFFFTView<x> where x is 1-8 (based on examples showing up to REFFFTView5)
        // Using 8 as a safe upper bound to match other view/ref limits
        if (match.includes('<x>')) {
          return generateRefFFTViewOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateRefFFTViewOptions(num);
      },
    },
    {
      // Match SPECView<x> or SPECView1, SPECView2, etc. (Spectrum View)
      regex: /^SPECView(<x>|\d+)$/i,
      type: 'view',
      mnemonicType: 'view',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateSpecViewOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateSpecViewOptions(num);
      },
    },
    {
      // Match SOUrce<x>, GSOurce<x>, or SOUrce1, GSOurce1, etc. (Source)
      regex: /^(SOUrce|GSOurce)(<x>|\d+)$/i,
      type: 'source',
      mnemonicType: 'source',
      getOptions: (match) => {
        // Extract prefix (SOUrce or GSOurce)
        const prefixMatch = match.match(/^(SOUrce|GSOurce)/i);
        const prefix = prefixMatch ? prefixMatch[0] : 'SOUrce';
        
        if (match.includes('<x>')) {
          return generateSourceOptions(1, prefix);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateSourceOptions(num, prefix);
      },
    },
    {
      // Match EDGE<x> or EDGE1, EDGE2, etc.
      regex: /^EDGE(<x>|\d+)$/i,
      type: 'edge',
      mnemonicType: 'edge',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateEdgeOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateEdgeOptions(num);
      },
    },
    {
      // Match SEG<x> or SEG1, SEG2, etc. (Segment)
      regex: /^SEG(<x>|\d+)$/i,
      type: 'segment',
      mnemonicType: 'segment',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateSegmentOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateSegmentOptions(num);
      },
    },
    {
      // Match POINT<x> or POINT1, POINT2, etc.
      regex: /^POINT(<x>|\d+)$/i,
      type: 'point',
      mnemonicType: 'point',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generatePointOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generatePointOptions(num);
      },
    },
    {
      // Match POSITION<x> or POSITION1, POSITION2, etc. (Cursor position)
      regex: /^POSITION(<x>|\d+)$/i,
      type: 'cursor',
      mnemonicType: 'cursor',
      getOptions: (match) => {
        // Cursor positions can be 1-8 (depending on scope model)
        const options: string[] = [];
        for (let i = 1; i <= 8; i++) {
          options.push(`POSITION${i}`);
        }
        return options;
      },
    },
    {
      // Match TABle<x> or TABle1, TABle2, etc.
      regex: /^TABle(<x>|\d+)$/i,
      type: 'table',
      mnemonicType: 'table',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateTableOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateTableOptions(num);
      },
    },
    {
      // Match TRACe<x> or TRACe1, TRACe2, etc. (Trace for RSA / spectrum analyzer commands)
      regex: /^TRACe(<x>|\d+)$/i,
      type: 'trace',
      mnemonicType: 'trace',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateTraceOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateTraceOptions(num);
      },
    },
    {
      // Match MARKer<x> or MARKer1, MARKer2, etc. (Marker for RSA / spectrum analyzer commands)
      regex: /^MARKer(<x>|\d+)$/i,
      type: 'marker',
      mnemonicType: 'marker',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateMarkerOptions(1);
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateMarkerOptions(num);
      },
    },
    {
      // Match MEASview<x> or MEASview1, MEASview2, etc. (RSA measurement views)
      regex: /^MEASview(<x>|\d+)$/i,
      type: 'view',
      mnemonicType: 'view',
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'MEASview', '');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'MEASview', '');
      },
    },
    {
      // Match PG<x>Val or PG1Val, PG2Val, etc. (<x> before "Val")
      regex: /^PG(<x>|\d+)Val$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'PG', 'Val');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'PG', 'Val');
      },
    },
    {
      // Match PW<x>Val or PW1Val, PW2Val, etc. (<x> before "Val")
      regex: /^PW(<x>|\d+)Val$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'PW', 'Val');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'PW', 'Val');
      },
    },
    {
      // Match AMP<x>Val or AMP1Val, AMP2Val, etc. (<x> before "Val")
      regex: /^AMP(<x>|\d+)Val$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'AMP', 'Val');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'AMP', 'Val');
      },
    },
    {
      // Match FREQ<x>Val or FREQ1Val, FREQ2Val, etc. (<x> before "Val")
      regex: /^FREQ(<x>|\d+)Val$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'FREQ', 'Val');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'FREQ', 'Val');
      },
    },
    {
      // Match SPAN<x>Val or SPAN1Val, SPAN2Val, etc. (<x> before "Val")
      regex: /^SPAN(<x>|\d+)Val$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'SPAN', 'Val');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'SPAN', 'Val');
      },
    },
    {
      // Match RIPPLEFREQ<x>Val or RIPPLEFREQ1Val, RIPPLEFREQ2Val, etc. (<x> before "Val")
      regex: /^RIPPLEFREQ(<x>|\d+)Val$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'RIPPLEFREQ', 'Val');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'RIPPLEFREQ', 'Val');
      },
    },
    {
      // Match MAXG<x>Voltage or MAXG1Voltage, MAXG2Voltage, etc. (<x> in the middle)
      regex: /^MAXG(<x>|\d+)Voltage$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'MAXG', 'Voltage');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'MAXG', 'Voltage');
      },
    },
    {
      // Match OUTPUT<x>VOLTage or OUTPUT1VOLTage, OUTPUT2VOLTage, etc. (<x> in the middle)
      regex: /^OUTPUT(<x>|\d+)VOLTage$/i,
      type: 'numeric',
      mnemonicType: undefined, // Not a standard mnemonic type
      getOptions: (match) => {
        if (match.includes('<x>')) {
          return generateNumericOptions(1, 8, 'OUTPUT', 'VOLTage');
        }
        const num = parseInt(match.match(/\d+/)![0]);
        return generateNumericOptions(num, 8, 'OUTPUT', 'VOLTage');
      },
    },
  ];

  for (const pattern of patterns) {
    const match = mnemonic.match(pattern.regex);
    if (match) {
      // If it's a placeholder like B<x>, use the first option (which should be 1) as default
      const isPlaceholder = mnemonic.includes('<x>');
      const options = pattern.getOptions(mnemonic);
      // Default to option with "1" (e.g., B1, CH1, MATH1) - this should be the first option
      const currentValue = isPlaceholder ? options[0] || mnemonic.toUpperCase().replace('<x>', '1') : mnemonic.toUpperCase();
      
      // Find position in original command
      let startIndex = 0;
      for (let i = 0; i < mnemonicIndex; i++) {
        startIndex += parsed.mnemonics[i].length + 1; // +1 for colon
      }
      const endIndex = startIndex + mnemonic.length;

      return {
        position: -1, // Mnemonic position (negative to distinguish from arguments)
        type: pattern.type,
        currentValue,
        validOptions: options,
        startIndex,
        endIndex,
        description: getParameterDescription(pattern.type),
        mnemonicType: pattern.mnemonicType,
      };
    }
  }

  return null;
}

/**
 * Detect if an argument is editable
 */
function detectArgumentParameter(
  arg: { value: string; type: string; startIndex: number; endIndex: number },
  argIndex: number,
  parsed: ParsedSCPI
): EditableParameter | null {
  const value = arg.value;

  // CRITICAL FIX: The arg.startIndex and arg.endIndex are relative to the argsString,
  // not the original command. We need to offset them by the header length + 1 (for space).
  // Header includes leading colon if present.
  const headerOffset = (parsed.hasLeadingColon ? 1 : 0) + parsed.header.length + 1; // +1 for space
  const absoluteStartIndex = headerOffset + arg.startIndex;
  const absoluteEndIndex = headerOffset + arg.endIndex;

  // Check for mnemonic patterns in arguments
  const mnemonicPatterns: Array<{
    regex: RegExp;
    type: EditableParameterType;
    mnemonicType: MnemonicType;
    getOptions: (val: string) => string[];
  }> = [
    {
      regex: /^(CH\d+|REF\d+|MATH\d+)$/i,
      type: 'channel',
      mnemonicType: 'channel',
      getOptions: (val) => {
        if (/^CH\d+$/i.test(val)) {
          const num = parseInt(val.match(/\d+/)![0]);
          return generateChannelOptions(num);
        } else if (/^REF\d+$/i.test(val)) {
          const num = parseInt(val.match(/\d+/)![0]);
          return generateReferenceOptions(num);
        } else if (/^MATH\d+$/i.test(val)) {
          const num = parseInt(val.match(/\d+/)![0]);
          return generateMathOptions(num);
        }
        return [];
      },
    },
    {
      regex: /^(B\d+|BUS\d+)$/i,
      type: 'bus',
      mnemonicType: 'bus',
      getOptions: (val) => {
        const num = parseInt(val.match(/\d+/)![0]);
        return generateBusOptions(num);
      },
    },
    {
      regex: /^MEAS\d+$/i,
      type: 'measurement',
      mnemonicType: 'measurement',
      getOptions: (val) => {
        const num = parseInt(val.match(/\d+/)![0]);
        return generateMeasurementOptions(num);
      },
    },
  ];

  for (const pattern of mnemonicPatterns) {
    if (pattern.regex.test(value)) {
      const options = pattern.getOptions(value);
      return {
        position: argIndex,
        type: pattern.type,
        currentValue: value.toUpperCase(),
        validOptions: options,
        startIndex: absoluteStartIndex,
        endIndex: absoluteEndIndex,
        description: getParameterDescription(pattern.type),
        mnemonicType: pattern.mnemonicType,
      };
    }
  }

  // For numeric arguments, we could detect ranges, but that requires manual data
  // For now, just mark as numeric if it's a number
  if (arg.type === 'numeric') {
    return {
      position: argIndex,
      type: 'numeric',
      currentValue: value,
      validOptions: [], // Would need manual data for ranges
      startIndex: absoluteStartIndex,
      endIndex: absoluteEndIndex,
      description: 'Numeric value',
    };
  }

  // For enumeration, we'd need manual data to know valid options
  if (arg.type === 'enumeration') {
    return {
      position: argIndex,
      type: 'enumeration',
      currentValue: value,
      validOptions: [], // Would need manual data for options
      startIndex: absoluteStartIndex,
      endIndex: absoluteEndIndex,
      description: 'Enumeration value',
    };
  }

  return null;
}

/**
 * Generate channel options (CH1-CH8, or CH1_DALL-CH8_DALL, etc.)
 * Note: CH<x> where <x> is ≥1
 * Modern MSO 4/5/6 series scopes support up to 8 analog channels
 * @param currentNum - Current channel number
 * @param suffix - Optional suffix like "_DALL", "_D0", etc.
 */
function generateChannelOptions(currentNum: number, suffix: string = ''): string[] {
  const options: string[] = [];
  // Channels: CH1-CH8 (modern MSO 4/5/6 series support up to 8 channels)
  // User can select the appropriate channel for their instrument
  const maxChannels = 8;
  for (let i = 1; i <= maxChannels; i++) {
    options.push(`CH${i}${suffix}`);
  }
  return options;
}

/**
 * Generate reference options (REF1-REF8, or REF1_DALL-REF8_DALL, etc.)
 * Note: REF<x> where <x> is ≥1
 * Modern MSO 4/5/6 series scopes support up to 8 references
 * @param currentNum - Current reference number
 * @param suffix - Optional suffix like "_DALL", "_D0", etc.
 */
function generateReferenceOptions(currentNum: number, suffix: string = ''): string[] {
  const options: string[] = [];
  // References: REF1-REF8 (modern scopes support up to 8)
  const maxRefs = 8;
  for (let i = 1; i <= maxRefs; i++) {
    options.push(`REF${i}${suffix}`);
  }
  return options;
}

/**
 * Generate math options (MATH1-MATH4)
 * Note: MATH<x> where <x> is ≥1
 */
function generateMathOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Math waveforms: MATH1-MATH4 (typically 4, but can be more)
  for (let i = 1; i <= 4; i++) {
    options.push(`MATH${i}`);
  }
  return options;
}

/**
 * Generate bus options (B1-B8)
 * Note: B<x> where <x> is ≥1
 */
function generateBusOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Buses: B1-B8 (x ≥ 1)
  for (let i = 1; i <= 8; i++) {
    options.push(`B${i}`);
    options.push(`BUS${i}`); // Also support BUS1, BUS2 format
  }
  return options;
}

/**
 * Generate measurement options (MEAS1-MEAS8)
 * Note: MEAS<x> where <x> is ≥1
 */
function generateMeasurementOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Measurements: MEAS1-MEAS8 (x ≥ 1)
  for (let i = 1; i <= 8; i++) {
    options.push(`MEAS${i}`);
  }
  return options;
}

/**
 * Generate cursor options (CURSOR1-CURSOR2)
 * Note: CURSOR<x> where <x> must be 1 or 2
 */
function generateCursorOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Cursors: CURSOR1 or CURSOR2 (x must be 1 or 2)
  for (let i = 1; i <= 2; i++) {
    options.push(`CURSOR${i}`);
  }
  return options;
}

/**
 * Generate zoom options (ZOOM1)
 * Note: ZOOM<x> where <x> must be equal to 1
 */
function generateZoomOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Zoom: ZOOM1 only (x must be equal to 1)
  options.push(`ZOOM1`);
  return options;
}

/**
 * Generate plot view options (PLOTView1-PLOTView4)
 * Note: PLOTView<x> where <x> is 1-4
 */
function generatePlotViewOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Plot views: PLOTView1-PLOTView8 (based on examples showing up to PLOTView5)
  // Using 8 as upper bound to match other view limits
  for (let i = 1; i <= 8; i++) {
    options.push(`PLOTView${i}`);
  }
  return options;
}

/**
 * Generate reference FFT view options (REFFFTView1-REFFFTView8)
 */
function generateRefFFTViewOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Reference FFT views: REFFFTView1-REFFFTView8
  for (let i = 1; i <= 8; i++) {
    options.push(`REFFFTView${i}`);
  }
  return options;
}

/**
 * Generate math FFT view options (MATHFFTView1-MATHFFTView8)
 */
function generateMathFFTViewOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Math FFT views: MATHFFTView1-MATHFFTView8
  for (let i = 1; i <= 8; i++) {
    options.push(`MATHFFTView${i}`);
  }
  return options;
}

/**
 * Generate search options (SEARCH1-SEARCH8)
 * Note: SEARCH<x> where <x> is ≥1
 */
function generateSearchOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Searches: SEARCH1-SEARCH8 (x ≥ 1)
  for (let i = 1; i <= 8; i++) {
    options.push(`SEARCH${i}`);
  }
  return options;
}

/**
 * Generate power options (POWer1-POWer8)
 * Note: POWer<x> where <x> is ≥1 (power measurements)
 */
function generatePowerOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Power measurements: POWer1-POWer8 (x ≥ 1)
  for (let i = 1; i <= 8; i++) {
    options.push(`POWer${i}`);
  }
  return options;
}

/**
 * Generate histogram options
 * Note: HISTogram<x> where <x> is 1-4
 */
function generateHistogramOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Histograms: HISTogram1-HISTogram4
  for (let i = 1; i <= 4; i++) {
    options.push(`HISTogram${i}`);
  }
  return options;
}

/**
 * Generate callout options
 * Note: CALLOUT<x> where <x> is 1-8
 */
function generateCalloutOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Callouts: CALLOUT1-CALLOUT8
  for (let i = 1; i <= 8; i++) {
    options.push(`CALLOUT${i}`);
  }
  return options;
}

/**
 * Generate mask options
 * Note: MASK<x> where <x> is 1-8
 */
function generateMaskOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Masks: MASK1-MASK8
  for (let i = 1; i <= 8; i++) {
    options.push(`MASK${i}`);
  }
  return options;
}

/**
 * Generate digital bit options
 * Note: D<x> where <x> is 0-7
 */
function generateDigitalBitOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Digital bits: D0-D7
  for (let i = 0; i <= 7; i++) {
    options.push(`D${i}`);
  }
  return options;
}

/**
 * Generate area options
 * Note: AREA<x> where <x> is ≥1
 */
function generateAreaOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Areas: AREA1-AREA4 (typically 4, but can be more)
  for (let i = 1; i <= 4; i++) {
    options.push(`AREA${i}`);
  }
  return options;
}

/**
 * Generate spectrum view options
 * Note: SPECView<x> where <x> is ≥1
 */
function generateSpecViewOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Spectrum views: SPECView1-SPECView4
  for (let i = 1; i <= 4; i++) {
    options.push(`SPECView${i}`);
  }
  return options;
}

/**
 * Generate source options
 * Note: SOUrce<x> or GSOurce<x> where <x> is 1-4
 * @param currentNum - Current source number
 * @param prefix - Prefix (SOUrce or GSOurce)
 */
function generateSourceOptions(currentNum: number, prefix: string = 'SOUrce'): string[] {
  const options: string[] = [];
  // Sources: SOURce1-SOURce4 or GSOurce1-GSOurce4
  // Use uppercase long form for readability (instruments accept any case)
  const upperPrefix = prefix.toUpperCase(); // SOURce -> SOURCE, GSOurce -> GSOURCE
  for (let i = 1; i <= 4; i++) {
    options.push(`${upperPrefix}${i}`);
  }
  return options;
}

/**
 * Generate edge options
 * Note: EDGE<x> where <x> is ≥1
 */
function generateEdgeOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Edges: EDGE1-EDGE4 (typically 1-4)
  for (let i = 1; i <= 4; i++) {
    options.push(`EDGE${i}`);
  }
  return options;
}

/**
 * Generate segment options
 * Note: SEG<x> where <x> is ≥1
 */
function generateSegmentOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Segments: SEG1-SEG8 (typically 1-8)
  for (let i = 1; i <= 8; i++) {
    options.push(`SEG${i}`);
  }
  return options;
}

/**
 * Generate point options
 * Note: POINT<x> where <x> is ≥1
 */
function generatePointOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Points: POINT1-POINT4 (typically 1-4)
  for (let i = 1; i <= 4; i++) {
    options.push(`POINT${i}`);
  }
  return options;
}

/**
 * Generate table options
 * Note: TABle<x> where <x> is ≥1
 */
function generateTableOptions(currentNum: number): string[] {
  const options: string[] = [];
  // Tables: TABle1-TABle4 (typically 1-4)
  for (let i = 1; i <= 4; i++) {
    options.push(`TABle${i}`);
  }
  return options;
}

/**
 * Generate trace options (TRACe1-TRACe4)
 * Note: TRACe<x> where <x> is 1-4 (some RSA measurements only use 1-2)
 */
function generateTraceOptions(currentNum: number): string[] {
  const options: string[] = [];
  for (let i = 1; i <= 4; i++) {
    options.push(`TRACe${i}`);
  }
  return options;
}

/**
 * Generate marker options (MARKer1-MARKer4)
 * Note: MARKer<x> where <x> is 1-4; MARKer0 (reference marker) is typically invalid
 */
function generateMarkerOptions(currentNum: number): string[] {
  const options: string[] = [];
  for (let i = 1; i <= 4; i++) {
    options.push(`MARKer${i}`);
  }
  return options;
}

/**
 * Generate numeric options for patterns like PG<x>Val, AMP<x>Val, etc.
 * @param currentNum - Current number
 * @param maxNum - Maximum number (typically 8)
 * @param prefix - Prefix before number (e.g., "PG", "AMP")
 * @param suffix - Suffix after number (e.g., "Val", "Voltage")
 */
function generateNumericOptions(currentNum: number, maxNum: number, prefix: string, suffix: string): string[] {
  const options: string[] = [];
  for (let i = 1; i <= maxNum; i++) {
    options.push(`${prefix}${i}${suffix}`);
  }
  return options;
}

/**
 * Get description for parameter type
 */
function getParameterDescription(type: EditableParameterType): string {
  const descriptions: Record<EditableParameterType, string> = {
    channel: 'Channel, Reference, or Math waveform',
    reference: 'Reference waveform',
    math: 'Math waveform',
    bus: 'Bus',
    measurement: 'Measurement',
    cursor: 'Cursor',
    zoom: 'Zoom',
    search: 'Search',
    plot: 'Plot',
    view: 'View',
    power: 'Power measurement (POWer1-POWer8)',
    histogram: 'Histogram (HISTogram1-HISTogram4)',
    callout: 'Callout (CALLOUT1-CALLOUT8)',
    mask: 'Mask (MASK1-MASK8)',
    digital_bit: 'Digital bit (D0-D7)',
    area: 'Area (AREA1-AREA4)',
    source: 'Source (SOUrce1-SOUrce4 or GSOurce1-GSOurce4)',
    edge: 'Edge (EDGE1-EDGE4)',
    segment: 'Segment (SEG1-SEG8)',
    point: 'Point (POINT1-POINT4)',
    table: 'Table (TABle1-TABle4)',
    trace: 'Trace (TRACe1-TRACe4)',
    marker: 'Marker (MARKer1-MARKer4)',
    numeric: 'Numeric value',
    enumeration: 'Enumeration value',
  };
  
  return descriptions[type] || 'Editable parameter';
}

/**
 * Replace parameter value in command string
 * 
 * @param command - Original command string
 * @param param - Parameter to replace
 * @param newValue - New value
 * @returns Modified command string
 */
export function replaceParameter(
  command: string,
  param: EditableParameter,
  newValue: string
): string {
  if (param.startIndex < 0 || param.endIndex < 0) {
    return command;
  }

  const before = command.slice(0, param.startIndex);
  const after = command.slice(param.endIndex);
  const originalMnemonic = command.slice(param.startIndex, param.endIndex);
  
  // Extract the number from newValue (e.g., "PG1Val" -> "1", "GSOurce1" -> "1", "B1" -> "1")
  const numberMatch = newValue.match(/\d+/);
  const number = numberMatch ? numberMatch[0] : null;
  
  if (originalMnemonic.includes('<x>')) {
    // Handle special patterns with <x> in the middle (PG<x>Val, AMP<x>Val, MAXG<x>Voltage, OUTPUT<x>VOLTage)
    // These patterns have the format: PREFIX<x>SUFFIX
    const specialPatternMatch = originalMnemonic.match(/^([A-Z]+)<x>([A-Z0-9]+)$/i);
    if (specialPatternMatch && number) {
      const prefix = specialPatternMatch[1];
      const suffix = specialPatternMatch[2];
      // Replace <x> with the number: PREFIX<x>SUFFIX -> PREFIX1SUFFIX
      const replacedMnemonic = `${prefix}${number}${suffix}`;
      return before + replacedMnemonic + after;
    }
    
    // Handle patterns with prefix (GSOurce<x>, SOUrce<x>)
    // These patterns have the format: PREFIX<x>
    const prefixPatternMatch = originalMnemonic.match(/^([A-Z]+)<x>$/i);
    if (prefixPatternMatch && number) {
      const prefix = prefixPatternMatch[1];
      // Replace <x> with the number: PREFIX<x> -> PREFIX1
      const replacedMnemonic = `${prefix}${number}`;
      return before + replacedMnemonic + after;
    }
    
    // Standard pattern: simple replacement of <x> with number
    if (number) {
      // Replace <x> with the number
      const replacedMnemonic = originalMnemonic.replace(/<x>/g, number);
      return before + replacedMnemonic + after;
    }
  } else {
    // Command already has a concrete value (e.g., "GSOurce4" or "PG5Val")
    // We need to replace the entire mnemonic with the new value
    
    // Check if it's a special pattern (PG5Val, AMP3Val, etc.)
    const specialPatternMatch = originalMnemonic.match(/^([A-Z]+)(\d+)([A-Z0-9]+)$/i);
    if (specialPatternMatch) {
      const prefix = specialPatternMatch[1];
      const suffix = specialPatternMatch[3];
      // Check if newValue matches this pattern
      const newValueMatch = newValue.match(/^([A-Z]+)(\d+)([A-Z0-9]+)$/i);
      if (newValueMatch && newValueMatch[1].toUpperCase() === prefix.toUpperCase() && 
          newValueMatch[3].toUpperCase() === suffix.toUpperCase()) {
        // Replace with new value
        return before + newValue + after;
      }
      // If newValue is just the number, construct the full mnemonic
      if (number) {
        return before + `${prefix}${number}${suffix}` + after;
      }
    }
    
    // Check if it's a prefix pattern (GSOurce4, SOUrce2, etc.)
    const prefixPatternMatch = originalMnemonic.match(/^([A-Z]+)(\d+)$/i);
    if (prefixPatternMatch) {
      const prefix = prefixPatternMatch[1];
      // Check if newValue matches this pattern
      const newValueMatch = newValue.match(/^([A-Z]+)(\d+)$/i);
      if (newValueMatch && newValueMatch[1].toUpperCase() === prefix.toUpperCase()) {
        // Replace with new value
        return before + newValue + after;
      }
      // If newValue is just the number, construct the full mnemonic
      if (number) {
        return before + `${prefix}${number}` + after;
      }
    }
    
    // Standard pattern: replace entire mnemonic with new value
    return before + newValue + after;
  }
  
  return before + newValue + after;
}


