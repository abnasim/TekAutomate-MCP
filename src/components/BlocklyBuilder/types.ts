/* ===================== BlocklyBuilder Types ===================== */

// DeviceEntry interface from App.tsx
export interface DeviceEntry {
  id: string;
  alias: string;
  deviceType: 'SCOPE' | 'AWG' | 'AFG' | 'PSU' | 'SMU' | 'DMM' | 'DAQ' | 'MT' | 'MF' | 'SS' | 'TEKSCOPE_PC';
  backend: 'pyvisa' | 'tm_devices' | 'vxi11' | 'tekhsi' | 'hybrid' | 'socket';
  enabled: boolean;
  connectionType?: 'tcpip' | 'socket' | 'usb' | 'gpib';
  host?: string;
  port?: number;
  timeout?: number;
  modelFamily?: string;
  deviceDriver?: string;
  [key: string]: any;
}

// Step interface from App.tsx (for import feature)
export type StepType = 'connect' | 'disconnect' | 'query' | 'write' | 'set_and_query' | 'sleep' | 'comment' | 'python' | 'save_waveform' | 'save_screenshot' | 'error_check' | 'group' | 'tm_device_command' | 'recall';

export interface Step {
  id: string;
  type: StepType;
  label: string;
  params: Record<string, any>;
  children?: Step[];
  collapsed?: boolean;
  category?: string;
  subcategory?: string;
  boundDeviceId?: string;
}

// BlocklyBuilder component props
export interface DeviceFamily {
  id: string;
  label: string;
  icon: string;
  description: string;
  tooltip?: string;
}

export interface BlocklyBuilderProps {
  devices: DeviceEntry[];
  steps?: Step[]; // Read-only, for import feature only
  workspaceXml?: string; // Workspace state from parent
  onWorkspaceChange?: (xml: string) => void; // Callback to update workspace state
  onImportDevicesFromSteps?: (devices: DeviceEntry[]) => void; // Sync Device Map when importing Steps into Blockly
  onExportPython?: (code: string) => void;
  onExportToSteps?: (steps: Step[]) => void; // Callback to export blocks back to steps
  onValidationChange?: (errorCount: number) => void; // Notify parent of validation error count (for header Export Python button)
  commands?: any[]; // SCPI command library for command explorer
  categoryColors?: Record<string, string>; // Category colors for command explorer
  deviceFamilies?: DeviceFamily[]; // Device families for filtering commands
  initialCommandBrowserFamily?: string; // Keep command browser family aligned with Steps browser filter
  /** When true, toolbar collapses to Undo, Redo, and a More dropdown (for tablet/phone). */
  isTabletOrNarrow?: boolean;
  /** When true, use dark workspace background (matches app dark mode). */
  isDark?: boolean;
}

/** Ref handle for BlocklyBuilder - used to trigger Export Python from parent (e.g. header) */
export interface BlocklyBuilderHandle {
  exportPython: () => void;
  /** Return generated Python code or null if validation fails. Same logic as Export Python. */
  getPythonCode: () => string | null;
  /** Convert current workspace to Steps snapshot. */
  getStepsSnapshot: () => Step[];
  /** Replace current workspace from Steps. */
  replaceWithSteps: (steps: Step[]) => void;
}

// Block field types
export interface BlockFieldValue {
  [fieldName: string]: string | number | boolean;
}

// Python generator context
export interface PythonGeneratorContext {
  devices: DeviceEntry[];
  currentDevice?: string; // Current device context (set by set_device_context block)
  variables: Record<string, any>; // Runtime variables
  indentLevel: number;
}

// Workspace configuration
export interface WorkspaceConfig {
  toolbox: any; // Blockly toolbox configuration
  zoom: {
    controls: boolean;
    wheel: boolean;
    startScale: number;
    maxScale: number;
    minScale: number;
    scaleSpeed: number;
  };
  trashcan: boolean;
  sounds: boolean;
  grid: {
    spacing: number;
    length: number;
    colour: string;
    snap: boolean;
  };
}

// Import modal state
export interface ImportModalState {
  show: boolean;
  stepCount: number;
  hasUnsavedWork: boolean;
}
