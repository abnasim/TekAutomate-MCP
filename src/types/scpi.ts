/**
 * SCPI Command Intelligence Types
 * 
 * Types for parsing and understanding SCPI command structure,
 * detecting editable parameters, and providing contextual help.
 */

/**
 * Parsed SCPI command structure
 */
export interface ParsedSCPI {
  /** Full command header (e.g., "DATa:SOUrce") */
  header: string;
  /** Array of mnemonic components (e.g., ["DATa", "SOUrce"]) */
  mnemonics: string[];
  /** Array of arguments found in the command */
  arguments: SCPIArgument[];
  /** Whether this is a query command (ends with ?) */
  isQuery: boolean;
  /** Original command string */
  originalCommand: string;
  /** Whether command starts with colon (concatenated) */
  hasLeadingColon: boolean;
}

/**
 * SCPI command argument
 */
export interface SCPIArgument {
  /** The argument value as a string */
  value: string;
  /** Detected type of the argument */
  type: ArgumentType;
  /** Position in the command (0-based) */
  position: number;
  /** Start position in original command string */
  startIndex: number;
  /** End position in original command string */
  endIndex: number;
}

/**
 * Argument type detection
 */
export type ArgumentType = 
  | 'mnemonic'      // Variable mnemonic like CH<x>, REF<x>, MATH<x>
  | 'enumeration'   // Fixed text value like "NORMal", "AUTO"
  | 'numeric'       // Numeric value (integer or float)
  | 'quoted_string' // Text in quotes
  | 'block'         // Binary data block
  | 'unknown';      // Could not determine type

/**
 * Editable parameter detected in a command
 */
export interface EditableParameter {
  /** Position in the command (0-based) */
  position: number;
  /** Type of editable parameter */
  type: EditableParameterType;
  /** Current value in the command */
  currentValue: string;
  /** Valid options for this parameter */
  validOptions: string[];
  /** Start position in original command string */
  startIndex: number;
  /** End position in original command string */
  endIndex: number;
  /** Description of what this parameter represents */
  description?: string;
  /** For mnemonic types, what kind of mnemonic */
  mnemonicType?: MnemonicType;
}

/**
 * Type of editable parameter
 */
export type EditableParameterType = 
  | 'channel'      // CH1, CH2, CH3, CH4, CH<x>_DALL, etc.
  | 'reference'    // REF1, REF2, REF3, REF4, REF<x>_DALL, etc.
  | 'math'         // MATH1, MATH2, MATH3, MATH4
  | 'bus'          // B1, B2, B3, etc.
  | 'measurement'  // MEAS1, MEAS2, MEAS3, etc.
  | 'cursor'       // CURSOR1, CURSOR2
  | 'zoom'         // ZOOM1, ZOOM2
  | 'search'       // SEARCH1, SEARCH2
  | 'plot'         // PLOT1, PLOT2
  | 'view'         // WAVEView1, PLOTView1, MATHFFTView<x>, REFFFTView<x>, SPECView<x>
  | 'histogram'    // HISTogram1, HISTogram2, etc.
  | 'power'        // POWer1, POWer2, etc.
  | 'callout'      // CALLOUT1, CALLOUT2, etc.
  | 'mask'         // MASK1, MASK2, etc.
  | 'digital_bit'  // D0, D1, D2, etc. (0-7)
  | 'area'         // AREA1, AREA2, etc.
  | 'source'       // SOUrce1, SOUrce2, GSOurce1, etc.
  | 'edge'         // EDGE1, EDGE2, etc.
  | 'segment'      // SEG1, SEG2, etc.
  | 'point'        // POINT1, POINT2, etc.
  | 'table'        // TABle1, TABle2, etc.
  | 'trace'        // TRACe1, TRACe2, etc.
  | 'marker'       // MARKer1, MARKer2, etc.
  | 'numeric'      // Numeric value with range
  | 'enumeration'; // Enumeration with options

/**
 * Type of mnemonic variable
 */
export type MnemonicType = 
  | 'channel'
  | 'reference'
  | 'math'
  | 'bus'
  | 'measurement'
  | 'cursor'
  | 'zoom'
  | 'search'
  | 'plot'
  | 'view'
  | 'histogram'
  | 'power'
  | 'callout'
  | 'mask'
  | 'digital_bit'
  | 'area'
  | 'source'
  | 'edge'
  | 'segment'
  | 'point'
  | 'table'
  | 'trace'
  | 'marker';

/**
 * Manual command entry from JSON knowledge base
 */
export interface ManualCommandEntry {
  command: string;
  header: string;
  mnemonics: string[];
  commandType: 'set' | 'query' | 'both';
  description: string;
  shortDescription: string;
  instruments: {
    families: string[];
    models: string[];
    exclusions: string[];
  };
  arguments: ManualArgument[];
  queryResponse?: {
    type: string;
    format: string;
    example: string;
    description?: string;
  };
  examples: ManualExample[];
  relatedCommands: string[];
  commandGroup: string;
  subGroup?: string;
  backwardCompatibility?: {
    legacyCommands: string[];
    notes?: string;
  };
  notes?: string[];
  manualReference?: {
    section: string;
    page: number;
    subsection?: string;
  };
  concatenation?: {
    canConcatenate: boolean;
    requiresColon: boolean;
    example?: string;
  };
  dynamicActivation?: {
    implicitlyActivates: boolean;
    createsObject?: string;
    defaultType?: string;
    notes?: string;
  };
  syntax?: {
    set?: string;
    query?: string;
    argumentType?: string;
  };
}

/**
 * Manual argument definition
 */
export interface ManualArgument {
  name: string;
  type: 'mnemonic' | 'enumeration' | 'numeric' | 'quoted_string' | 'block' | 'string';
  required: boolean;
  position: number;
  description: string;
  mnemonicType?: string;
  dependsOn?: string; // Name of parent argument this depends on
  queryOnly?: boolean; // If true, only show in SET commands, hide in QUERY commands
  validValues?: {
    type: string;
    pattern?: string;
    examples?: string[];
    range?: Record<string, { min: number; max: number; description?: string }>;
    values?: string[]; // Flat list of values (for backward compatibility)
    conditionalValues?: Record<string, string[]>; // Map of parent value -> child values
    caseSensitive?: boolean;
    format?: string;
    min?: number;
    max?: number;
    unit?: string;
    default?: any;
    increment?: number;
    notes?: string;
    maxLength?: number;
  };
  defaultValue?: any;
}

/**
 * Manual example entry
 */
export interface ManualExample {
  description: string;
  codeExamples: {
    scpi?: CodeExample;
    python?: CodeExample;
    tm_devices?: CodeExample;
    c?: CodeExample;
    labview?: CodeExample;
    matlab?: CodeExample;
  };
  result?: string | number | null;
  resultDescription?: string;
}

/**
 * Code example for a specific language/library
 */
export interface CodeExample {
  code: string;
  library: string;
  description: string;
}

/**
 * Enhanced command library item with SCPI intelligence
 */
export interface EnhancedCommandLibraryItem {
  // Existing fields
  name: string;
  scpi: string;
  description?: string;
  params?: CommandParam[];
  example?: string;
  category?: string;
  subcategory?: string;
  tekhsi?: boolean;
  
  // New SCPI intelligence fields
  scpiStructure?: ParsedSCPI;
  editableParameters?: EditableParameter[];
  manualReference?: {
    section?: string;
    page?: number;
    examples?: string[];
  };
  manualEntry?: ManualCommandEntry;
}

/**
 * Command parameter (existing structure)
 */
export interface CommandParam {
  name: string;
  type: string;
  default?: any;
  required?: boolean;
  options?: string[];
  description?: string;
  min?: number;
  max?: number;
  unit?: string;
  dependsOn?: string; // Name of parent argument this depends on
  conditionalValues?: Record<string, string[]>; // Map of parent value -> child values
  queryOnly?: boolean; // If true, only show in SET commands, hide in QUERY commands
  position?: number; // Position of argument in command (0-based, for TekExpress commands)
}


