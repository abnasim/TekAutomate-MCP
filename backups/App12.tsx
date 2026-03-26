import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Play, Trash2, Copy, Download, ChevronRight, ChevronLeft, AlertCircle, Settings, Search,
  Upload, Folder, Zap, X, Undo2, Redo2, FileJson, Code2, ChevronDown, ChevronUp,
  GitBranch, RefreshCw, Repeat,
  Monitor, Cpu, Battery, Gauge, Activity, Radio, ArrowUp, ArrowDown, Edit, GraduationCap, Plus, BookOpen, HelpCircle,
  // Better step icons
  PlugZap, Unplug, Send, Timer, MessageSquare, HardDriveDownload, ShieldAlert, FolderOpen
} from 'lucide-react';
import { FlowBuilder } from './components/FlowBuilder/FlowBuilder';
import { Flow } from './components/FlowBuilder/types';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { parseSCPI } from './utils/scpiParser';
import { detectEditableParameters, replaceParameter } from './utils/scpiParameterDetector';
import { extractCommandParameters } from './utils/scpiSyntaxParser';
import { SCPIHelpModal } from './components/SCPIHelpModal';
import { CommandDetailModal } from './components/CommandDetailModal';
import { ParsedSCPI, EditableParameter, ManualCommandEntry } from './types/scpi';
import { loadCompleteCommandsFile, normalizeCommandHeader, DEFAULT_CATEGORY_COLORS } from './utils/commandLoader';
import { normalizeCategoryName } from './utils/categoryMapping';
import { WelcomeWizard, DeviceFamily, BackendChoice, Intent, WizardData } from './components/WelcomeWizard';
import { InteractiveTour } from './components/InteractiveTour';
import { TriggerMascot, useTriggerMascot, TriggerAnimation } from './components/TriggerMascot';
import { AcademyProvider, AcademyModal, useHelp } from './components/Academy';

/* ===================== Types ===================== */
type Backend = 'pyvisa' | 'tm_devices' | 'vxi11' | 'tekhsi' | 'hybrid';
type StepType = 'connect' | 'disconnect' | 'query' | 'write' | 'set_and_query' | 'sleep' | 'comment' | 'python' | 'save_waveform' | 'error_check' | 'group' | 'sweep';
type ConnectionType = 'tcpip' | 'socket' | 'usb' | 'gpib';

interface InstrumentConfig {
  connectionType: ConnectionType;
  host: string;
  port: number;
  usbVendorId: string;
  usbProductId: string;
  usbSerial: string;
  gpibBoard: number;
  gpibAddress: number;
  backend: Backend;
  timeout: number;
  modelFamily: string;
  deviceType: 'SCOPE' | 'AWG' | 'AFG' | 'PSU' | 'SMU' | 'DMM' | 'DAQ' | 'MT' | 'MF' | 'SS';
  deviceDriver: string;
  alias: string;
  visaBackend: 'system' | 'pyvisa-py';
  tekhsiDevice?: string;
}

interface Step {
  id: string;
  type: StepType;
  label: string;
  params: Record<string, any>;
  children?: Step[];
  collapsed?: boolean;
  category?: string;
  subcategory?: string;
  boundDeviceId?: string; // links to DeviceEntry.id for multi-device support
}

interface Template {
  name: string;
  description: string;
  steps: Step[];
  backend?: Backend;
  category?: string;
  source?: string;
  deviceType?: 'SCOPE' | 'AWG' | 'AFG' | 'PSU' | 'SMU' | 'DMM' | 'DAQ' | 'MT' | 'MF' | 'SS';
  deviceDriver?: string;
}

interface CommandParam {
  name: string;
  type: string;
  default?: any;
  required?: boolean;
  options?: string[];
  description?: string;
  min?: number;
  max?: number;
  unit?: string;
  inputType?: string; // e.g., 'color' for color picker
  dependsOn?: string; // Name of parent argument this depends on
  conditionalValues?: Record<string, string[]>; // Map of parent value -> child values
  queryOnly?: boolean; // If true, only show in SET commands, hide in QUERY commands
}

export interface CommandLibraryItem {
  name: string;
  scpi: string;
  description: string;
  category: string;
  subcategory?: string;
  params?: CommandParam[];
  example?: string;
  tekhsi?: boolean;
  sourceFile?: string; // Track which JSON file this command came from
  // SCPI Intelligence fields
  scpiStructure?: import('./types/scpi').ParsedSCPI;
  editableParameters?: import('./types/scpi').EditableParameter[];
  manualReference?: {
    section?: string;
    page?: number;
    examples?: string[];
  };
  // Full manual entry from mso_commands.json
  manualEntry?: import('./types/scpi').ManualCommandEntry;
}

interface CommandFile {
  category: string;
  subcategory?: string;
  color: string;
  description: string;
  commands: Omit<CommandLibraryItem, 'category'>[];
}

interface TemplateFile {
  category: string;
  templates: Template[];
}

type BrowseProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (command: CommandLibraryItem) => void;
  commands: CommandLibraryItem[];
  categoryColors: Record<string, string>;
  selectedDeviceFamily?: string;
  setSelectedDeviceFamily?: (family: string) => void;
  deviceFamilies?: Array<{ id: string; label: string; icon: string; description: string; tooltip?: string }>;
};

type ExportOpts = {
  scriptName: string;
  waveformFormat: 'bin' | 'wfm' | 'csv';
  waveformFilename: string;
  saveCsv: boolean;
  csvName: string;
  enablePerformanceOptimization: boolean;
  exportMeasurements: boolean;
  measurementsFilename: string;
};

/* ===================== Layout View Types ===================== */
interface DeviceEntry extends InstrumentConfig {
  id: string;
  enabled: boolean;
  x?: number;
  y?: number;
  status?: 'online' | 'offline' | 'idle' | 'acquiring';
}

interface InstrumentNode {
  id: string;
  deviceId?: string; // links to DeviceEntry.id
  type: InstrumentConfig['deviceType'];
  label: string;
  backend: Backend;
  connectionType: ConnectionType;
  host?: string;
  port?: number;
  x: number;
  y: number;
  status?: 'online' | 'offline' | 'idle' | 'acquiring';
  resourceString?: string;
  alias?: string;
  deviceDriver?: string;
}

interface ConnectionEdge {
  id: string;
  from: string;
  to: string;
  type: 'visa' | 'tcpip' | 'grpc' | 'signal' | 'trigger' | 'sync';
  backend?: Backend;
  label?: string;
  fromDeviceId?: string;
  toDeviceId?: string;
}

interface SignalBlock {
  id: string;
  stepId: string;
  type: StepType;
  label: string;
  backend?: Backend;
  x: number;
  y: number;
  width: number;
  height: number;
  command?: string;
}

/* ===================== Constants ===================== */
const COMMAND_FILES = [
  'system.json', 'acquisition.json', 'horizontal.json', 'channels.json',
  'trigger.json', 'data.json', 'display.json', 'dpojet.json',
  'measurement.json', 'math.json', 'cursor.json', 'save-recall.json',
  'waveform.json', 'awg.json', 'mso_commands.json' // Detailed format with full manual data
];

// All command files - loaded on startup (prioritize MSO files first for full parsing)
const QUICK_LOAD_FILES = [
  'mso_2_4_5_6_7.json', // MSO 4/5/6/5B/6B Series - full parsing required
  'MSO_DPO_5k_7k_70K.json', // DPO/MSO 5K/7K Series - full parsing required
  'tekexpress.json', // TekExpress compliance test automation commands
  'dpojet.json', // DPOJET jitter and eye diagram analysis commands
  'afg.json', // AFG31K arbitrary function generator commands
  'smu.json', // SMU source measure unit commands
  'awg.json', // AWG arbitrary waveform generator commands
];

// No lazy loading - all files loaded on startup for full parsing
const LAZY_LOAD_FILES: string[] = [];

// All complete command files
const COMPLETE_COMMAND_FILES = [...QUICK_LOAD_FILES];

// Mapping of JSON files to device families
const FILE_TO_DEVICE_FAMILY: Record<string, { id: string; label: string; icon: string; description: string; tooltip?: string }> = {
  'mso_2_4_5_6_7.json': { id: '4/5/6 Series', label: '4/5/6 Series', icon: '', description: '4/5/6 Series MSO' },
  'MSO_DPO_5k_7k_70K.json': { id: 'DPO/MSO 5k_7k_70K', label: 'DPO/MSO 5k_7k_70K', icon: '', description: 'DPO/MSO 5000/7000', tooltip: 'MSO/DPO5000/B, DPO7000/C, DPO70000/B/C/D/DX/SX, DSA70000/B/C/D, and MSO70000/C/DX Series' },
  'tekexpress.json': { id: 'TekExpress', label: 'TekExpress Compliance', icon: '', description: 'Compliance test automation' },
  'dpojet.json': { id: 'DPOJET', label: 'DPOJET Analysis', icon: '', description: 'Jitter and eye diagram analysis' },
  'afg.json': { id: 'AFG', label: 'AFG Series', icon: '', description: 'Arbitrary function generator' },
  'smu.json': { id: 'SMU', label: 'SMU Series', icon: '', description: 'Source measure unit' },
  'awg.json': { id: 'AWG', label: 'AWG Series', icon: '', description: 'Arbitrary waveform generator' },
};
const TEMPLATE_FILES = ['basic.json', 'tm_devices.json', 'tekhsi.json', 'advanced.json'];

// tm_devices device types and drivers
const TM_DEVICE_TYPES = {
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
    drivers: ['TMT4']
  },
  MF: {
    label: 'Mainframe',
    drivers: []
  },
  SS: {
    label: 'Systems Switch',
    drivers: ['SS3706A']
  }
};

const STEP_PALETTE = [
  { type: 'connect' as StepType, label: 'Connect', icon: PlugZap, color: 'bg-green-100 text-green-700' },
  { type: 'disconnect' as StepType, label: 'Disconnect', icon: Unplug, color: 'bg-red-100 text-red-700' },
  { type: 'query' as StepType, label: 'Query', icon: HelpCircle, color: 'bg-blue-100 text-blue-700' },
  { type: 'write' as StepType, label: 'Write', icon: Send, color: 'bg-amber-100 text-amber-700' },
  { type: 'set_and_query' as StepType, label: 'Set+Query', icon: RefreshCw, color: 'bg-teal-100 text-teal-700' },
  { type: 'sleep' as StepType, label: 'Sleep', icon: Timer, color: 'bg-yellow-100 text-yellow-700' },
  { type: 'python' as StepType, label: 'Python', icon: Code2, color: 'bg-slate-100 text-slate-700' },
  { type: 'comment' as StepType, label: 'Comment', icon: MessageSquare, color: 'bg-gray-100 text-gray-700' },
  { type: 'save_waveform' as StepType, label: 'Save Data', icon: HardDriveDownload, color: 'bg-indigo-100 text-indigo-700' },
  { type: 'error_check' as StepType, label: 'Error Check', icon: ShieldAlert, color: 'bg-orange-100 text-orange-700' },
  { type: 'group' as StepType, label: 'Group', icon: FolderOpen, color: 'bg-gray-100 text-gray-700' },
  { type: 'sweep' as StepType, label: 'Sweep', icon: Repeat, color: 'bg-cyan-100 text-cyan-700' }
];

/* ===================== Layout View Helpers ===================== */
const getBackendColor = (backend: Backend): string => {
  switch (backend) {
    case 'tekhsi': return '#10b981'; // green
    case 'tm_devices': return '#f97316'; // orange
    case 'hybrid': return '#3b82f6'; // blue
    case 'pyvisa': return '#8b5cf6'; // purple
    case 'vxi11': return '#6366f1'; // indigo
    default: return '#6b7280'; // gray
  }
};

const getStepBackend = (step: Step, defaultBackend: Backend): Backend => {
  if (step.type === 'save_waveform' && step.params?.command?.includes('tekhsi')) return 'tekhsi';
  if (step.category === 'TekHSI') return 'tekhsi';
  return defaultBackend;
};

const getVisaResourceString = (device: DeviceEntry): string => {
  if (device.connectionType === 'tcpip') {
    return `TCPIP::${device.host}::INSTR`;
  } else if (device.connectionType === 'socket') {
    return `TCPIP::${device.host}::${device.port}::SOCKET`;
  } else if (device.connectionType === 'usb') {
    const serial = device.usbSerial ? `::${device.usbSerial}` : '';
    return `USB::${device.usbVendorId}::${device.usbProductId}${serial}::INSTR`;
  } else if (device.connectionType === 'gpib') {
    return `GPIB${device.gpibBoard}::${device.gpibAddress}::INSTR`;
  }
  return 'Unknown';
};

const getDeviceIcon = (deviceType: InstrumentConfig['deviceType']) => {
  switch (deviceType) {
    case 'SCOPE': return Monitor;
    case 'AWG': case 'AFG': return Radio;
    case 'PSU': return Battery;
    case 'SMU': return Gauge;
    case 'DMM': return Activity;
    case 'DAQ': return Cpu;
    default: return Monitor;
  }
};

const extractTopologyFromDevices = (devices: DeviceEntry[], connections: ConnectionEdge[]): { nodes: InstrumentNode[], edges: ConnectionEdge[] } => {
  const nodes: InstrumentNode[] = [];
  const edges: ConnectionEdge[] = [];
  
  // Add PC node
  const pcNodeId = 'pc';
  nodes.push({
    id: pcNodeId,
    type: 'DMM', // Placeholder type for PC
    label: 'PC / Host',
    backend: 'pyvisa',
    connectionType: 'tcpip',
    x: 50,
    y: 200,
    status: 'online'
  });
  
  // Create nodes for each enabled device
  devices.filter(d => d.enabled).forEach(device => {
    const nodeId = `node-${device.id}`;
    nodes.push({
      id: nodeId,
      deviceId: device.id,
      type: device.deviceType,
      label: device.alias || `${device.deviceType} (${device.host || 'localhost'})`,
      backend: device.backend,
      connectionType: device.connectionType,
      host: device.host,
      port: device.port,
      x: device.x || 200,
      y: device.y || 200,
      status: device.status || 'offline',
      resourceString: getVisaResourceString(device),
      alias: device.alias,
      deviceDriver: device.deviceDriver
    });

    // Add connection from PC to device
    edges.push({
      id: `edge-pc-${device.id}`,
      from: pcNodeId,
      to: nodeId,
      type: device.connectionType === 'tcpip' ? 'tcpip' : device.connectionType === 'socket' ? 'tcpip' : 'visa',
      backend: device.backend,
      label: `${device.connectionType.toUpperCase()}`,
      fromDeviceId: undefined,
      toDeviceId: device.id
    });

    // Check for hybrid mode - add TekHSI node if needed
    if (device.backend === 'hybrid' || device.backend === 'tekhsi') {
      const tekhsiNodeId = `tekhsi-${device.id}`;
      nodes.push({
        id: tekhsiNodeId,
        deviceId: device.id,
        type: device.deviceType,
        label: `${device.alias || device.deviceType} (TekHSI)`,
        backend: 'tekhsi',
        connectionType: 'tcpip',
        host: device.host,
        port: 5000,
        x: (device.x || 200) + 300,
        y: device.y || 200,
        status: 'offline',
        resourceString: `${device.host}:5000`,
        alias: device.alias,
        deviceDriver: device.deviceDriver
      });
      
      edges.push({
        id: `edge-tekhsi-${device.id}`,
        from: nodeId,
        to: tekhsiNodeId,
        type: 'grpc',
        backend: 'tekhsi',
        label: 'gRPC (Port 5000)',
        fromDeviceId: device.id,
        toDeviceId: device.id
      });
    }
  });

  // Add user-defined device connections
  connections.forEach(conn => {
    edges.push({
      ...conn,
      from: conn.from || `node-${conn.fromDeviceId}`,
      to: conn.to || `node-${conn.toDeviceId}`
    });
  });

  return { nodes, edges };
};

/**
 * Fix mixed syntax strings and construct proper SET syntax with arguments.
 * E.g., "CMD {<NR1>|OFF|ON} CMD?" should be split into:
 *   set: "CMD {<NR1>|OFF|ON}"
 *   query: "CMD?"
 * 
 * If params are provided and set syntax is missing arguments, construct them.
 */
const fixSyntaxDisplay = (
  syntax: { set?: string; query?: string } | undefined,
  params?: Array<{ name: string; type?: string; options?: string[] }>
): { set: string | null; query: string | null } => {
  if (!syntax) return { set: null, query: null };
  
  let setSyntax = syntax.set?.trim() || null;
  let querySyntax = syntax.query?.trim() || null;
  
  // Fix case where query contains both SET and QUERY syntax
  if (querySyntax && querySyntax.includes('{') && querySyntax.includes('?')) {
    // Pattern: "COMMAND {args} COMMAND?" - split them
    const queryMatch = querySyntax.match(/^(.+?\})\s+(\S+\?)$/);
    if (queryMatch) {
      if (!setSyntax) {
        setSyntax = queryMatch[1].trim();
      }
      querySyntax = queryMatch[2].trim();
    } else {
      // Try another pattern: find where the query command starts (command repeated with ?)
      const parts = querySyntax.split(/\s+/);
      const queryPart = parts.find(p => p.endsWith('?'));
      if (queryPart) {
        const queryIdx = querySyntax.lastIndexOf(queryPart);
        if (queryIdx > 0) {
          const potentialSet = querySyntax.substring(0, queryIdx).trim();
          if (potentialSet && (potentialSet.includes('{') || potentialSet.includes('<NR'))) {
            if (!setSyntax) {
              setSyntax = potentialSet;
            }
            querySyntax = queryPart;
          }
        }
      }
    }
  }
  
  // Also fix case where set syntax wrongly ends with ?
  if (setSyntax && setSyntax.endsWith('?')) {
    // This is actually a query-only command
    if (!querySyntax) {
      querySyntax = setSyntax;
    }
    setSyntax = null;
  }
  
  // Ensure query ends with ? and set doesn't
  if (querySyntax && !querySyntax.endsWith('?')) {
    querySyntax = null; // Invalid query syntax
  }
  
  // If set syntax exists but has no arguments, construct them from params
  if (setSyntax && !setSyntax.includes('{') && !/\s*<NR\d*>/i.test(setSyntax) && !/<QString>/i.test(setSyntax) && params && params.length > 0) {
    // Find value parameter (not mnemonic params like 'channel', 'math', etc.)
    const mnemonicNames = ['channel', 'math', 'ref', 'bus', 'cursor', 'search', 'power', 'plot', 'meas', 'source', 'histogram', 'digital_bit', 'mask', 'callout', 'actonevent', 'license', 'rail', 'source_num', 'trigger_type'];
    const valueParam = params.find(p => 
      p.name.toLowerCase() === 'value' || 
      (p.options && p.options.length > 0 && !mnemonicNames.includes(p.name.toLowerCase()))
    );
    
    if (valueParam) {
      let argStr = '';
      if (valueParam.options && valueParam.options.length > 0) {
        // Check if options include numeric types (case-insensitive)
        const numericRegex = /<(number|NR\d*|NRx)>/i;
        const hasNumber = valueParam.options.some(o => numericRegex.test(o));
        const otherOptions = valueParam.options.filter(o => !numericRegex.test(o) && !/<QString>/i.test(o));
        
        if (hasNumber && otherOptions.length > 0) {
          argStr = ` {<NR1>|${otherOptions.join('|')}}`;
        } else if (otherOptions.length > 0) {
          argStr = ` {${otherOptions.join('|')}}`;
        } else if (hasNumber) {
          argStr = ' <NR1>';
        }
      } else if (valueParam.type === 'number' || valueParam.type === 'integer' || valueParam.type === 'enumeration') {
        // For enumeration type without explicit options, just show <value>
        argStr = valueParam.type === 'enumeration' ? '' : ' <NR1>';
      } else if (valueParam.type === 'string') {
        argStr = ' <QString>';
      }
      
      if (argStr) {
        setSyntax = setSyntax + argStr;
      }
    }
  }
  
  return { set: setSyntax, query: querySyntax };
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _extractSignalPathForDevice = (steps: Step[], deviceId: string, devices: DeviceEntry[]): SignalBlock[] => {
  const blocks: SignalBlock[] = [];
  let y = 100;
  const blockHeight = 80;
  const blockSpacing = 20;
  const blockWidth = 200;
  const device = devices.find(d => d.id === deviceId);
  const defaultBackend = device?.backend || 'pyvisa';

  const processSteps = (stepList: Step[], x: number = 100) => {
    stepList.forEach((step, idx) => {
      // Only include steps bound to this device
      if (step.boundDeviceId && step.boundDeviceId !== deviceId) {
        if (step.children) {
          processSteps(step.children, x);
        }
        return;
      }

      if (step.type === 'comment' || step.type === 'group' || step.type === 'sweep') {
        if (step.children) {
          processSteps(step.children, x + 30);
        }
        return;
      }

      const backend = getStepBackend(step, defaultBackend);
      blocks.push({
        id: step.id,
        stepId: step.id,
        type: step.type,
        label: step.label || step.type,
        backend,
        x,
        y: y + (blocks.length * (blockHeight + blockSpacing)),
        width: blockWidth,
        height: blockHeight,
        command: step.params?.command || step.params?.text || ''
      });

      if (step.children) {
        processSteps(step.children, x + 30);
      }
    });
  };

  processSteps(steps);
  return blocks;
};

/* ===================== Command Browser ===================== */
const CommandBrowser: React.FC<BrowseProps & { triggerAnimation?: (anim: TriggerAnimation) => void }> = ({ 
  isOpen, 
  onClose, 
  onSelect, 
  commands, 
  categoryColors,
  triggerAnimation,
  selectedDeviceFamily,
  setSelectedDeviceFamily,
  deviceFamilies = []
}) => {
  const [search, setSearch] = useState<string>('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<CommandLibraryItem | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get categories with command counts (must be before early return)
  const categories = useMemo(() => {
    const catMap = new Map<string, number>();
    commands.forEach(cmd => {
      catMap.set(cmd.category, (catMap.get(cmd.category) || 0) + 1);
    });
    return Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [commands]);

  // Filter commands (must be before early return)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return commands.filter((cmd) => {
      // Search across all relevant fields
      const searchableFields = [
        cmd.name,
        cmd.scpi,
        cmd.description,
        cmd.category,
        cmd.example,
        // Arguments text
        (cmd as any).arguments,
        // Parameter names and descriptions
        ...(cmd.params?.map(p => `${p.name} ${p.description || ''} ${p.options?.join(' ') || ''}`) || []),
        // Manual entry fields
        cmd.manualEntry?.arguments,
        cmd.manualEntry?.shortDescription,
        cmd.manualEntry?.commandGroup,
        cmd.manualEntry?.mnemonics?.join(' '),
        // Examples
        ...(cmd.manualEntry?.examples?.map((ex: any) => `${ex.description || ''} ${ex.codeExamples?.scpi?.code || ''}`) || []),
      ].filter(Boolean).map(s => String(s).toLowerCase());
      
      const matchesSearch = searchableFields.some(field => field.includes(q));
      const matchesCat = selectedCat === null || cmd.category === selectedCat;
      return matchesSearch && matchesCat;
    });
  }, [commands, search, selectedCat]);

  // Infinite scroll (must be before early return)
  const visibleCommands = useMemo(() => 
    filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMore = visibleCount < filtered.length;

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [search, selectedCat]);

  // Infinite scroll observer for CommandBrowser
  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setVisibleCount(prev => Math.min(prev + 50, filtered.length));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, filtered.length]);
  
  // Trigger search animation when browser opens
  React.useEffect(() => {
    if (isOpen && triggerAnimation) {
      triggerAnimation('search');
    }
  }, [isOpen, triggerAnimation]);
  

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);
  
  // Debounced search handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);
    setVisibleCount(50); // Reset visible count on search
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      if (triggerAnimation && value.length > 0) {
        triggerAnimation('search');
      }
    }, 300);
  };
  
  if (!isOpen) return null;

  const handleCommandClick = (cmd: CommandLibraryItem, e: React.MouseEvent) => {
    // Check if info icon was clicked
    const target = e.target as HTMLElement;
    if (target.closest('.info-icon') || target.closest('button[data-action="info"]')) {
      e.stopPropagation();
      setSelectedCommand(cmd);
      setShowDetailModal(true);
      return;
    }
    
    // Otherwise, add to flow
    onSelect(cmd);
    onClose();
    if (triggerAnimation) {
      triggerAnimation('success');
    }
  };

  const handleAddFromDetail = (cmd: CommandLibraryItem) => {
    onSelect(cmd);
    setShowDetailModal(false);
    onClose();
    if (triggerAnimation) {
      triggerAnimation('success');
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
            <h2 className="text-xl font-bold text-gray-900">Browse Commands</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded transition">
              <X size={20} />
            </button>
          </div>

          {/* Search Bar */}
          <div className="p-4 border-b bg-white sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Search by name, SCPI command, or description..."
                  value={search}
                  onChange={handleSearchChange}
                  className="w-full pl-10 pr-4 py-2.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
              {deviceFamilies.length > 0 && selectedDeviceFamily && setSelectedDeviceFamily && (
                <div className="relative" title={deviceFamilies.find(f => f.id === selectedDeviceFamily)?.tooltip || ''}>
                  <select
                    value={selectedDeviceFamily}
                    onChange={(e) => setSelectedDeviceFamily(e.target.value)}
                    className="appearance-none text-xs pl-4 pr-8 py-2.5 bg-blue-50 border border-blue-200 rounded cursor-pointer hover:bg-blue-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    title={deviceFamilies.find(f => f.id === selectedDeviceFamily)?.tooltip || ''}
                  >
                    {deviceFamilies.map(family => (
                      <option key={family.id} value={family.id} title={family.tooltip || ''}>
                        {family.icon} {family.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600 pointer-events-none" />
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Category Sidebar */}
            <div className="w-64 border-r bg-gray-50 overflow-y-auto">
              <div className="p-3 border-b bg-white">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Categories</h3>
                <button
                  onClick={() => setSelectedCat(null)}
                  className={`w-full text-left px-3 py-2 text-sm rounded transition ${
                    selectedCat === null
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  All ({commands.length})
                </button>
              </div>
              <div className="p-2 space-y-1">
                {categories.map(({ name, count }) => (
                  <button
                    key={name}
                    onClick={() => setSelectedCat(name)}
                    className={`w-full text-left px-3 py-2 text-sm rounded transition flex items-center justify-between ${
                      selectedCat === name
                        ? `${categoryColors[name] || 'bg-blue-100 text-blue-700'} font-medium`
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="truncate">{name}</span>
                    <span className={`text-xs ml-2 ${
                      selectedCat === name ? 'text-blue-600' : 'text-gray-400'
                    }`}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Command List */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {filtered.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Search size={48} className="mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No commands found</p>
                    <p className="text-sm mt-2">Try adjusting your search or category filter</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="space-y-2">
                      {visibleCommands.map((cmd, idx) => (
                        <div
                          key={`${cmd.scpi}-${idx}`}
                          className="p-3 bg-white border rounded-lg hover:border-blue-400 hover:shadow-md transition cursor-pointer group"
                          onClick={(e) => handleCommandClick(cmd, e)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="font-semibold text-sm text-gray-900">{cmd.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${categoryColors[cmd.category] || 'bg-gray-100 text-gray-700'}`}>
                                  {cmd.category}
                                </span>
                                {cmd.subcategory && (
                                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                                    {cmd.subcategory}
                                  </span>
                                )}
                                {cmd.tekhsi && (
                                  <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded border border-red-300">
                                    <Zap size={10} className="inline" /> gRPC
                                  </span>
                                )}
                              </div>
                              <div className="text-xs font-mono text-blue-600 mb-1.5 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                                {cmd.scpi}
                              </div>
                              <div className="text-xs text-gray-600 line-clamp-2">
                                {cmd.description || 'No description available.'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                data-action="info"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCommand(cmd);
                                  setShowDetailModal(true);
                                }}
                                className="p-1.5 hover:bg-gray-100 rounded transition opacity-0 group-hover:opacity-100 info-icon"
                                title="View details"
                              >
                                <HelpCircle size={18} className="text-gray-500" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelect(cmd);
                                  onClose();
                                  if (triggerAnimation) {
                                    triggerAnimation('success');
                                  }
                                }}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition opacity-0 group-hover:opacity-100"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {/* Infinite scroll sentinel - INSIDE scrollable container */}
                      <div 
                        ref={scrollSentinelRef} 
                        className="py-4 text-center"
                      >
                        <div className="text-sm text-gray-500">
                          {hasMore ? (
                            <span className="flex items-center justify-center gap-2">
                              <span className="animate-pulse">Loading more...</span>
                              <span className="text-gray-400">({visibleCommands.length} of {filtered.length})</span>
                            </span>
                          ) : (
                            <span>Showing all {filtered.length} commands</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Command Detail Modal */}
      <CommandDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedCommand(null);
        }}
        command={selectedCommand}
        onAddToFlow={handleAddFromDetail}
        categoryColor={selectedCommand ? (categoryColors[selectedCommand.category] || 'bg-blue-100 text-blue-700 border-blue-300') : undefined}
      />
    </>
  );
};

/* ===================== Layout View Components ===================== */
interface InstrumentLayoutCanvasProps {
  nodes: InstrumentNode[];
  edges: ConnectionEdge[];
  selectedNode: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  onNodeDrag: (nodeId: string, x: number, y: number) => void;
  zoom: number;
  pan: { x: number; y: number };
  expanded: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _InstrumentLayoutCanvas: React.FC<InstrumentLayoutCanvasProps> = (props) => {
  const { nodes, edges, selectedNode, onNodeSelect, onNodeDrag, zoom, pan, expanded } = props;
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDraggingNode(nodeId);
    setDragOffset({
      x: e.clientX - node.x * zoom - pan.x,
      y: e.clientY - node.y * zoom - pan.y
    });
    onNodeSelect(nodeId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggingNode) return;
    const newX = (e.clientX - dragOffset.x - pan.x) / zoom;
    const newY = (e.clientY - dragOffset.y - pan.y) / zoom;
    onNodeDrag(draggingNode, newX, newY);
  };

  const handleMouseUp = () => {
    setDraggingNode(null);
  };

  const getNodeColor = (node: InstrumentNode) => {
    // Special styling for PC node
    if (node.id === 'pc') {
      return 'bg-slate-100 border-slate-400 text-slate-800';
    }
    switch (node.backend) {
      case 'tekhsi': return 'bg-green-100 border-green-400 text-green-800';
      case 'tm_devices': return 'bg-orange-100 border-orange-400 text-orange-800';
      case 'hybrid': return 'bg-blue-100 border-blue-400 text-blue-800';
      case 'pyvisa': return 'bg-purple-100 border-purple-400 text-purple-800';
      default: return 'bg-gray-100 border-gray-400 text-gray-800';
    }
  };

  const getEdgeColor = (edge: ConnectionEdge) => {
    if (edge.backend) return getBackendColor(edge.backend);
    return '#6b7280';
  };

  if (nodes.length === 0) {
    return (
      <div className={`relative bg-gray-50 border rounded flex items-center justify-center ${expanded ? 'h-[90vh]' : 'h-[600px]'}`}>
        <div className="text-center text-gray-400">
          <p className="text-sm">No instruments configured</p>
          <p className="text-xs mt-2">Configure an instrument in the Builder view to see the topology</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`relative bg-white border rounded ${expanded ? 'h-[90vh]' : 'h-[600px]'}`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Grid Background */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `
            linear-gradient(to right, #e5e7eb 1px, transparent 1px),
            linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }}
      />
      
      <svg className="w-full h-full relative z-10" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {/* Render edges */}
        {edges.map(edge => {
          const fromNode = nodes.find(n => n.id === edge.from) || { x: 50, y: 50 };
          const toNode = nodes.find(n => n.id === edge.to);
          if (!toNode) return null;
          
          return (
            <line
              key={edge.id}
              x1={fromNode.x}
              y1={fromNode.y}
              x2={toNode.x}
              y2={toNode.y}
              stroke={getEdgeColor(edge)}
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              className="cursor-pointer hover:stroke-width-3"
              onClick={() => onNodeSelect(edge.id)}
            />
          );
        })}
        
        {/* Arrow marker definition */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <polygon points="0 0, 10 3, 0 6" fill="#6b7280" />
          </marker>
        </defs>
      </svg>

      {/* Render nodes */}
      <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {nodes.map(node => (
          <div
            key={node.id}
            className={`absolute w-48 p-3 rounded-lg border-2 cursor-move transition-all ${
              getNodeColor(node)
            } ${selectedNode === node.id ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-md'}`}
            style={{ left: node.x, top: node.y }}
            onMouseDown={(e) => handleMouseDown(e, node.id)}
          >
            <div className="font-semibold text-sm mb-1">{node.alias || node.label}</div>
            <div className="text-xs space-y-1">
              <div className="font-medium">{node.connectionType.toUpperCase()}</div>
              {node.deviceDriver && (
                <div className="text-gray-600">{node.deviceDriver}</div>
              )}
              <div className="flex items-center gap-1 flex-wrap">
                {node.backend === 'hybrid' ? (
                  <>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">pyvisa</span>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">vxi11</span>
                  </>
                ) : (
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    node.backend === 'tm_devices' ? 'bg-orange-100 text-orange-700' :
                    node.backend === 'tekhsi' ? 'bg-green-100 text-green-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {node.backend}
                  </span>
                )}
              </div>
              {node.status && (
                <div className="mt-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    node.status === 'online' ? 'bg-green-200 text-green-800' :
                    node.status === 'acquiring' ? 'bg-yellow-200 text-yellow-800' :
                    'bg-gray-200 text-gray-800'
                  }`}>
                    {node.status === 'online' ? 'Connected' : node.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface SignalPathViewProps {
  blocks: SignalBlock[];
  selectedStep: string | null;
  onBlockSelect: (stepId: string) => void;
  zoom: number;
  pan: { x: number; y: number };
  expanded: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _SignalPathView: React.FC<SignalPathViewProps> = (props) => {
  const { blocks, selectedStep, onBlockSelect, zoom, pan, expanded } = props;
  const getBlockColor = (backend?: Backend) => {
    if (!backend) return 'bg-gray-200 border-gray-400';
    switch (backend) {
      case 'tekhsi': return 'bg-green-200 border-green-500';
      case 'tm_devices': return 'bg-orange-200 border-orange-500';
      case 'hybrid': return 'bg-blue-200 border-blue-500';
      case 'pyvisa': return 'bg-purple-200 border-purple-500';
      default: return 'bg-gray-200 border-gray-400';
    }
  };

  const getStepTypeColor = (type: StepType) => {
    const palette = STEP_PALETTE.find(s => s.type === type);
    return palette?.color || 'bg-gray-100 text-gray-700';
  };

  if (blocks.length === 0) {
    return (
      <div className={`relative bg-gray-50 border rounded flex items-center justify-center ${expanded ? 'h-[90vh]' : 'h-[600px]'}`}>
        <div className="text-center text-gray-400">
          <p className="text-sm">No steps to display</p>
          <p className="text-xs mt-2">Add steps in the Builder view to see the signal path</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative bg-gray-50 border rounded overflow-auto ${expanded ? 'h-[90vh]' : 'h-[600px]'}`}>
      <svg 
        className="w-full h-full" 
        style={{ 
          minWidth: `${Math.max(...blocks.map(b => b.x + b.width), 500)}px`,
          minHeight: `${Math.max(...blocks.map(b => b.y + b.height), 500)}px`
        }}
      >
        {/* Render arrows between blocks */}
        {blocks.map((block, idx) => {
          if (idx === blocks.length - 1) return null;
          const nextBlock = blocks[idx + 1];
          return (
            <line
              key={`arrow-${block.id}`}
              x1={block.x + block.width / 2}
              y1={block.y + block.height}
              x2={nextBlock.x + nextBlock.width / 2}
              y2={nextBlock.y}
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead-signal)"
            />
          );
        })}
        
        <defs>
          <marker id="arrowhead-signal" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <polygon points="0 0, 10 3, 0 6" fill="#6b7280" />
          </marker>
        </defs>
      </svg>

      {/* Render blocks */}
      <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {blocks.map(block => (
          <div
            key={block.id}
            className={`absolute rounded-lg border-2 p-3 cursor-pointer transition-all shadow-md hover:shadow-lg ${
              getBlockColor(block.backend)
            } ${selectedStep === block.stepId ? 'ring-2 ring-blue-500' : ''}`}
            style={{
              left: block.x,
              top: block.y,
              width: block.width,
              height: block.height
            }}
            onClick={() => onBlockSelect(block.stepId)}
            title={block.command || block.label}
          >
            <div className={`inline-block px-2 py-1 rounded text-xs mb-2 ${getStepTypeColor(block.type)}`}>
              {block.type}
            </div>
            <div className="font-semibold text-sm mb-1">{block.label}</div>
            {block.backend && (
              <div className="text-xs mt-1">
                <span className="px-1.5 py-0.5 rounded bg-white/50">
                  {block.backend}
                </span>
              </div>
            )}
            {block.command && (
              <div className="text-xs font-mono mt-2 truncate" title={block.command}>
                {block.command}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ===================== Help Dropdown Academy Button ===================== */
const HelpDropdownAcademyButtonWrapper: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { openArticle } = useHelp();
  return (
    <button 
      onClick={() => { openArticle(); onClose(); }}
      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
    >
      <BookOpen size={14} />
      Academy
    </button>
  );
};

/* ===================== App ===================== */
function AppInner() {
  // Load config from localStorage on initialization
  const [config, setConfig] = useState<InstrumentConfig>(() => {
    try {
      const saved = localStorage.getItem('tekautomate_config');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load config from localStorage:', e);
    }
    return {
      connectionType: 'tcpip',
      host: '127.0.0.1',
      port: 5000,
      usbVendorId: '0x0699',
      usbProductId: '0x0522',
      usbSerial: '',
      gpibBoard: 0,
      gpibAddress: 1,
      backend: 'pyvisa',
      timeout: 5.0,
      modelFamily: 'MSO4/5/6 Series',
      deviceType: 'SCOPE',
      deviceDriver: 'MSO6',
      alias: 'scope1',
      visaBackend: 'system',
      tekhsiDevice: '6 Series MSO'
    };
  });

  // Save config to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('tekautomate_config', JSON.stringify(config));
    } catch (e) {
      console.error('Failed to save config to localStorage:', e);
    }
  }, [config]);

  // Load steps from localStorage on initialization
  const [steps, setSteps] = useState<Step[]>(() => {
    try {
      const saved = localStorage.getItem('tekautomate_steps');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load steps from localStorage:', e);
    }
    return [];
  });

  // Save steps to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('tekautomate_steps', JSON.stringify(steps));
    } catch (e) {
      console.error('Failed to save steps to localStorage:', e);
    }
  }, [steps]);
  const [showTekHSIInfo, setShowTekHSIInfo] = useState(false);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]); // Multi-select support
  const [lastSelectedStep, setLastSelectedStep] = useState<string | null>(null); // For shift-click range selection
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stepId: string } | null>(null);
  const [showWelcomeWizard, setShowWelcomeWizard] = useState(false);
  const [runTour, setRunTour] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showSCPIHelp, setShowSCPIHelp] = useState(false);
  const [showMascot, setShowMascot] = useState(false); // Hidden by default
  const [mascotTemporarilyShown, setMascotTemporarilyShown] = useState(false);
  
  // Trigger mascot control
  const triggerControls = useTriggerMascot();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [past, setPast] = useState<Step[][]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [future, setFuture] = useState<Step[][]>([]);
  const commit = (next: Step[]) => { setPast((p) => [...p, steps]); setSteps(next); setFuture([]); };
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [steps, ...f]);
      setSteps(prev);
      triggerControls.triggerAnimation('success');
      return p.slice(0, -1);
    });
  }, [steps, triggerControls]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, steps]);
      setSteps(next);
      triggerControls.triggerAnimation('success');
      return f.slice(1);
    });
  }, [steps, triggerControls]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z') { e.preventDefault(); undo(); }
      if (mod && k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const [showConfig, setShowConfig] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_flowNodes, _setFlowNodes] = useState<Array<{ id: string; type: string; x: number; y: number; stepId?: string }>>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_draggingFlowNode, _setDraggingFlowNode] = useState<string | null>(null);
  const [draggedStep, setDraggedStep] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'builder' | 'library' | 'templates' | 'flow-designer'>('builder');
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0);
  const [showManageInstruments, setShowManageInstruments] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showSettingsDropdown, _setShowSettingsDropdown] = useState(false);
  const [enableFlowDesigner, setEnableFlowDesigner] = useState(() => {
    const saved = localStorage.getItem('enableFlowDesigner');
    return saved === 'true';
  });
  const [carouselStartX, setCarouselStartX] = useState(0);
  const [isDraggingCarousel, setIsDraggingCarousel] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_selectedNode, _setSelectedNode] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_canvasZoom, _setCanvasZoom] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_canvasPan, _setCanvasPan] = useState({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_selectedTopologyDevice, _setSelectedTopologyDevice] = useState<string | null>(null);
  const [showDeviceTypeSelector, setShowDeviceTypeSelector] = useState(false);
  const [expandedDeviceGroups, setExpandedDeviceGroups] = useState<Set<string>>(new Set());
  // Load devices from localStorage on initialization
  const [devices, setDevices] = useState<DeviceEntry[]>(() => {
    try {
      const saved = localStorage.getItem('tekautomate_devices');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load devices from localStorage:', e);
    }
    // Initialize with default device from config
    const initialDevice: DeviceEntry = {
      ...config,
      id: 'device-1',
      enabled: true,
      x: 200,
      y: 200
    };
    return [initialDevice];
  });

  // Save devices to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('tekautomate_devices', JSON.stringify(devices));
    } catch (e) {
      console.error('Failed to save devices to localStorage:', e);
    }
  }, [devices]);
  const [deviceConnections, setDeviceConnections] = useState<ConnectionEdge[]>([]);
  const [editingDevice, setEditingDevice] = useState<DeviceEntry | null>(null);

  const [commandLibrary, setCommandLibrary] = useState<CommandLibraryItem[]>([]);
  const [builtInTemplates, setBuiltInTemplates] = useState<Template[]>([]);
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBackends, setSelectedBackends] = useState<string[]>([]);
  // Command Library infinite scroll state
  const [libraryVisibleCount, setLibraryVisibleCount] = useState(50);
  const libraryScrollSentinelRef = useRef<HTMLDivElement>(null);
  const [librarySearchDebounced, setLibrarySearchDebounced] = useState('');
  const [selectedLibraryCommand, setSelectedLibraryCommand] = useState<CommandLibraryItem | null>(null);
  const [showLibraryDetailModal, setShowLibraryDetailModal] = useState(false);
  const librarySearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Device family filter for commands
  const [selectedDeviceFamily, setSelectedDeviceFamily] = useState<string>('4/5/6 Series');
  
  // Track which files were successfully loaded
  const [loadedFiles, setLoadedFiles] = useState<Set<string>>(new Set());
  
  // Available device families - show all configured families (large files will lazy load)
  const deviceFamilies = useMemo(() => {
    return Object.values(FILE_TO_DEVICE_FAMILY);
  }, []);
  // Load user templates from localStorage on initialization
  const [userTemplates, setUserTemplates] = useState<Template[]>(() => {
    try {
      const saved = localStorage.getItem('tekautomate_user_templates');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load user templates from localStorage:', e);
    }
    return [];
  });

  // Save user templates to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('tekautomate_user_templates', JSON.stringify(userTemplates));
    } catch (e) {
      console.error('Failed to save user templates to localStorage:', e);
    }
  }, [userTemplates]);
  const [showCommandBrowser, setShowCommandBrowser] = useState(false);
  const [commandBrowserCallback, setCommandBrowserCallback] = useState<((cmd: CommandLibraryItem) => void) | null>(null);
  const [templateTab, setTemplateTab] = useState<'builtin' | 'tekexpress' | 'user'>('builtin');

  const [exportOpen, setExportOpen] = useState(false);
  const [xopt, setXopt] = useState<ExportOpts>({
    scriptName: 'tek_automation.py',
    waveformFormat: 'bin',
    waveformFilename: 'waveform.bin',
    saveCsv: true,
    csvName: 'tek_log.csv',
    enablePerformanceOptimization: false,
    exportMeasurements: false,
    measurementsFilename: 'measurements.csv',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showFlowDropdown, setShowFlowDropdown] = useState(false);
  const [showHelpDropdown, setShowHelpDropdown] = useState(false);
  const [enablePrintMessages, setEnablePrintMessages] = useState(false);
  
  // Flow Builder state - persisted across view changes
  const [flowBuilderState, setFlowBuilderState] = useState<Flow | null>(() => {
    // Try to load from localStorage
    try {
      const saved = localStorage.getItem('tekautomate_flow_builder');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load flow from localStorage:', e);
    }
    return null;
  });
  
  // Save flow to localStorage whenever it changes
  useEffect(() => {
    if (flowBuilderState) {
      try {
        localStorage.setItem('tekautomate_flow_builder', JSON.stringify(flowBuilderState));
      } catch (e) {
        console.error('Failed to save flow to localStorage:', e);
      }
    }
  }, [flowBuilderState]);

  // Check if welcome wizard should be shown on first launch
  useEffect(() => {
    const hasSeenWizard = localStorage.getItem('tekautomate_wizard_shown');
    if (!hasSeenWizard) {
      setShowWelcomeWizard(true);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const commands: CommandLibraryItem[] = [];
        const colors: Record<string, string> = {};
        const loadedCommandIds = new Set<string>(); // Track normalized command headers
        
        // STEP 1: Load QUICK command files only (small files for fast startup)
        const successfullyLoadedFiles = new Set<string>();
        
        for (const file of QUICK_LOAD_FILES) {
          try {
            const response = await fetch(`/commands/${file}`);
            if (!response.ok) continue;
            const data: any = await response.json();
            
            // Track successfully loaded file
            successfullyLoadedFiles.add(file);
            
            // Check if it's the commands_by_section format or commands array format
            if (data.commands_by_section) {
              // Standard format (mso_commands_complete.json)
              const result = loadCompleteCommandsFile(data);
              result.commands.forEach(cmd => {
                const normalized = normalizeCommandHeader(cmd.scpi);
                if (!loadedCommandIds.has(normalized)) {
                  loadedCommandIds.add(normalized);
                  // Tag command with source file
                  const cmdWithSource = { ...cmd, sourceFile: (cmd as any).sourceFile || file };
                  commands.push(cmdWithSource);
                }
              });
              
              // Merge colors
              Object.assign(colors, result.colors);
              
              if (result.metadata) {
                console.log(`Loaded ${result.commands.length} commands from ${file}`, {
                  total: result.metadata.total_commands,
                  sections: result.metadata.total_sections,
                  equipment: result.metadata.equipment || result.metadata.source,
                });
              } else {
                console.log(`Loaded ${result.commands.length} commands from ${file}`);
              }
            } else if (data.groups && typeof data.groups === 'object') {
              // Groups format (mso_commands_extracted_v2.json cleaned version)
              // Load commands from groups
              let addedCount = 0;
              let enhancedCount = 0;
              
              Object.entries(data.groups).forEach(([groupName, groupData]: [string, any]) => {
                if (!groupData || !Array.isArray(groupData.commands)) return;
                
                // Map group name to category - normalize to consolidate duplicates
                const rawCategoryName = groupName || 'miscellaneous';
                const categoryName = normalizeCategoryName(rawCategoryName);
                
                // Skip malformed categories (likely all the gibberish commands)
                if (categoryName === 'Zoom' && rawCategoryName !== 'Zoom' && rawCategoryName !== 'Zoom Command Group') {
                  // This is likely a malformed command being dumped into Zoom - skip it
                  return;
                }
                
                if (!colors[categoryName]) {
                  // Use color from group data if available, otherwise use defaults
                  colors[categoryName] = groupData.color || DEFAULT_CATEGORY_COLORS[categoryName.toLowerCase()] || DEFAULT_CATEGORY_COLORS['miscellaneous'];
                }
                
                groupData.commands.forEach((cmd: any) => {
                  const scpiCmd = cmd.scpi || cmd.header;
                  if (!scpiCmd) return;
                  
                  // Tag command with source file - ALWAYS set it for groups structure
                  cmd.sourceFile = file;
                  
                  // Use cmd.name (generated from SCPI structure) as primary, fallback to shortDescription
                  let shortDesc = cmd.name || cmd.short_description || cmd.shortDescription || cmd.id || '';
                  
                  // Filter out query response patterns (e.g., "AFG:AMPLITUDE? might return :AFG:AMPLITUDE 3")
                  if (shortDesc.includes('might return') || shortDesc.includes('? might return') || 
                      shortDesc.includes('? returns') || shortDesc.includes('returns :') ||
                      shortDesc.includes('return :') || shortDesc.includes('indicating the')) {
                    shortDesc = '';
                  }
                  
                  // Filter out descriptions that are just command syntax or concatenated commands
                  if (shortDesc.includes(':') && shortDesc.split(':').length > 2 && 
                      !shortDesc.startsWith('CH') && !shortDesc.startsWith('REF') && 
                      !shortDesc.startsWith('MATH') && !shortDesc.startsWith('MEAS') &&
                      !shortDesc.startsWith('SEARCH') && !shortDesc.startsWith('BUS')) {
                    shortDesc = '';
                  }
                  
                  // Filter out pipe-separated gibberish (e.g., "EXTDLC| NETMN| COUNter| DATa|ERRors}")
                  if (shortDesc.includes('|') && shortDesc.split('|').length > 2) {
                    shortDesc = '';
                  }
                  
                  // Filter out overly long or malformed descriptions
                  if (shortDesc.length > 100 || (shortDesc.includes('DISplay:GLObal') && shortDesc.length > 50)) {
                    shortDesc = '';
                  }
                  
                  // Clean up description - remove query response patterns and gibberish
                  let description = cmd.description || '';
                  
                  // Remove query response patterns from description
                  if (description.includes('might return') || description.includes('? might return') ||
                      description.includes('return :') || description.includes('indicating the')) {
                    // Extract the actual description part before "might return" or "return :"
                    const parts = description.split(/might return|returns|return :|indicating the/i);
                    description = parts[0].trim();
                  }
                  
                  // Filter out descriptions that are just concatenated commands
                  if (description.includes('DISplay:GLObal') && description.split(':').length > 5) {
                    description = '';
                  }
                  
                  // Filter out pipe-separated gibberish
                  if (description.includes('|') && description.split('|').length > 2) {
                    description = '';
                  }
                  
                  // Filter out descriptions that are just SCPI command syntax
                  if (description.trim() === scpiCmd || description.trim().startsWith(scpiCmd + ' ')) {
                    description = '';
                  }
                  
                  // Filter out overly long descriptions (likely malformed)
                  if (description.length > 500) {
                    description = description.substring(0, 200) + '...';
                  }
                  
                  // Skip commands with no usable description at all
                  if (!shortDesc && !description) {
                    // Try to generate a basic description from the command structure
                    const parts = scpiCmd.split(':');
                    const lastPart = parts[parts.length - 1];
                    // Generate a simple description based on command structure
                    shortDesc = lastPart.replace(/([A-Z])/g, ' $1').trim() || scpiCmd;
                    description = `Sets or queries ${shortDesc.toLowerCase()}`;
                  } else if (!shortDesc) {
                    // Extract first sentence as short description
                    const firstSentence = description.split('.')[0].trim();
                    shortDesc = firstSentence.length > 80 ? firstSentence.substring(0, 77) + '...' : firstSentence;
                  } else if (!description) {
                    // Use shortDesc as description if description is empty
                    description = shortDesc;
                  }
                  
                  const normalized = normalizeCommandHeader(scpiCmd);
                  
                  // Find existing command
                  const existingIndex = commands.findIndex(c => 
                    normalizeCommandHeader(c.scpi) === normalized
                  );
                  
                  // Parse SCPI structure
                  const parsed = scpiCmd ? parseSCPI(scpiCmd) : undefined;
                  const editableParams = parsed ? detectEditableParameters(parsed) : undefined;
                  
                  // Clean manualEntry - ensure examples is an array
                  let cleanManualEntry = cmd._manualEntry || cmd;
                  if (cleanManualEntry && !Array.isArray(cleanManualEntry.examples)) {
                    // Convert examples string to array format
                    if (typeof cleanManualEntry.examples === 'string') {
                      const exampleLines = cleanManualEntry.examples.split('\n').filter((line: string) => line.trim());
                      cleanManualEntry = {
                        ...cleanManualEntry,
                        examples: exampleLines.map((line: string, i: number) => ({
                          description: `Example ${i + 1}`,
                          codeExamples: {
                            scpi: { code: line.trim() }
                          }
                        }))
                      };
                    } else {
                      cleanManualEntry = {
                        ...cleanManualEntry,
                        examples: []
                      };
                    }
                  }
                  // Remove instruments field if present
                  if (cleanManualEntry && cleanManualEntry.instruments) {
                    cleanManualEntry = { ...cleanManualEntry, instruments: undefined };
                  }
                  
                  // Map params from new format (cmd.params) or old format (cmd.arguments)
                  const mapParams = (params: any[]): CommandParam[] => {
                    if (!Array.isArray(params)) return [];
                    const normalizeType = (t: string): CommandParam['type'] => {
                      const type = (t || '').toLowerCase();
                      if (['enumeration', 'enum', 'boolean', 'bool'].includes(type)) return 'enumeration';
                      if (['number', 'numeric', 'integer', 'floating_point', 'nr1', 'nr2', 'nr3', 'float'].includes(type)) return 'number';
                      // Treat everything else as text for UI input
                      return 'text';
                    };
                    return params.map((param: any) => {
                      // New format: { name, type, required, default, options, description }
                      if (param.name && param.type) {
                        return {
                          name: param.name,
                          type: normalizeType(param.type),
                          default: param.default,
                          required: param.required || false,
                          options: param.options || param.validValues?.values || param.validValues?.examples || [],
                          description: param.description,
                          inputType: param.inputType,
                          min: param.min,
                          max: param.max,
                          unit: param.unit,
                        };
                      }
                      // Old format: { name, type, defaultValue, required, validValues }
                      return {
                        name: param.name,
                        type: normalizeType(param.type),
                        default: param.defaultValue,
                        required: param.required,
                        options: param.validValues?.values || param.validValues?.examples || [],
                        min: param.validValues?.min,
                        max: param.validValues?.max,
                        unit: param.validValues?.unit,
                        description: param.description,
                        inputType: param.inputType,
                      };
                    });
                  };
                  
                  // Extract parameters using syntax parser if available
                  let finalParams = mapParams(cmd.params || cmd.arguments || []);
                  if (finalParams.length === 0 && cleanManualEntry) {
                    // Try to extract from syntax
                    const extractedParams = extractCommandParameters({
                      scpi: scpiCmd,
                      manualEntry: cleanManualEntry,
                      params: []
                    });
                    if (extractedParams.length > 0) {
                      finalParams = extractedParams;
                    }
                  }
                  
                  const commandItem: CommandLibraryItem = {
                    sourceFile: (cmd as any).sourceFile || file, // Tag with source file
                    name: shortDesc || scpiCmd,
                    scpi: scpiCmd,
                    description: description || shortDesc || `SCPI command: ${scpiCmd}`,
                    category: categoryName,
                    subcategory: cmd.subcategory,
                    params: finalParams,
                    example: cmd.examples?.[0]?.code || cmd.codeExamples?.[0]?.codeExamples?.python?.code || cmd.codeExamples?.[0]?.codeExamples?.scpi?.code,
                    tekhsi: false,
                    scpiStructure: parsed,
                    editableParameters: editableParams,
                    manualReference: cmd.manualReference || { section: groupName },
                    manualEntry: cleanManualEntry as any,
                  };
                  
                  // Final validation - skip commands with completely unusable data
                  const hasReturnPattern = commandItem.description.includes('return :') || 
                                          commandItem.description.includes('indicating the') ||
                                          commandItem.name.includes('return :') ||
                                          commandItem.name.includes('indicating the');
                  const hasPipeGibberish = (commandItem.description.includes('|') && commandItem.description.split('|').length > 2) ||
                                          (commandItem.name.includes('|') && commandItem.name.split('|').length > 2);
                  const isJustScpiCommand = commandItem.description === `SCPI command: ${scpiCmd}` && 
                                           commandItem.name === scpiCmd;
                  
                  // Additional check: skip if description is just the SCPI command repeated
                  const isJustCommandRepeated = commandItem.description.toLowerCase().includes(scpiCmd.toLowerCase()) && 
                                               commandItem.description.length < scpiCmd.length + 20 &&
                                               !commandItem.description.toLowerCase().includes('sets or queries');
                  
                  if (hasReturnPattern || hasPipeGibberish || isJustScpiCommand || isJustCommandRepeated) {
                    // Skip this command - it's too malformed or has no useful data
                    return;
                  }
                  
                  if (existingIndex >= 0) {
                    // Merge with existing command, but only if new data is better
                    const existing = commands[existingIndex];
                    const newDesc = commandItem.description && 
                                   !commandItem.description.includes('return :') &&
                                   !commandItem.description.includes('indicating the') &&
                                   !commandItem.description.includes('|') &&
                                   commandItem.description.length < 200 &&
                                   commandItem.description !== `SCPI command: ${scpiCmd}`;
                    const newName = shortDesc && 
                                   shortDesc.length < 100 && 
                                   !shortDesc.includes(':') &&
                                   !shortDesc.includes('|') &&
                                   !shortDesc.includes('return :') &&
                                   !shortDesc.includes('indicating the');
                    
                    commands[existingIndex] = {
                      ...existing,
                      ...commandItem,
                      description: newDesc ? commandItem.description : existing.description,
                      name: newName ? shortDesc : existing.name,
                      manualEntry: commandItem.manualEntry || existing.manualEntry,
                    };
                    enhancedCount++;
                  } else {
                    commands.push(commandItem);
                    loadedCommandIds.add(normalized);
                    addedCount++;
                  }
                });
              });
              
              const totalCommands = Object.values(data.groups).reduce((sum: number, group: any) => 
                sum + (Array.isArray(group.commands) ? group.commands.length : 0), 0);
              console.log(`Loaded ${totalCommands} commands from ${file} (${addedCount} new, ${enhancedCount} enhanced)`, {
                groups: Object.keys(data.groups).length,
                metadata: data.metadata
              });
            } else if (data.commands && Array.isArray(data.commands)) {
              // Enhanced format (mso_commands_final.json) or simple format (tekexpress.json, dpojet.json)
              // Load categories and colors
              if (data.categories && Array.isArray(data.categories)) {
                data.categories.forEach((cat: any) => {
                  colors[cat.id || cat.name] = cat.color;
                });
              }
              
              // Simple format: single category at root level (e.g., tekexpress.json, dpojet.json)
              const rootCategory = data.category || null;
              const rootColor = data.color || null;
              if (rootCategory && rootColor) {
                colors[rootCategory] = rootColor;
              }
              
              // Load commands - merge with existing or add new
              let addedCount = 0;
              let enhancedCount = 0;
              
              data.commands.forEach((cmd: any) => {
                const scpiCmd = cmd.scpi || cmd.header;
                if (!scpiCmd) return;
                
                // Clean up malformed shortDescription - filter out query responses and gibberish
                let shortDesc = cmd.shortDescription || cmd.name || cmd.id || '';
                
                // Filter out query response patterns
                if (shortDesc.includes('might return') || shortDesc.includes('? might return') || 
                    shortDesc.includes('? returns') || shortDesc.includes('returns :')) {
                  shortDesc = '';
                }
                
                // Filter out descriptions that are just command syntax
                if (shortDesc.includes(':') && shortDesc.split(':').length > 2 && 
                    !shortDesc.startsWith('CH') && !shortDesc.startsWith('REF') && 
                    !shortDesc.startsWith('MATH') && !shortDesc.startsWith('MEAS')) {
                  shortDesc = '';
                }
                
                // Filter out overly long descriptions
                if (shortDesc.length > 100) {
                  shortDesc = '';
                }
                
                // Clean up description
                let description = cmd.description || '';
                if (description.includes('might return') || description.includes('? might return')) {
                  const parts = description.split(/might return|returns/);
                  description = parts[0].trim();
                }
                if (description.length > 500) {
                  description = description.substring(0, 200) + '...';
                }
                
                // Use SCPI command as fallback if no good description
                if (!shortDesc && !description) {
                  shortDesc = scpiCmd;
                  description = `SCPI command: ${scpiCmd}`;
                } else if (!shortDesc) {
                  shortDesc = description.split('.')[0].substring(0, 80);
                }
                
                const normalized = normalizeCommandHeader(scpiCmd);
                
                // Find existing command
                const existingIndex = commands.findIndex(c => 
                  normalizeCommandHeader(c.scpi) === normalized
                );
                
                // Parse SCPI structure
                const parsed = scpiCmd ? parseSCPI(scpiCmd) : undefined;
                const editableParams = parsed ? detectEditableParameters(parsed) : undefined;
                
                // Determine category: use cmd.category, then categoryInfo from categories array, then rootCategory
                const categoryInfo = data.categories?.find((c: any) => (c.id || c.name) === cmd.category);
                const categoryName = categoryInfo?.name || cmd.category || rootCategory || 'miscellaneous';
                
                // Remove instruments field from manualEntry
                const cleanManualEntry = cmd.instruments ? { ...cmd, instruments: undefined } : cmd;
                
                // Map params from new format (cmd.params) or old format (cmd.arguments)
                const mapParams = (params: any[]): CommandParam[] => {
                  if (!Array.isArray(params)) return [];
                  const normalizeType = (t: string): CommandParam['type'] => {
                    const type = (t || '').toLowerCase();
                    if (['enumeration', 'enum', 'boolean', 'bool'].includes(type)) return 'enumeration';
                    if (['number', 'numeric', 'integer', 'floating_point', 'nr1', 'nr2', 'nr3', 'float'].includes(type)) return 'number';
                    return 'text';
                  };
                  return params.map((param: any) => {
                    // New format: { name, type, required, default, options, description }
                    if (param.name && param.type) {
                      return {
                        name: param.name,
                        type: normalizeType(param.type),
                        default: param.default,
                        required: param.required || false,
                        options: param.options || param.validValues?.values || param.validValues?.examples || [],
                        description: param.description,
                        inputType: param.inputType,
                        min: param.min,
                        max: param.max,
                        unit: param.unit,
                      };
                    }
                    // Old format: { name, type, defaultValue, required, validValues }
                    return {
                      name: param.name,
                      type: normalizeType(param.type),
                      default: param.defaultValue,
                      required: param.required,
                      options: param.validValues?.values || param.validValues?.examples || [],
                      min: param.validValues?.min,
                      max: param.validValues?.max,
                      unit: param.validValues?.unit,
                      description: param.description,
                      inputType: param.inputType,
                    };
                  });
                };
                
                // Extract parameters using syntax parser if available
                let finalParams = mapParams(cmd.params || cmd.arguments || []);
                if (finalParams.length === 0 && cleanManualEntry) {
                  // Try to extract from syntax
                  const extractedParams = extractCommandParameters({
                    scpi: scpiCmd,
                    manualEntry: cleanManualEntry,
                    params: []
                  });
                  if (extractedParams.length > 0) {
                    finalParams = extractedParams;
                  }
                }
                
                const commandItem: CommandLibraryItem = {
                  name: cmd.name || shortDesc || scpiCmd,
                  scpi: scpiCmd,
                  description: description || shortDesc || scpiCmd,
                  category: categoryName,
                  subcategory: cmd.subcategory,
                  params: finalParams,
                  example: cmd.example || cmd.codeExamples?.[0]?.codeExamples?.python?.code || cmd.codeExamples?.[0]?.codeExamples?.scpi?.code,
                  tekhsi: false,
                  sourceFile: file, // Tag with source file for dropdown filtering
                  scpiStructure: parsed,
                  editableParameters: editableParams,
                  manualReference: cmd.manualReference,
                  manualEntry: cleanManualEntry as any,
                };
                
                if (existingIndex >= 0) {
                  // Merge with existing command (enhance it with detailed data)
                  commands[existingIndex] = {
                    ...commands[existingIndex],
                    ...commandItem,
                    // Keep original description if enhanced one is empty or malformed
                    description: (commandItem.description && commandItem.description.length < 200) 
                      ? commandItem.description 
                      : commands[existingIndex].description,
                    // Keep better name
                    name: (shortDesc && shortDesc.length < 100 && !shortDesc.includes(':')) 
                      ? shortDesc 
                      : commands[existingIndex].name,
                    // Merge manualEntry if it has more data
                    manualEntry: commandItem.manualEntry || commands[existingIndex].manualEntry,
                  };
                  enhancedCount++;
                } else {
                  // New command, add it
                  commands.push(commandItem);
                  loadedCommandIds.add(normalized);
                  addedCount++;
                }
              });
              
              console.log(`Loaded ${data.commands.length} commands from ${file} (${addedCount} new, ${enhancedCount} enhanced)`);
            }
          } catch (err) {
            console.error(`Failed to load complete command file ${file}:`, err);
          }
        }
        
        // STEP 2: Load detailed mso_commands.json (for enhanced data)
        try {
          const msoResponse = await fetch('/commands/mso_commands.json');
          if (msoResponse.ok) {
            const msoData: any = await msoResponse.json();
            
            if (msoData.categories && Array.isArray(msoData.categories)) {
              // Load categories and colors
              msoData.categories.forEach((cat: any) => {
                colors[cat.id || cat.name] = cat.color;
              });
              
              // Merge detailed command data into existing commands
              msoData.commands.forEach((cmd: any) => {
                const scpiCmd = cmd.scpi || cmd.header;
                const normalized = normalizeCommandHeader(scpiCmd);
                
                // Find existing command or create new one
                const existingIndex = commands.findIndex(c => 
                  normalizeCommandHeader(c.scpi) === normalized
                );
                
                const categoryInfo = msoData.categories.find((c: any) => (c.id || c.name) === cmd.category);
                
                // Parse SCPI structure
                const parsed = scpiCmd ? parseSCPI(scpiCmd) : undefined;
                const editableParams = parsed ? detectEditableParameters(parsed) : undefined;
                
                // Map params from new format (cmd.params) or old format (cmd.arguments)
                const mapParams = (params: any[]): CommandParam[] => {
                  if (!Array.isArray(params)) return [];
                  const normalizeType = (t: string): CommandParam['type'] => {
                    const type = (t || '').toLowerCase();
                    if (['enumeration', 'enum', 'boolean', 'bool'].includes(type)) return 'enumeration';
                    if (['number', 'numeric', 'integer', 'floating_point', 'nr1', 'nr2', 'nr3', 'float'].includes(type)) return 'number';
                    return 'text';
                  };
                  return params.map((param: any) => {
                    // New format: { name, type, required, default, options, description }
                    if (param.name && param.type) {
                      return {
                        name: param.name,
                        type: normalizeType(param.type),
                        default: param.default,
                        required: param.required || false,
                        options: param.options || param.validValues?.values || param.validValues?.examples || [],
                        description: param.description,
                      };
                    }
                    // Old format: { name, type, defaultValue, required, validValues }
                    return {
                      name: param.name,
                      type: normalizeType(param.type),
                      default: param.defaultValue,
                      required: param.required,
                      options: param.validValues?.values || param.validValues?.examples || [],
                      min: param.validValues?.min,
                      max: param.validValues?.max,
                      unit: param.validValues?.unit,
                      description: param.description,
                    };
                  });
                };
                
                const enhancedCommand: CommandLibraryItem = {
                  name: cmd.name || cmd.shortDescription || cmd.id || scpiCmd,
                  scpi: scpiCmd,
                  description: cmd.description || cmd.shortDescription || '',
                  category: categoryInfo?.name || cmd.category || 'miscellaneous',
                  subcategory: cmd.subcategory,
                  params: mapParams(cmd.params || cmd.arguments || []),
                  example: cmd.codeExamples?.[0]?.codeExamples?.python?.code || cmd.codeExamples?.[0]?.codeExamples?.scpi?.code,
                  tekhsi: false,
                  sourceFile: (cmd as any).sourceFile || 'mso_commands.json', // Preserve source file from original command or use mso_commands.json
                  scpiStructure: parsed,
                  editableParameters: editableParams,
                  manualReference: cmd.manualReference,
                  manualEntry: cmd as any,
                };
                
                if (existingIndex >= 0) {
                  // Merge with existing command (enhance it)
                  commands[existingIndex] = {
                    ...commands[existingIndex],
                    ...enhancedCommand,
                    // Keep original description if enhanced one is empty
                    description: enhancedCommand.description || commands[existingIndex].description,
                    // Keep source file if it exists
                    sourceFile: enhancedCommand.sourceFile || commands[existingIndex].sourceFile,
                  };
                } else {
                  // New command, add it
                  commands.push(enhancedCommand);
                  loadedCommandIds.add(normalized);
                }
              });
            }
          }
        } catch (err) {
          console.error('Failed to load mso_commands.json:', err);
        }
        
        // STEP 3: Load legacy command files, skipping duplicates
        for (const file of COMMAND_FILES) {
          // Skip files we've already processed
          if (file === 'mso_commands.json') continue;
          
          try {
            const response = await fetch(`/commands/${file}`);
            if (!response.ok) continue;
            const data: any = await response.json();
            
            // Old format: { category: "...", color: "...", commands: [...] }
            if (!data.categories) {
              colors[data.category] = data.color;
              data.commands.forEach((cmd: any) => {
                const cmdScpi = cmd.scpi || '';
                const normalized = normalizeCommandHeader(cmdScpi);
                
                // Skip if already loaded from complete or detailed files
                if (loadedCommandIds.has(normalized)) {
                  return; // Skip duplicate
                }
                
                commands.push({ 
                  ...cmd, 
                  category: data.category, 
                  subcategory: data.subcategory,
                  tekhsi: data.category === 'TekHSI',
                  scpiStructure: cmd.scpi ? parseSCPI(cmd.scpi) : undefined,
                  editableParameters: cmd.scpi ? detectEditableParameters(parseSCPI(cmd.scpi)) : undefined,
                });
                
                loadedCommandIds.add(normalized);
              });
            }
          } catch (err) {
            console.error(`Failed to load command file ${file}:`, err);
          }
        }
        
        setCommandLibrary(commands);
        
        // Update loaded files
        setLoadedFiles(successfullyLoadedFiles);
        setCategoryColors(colors);

        const templates: Template[] = [];
        for (const file of TEMPLATE_FILES) {
          try {
            const response = await fetch(`/templates/${file}`);
            if (!response.ok) {
              console.error(`Failed to fetch template ${file}: ${response.status}`);
              continue;
            }
            const data: TemplateFile = await response.json();
            console.log(`Loaded template file ${file}:`, data);
            templates.push(...data.templates);
          } catch (err) {
            console.error(`Failed to load template file ${file}:`, err);
          }
        }
        setBuiltInTemplates(templates);
        console.log(`Total templates loaded: ${templates.length}`);
        setLoading(false);
        if (commands.length === 0) setLoadError('No commands loaded. Check public/commands and public/templates.');
      } catch (err) {
        console.error('Fatal error loading data:', err);
        setLoadError('Failed to load command library.');
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Lazy load large command files when device family is selected
  const [lazyLoadedFiles, setLazyLoadedFiles] = useState<Set<string>>(new Set());
  const [lazyLoading, setLazyLoading] = useState(false);
  
  useEffect(() => {
    const loadLazyFile = async (file: string) => {
      if (lazyLoadedFiles.has(file)) return; // Already loaded
      
      console.log(`Lazy loading ${file}...`);
      setLazyLoading(true);
      
      try {
        const response = await fetch(`/commands/${file}`);
        if (!response.ok) {
          console.error(`Failed to fetch ${file}`);
          setLazyLoading(false);
          return;
        }
        const data: any = await response.json();
        
        const newCommands: CommandLibraryItem[] = [];
        const newColors: Record<string, string> = {};
        const existingIds = new Set(commandLibrary.map(cmd => normalizeCommandHeader(cmd.scpi)));
        
        if (data.groups && typeof data.groups === 'object') {
          Object.entries(data.groups).forEach(([groupName, groupData]: [string, any]) => {
            if (!groupData || !Array.isArray(groupData.commands)) return;
            
            const rawCategoryName = groupName || 'miscellaneous';
            const categoryName = normalizeCategoryName(rawCategoryName);
            
            if (!newColors[categoryName] && !categoryColors[categoryName]) {
              newColors[categoryName] = groupData.color || DEFAULT_CATEGORY_COLORS[categoryName.toLowerCase()] || DEFAULT_CATEGORY_COLORS['miscellaneous'];
            }
            
            groupData.commands.forEach((cmd: any) => {
              const scpiCmd = cmd.scpi || cmd.header;
              if (!scpiCmd) return;
              
              const normalized = normalizeCommandHeader(scpiCmd);
              if (existingIds.has(normalized)) return; // Skip duplicates
              existingIds.add(normalized);
              
              const parsed = scpiCmd ? parseSCPI(scpiCmd) : undefined;
              const editableParams = parsed ? detectEditableParameters(parsed) : undefined;
              
              const shortDesc = cmd.name || cmd.short_description || cmd.shortDescription || cmd.id || '';
              const description = cmd.description || cmd.long_description || cmd.longDescription || cmd.shortDescription || '';
              
              const mapParams = (params: any[]): CommandParam[] => {
                if (!Array.isArray(params)) return [];
                return params.map((param: any) => ({
                  name: param.name,
                  type: (param.type?.toLowerCase() || 'text') as CommandParam['type'],
                  default: param.default || param.defaultValue,
                  required: param.required || false,
                  options: param.options || param.validValues?.values || [],
                }));
              };
              
              const commandItem: CommandLibraryItem = {
                name: shortDesc || scpiCmd,
                scpi: scpiCmd,
                description: description || `SCPI command: ${scpiCmd}`,
                category: categoryName,
                subcategory: cmd.subcategory,
                params: mapParams(cmd.params || cmd.arguments || []),
                tekhsi: false,
                sourceFile: file,
                scpiStructure: parsed,
                editableParameters: editableParams,
                manualReference: cmd.manualReference,
                manualEntry: cmd as any,
              };
              
              newCommands.push(commandItem);
            });
          });
        }
        
        if (newCommands.length > 0) {
          setCommandLibrary(prev => [...prev, ...newCommands]);
          setCategoryColors(prev => ({ ...prev, ...newColors }));
          console.log(`Lazy loaded ${newCommands.length} commands from ${file}`);
        }
        
        setLazyLoadedFiles(prev => new Set(Array.from(prev).concat(file)));
        setLoadedFiles(prev => new Set(Array.from(prev).concat(file)));
      } catch (err) {
        console.error(`Failed to lazy load ${file}:`, err);
      }
      
      setLazyLoading(false);
    };
    
    // Map device family to file
    const familyToFile: Record<string, string> = {
      '4/5/6 Series': 'mso_2_4_5_6_7.json',
      'DPO/MSO 5k_7k_70K': 'MSO_DPO_5k_7k_70K.json',
    };
    
    const fileToLoad = familyToFile[selectedDeviceFamily];
    if (fileToLoad && LAZY_LOAD_FILES.includes(fileToLoad)) {
      loadLazyFile(fileToLoad);
    }
  }, [selectedDeviceFamily, lazyLoadedFiles, commandLibrary, categoryColors]);

  const moveStep = (id: string, delta: -1 | 1) => {
    const mutate = (arr: Step[]): Step[] => {
      const idx = arr.findIndex((s) => s.id === id);
      if (idx !== -1) {
        const next = [...arr];
        const newIdx = Math.max(0, Math.min(arr.length - 1, idx + delta));
        if (newIdx !== idx) {
          const [it] = next.splice(idx, 1);
          next.splice(newIdx, 0, it);
        }
        return next;
      }
      return arr.map((s) => (s.children ? { ...s, children: mutate(s.children) } : s));
    };
    commit(mutate(steps));
  };

  const moveUp = (id: string) => moveStep(id, -1);
  const moveDown = (id: string) => moveStep(id, 1);

  const openCommandBrowser = (callback: (cmd: CommandLibraryItem) => void) => {
    triggerControls.triggerAnimation('search');
    setCommandBrowserCallback(() => callback);
    setShowCommandBrowser(true);
  };

  const addStep = (type: StepType, parentId?: string) => {
    const newStep: Step = {
      id: crypto.randomUUID(),
      type,
      label: STEP_PALETTE.find((s) => s.type === type)?.label || type,
      params:
        type === 'sleep' ? { duration: 0.5 } :
        type === 'comment' ? { text: '' } :
        type === 'python' ? { code: '' } :
        type === 'query' ? { command: '*IDN?', cmdParams: [], paramValues: {} } :
        type === 'write' ? { command: '', cmdParams: [], paramValues: {} } :
        type === 'set_and_query' ? { command: '', cmdParams: [], paramValues: {} } :
        type === 'save_waveform' ? { source: 'CH1', filename: 'data.bin', command: '', width: 1, encoding: 'RIBinary', start: 1, stop: null, format: 'bin' } :
        type === 'error_check' ? { command: 'ALLEV?' } :
        type === 'connect' ? { instrumentId: devices[0]?.id || '', instrumentIds: [], printIdn: false } :
        type === 'disconnect' ? { instrumentId: '', instrumentIds: [] } :
        type === 'sweep' ? { variableName: 'value', start: 0, stop: 10, step: 1, saveResults: false, resultVariable: '' } : {},
      children: (type === 'group' || type === 'sweep') ? [] : undefined,
      collapsed: false
    };

    // Animations are triggered on click in the button handler, not here
    // This prevents double-triggering

    const insert = (items: Step[]): Step[] =>
      items.map((item) => {
        if (item.id === parentId && item.type === 'group') {
          return { ...item, children: [...(item.children || []), newStep] };
        }
        if (item.children) return { ...item, children: insert(item.children) };
        return item;
      });

    if (parentId) commit(insert(steps));
    else commit([...steps, newStep]);
    setSelectedStep(newStep.id);
  };
  const deleteStep = (id: string) => {
    const prune = (items: Step[]): Step[] =>
      items.filter((i) => i.id !== id).map((i) => (i.children ? { ...i, children: prune(i.children) } : i));
    commit(prune(steps));
    if (selectedStep === id) setSelectedStep(null);
  };

  const duplicateStep = (id: string) => {
    // Deep clone function that generates new IDs
    const deepCloneWithNewIds = (step: Step): Step => {
      const cloned: Step = {
        ...step,
        id: crypto.randomUUID(),
        children: step.children ? step.children.map(deepCloneWithNewIds) : undefined
      };
      return cloned;
    };

    // Find the step to duplicate
    const findAndDuplicate = (items: Step[]): Step[] => {
      const result: Step[] = [];
      for (let i = 0; i < items.length; i++) {
        result.push(items[i]);
        if (items[i].id === id) {
          // Insert duplicate right after the original
          result.push(deepCloneWithNewIds(items[i]));
        }
        if (items[i].children) {
          items[i] = { ...items[i], children: findAndDuplicate(items[i].children!) };
        }
      }
      return result;
    };

    commit(findAndDuplicate(steps));
  };

  const updateStep = (id: string, updates: Partial<Step>) => {
    const update = (items: Step[]): Step[] =>
      items.map((i) => {
        if (i.id === id) return { ...i, ...updates };
        if (i.children) return { ...i, children: update(i.children) };
        return i;
      });
    commit(update(steps));
  };

  // Get all step IDs in display order (flattened)
  const getAllStepIds = useCallback((stepList: Step[]): string[] => {
    const ids: string[] = [];
    const collect = (items: Step[]) => {
      for (const step of items) {
        ids.push(step.id);
        if (step.children && !step.collapsed) {
          collect(step.children);
        }
      }
    };
    collect(stepList);
    return ids;
  }, []);

  // Handle step selection with shift/ctrl support
  const handleStepClick = useCallback((stepId: string, e: React.MouseEvent) => {
    const allIds = getAllStepIds(steps);
    
    if (e.shiftKey && lastSelectedStep) {
      // Shift+click: select range
      const lastIdx = allIds.indexOf(lastSelectedStep);
      const currentIdx = allIds.indexOf(stepId);
      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);
        const rangeIds = allIds.slice(start, end + 1);
        setSelectedSteps(rangeIds);
        setSelectedStep(stepId);
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle individual selection
      setSelectedSteps(prev => {
        if (prev.includes(stepId)) {
          return prev.filter(id => id !== stepId);
        } else {
          return [...prev, stepId];
        }
      });
      setSelectedStep(stepId);
      setLastSelectedStep(stepId);
    } else {
      // Normal click: single selection
      setSelectedSteps([stepId]);
      setSelectedStep(stepId);
      setLastSelectedStep(stepId);
    }
  }, [steps, lastSelectedStep, getAllStepIds]);

  // Group selected steps
  const groupSelectedSteps = useCallback(() => {
    if (selectedSteps.length < 2) return;
    
    // Find the steps to group (only top-level for now)
    const stepsToGroup = steps.filter(s => selectedSteps.includes(s.id));
    if (stepsToGroup.length < 2) return;
    
    // Find the position of the first selected step
    const firstIdx = steps.findIndex(s => selectedSteps.includes(s.id));
    
    // Create new group
    const newGroup: Step = {
      id: crypto.randomUUID(),
      type: 'group',
      label: 'New Group',
      params: {},
      children: stepsToGroup,
      collapsed: false
    };
    
    // Remove grouped steps and insert group at first position
    const newSteps = steps.filter(s => !selectedSteps.includes(s.id));
    newSteps.splice(firstIdx, 0, newGroup);
    
    commit(newSteps);
    setSelectedSteps([]);
    setSelectedStep(newGroup.id);
  }, [selectedSteps, steps, commit]);

  // Keyboard handler for alt+arrow movement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if we have a selected step and alt is pressed
      if (!selectedStep || !e.altKey) return;
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveUp(selectedStep);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveDown(selectedStep);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStep]);

  // Collect all saveAs variable names from steps (including nested groups)
  const collectSaveAsVariables = useCallback((stepList: Step[]): { name: string; stepId: string; label: string }[] => {
    const variables: { name: string; stepId: string; label: string }[] = [];
    
    const collect = (items: Step[]) => {
      for (const step of items) {
        if (step.params?.saveAs && typeof step.params.saveAs === 'string' && step.params.saveAs.trim()) {
          variables.push({ 
            name: step.params.saveAs.trim(), 
            stepId: step.id,
            label: step.label || step.type
          });
        }
        if (step.children && step.children.length > 0) {
          collect(step.children);
        }
      }
    };
    
    collect(stepList);
    return variables;
  }, []);

  // Check for duplicate variable names (case-insensitive)
  const findDuplicateVariables = useCallback((stepList: Step[]): string[] => {
    const variables = collectSaveAsVariables(stepList);
    const seen = new Map<string, { count: number; original: string }>();
    const duplicates: string[] = [];
    
    for (const v of variables) {
      const lowerName = v.name.toLowerCase();
      const existing = seen.get(lowerName);
      if (existing) {
        existing.count++;
        if (existing.count === 2) {
          duplicates.push(v.name); // Return original casing
        }
      } else {
        seen.set(lowerName, { count: 1, original: v.name });
      }
    }
    
    return duplicates;
  }, [collectSaveAsVariables]);

  // Validate variables whenever steps change
  useEffect(() => {
    const duplicates = findDuplicateVariables(steps);
    if (duplicates.length > 0) {
      // If mascot is hidden, temporarily show it for the error
      if (!showMascot) {
        setMascotTemporarilyShown(true);
      }
      triggerControls.error(`Duplicate variable: ${duplicates[0]}`);
    }
  }, [steps, findDuplicateVariables, triggerControls, showMascot]);

  const handleDragStart = (e: React.DragEvent, stepId: string) => {
    // If multiple steps are selected and this is one of them, drag all selected steps
    if (selectedSteps.length > 1 && selectedSteps.includes(stepId)) {
      // Store all selected step IDs in data transfer
      e.dataTransfer.setData('multipleSteps', JSON.stringify(selectedSteps));
      setDraggedStep(stepId); // Still track the primary dragged step
    } else {
      setDraggedStep(stepId);
    }
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, targetId?: string, isGroup?: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (isGroup && targetId) setDragOverGroup(targetId);
  };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOverGroup(null); };
  const handleDrop = (e: React.DragEvent, targetId?: string, isGroup?: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroup(null);
    
    const stepType = e.dataTransfer.getData('stepType') as StepType;
    if (stepType) {
      addStep(stepType, isGroup && targetId ? targetId : undefined);
      return;
    }

    // Check if multiple steps were dragged
    const multipleStepsData = e.dataTransfer.getData('multipleSteps');
    const multipleStepIds = multipleStepsData ? JSON.parse(multipleStepsData) as string[] : null;
    
    if (multipleStepIds && multipleStepIds.length > 1) {
      // Handle multiple steps drag
      const stepsToMove = steps.filter(s => multipleStepIds.includes(s.id));
      
      const remove = (arr: Step[]): Step[] =>
        arr.filter((s) => {
          if (multipleStepIds.includes(s.id)) return false;
          if (s.children) s.children = remove(s.children);
          return true;
        });

      const base = remove([...steps]);
      
      if (isGroup && targetId) {
        const addTo = (arr: Step[]): Step[] =>
          arr.map((s) => {
            if (s.id === targetId && s.type === 'group') {
              return { ...s, children: [...(s.children || []), ...stepsToMove], collapsed: false };
            }
            if (s.children) return { ...s, children: addTo(s.children) };
            return s;
          });
        commit(addTo(base));
      } else if (targetId) {
        const insertNear = (arr: Step[]): Step[] => {
          const idx = arr.findIndex((s) => s.id === targetId);
          if (idx >= 0) {
            const out = [...arr];
            out.splice(idx, 0, ...stepsToMove);
            return out;
          }
          return arr.map((s) => (s.children ? { ...s, children: insertNear(s.children) } : s));
        };
        commit(insertNear(base));
      } else {
        commit([...base, ...stepsToMove]);
      }
      setSelectedSteps([]);
      setDraggedStep(null);
      return;
    }

    // Single step drag (original behavior)
    if (!draggedStep) return;

    let dragged: Step | null = null;
    const remove = (arr: Step[]): Step[] =>
      arr.filter((s) => {
        if (s.id === draggedStep) { dragged = s; return false; }
        if (s.children) s.children = remove(s.children);
        return true;
      });

    const base = remove([...steps]);
    if (!dragged) return;

    if (isGroup && targetId) {
      const addTo = (arr: Step[]): Step[] =>
        arr.map((s) => {
          if (s.id === targetId && s.type === 'group') return { ...s, children: [...(s.children || []), dragged!] };
          if (s.children) return { ...s, children: addTo(s.children) };
          return s;
        });
      commit(addTo(base));
    } else if (targetId) {
      const insertNear = (arr: Step[]): Step[] => {
        const idx = arr.findIndex((s) => s.id === targetId);
        if (idx >= 0) { const out = [...arr]; out.splice(idx, 0, dragged!); return out; }
        return arr.map((s) => (s.children ? { ...s, children: insertNear(s.children) } : s));
      };
      commit(insertNear(base));
    } else {
      commit([...base, dragged]);
    }
    setDraggedStep(null);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategory(prev => prev === category ? null : category);
    setLibraryVisibleCount(50); // Reset visible count when category changes
  };
  
  const toggleBackend = (backend: string) =>
    setSelectedBackends((prev) => (prev.includes(backend) ? prev.filter((b) => b !== backend) : [...prev, backend]));

  const wrapAsGroup = (name: string, items: Step[]): Step => {
    const reid = (s: Step): Step => ({
      ...s,
      id: crypto.randomUUID(),
      children: s.children ? s.children.map(reid) : undefined,
      category: s.category,
      subcategory: s.subcategory
    });
    return { 
      id: crypto.randomUUID(), 
      type: 'group', 
      label: name, 
      params: {}, 
      children: items.map(reid), 
      collapsed: false 
    };
  };

  const loadTemplateAppend = (template: Template) => {
    triggerControls.triggerAnimation('success');
    const reid = (s: Step): Step => ({
      ...s,
      id: crypto.randomUUID(),
      children: s.children ? s.children.map(reid) : undefined
    });
    
    const templateSteps = template.steps.map(reid);
    commit([...steps, wrapAsGroup(template.name, templateSteps)]);
    
    // Auto-select backend from template if specified
    if (template.backend) {
      const targetBackend = template.backend as Backend;
      
      // Update device backend if devices exist
      if (devices.length > 0) {
        // Update first device's backend
        updateDevice(devices[0].id, {
          backend: targetBackend,
          deviceType: template.deviceType || devices[0].deviceType,
          deviceDriver: template.deviceDriver || devices[0].deviceDriver
        });
        
        // Show notification
        window.alert(`Template backend "${targetBackend}" applied to device "${devices[0].alias || 'device'}"`);
      } else {
        // Update config backend if no devices exist
        setConfig({
          ...config,
          backend: targetBackend,
          deviceType: template.deviceType || config.deviceType,
          deviceDriver: template.deviceDriver || config.deviceDriver
        });
        
        // Show notification
        window.alert(`Template backend "${targetBackend}" applied to configuration`);
      }
    }
    
    // Fallback: Check if template steps contain tm_devices commands (for backward compatibility)
    const hasTmDevicesCommands = (() => {
      const checkStep = (s: Step): boolean => {
        if (s.type === 'group' && s.children) {
          return s.children.some(checkStep);
        }
        if ((s.type === 'query' || s.type === 'write') && s.params.command) {
          const cmd = s.params.command || '';
          return cmd.includes('.commands.') || 
                 cmd.includes('.add_') || 
                 cmd.includes('.save_');
        }
        if (s.type === 'python' && s.params?.code) {
          const code = s.params.code || '';
          return code.includes('.commands.') || 
                 code.includes('.add_') || 
                 code.includes('.save_');
        }
        return false;
      };
      return templateSteps.some(checkStep);
    })();
    
    // Check if template steps contain TekHSI commands
    const hasTekHSICommands = (() => {
      const checkStep = (s: Step): boolean => {
        if (s.type === 'group' && s.children) {
          return s.children.some(checkStep);
        }
        if (s.type === 'save_waveform') return true;
        if (s.type === 'python' && s.params?.code) {
          const code = s.params.code || '';
          return (code.includes('scope.') && !code.includes('scope.commands.') && !code.includes('scope.add_') && !code.includes('scope.save_')) || 
                 code.includes('TekHSIConnect') || code.includes('access_data') || code.includes('get_data');
        }
        if (s.type === 'query' || s.type === 'write') {
          const cmd = s.params.command || '';
          return (cmd.startsWith('scope.') && !cmd.includes('.commands.') && !cmd.includes('.add_') && !cmd.includes('.save_')) || cmd.startsWith('#');
        }
        return false;
      };
      return templateSteps.some(checkStep);
    })();
    
    // Fallback logic: Only use command detection if template.backend was not specified
    if (!template.backend) {
      if (hasTmDevicesCommands && hasTekHSICommands) {
        // tm_devices + TekHSI hybrid
        if (devices.length > 0) {
          updateDevice(devices[0].id, { backend: 'hybrid' });
        } else {
          setConfig({ ...config, backend: 'hybrid' });
        }
      } else if (hasTmDevicesCommands) {
        // Only tm_devices commands
        if (devices.length > 0) {
          updateDevice(devices[0].id, {
            backend: 'tm_devices',
            deviceType: template.deviceType || devices[0].deviceType,
            deviceDriver: template.deviceDriver || devices[0].deviceDriver
          });
        } else {
          setConfig({
            ...config,
            backend: 'tm_devices',
            deviceType: template.deviceType || config.deviceType,
            deviceDriver: template.deviceDriver || config.deviceDriver
          });
        }
      } else if (hasTekHSICommands) {
        // Only TekHSI commands - use hybrid (PyVISA + TekHSI)
        if (devices.length > 0) {
          if (devices[0].backend !== 'tm_devices') {
            updateDevice(devices[0].id, { backend: 'hybrid' });
          }
        } else {
          if (config.backend !== 'tm_devices') {
            setConfig({ ...config, backend: 'hybrid' });
          }
        }
      }
    }
    
    setSelectedStep(null);
    setCurrentView('builder');
  };

  const exportTemplate = (template: Template) => {
    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${template.name.replace(/\s+/g, '_')}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev: any) => {
        try { 
          const t: Template = JSON.parse(ev.target.result); 
          // Use functional update to ensure we have the latest state
          setUserTemplates(prev => [...prev, t]); 
          window.alert('Template imported and saved');
        }
        catch { window.alert('Invalid template file'); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const deleteUserTemplate = (index: number) => {
    // Use functional update to get current state
    setUserTemplates(prev => {
      const template = prev[index];
      if (window.confirm(`Are you sure you want to delete template "${template.name}"?`)) {
        return prev.filter((_, i) => i !== index);
      }
      return prev;
    });
  };

  const exportFlowJson = () => {
    const json = JSON.stringify({ steps }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'flow.json'; a.click();
    URL.revokeObjectURL(url);
  };
  
  const importFlowJson = async (file: File, mode: 'append' | 'replace') => {
    const text = await file.text();
    const obj = JSON.parse(text);
    const incoming: Step[] = Array.isArray(obj) ? obj : obj.steps || [];
    if (mode === 'replace') commit(incoming);
    else commit([...steps, wrapAsGroup(file.name.replace(/\.json$/i, ''), incoming)]);
  };

  const addCommandFromLibrary = (cmd: CommandLibraryItem) => {
    // Pre-populate paramValues with defaults from params and examples
    const paramValues: Record<string, any> = {};
    
    if (cmd.params) {
      cmd.params.forEach((p: CommandParam) => {
        // Set default value if available
        // Note: Example values will override these defaults later
        if (p.default !== undefined && p.default !== null && p.default !== '') {
          paramValues[p.name] = p.default;
        }
      });
    }
    
    // Extract example values from SCPI examples and pre-fill paramValues
    // Check multiple possible locations for examples
    const cmdExamples = (cmd as any).examples || (cmd as any).manualEntry?.examples || [];
    // Also check singular 'example' field (string format)
    const singleExample = (cmd as any).example;
    
    if ((cmdExamples.length > 0 || singleExample) && cmd.params && cmd.params.length > 0) {
      // Try both example formats: direct { scpi: "..." } and nested { codeExamples: { scpi: { code: "..." } } }
      let exampleScpi = '';
      
      // First try singular example field (string) - this is the most common format
      if (singleExample && typeof singleExample === 'string' && singleExample.trim()) {
        exampleScpi = singleExample.trim();
      } else if (cmdExamples.length > 0) {
        // Then try examples array
        for (const example of cmdExamples) {
          // Direct format: { scpi: "..." }
          if (example.scpi && typeof example.scpi === 'string' && example.scpi.trim()) {
            exampleScpi = example.scpi.trim();
            break;
          }
          // Nested format: { codeExamples: { scpi: { code: "..." } } }
          if (example.codeExamples?.scpi?.code && typeof example.codeExamples.scpi.code === 'string') {
            exampleScpi = example.codeExamples.scpi.code.trim();
            break;
          }
        }
      }
      
      if (exampleScpi && exampleScpi.trim()) {
        // Extract arguments from example - everything after the command part
        // Simple approach: split by space and take everything after first space
        // This handles cases where example has different mnemonic values than template
        const trimmedExample = exampleScpi.trim();
        const spaceIndex = trimmedExample.indexOf(' ');
        let argsString = '';
        
        if (spaceIndex > 0) {
          // Extract everything after the first space (skip query marker if present)
          argsString = trimmedExample.substring(spaceIndex + 1).trim();
          // Remove query marker if it's at the end
          if (argsString.endsWith('?')) {
            argsString = '';
          }
        }
        
        if (argsString && argsString.length > 0) {
          
          // Tokenize arguments - handle quoted strings, scientific notation, and regular values
          const tokenizeArgs = (text: string): string[] => {
            const tokens: string[] = [];
            let current = '';
            let inQuotes = false;
            let quoteChar = '';
            
            for (let i = 0; i < text.length; i++) {
              const char = text[i];
              
              if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
                if (current.trim()) {
                  tokens.push(current.trim());
                  current = '';
                }
                current += char;
              } else if (char === quoteChar && inQuotes) {
                current += char;
                tokens.push(current);
                current = '';
                inQuotes = false;
                quoteChar = '';
              } else if (char === ' ' && !inQuotes) {
                if (current.trim()) {
                  tokens.push(current.trim());
                  current = '';
                }
              } else {
                current += char;
              }
            }
            
            if (current.trim()) {
              tokens.push(current.trim());
            }
            
            return tokens;
          };
          
          const argTokens = tokenizeArgs(argsString);
          
          // Filter out mnemonic parameters (those that are for <x> placeholders in the command)
          // These are typically named: measurement, source, channel, math, bus, etc.
          // and have descriptions mentioning "<x>" or "where x is"
          const mnemonicParamNames = ['measurement', 'source', 'source_num', 'channel', 'ch', 'bus', 'b', 
            'ref', 'reference', 'meas', 'math', 'cursor', 'search', 'plot', 'zoom', 'view', 
            'plotview', 'power', 'scope', 'histogram', 'callout', 'mask', 'digital_bit', 
            'area', 'd', 'gsource', 'g', 'pg', 'pw', 'amp', 'maxg', 'output'];
          
          // Get only non-mnemonic parameters (actual command arguments)
          const nonMnemonicParams = cmd.params.filter((p: CommandParam) => {
            const nameLower = p.name.toLowerCase();
            // Skip if it's a known mnemonic parameter name
            if (mnemonicParamNames.includes(nameLower)) {
              return false;
            }
            // Skip if description indicates it's for a mnemonic placeholder
            if (p.description && (
              p.description.toLowerCase().includes('<x>') || 
              p.description.toLowerCase().includes('where x is') ||
              p.description.toLowerCase().includes('mnemonic')
            )) {
              return false;
            }
            return true;
          });
          
          // Match argument tokens to non-mnemonic parameters by position
          // Example values should override defaults
          nonMnemonicParams.forEach((param: CommandParam, index: number) => {
            // Get the token at this position
            if (index < argTokens.length) {
              let token = argTokens[index];
              
              // Remove quotes if present
              if ((token.startsWith('"') && token.endsWith('"')) || 
                  (token.startsWith("'") && token.endsWith("'"))) {
                token = token.slice(1, -1);
              }
              
              // Check if token matches parameter type
              // Improved numeric regex to handle scientific notation like 150.0000E-6
              // The regex handles: integers, decimals, and scientific notation (E-6, E+6, e-6, etc.)
              const isNumeric = /^-?\d+\.?\d*([eE][+-]?\d+)?$/.test(token);
              const isEnumeration = param.options && param.options.length > 0;
              
              // For numeric parameters, use the numeric value (override any default)
              if (param.type === 'number' || param.type === 'integer') {
                // Always try to extract numeric value - this handles scientific notation better
                const numericMatch = token.match(/-?\d+\.?\d*([eE][+-]?\d+)?/);
                if (numericMatch) {
                  // Use the matched numeric value (handles cases like "150.0000E-6")
                  paramValues[param.name] = numericMatch[0];
                } else if (isNumeric) {
                  // Fallback to strict regex match
                  paramValues[param.name] = token;
                }
              }
              // For enumeration parameters, check if token matches an option
              else if (isEnumeration && param.options?.includes(token)) {
                paramValues[param.name] = token;
              }
              // For string/text parameters, use the token (with quotes removed)
              else if (param.type === 'string' || param.type === 'text') {
                paramValues[param.name] = token;
              }
              // Default: use the token as-is (override any default)
              else {
                paramValues[param.name] = token;
              }
            }
          });
        }
      }
    }
    
    // Set default trigger_type to 'A' if command has {A|B} pattern
    if (cmd.scpi.includes('{A|B}')) {
      paramValues['trigger_type'] = 'A';
    }
    
    // Determine step type based on commandType from manualEntry or '?' in command
    // Note: Commands with commandType 'both' are added as 'write' (SET) by default
    // Users can transform to set_and_query via right-click context menu
    const commandType = cmd.manualEntry?.commandType || (cmd as any)._manualEntry?.commandType || 'set';
    let stepType: StepType = 'write';
    let finalCommand = cmd.scpi;
    
    if (commandType === 'query') {
      // Query-only command - add '?' if not present
      stepType = 'query';
      if (!cmd.scpi.trim().endsWith('?')) {
        finalCommand = cmd.scpi.trim() + '?';
      }
    } else if (commandType === 'both') {
      // Both set and query - add as write (SET) by default, user can transform to set_and_query
      stepType = cmd.scpi.trim().endsWith('?') ? 'query' : 'write';
    } else {
      // Set command or unknown - check if command has '?'
      stepType = cmd.scpi.trim().endsWith('?') ? 'query' : 'write';
    }
    
    const newStep: Step = {
      id: crypto.randomUUID(),
      type: stepType,
      label: cmd.name,
      params: { 
        command: finalCommand, 
        cmdParams: cmd.params || [], 
        paramValues 
        // Note: saveAs is NOT set by default - user must check the checkbox
      },
      category: cmd.category,
      subcategory: cmd.subcategory
    };
    commit([...steps, newStep]);
    setCurrentView('builder');
    setSelectedStep(newStep.id);
  };

  const substituteSCPI = (scpi: string, paramDefs: CommandParam[] = [], paramValues: Record<string, any> = {}): string => {
    if (!scpi) return scpi;
    
    let result = scpi;
    
    // First, handle {paramName} format
    paramDefs.forEach(p => {
      // Try multiple key variations for case-insensitive lookup
      const value = paramValues[p.name] ?? 
                    paramValues[p.name.toLowerCase()] ?? 
                    paramValues[p.name.charAt(0).toLowerCase() + p.name.slice(1)] ??
                    p.default ?? '';
      if (value !== '' && value !== null && value !== undefined) {
        result = result.replace(new RegExp(`\\{${p.name}\\}`, 'g'), String(value));
      }
    });
    
    // Then, handle <x> placeholders in mnemonics (B<x>, CH<x>, MATH<x>, etc.)
    // Pattern: B<x>, CH<x>, MEAS<x>, MATH<x>, REF<x>, CH<x>_DALL, etc.
    // Also handle special patterns: PG<x>Val, AMP<x>Val, MAXG<x>Voltage, OUTPUT<x>VOLTage, GSOurce<x>, etc.
    // This pattern matches the prefix and <x>, but also captures any suffix
    const placeholderPattern = /([A-Z]+)<x>([_A-Z0-9]*)/gi;
    result = result.replace(placeholderPattern, (match, prefix, suffix) => {
      // Handle special patterns with suffix (PG<x>Val, AMP<x>Val, MAXG<x>Voltage, OUTPUT<x>VOLTage)
      // These have a suffix after <x> that's part of the mnemonic name
      if (suffix && suffix.length > 0 && !suffix.startsWith('_')) {
        // This is a special pattern like PG<x>Val, AMP<x>Val, etc.
        // Try to find a parameter value that matches the full pattern (e.g., "PG1Val", "AMP3Val")
        const fullPattern = `${prefix}<x>${suffix}`.toLowerCase();
        let value = paramValues[fullPattern] || paramValues[prefix.toLowerCase()] || 
                     paramValues['x'] || paramValues[prefix];
        
        // If not found, check if there's a paramDef with a matching name
        if (!value) {
          const matchingParam = paramDefs.find(p => 
            p.name.toLowerCase() === fullPattern ||
            p.name.toLowerCase() === prefix.toLowerCase() ||
            p.name.toLowerCase() === 'x'
          );
          if (matchingParam) {
            value = paramValues[matchingParam.name] ?? matchingParam.default ?? '';
          }
        }
        
        if (value && value !== '') {
          // Extract number from value (e.g., "PG1Val" -> "1", "AMP3Val" -> "3")
          const numberMatch = String(value).match(/\d+/);
          if (numberMatch) {
            return `${prefix}${numberMatch[0]}${suffix}`;
          }
          // If value is just a number, use it directly
          if (/^\d+$/.test(String(value))) {
            return `${prefix}${value}${suffix}`;
          }
        }
        // Default to 1 if no value found
        return `${prefix}1${suffix}`;
      }
      
      // Standard pattern handling (B<x>, CH<x>, GSOurce<x>, etc.)
      // Try to find a parameter value that matches this pattern
      // Check multiple possible parameter names
      const prefixLower = prefix.toLowerCase();
      let value = paramValues[prefixLower] || paramValues['x'] || paramValues[prefix] || 
                   paramValues['bus'] || paramValues['channel'] || paramValues['measurement'] ||
                   paramValues['math'] || paramValues['reference'] || paramValues['callout'] ||
                   paramValues['mask'] || paramValues['digital_bit'] || paramValues['area'] ||
                   paramValues['source'] || paramValues['gsource'];
      
      // Special handling for GSOurce and SOUrce
      if ((prefixLower === 'gsource' || prefixLower === 'source') && !value) {
        // Check for gsource or source in paramValues
        value = paramValues['gsource'] || paramValues['source'] || paramValues['g'] || paramValues['s'];
      }
      
      // If not found, check if there's a paramDef with a matching name
      if (!value) {
        const matchingParam = paramDefs.find(p => 
          p.name.toLowerCase() === prefixLower || 
          p.name.toLowerCase() === 'x' ||
          (prefixLower === 'b' && p.name.toLowerCase().includes('bus')) ||
          (prefixLower === 'ch' && p.name.toLowerCase().includes('channel')) ||
          (prefixLower === 'math' && p.name.toLowerCase().includes('math')) ||
          (prefixLower === 'ref' && p.name.toLowerCase().includes('reference')) ||
          (prefixLower === 'callout' && p.name.toLowerCase().includes('callout')) ||
          (prefixLower === 'mask' && p.name.toLowerCase().includes('mask')) ||
          (prefixLower === 'd' && p.name.toLowerCase().includes('digital')) ||
          (prefixLower === 'gsource' && (p.name.toLowerCase().includes('gsource') || p.name.toLowerCase().includes('source'))) ||
          (prefixLower === 'source' && (p.name.toLowerCase().includes('source') || p.name.toLowerCase().includes('gsource')))
        );
        if (matchingParam) {
          value = paramValues[matchingParam.name] ?? matchingParam.default ?? '';
        }
      }
      
      if (value && value !== '') {
        // Extract number from value (e.g., "B1" -> "1", "BUS1" -> "1", "MATH1" -> "1", "CH1_DALL" -> "1", "GSOurce1" -> "1")
        const numberMatch = String(value).match(/\d+/);
        if (numberMatch) {
          // If suffix contains <x>, we need to handle it (e.g., CH<x>_D<x>)
          if (suffix && suffix.includes('<x>')) {
            // For CH<x>_D<x>, we need to handle the second <x> (digital bit)
            // For now, default to 0 for digital bits
            const digitalBitValue = paramValues['digital_bit'] || paramValues['d'] || '0';
            const digitalBitNum = String(digitalBitValue).match(/\d+/)?.[0] || '0';
            const suffixReplaced = suffix.replace('<x>', digitalBitNum);
            return `${prefix}${numberMatch[0]}${suffixReplaced}`;
          }
          return `${prefix}${numberMatch[0]}${suffix || ''}`;
        }
        // If value is just a number, use it directly
        if (/^\d+$/.test(String(value))) {
          // Handle suffix with <x> if present
          if (suffix && suffix.includes('<x>')) {
            const digitalBitValue = paramValues['digital_bit'] || paramValues['d'] || '0';
            const digitalBitNum = String(digitalBitValue).match(/\d+/)?.[0] || '0';
            const suffixReplaced = suffix.replace('<x>', digitalBitNum);
            return `${prefix}${value}${suffixReplaced}`;
          }
          return `${prefix}${value}${suffix || ''}`;
        }
      }
      return match; // Keep original if no value found
    });
    
    // Handle choice patterns like {CH<x>|MATH<x>|REF<x>} or {A|B}
    // Replace with the selected option
    const choicePattern = /\{([^}]+)\}/g;
    result = result.replace(choicePattern, (match, choices) => {
      // Split choices by |
      const options = choices.split('|').map((opt: string) => opt.trim());
      
      // Special case for {A|B} trigger type
      if (options.length === 2 && options.includes('A') && options.includes('B')) {
        const triggerValue = paramValues['trigger_type'] || paramValues['trigger'] || paramValues['trig'];
        if (triggerValue && (triggerValue === 'A' || triggerValue === 'B')) {
          return triggerValue;
        }
        // Default to 'A' if no value set
        return 'A';
      }
      
      // Try to find which option matches a value in paramValues
      for (const option of options) {
        // Check if this option has a value set
        const optionPrefix = option.match(/^([A-Z]+)/)?.[1];
        if (optionPrefix) {
          const prefixLower = optionPrefix.toLowerCase();
          const value = paramValues[prefixLower] || paramValues[optionPrefix] || 
                       paramValues['source'] || paramValues['channel'] || paramValues['math'] || paramValues['reference'];
          
          if (value && value !== '') {
            // If the option contains <x>, replace it
            if (option.includes('<x>')) {
              const numberMatch = String(value).match(/\d+/);
              if (numberMatch) {
                return option.replace('<x>', numberMatch[0]);
              }
              if (/^\d+$/.test(String(value))) {
                return option.replace('<x>', String(value));
              }
            } else {
              // Use the option as-is if it matches
              return option;
            }
          }
        }
      }
      
      // If no match found, use the first option as default (with <x> replaced if present)
      const firstOption = options[0];
      if (firstOption.includes('<x>')) {
        // Try to get a default value
        const defaultNum = '1';
        return firstOption.replace('<x>', defaultNum);
      }
      return firstOption;
    });
    
    // Append arguments from paramValues that aren't mnemonic placeholders
    // Mnemonic parameters (math, waveview, channel, etc.) are for <x> placeholders in the command path
    // Actual value parameters (value, scale, etc.) should be appended as arguments
    const mnemonicParamNames = [
      'x', 'n', 'math', 'waveview', 'channel', 'ch', 'bus', 'b', 
      'ref', 'reference', 'meas', 'measurement', 'cursor', 'search', 
      'plot', 'zoom', 'view', 'plotview', 'power', 'scope', 'histogram',
      'trigger_type', 'trigger', 'trig', 'callout', 'mask', 'digital_bit', 
      'area', 'd', 'gsource', 'source_num', 'pg', 'pw', 'amp', 'maxg', 'output' // For {A|B} trigger type selection, callout for CALLOUT<x>, mask, digital bit, area, and WBG parameters
      // Note: 'source' is NOT in this list - it can be either a mnemonic (GSOurce<x>) or a command argument (CH1)
      // We'll check the command structure to determine which it is
    ];
    
    // Check if there's a more specific named numeric parameter (not 'value') 
    // that would be the actual command argument (not a mnemonic placeholder)
    // Only skip 'value' if it's ALSO numeric (to avoid duplicates like Offset + value)
    // Don't skip 'value' if it's an enumeration (like ON/OFF) - those are real options
    const valueParam = paramDefs.find(p => p.name.toLowerCase() === 'value');
    const valueIsNumeric = valueParam && (valueParam.type === 'number' || valueParam.type === 'integer');
    
    const hasSpecificNumericParam = valueIsNumeric && paramDefs.some(p => {
      const pNameLower = p.name.toLowerCase();
      return pNameLower !== 'value' && 
        (p.type === 'number' || p.type === 'integer') &&
        !mnemonicParamNames.includes(pNameLower) &&
        !(p.description?.toLowerCase().includes('<x>') || 
          p.description?.toLowerCase().includes('where x is'));
    });
    
    const args: string[] = [];
    const processedParamNames = new Set<string>();
    
    paramDefs.forEach(p => {
      const paramNameLower = p.name.toLowerCase();
      processedParamNames.add(paramNameLower);
      
      // Skip mnemonic placeholder parameters - these are for <x> substitution in the command path
      // Key insight: If a parameter has options (enumeration) or specific values, it's a command argument, not a mnemonic
      // Mnemonics are used for <x> substitution in the command path (like B<x>, CH<x>)
      // Command arguments are values that get appended to the command (like CH1, MATH1, ON, OFF, etc.)
      
      // If parameter has options (enumeration), it's definitely a command argument
      if (p.options && p.options.length > 0) {
        // This is a command argument with specific options - keep it
      } else if (p.type === 'enumeration') {
        // Even if no options listed, if type is enumeration, it's a command argument
      } else {
        // Check if this parameter name appears as a mnemonic pattern in the command path
        const paramNameUpper = paramNameLower.charAt(0).toUpperCase() + paramNameLower.slice(1);
        const mnemonicPatterns = [
          new RegExp(`G${paramNameUpper}(<x>|\\d+)`, 'i'),  // GSOurce<x>
          new RegExp(`${paramNameUpper}(<x>|\\d+)`, 'i'),  // SOUrce<x>, CH<x>, MATH<x>
        ];
        
        // Check if any pattern matches in the command
        const isMnemonicInCommand = mnemonicPatterns.some(pattern => pattern.test(scpi)) ||
                                     mnemonicParamNames.includes(paramNameLower);
        
        // If it's a mnemonic in the command path, skip it (it's handled by <x> substitution)
        if (isMnemonicInCommand) {
          return;
        }
      }
      
      // Skip generic 'value' parameter if there's a more specific numeric parameter
      if (paramNameLower === 'value' && hasSpecificNumericParam) {
        return;
      }
      
      // Also skip if param description indicates it's for a mnemonic placeholder
      if (p.description) {
        const descLower = p.description.toLowerCase();
        if (descLower.includes('<x>') || 
            descLower.includes('where x is') || 
            descLower.includes('waveview') ||
            descLower.includes('math waveform number') ||
            descLower.includes('channel number') ||
            descLower.includes('trigger type') ||
            descLower.includes('a or b')) {
          return;
        }
      }
      
      // Get the value - prefer user-set value, fall back to default
      // Try multiple key variations for case-insensitive lookup
      const value = paramValues[p.name] ?? 
                    paramValues[p.name.toLowerCase()] ?? 
                    paramValues[p.name.charAt(0).toLowerCase() + p.name.slice(1)] ??
                    p.default;
      if (value !== '' && value !== null && value !== undefined) {
        const valueStr = String(value);
        
        const numericPlaceholderRegex = /^<(NR\d*|number|NRx)>$/i;
        // For CUSTom option, use the custom value if available
        if ((valueStr.toUpperCase() === 'CUSTOM') && paramValues[`${p.name}_custom`]) {
          args.push(String(paramValues[`${p.name}_custom`]));
        } else if (numericPlaceholderRegex.test(valueStr)) {
          const numericValue = paramValues[`${p.name}_number`] ?? '1';
          args.push(String(numericValue));
        } else {
          // For string/text parameters, quote the value if it's not already quoted
          // and if it's not an enumeration option
          const isStringType = p.type === 'string' || p.type === 'text';
          const isEnumeration = p.options && p.options.length > 0;
          const isAlreadyQuoted = valueStr.startsWith('"') && valueStr.endsWith('"');
          
          if (isStringType && !isEnumeration && !isAlreadyQuoted) {
            args.push(`"${valueStr}"`);
          } else {
            args.push(valueStr);
          }
        }
      }
    });
    
    // Also collect values from paramValues that are NOT mnemonic parameters
    // This handles cases where paramDefs doesn't include all parameters
    Object.entries(paramValues).forEach(([key, value]) => {
      const keyLower = key.toLowerCase();
      // Skip if already processed
      if (processedParamNames.has(keyLower)) {
        return;
      }
      
      // Check if this parameter name appears as a mnemonic in the command path
      const isMnemonicInCommand = (() => {
        const paramNameUpper = keyLower.charAt(0).toUpperCase() + keyLower.slice(1);
        const mnemonicPatterns = [
          new RegExp(`G${paramNameUpper}(<x>|\\d+)`, 'i'),
          new RegExp(`${paramNameUpper}(<x>|\\d+)`, 'i'),
        ];
        
        for (const pattern of mnemonicPatterns) {
          if (pattern.test(scpi)) {
            return true;
          }
        }
        
        if (mnemonicParamNames.includes(keyLower)) {
          return true;
        }
        
        return false;
      })();
      
      if (isMnemonicInCommand) {
        return; // It's a mnemonic, skip it
      }
      // Skip special keys (custom values, number values for placeholders)
      if (key.endsWith('_custom') || key.endsWith('_number')) {
        return;
      }
      // Skip empty values
      if (value === '' || value === null || value === undefined) {
        return;
      }
      const valueStr = String(value);
      // Skip placeholder values
      if (/^<(NR\d*|number|NRx|QString)>$/i.test(valueStr)) {
        return;
      }
      // Add to args if not already there
      if (!args.includes(valueStr)) {
        args.push(valueStr);
      }
    });
    
    // Append arguments to command if not a query
    // For write commands, we need to append the value argument
    if (!result.endsWith('?')) {
      // Split command into header and existing arguments
      const parts = result.split(/\s+/);
      const headerOnly = parts[0];
      const hasExistingNumericValue = parts.length > 1 && 
                                      /^-?\d+\.?\d*([eE][+-]?\d+)?$/.test(parts[1]);
      
      // Check if there's a value parameter that should replace any existing numeric value
      // This handles cases where the command template has a default value (e.g., "COMMAND 1")
      // but paramValues has a different value (e.g., "150.0000E-6") that should replace it
      const valueParam = paramDefs.find(p => p.name.toLowerCase() === 'value');
      const valueFromParams = valueParam ? paramValues[valueParam.name] : undefined;
      // Check if we have a value parameter with a valid value
      // Also check paramValues directly in case the parameter definition wasn't found
      // Check if we have a value parameter with a valid value
      // Also check paramValues directly in case the parameter definition wasn't found
      // This handles cases where the value was extracted from examples but the parameter definition wasn't found
      const hasValueParam = (valueParam && 
                            (valueParam.type === 'number' || valueParam.type === 'integer') &&
                            valueFromParams !== undefined && 
                            valueFromParams !== null && 
                            valueFromParams !== '') ||
                           // Fallback: if paramValues has 'value' key with a non-empty value, use it
                           (paramValues['value'] !== undefined && 
                            paramValues['value'] !== null && 
                            paramValues['value'] !== '' &&
                            String(paramValues['value']).trim() !== '' &&
                            !isNaN(Number(paramValues['value'])));
      // Use the value from paramValues if available (either from valueParam or direct access)
      const actualValue = valueFromParams !== undefined ? valueFromParams : paramValues['value'];
      
      // Always prioritize value parameter from paramValues if it exists
      if (hasValueParam && actualValue !== undefined && actualValue !== null && actualValue !== '') {
        // Always use the value from paramValues, replacing any existing numeric value
        // This ensures that user-set values always override any defaults in the command template
        if (hasExistingNumericValue) {
          // Command has an existing numeric value (like "1") - replace it with actualValue
          if (args.length > 0) {
            // Filter out any numeric values from args to avoid duplicates
            const argsWithoutNumeric = args.filter(arg => !/^-?\d+\.?\d*([eE][+-]?\d+)?$/.test(String(arg)));
            result = `${headerOnly} ${String(actualValue)} ${argsWithoutNumeric.join(' ')}`.trim();
          } else {
            result = `${headerOnly} ${String(actualValue)}`;
          }
        } else {
          // No existing numeric value, add actualValue
          if (args.length > 0) {
            // Check if args already contains this value to avoid duplicates
            const valueInArgs = args.some(arg => String(arg) === String(actualValue));
            if (valueInArgs) {
              result = `${headerOnly} ${args.join(' ')}`;
            } else {
              result = `${headerOnly} ${String(actualValue)} ${args.join(' ')}`.trim();
            }
          } else {
            result = `${headerOnly} ${String(actualValue)}`;
          }
        }
      } else if (args.length > 0) {
        // No value parameter in paramValues, but we have other args - use them
        // Still replace existing numeric value if present (might be a default that shouldn't be there)
        if (hasExistingNumericValue) {
          // Remove existing numeric value and use args instead
          result = `${headerOnly} ${args.join(' ')}`;
        } else {
          result = `${headerOnly} ${args.join(' ')}`;
        }
      } else if (hasExistingNumericValue) {
        // Command has a numeric value but no value in paramValues and no other args
        // Check if there's a value parameter definition - if so, remove the default value
        // (user hasn't set a value yet, so don't show a default)
        if (valueParam) {
          result = headerOnly;
        }
        // If no valueParam, keep the existing numeric value (might be part of the command structure)
      }
      // If no args and no value param and no existing numeric value, keep result as-is (might be a command without arguments)
    }
    
    return result.trim();
  };

  const tekhsiPattern = (text?: string): boolean => {
    if (!text) return false;
    const normalized = text.replace(/^#\s*/, '');
    return normalized.includes('scope.') || normalized.includes('with scope') || normalized.includes('stream_waveforms(');
  };

  // Update devices when config changes (but keep existing devices)
  useEffect(() => {
    if (devices.length > 0 && devices[0].id === 'device-1') {
      // Update the first device if it's the default one
      setDevices(prev => prev.map((d, idx) => 
        idx === 0 ? { ...d, ...config, id: 'device-1' } : d
      ));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.host, config.port, config.backend, config.connectionType]);

  // Device management functions
  const addDevice = (deviceType: InstrumentConfig['deviceType']) => {
    triggerControls.triggerAnimation('success');
    setDevices(prevDevices => {
      const newDevice: DeviceEntry = {
        ...config,
        id: `device-${Date.now()}`,
        enabled: true,
        deviceType,
        backend: 'pyvisa', // Default to PyVISA for new devices - user can change later
        alias: `${deviceType.toLowerCase()}${prevDevices.length + 1}`,
        x: 200 + (prevDevices.length * 250),
        y: 200,
        // Set appropriate driver if using tm_devices later
        deviceDriver: TM_DEVICE_TYPES[deviceType]?.drivers?.[0] || ''
      };
      return [...prevDevices, newDevice];
    });
  };

  const updateDevice = (id: string, updates: Partial<DeviceEntry>) => {
    setDevices(prevDevices => {
      const updated = prevDevices.map(d => d.id === id ? { ...d, ...updates } : d);
      // Sync first device with global config if only one device exists
      if (updated.length === 1 && updated[0]?.id === id) {
        setConfig(prevConfig => ({ ...prevConfig, ...updates }));
      }
      // Update editingDevice if it's the one being edited
      if (editingDevice?.id === id) {
        const updatedDevice = updated.find(d => d.id === id);
        if (updatedDevice) {
          setEditingDevice(updatedDevice);
        }
      }
      return updated;
    });
  };

  const deleteDevice = (id: string) => {
    setDevices(prevDevices => {
      const filtered = prevDevices.filter(d => d.id !== id);
      // If only one device remains, sync it with global config
      if (filtered.length === 1) {
        setConfig(prevConfig => ({ ...prevConfig, ...filtered[0] }));
        setCurrentDeviceIndex(0);
      } else if (filtered.length > 0) {
        const INSTRUMENTS_PER_PAGE = 3;
        const totalPages = Math.ceil(filtered.length / INSTRUMENTS_PER_PAGE);
        // If current page is beyond available pages, go to last page
        if (currentDeviceIndex >= totalPages) {
          setCurrentDeviceIndex(Math.max(0, totalPages - 1));
        }
      }
      return filtered;
    });
    setDeviceConnections(prevConnections => prevConnections.filter(c => c.fromDeviceId !== id && c.toDeviceId !== id));
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _addDeviceConnection = (fromId: string, toId: string, type: ConnectionEdge['type'] = 'signal', label?: string) => {
    const fromDevice = devices.find(d => d.id === fromId);
    const toDevice = devices.find(d => d.id === toId);
    if (!fromDevice || !toDevice) return;

    const newConnection: ConnectionEdge = {
      id: `edge-${fromId}-${toId}-${Date.now()}`,
      from: `node-${fromId}`,
      to: `node-${toId}`,
      type,
      label: label || type,
      fromDeviceId: fromId,
      toDeviceId: toId
    };
    setDeviceConnections([...deviceConnections, newConnection]);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _deleteConnection = (id: string) => {
    setDeviceConnections(deviceConnections.filter(c => c.id !== id));
  };

  // Layout view handlers
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleNodeDrag = (nodeId: string, x: number, y: number) => {
    // Update device position if it's a device node
    const device = devices.find(d => `node-${d.id}` === nodeId);
    if (device) {
      updateDevice(device.id, { x, y });
    } else {
      setNodePositions(prev => ({ ...prev, [nodeId]: { x, y } }));
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleZoomIn = () => _setCanvasZoom(prev => Math.min(prev + 0.1, 2));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleZoomOut = () => _setCanvasZoom(prev => Math.max(prev - 0.1, 0.5));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleZoomReset = () => _setCanvasZoom(1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handlePanReset = () => _setCanvasPan({ x: 0, y: 0 });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleBlockSelect = (stepId: string) => {
    setSelectedStep(stepId);
    setCurrentView('builder');
  };

  // Real-time connection state polling (placeholder - would need actual ping function)
  useEffect(() => {
    if (currentView !== 'builder' || !showConfig) return;
    const interval = setInterval(() => {
      setDevices(d => d.map(dev => ({
        ...dev,
        status: 'offline' as const // Placeholder - implement actual pingInstrument(dev.host)
      })));
    }, 5000);
    return () => clearInterval(interval);
  }, [currentView, showConfig, devices.length]);

  // Get topology and signal path data
  const topology = extractTopologyFromDevices(devices, deviceConnections);
  
  // Apply saved node positions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _nodesWithPositions = topology.nodes.map(node => {
    const device = devices.find(d => d.id === node.deviceId);
    return {
      ...node,
      x: nodePositions[node.id]?.x || device?.x || node.x,
      y: nodePositions[node.id]?.y || device?.y || node.y
    };
  });

  const stepHasTekHSICommand = (step: Step): boolean => {
    if ((step.type === 'query' || step.type === 'write') && typeof step.params.command === 'string') {
      return tekhsiPattern(step.params.command.replace(/^#\s*/, ''));
    }
    if (step.type === 'python' && typeof step.params.code === 'string') {
      return tekhsiPattern(step.params.code);
    }
    if (step.children) return step.children.some(stepHasTekHSICommand);
    return false;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _hasTekHSICommands = steps.some(stepHasTekHSICommand);

  const stepUsesTmDevicesHighLevel = (step: Step): boolean => {
    if ((step.type === 'query' || step.type === 'write') && typeof step.params.command === 'string') {
      const cmd = step.params.command;
      return (
        cmd.includes('.commands.') ||
        cmd.includes('.add_') ||
        cmd.includes('.save_') ||
        cmd.includes('.turn_') ||
        cmd.includes('.set_and_check') ||
        cmd.includes('.get_')
      );
    }
    if (step.children) return step.children.some(stepUsesTmDevicesHighLevel);
    return false;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _hasTmDevicesHighLevelCommands = steps.some(stepUsesTmDevicesHighLevel);

  const detectHybridMode = useCallback((items: Step[]): boolean => {
    let hasTekHSI = false;
    const scan = (arr: Step[]) => {
      arr.forEach((s) => {
        if (hasTekHSI) return;
        if (stepHasTekHSICommand(s)) {
          hasTekHSI = true;
          return;
        }
        if (s.children) scan(s.children);
      });
    };
    scan(items);
    return hasTekHSI;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only auto-switch to hybrid mode if:
    // 1. We detect TekHSI commands (scope. or #)
    // 2. We're NOT already using tm_devices (tm_devices can handle SCPI via VISA resource)
    // 3. We're not already in hybrid mode
    if (detectHybridMode(steps) && config.backend !== 'hybrid' && config.backend !== 'tm_devices') {
      setConfig(prev => ({ ...prev, backend: 'hybrid' }));
    }
  }, [steps, config.backend, detectHybridMode]);

  const getDeviceType = (modelFamily: string): 'scope' | 'awg' | 'afg' => {
    if (modelFamily.includes('AWG')) return 'awg';
    if (modelFamily.includes('AFG')) return 'afg';
    return 'scope';
  };

  const isCommandCompatible = (cmd: CommandLibraryItem): boolean => {
    // SPECIAL CASE: TekExpress commands - check FIRST before other filters
    // TekExpress commands should show when TekExpress is selected OR when no device family is selected
    if (cmd.manualEntry?.commandGroup === 'USB4Tx' || 
        cmd.category === 'tekexpress' || 
        (cmd.scpi && cmd.scpi.startsWith('TEKEXP:'))) {
      // Show TekExpress commands if TekExpress is selected, or if no device family is selected
      return !selectedDeviceFamily || selectedDeviceFamily === 'TekExpress';
    }
    
    // PRIMARY FILTER: Check if command matches selected device family by source file
    // This is the most important filter - it separates MSO vs DPO commands
    if (cmd.sourceFile && selectedDeviceFamily) {
      const familyMapping = FILE_TO_DEVICE_FAMILY[cmd.sourceFile];
      if (familyMapping) {
        // If we have a mapping, only show commands from the selected family's file
        return familyMapping.id === selectedDeviceFamily;
      }
    }
    
    // FALLBACK: For commands without sourceFile, use device type checking
    // This handles legacy commands or commands from files not in FILE_TO_DEVICE_FAMILY
    const deviceType = getDeviceType(selectedDeviceFamily);
    const isAWGCommand = cmd.category === 'AWG' || cmd.name.toLowerCase().includes('awg');
    const isAFGCommand = cmd.category === 'AFG' || cmd.name.toLowerCase().includes('afg');
    
    if (deviceType === 'awg') return isAWGCommand;
    if (deviceType === 'afg') return isAFGCommand;
    if (deviceType === 'scope') return !isAWGCommand && !isAFGCommand;
    
    // Default: show all if we can't determine
    return true;
  };

  const getVisaResourceString = (): string => {
    switch (config.connectionType) {
      case 'tcpip':
        return `TCPIP::${config.host}::INSTR`;
      case 'socket':
        return `TCPIP::${config.host}::${config.port}::SOCKET`;
      case 'usb':
        const serial = config.usbSerial ? `::${config.usbSerial}` : '';
        return `USB0::${config.usbVendorId}::${config.usbProductId}${serial}::INSTR`;
      case 'gpib':
        return `GPIB${config.gpibBoard}::${config.gpibAddress}::INSTR`;
      default:
        return `TCPIP::${config.host}::INSTR`;
    }
  };

  /* Python generation */
  const generatePython = () => {
    const isPyVISA = config.backend === 'pyvisa';
    const isTmDevices = config.backend === 'tm_devices';
    const isVxi11 = config.backend === 'vxi11';
    const isTekHSI = config.backend === 'tekhsi';
    const isHybrid = config.backend === 'hybrid';

    const hasTekExpress = steps.some(
      (s) => (s.type === 'query' || s.type === 'write') && s.params.command?.startsWith('TEKEXP:')
    );
    const hasTekHSICommands = steps.some(
      (s) => (s.type === 'query' || s.type === 'write') && (s.params.command?.startsWith('scope.') || s.params.command?.startsWith('#'))
    );

    const formatPythonSnippet = (code: string, indent: string): string => {
      if (!code) return '';
      const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      return lines.map(line => indent + line).join('\n') + '\n';
    };

    const stepContainsProcessWaveform = (items: Step[]): boolean => {
      let found = false;
      const scan = (arr: Step[]) => {
        for (const s of arr) {
          if (found) return;
          if ((s.type === 'write' || s.type === 'query') && typeof s.params?.command === 'string') {
            const normalized = s.params.command.replace(/^#\s*/, '').trim();
            if (normalized.startsWith('process_waveform(')) {
              found = true;
              return;
            }
          }
          if (s.type === 'python' && typeof s.params?.code === 'string') {
            if (s.params.code.includes('process_waveform(')) {
              found = true;
              return;
            }
          }
          if (s.children) scan(s.children);
        }
      };
      scan(items);
      return found;
    };

    const header = `#!/usr/bin/env python3
"""
Generated by TekAutomate
Backend: ${config.backend}${(() => {
  if (config.backend === 'pyvisa' || config.backend === 'vxi11') {
    if (config.connectionType === 'socket') {
      return ' (Socket via TCPIP::SOCKET)';
    } else if (config.connectionType === 'tcpip') {
      return ' (VXI-11 via TCPIP::INSTR)';
    }
  }
  return '';
})()}
Host: ${config.host}
${config.backend === 'tm_devices' && !config.deviceDriver ? 'Device Driver: Auto-detect' : config.backend === 'tm_devices' ? `Device Driver: ${config.deviceDriver}` : `Model: ${config.modelFamily}`}
${(config.backend === 'tekhsi' || config.backend === 'hybrid') && config.tekhsiDevice ? `TekHSI Device: ${config.tekhsiDevice}` : ''}
${hasTekExpress ? 'TekExpress: TEKEXP:* via port 5000' : ''}
${hasTekHSICommands ? 'TekHSI: fast waveform on port 5000' : ''}
"""
import argparse, time, pathlib
${hasTekExpress ? 'from time import sleep' : ''}
${xopt.saveCsv || xopt.exportMeasurements || hasTekExpress ? 'import csv' : ''}
`;

    const logBlock = xopt.saveCsv
      ? `    logf = open(${JSON.stringify(xopt.csvName)}, "w", newline="", buffering=1)
    log = csv.writer(logf)
    log.writerow(["ts","cmd","resp_len"])
    
    def log_cmd(cmd, resp):
        try:
            n = len(resp) if isinstance(resp,(bytes,bytearray)) else len(str(resp))
        except Exception:
            n = -1
        log.writerow([time.time(), cmd, n])
        logf.flush()  # Flush immediately so data is visible

`
      : `    def log_cmd(cmd, resp):
        pass

`;

    const measurementsBlock = xopt.exportMeasurements
      ? `    # Measurement data export (actual measurement values)
    measurements_file = open(${JSON.stringify(xopt.measurementsFilename)}, "w", newline="")
    measurements_csv = csv.writer(measurements_file)
    measurements_csv.writerow(["timestamp", "measurement_type", "source", "value", "unit"])
    
    def save_measurement(meas_type, source, value, unit=""):
        measurements_csv.writerow([time.time(), meas_type, source, value, unit])
        measurements_file.flush()

`
      : `    def save_measurement(meas_type, source, value, unit=""):
        pass

`;

    const binQueryHelper = (xopt.enablePerformanceOptimization ? `def read_ieee_block(inst) -> bytes:
    """Reads an IEEE-488.2 definite-length block (#N)."""
    first = inst.read_bytes(1)
    if first != b'#':
        # non-block response; drain line
        rest = first + inst.read_raw()
        return rest
    ndig = int(inst.read_bytes(1))
    length = int(inst.read_bytes(ndig).decode('ascii'))
    payload = inst.read_bytes(length)
    # Strip any garbage before PNG header if present
    if b'\\x89PNG' in payload[:64]:
        return b'\\x89PNG' + payload.split(b'\\x89PNG', 1)[1]
    return payload

` : '') + `def read_waveform_binary(inst, source='CH1', start=1, stop=None, width=1, encoding='RIBinary'):
    """
    Reads waveform data with proper setup - FAST binary transfer.
    
    Returns: (preamble_dict, binary_data)
    """
    # Query actual record length if not specified
    if stop is None:
        try:
            rec_len = int(inst.query('HORizontal:RECOrdlength?').strip())
            stop = rec_len
            print(f"  Queried record length: {rec_len:,} points")
        except:
            stop = 10000
    
    # Setup acquisition parameters (following Waveform Transfer sequence)
    inst.write(f'DATa:SOUrce {source}')
    inst.write(f'DATa:ENCdg {encoding}')
    inst.write(f'WFMOutpre:BYT_Nr {width}')
    inst.write('HEAD OFF')
    inst.write(f'DATa:STARt {start}')
    inst.write(f'DATa:STOP {stop}')
    
    num_points = stop - start + 1
    expected_bytes = num_points * width
    print(f"Configured: {source}, {num_points:,} points, {expected_bytes:,} bytes")
    
    # Set generous timeout${xopt.enablePerformanceOptimization ? ' and large chunk size for speed' : ''}
    old_timeout = inst.timeout
    inst.timeout = 60000  # 60 seconds${xopt.enablePerformanceOptimization ? '\n    inst.chunk_size = 128 * 1024 * 1024  # 128 MB chunks for speed' : ''}
    
    try:
        # PyVISA's query_binary_values is FAST
        import time
        t0 = time.time()
        data = inst.query_binary_values('CURVe?', datatype='B', container=bytes)
        elapsed = time.time() - t0
        
        rate_mbps = (len(data) / elapsed) / 1_000_000
        print(f"  ✓ {len(data):,} bytes in {elapsed:.2f}s ({rate_mbps:.1f} MB/s)")
        
        # Simple preamble
        preamble = {'num_points': num_points, 'width': width}
        return preamble, data
        
    finally:
        inst.timeout = old_timeout
`;

    const subst = (cmd: string, defs: CommandParam[] = [], vals: Record<string, any> = {}) =>
      substituteSCPI(cmd, defs, vals);

    const genStepsTekHSI = (items: Step[], ind = '    ', sweepContext?: { varName: string; value: string }): string => {
      let out = '';
      for (const s of items) {
        if (s.type === 'sweep') {
          const varName = s.params.variableName || 'value';
          const start = s.params.start ?? 0;
          const stop = s.params.stop ?? 10;
          const step = s.params.step ?? 1;
          const saveResults = s.params.saveResults || false;
          const resultVar = s.params.resultVariable || 'results';
          
          out += `${ind}# Sweep: ${varName} from ${start} to ${stop} step ${step}\n`;
          if (saveResults) {
            out += `${ind}${resultVar} = []\n`;
          }
          out += `${ind}${varName} = ${start}\n`;
          out += `${ind}while ${varName} <= ${stop}:\n`;
          
          // Process children with variable substitution
          if (s.children && s.children.length > 0) {
            const childInd = ind + '    ';
            const childOut = genStepsTekHSI(s.children, childInd, { varName, value: `{${varName}}` });
            out += childOut;
            
            // Collect results if enabled
            if (saveResults) {
              // Find query commands in children and collect their results
              const hasQuery = s.children.some(child => child.type === 'query' && child.params?.saveAs);
              if (hasQuery) {
                // Collect all query results - we'll need to track which variables were set
                // For simplicity, collect the last result variable or a generic 'result'
                const lastQuery = s.children.filter(c => c.type === 'query' && c.params?.saveAs).pop();
                if (lastQuery) {
                  const queryVar = lastQuery.params.saveAs || 'result';
                  out += `${childInd}${resultVar}.append({'${varName}': ${varName}, 'result': ${queryVar}})\n`;
                }
              }
            }
          } else {
            out += `${ind}    pass  # No commands in sweep\n`;
          }
          
          out += `${ind}    ${varName} += ${step}\n`;
          continue;
        }
        if (s.type === 'group') {
          out += `${ind}# Group: ${s.label}\n`;
          if (s.children) out += genStepsTekHSI(s.children, ind, sweepContext);
          continue;
        }
        if (s.type === 'sleep') { 
          if (enablePrintMessages) out += `${ind}print("Sleeping for ${s.params.duration}s")\n`;
          out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`; 
          continue; 
        }
        if (s.type === 'save_waveform') {
          const src = s.params.source || 'ch1';
          const fn = s.params.filename || 'waveform.csv';
          if (enablePrintMessages) out += `${ind}print("Saving waveform from ${src} to ${fn}")\n`;
          out += `${ind}with scope.access_data():\n${ind}    wfm = scope.get_data("${src}")\n${ind}from tm_data_types import write_file\n${ind}write_file("${fn}", wfm)\n`;
          continue;
        }
        if (s.type === 'python' && typeof s.params?.code === 'string') {
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Executing Python code'}")\n`;
          out += formatPythonSnippet(s.params.code, ind);
          continue;
        }
        
        // Handle set_and_query type in TekHSI mode
        if (s.type === 'set_and_query') {
          let raw = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
          const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
          const queryCmd = cmdHeader + '?';
          const paramValues = s.params.paramValues || {};
          const valueParam = paramValues['value'] || paramValues['Value'] || '';
          
          let writeCmd = raw.replace(/\?$/, '');
          if (writeCmd === cmdHeader && valueParam) {
            writeCmd = `${cmdHeader} ${valueParam}`;
          }
          
          const varName = s.params.saveAs || 'result';
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
          out += `${ind}scope.commands.write("${writeCmd}")\n`;
          out += `${ind}${varName} = scope.commands.query("${queryCmd}")\n`;
          continue;
        }
        
        if (s.type !== 'query' && s.type !== 'write') continue;

        let raw = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
        // Substitute sweep variable if in sweep context
        if (sweepContext) {
          raw = raw.replace(/\$\{([^}]+)\}/g, (match, varNameInCmd) => {
            if (varNameInCmd === sweepContext.varName) {
              return sweepContext.varName; // Replace ${varName} with varName (Python variable)
            }
            return match; // Keep other variables as-is
          });
        }
        const line = raw.startsWith('#') ? raw.slice(1).trim() : raw;
        if (enablePrintMessages) out += `${ind}print("${s.label || 'Executing TekHSI command'}")\n`;
        if (s.type === 'query') {
          const varName = s.params.saveAs || 'result';
          out += `${ind}${varName} = ${line}\n`;
        } else {
          out += `${ind}${line}\n`;
        }
      }
      return out;
    };

    const genStepsHybrid = (items: Step[], ind = '    ', sweepContext?: { varName: string; value: string }): string => {
      let out = '';
      for (const s of items) {
        if (s.type === 'sweep') {
          const varName = s.params.variableName || 'value';
          const start = s.params.start ?? 0;
          const stop = s.params.stop ?? 10;
          const step = s.params.step ?? 1;
          const saveResults = s.params.saveResults || false;
          const resultVar = s.params.resultVariable || 'results';
          
          out += `${ind}# Sweep: ${varName} from ${start} to ${stop} step ${step}\n`;
          if (saveResults) {
            out += `${ind}${resultVar} = []\n`;
          }
          out += `${ind}${varName} = ${start}\n`;
          out += `${ind}while ${varName} <= ${stop}:\n`;
          
          if (s.children && s.children.length > 0) {
            const childInd = ind + '    ';
            const childOut = genStepsHybrid(s.children, childInd, { varName, value: `{${varName}}` });
            out += childOut;
            
            if (saveResults) {
              const hasQuery = s.children.some(child => child.type === 'query' && child.params?.saveAs);
              if (hasQuery) {
                const lastQuery = s.children.filter(c => c.type === 'query' && c.params?.saveAs).pop();
                if (lastQuery) {
                  const queryVar = lastQuery.params.saveAs || 'result';
                  out += `${childInd}${resultVar}.append({'${varName}': ${varName}, 'result': ${queryVar}})\n`;
                }
              }
            }
          } else {
            out += `${ind}    pass  # No commands in sweep\n`;
          }
          
          out += `${ind}    ${varName} += ${step}\n`;
          continue;
        }
        if (s.type === 'group') {
          out += `${ind}# Group: ${s.label}\n`;
          if (s.children) out += genStepsHybrid(s.children, ind, sweepContext);
          continue;
        }
        if (s.type === 'sleep') { out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`; continue; }
        if (s.type === 'save_waveform') {
          const src = s.params.source || 'ch1';
          const fn = s.params.filename || 'waveform.csv';
          out += `${ind}with scope.access_data():\n${ind}    wfm = scope.get_data("${src}")\n${ind}from tm_data_types import write_file\n${ind}write_file("${fn}", wfm)\n`;
          continue;
        }
        if (s.type === 'python' && typeof s.params?.code === 'string') {
          // In hybrid mode, if Python snippet contains TekHSI commands (scope. or hsi.),
          // treat them as TekHSI commands and output directly (not as raw Python)
          // Note: We output the code as-is without any automatic conversions
          const code = s.params.code.replace(/\bhsi\./g, 'scope.');
          const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const lines = normalized.split('\n');
          
          // Check if all non-empty lines are TekHSI commands
          const nonEmptyLines = lines.filter(line => line.trim());
          const allTekHSI = nonEmptyLines.length > 0 && nonEmptyLines.every(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('scope.') || trimmed.startsWith('#');
          });
          
          if (allTekHSI) {
            // Output each line preserving original structure (including empty lines)
            // Output as-is without any automatic conversions
            for (const line of lines) {
              if (line.trim()) {
                // Non-empty line - output with proper indentation
                out += `${ind}${line.trim()}\n`;
              } else {
                // Empty line - preserve it
                out += '\n';
              }
            }
          } else {
            // Mixed content or non-TekHSI Python - output as-is with formatting
            out += formatPythonSnippet(code, ind);
          }
          continue;
        }
        
        // Handle set_and_query type in Hybrid mode
        if (s.type === 'set_and_query') {
          let raw = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
          const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
          const queryCmd = cmdHeader + '?';
          const paramValues = s.params.paramValues || {};
          const valueParam = paramValues['value'] || paramValues['Value'] || '';
          
          let writeCmd = raw.replace(/\?$/, '');
          if (writeCmd === cmdHeader && valueParam) {
            writeCmd = `${cmdHeader} ${valueParam}`;
          }
          
          const varName = s.params.saveAs || 'result';
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
          out += `${ind}scpi.write(${JSON.stringify(writeCmd)})\n`;
          out += `${ind}${varName} = scpi.query(${JSON.stringify(queryCmd)}).strip()\n`;
          out += `${ind}log_cmd(${JSON.stringify(queryCmd)}, ${varName})\n`;
          continue;
        }
        
        if (s.type !== 'query' && s.type !== 'write') continue;

        let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
        // Substitute sweep variable if in sweep context - replace ${varName} with {varName} for f-strings
        let needsFString = false;
        if (sweepContext) {
          const varPattern = new RegExp(`\\$\\{${sweepContext.varName}\\}`, 'g');
          if (varPattern.test(cmd)) {
            cmd = cmd.replace(varPattern, `{${sweepContext.varName}}`);
            needsFString = true;
          }
        }
        // Check if it's a tm_devices command (scope.commands.*, scope.add_*, scope.save_*)
        const isTmDevicesCommand = cmd.includes('.commands.') || cmd.includes('.add_') || cmd.includes('.save_');
        // True TekHSI commands start with 'scope.' but are NOT tm_devices commands, or start with '#'
        const isHSI = (cmd.startsWith('scope.') && !isTmDevicesCommand) || cmd.startsWith('#');
        
        if (isHSI) {
          let clean = cmd.startsWith('#') ? cmd.slice(1) : cmd;
          if (clean.startsWith(' ')) clean = clean.slice(1);
          clean = clean.replace(/\s+$/g, '');
          // Handle sweep variable substitution for f-strings
          if (sweepContext && clean.includes(`{${sweepContext.varName}}`)) {
            clean = `f"${clean}"`; // Wrap in f-string
          }
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Executing TekHSI command'}")\n`;
          if (s.type === 'query') {
            const varName = s.params.saveAs || 'result';
            out += `${ind}# TekHSI\n${ind}${varName} = ${clean}\n`;
          } else {
            out += `${ind}# TekHSI\n${ind}${clean}\n`;
          }
        } else if (isTmDevicesCommand) {
          // Handle sweep variable substitution for tm_devices commands
          let finalCmd = cmd;
          if (sweepContext && cmd.includes(`{${sweepContext.varName}}`)) {
            finalCmd = `f"${cmd}"`; // Wrap in f-string
          }
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Executing tm_devices command'}")\n`;
          if (s.type === 'query') {
            const varName = s.params.saveAs || 'result';
            out += `${ind}${varName} = ${finalCmd}\n`;
          } else {
            out += `${ind}${finalCmd}\n`;
          }
        } else {
          // SCPI command - handle sweep variable substitution
          let finalCmd = cmd;
          let useFString = false;
          if (sweepContext && cmd.includes(`{${sweepContext.varName}}`)) {
            finalCmd = cmd.replace(/\{([^}]+)\}/g, (match, varNameInCmd) => {
              if (varNameInCmd === sweepContext.varName) {
                useFString = true;
                return `{${sweepContext.varName}}`; // Keep for f-string
              }
              return match;
            });
          }
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Sending SCPI command'}")\n`;
          if (s.type === 'query') {
            const varName = s.params.saveAs || 'result';
            if (useFString) {
              out += `${ind}${varName} = scpi.query(f${JSON.stringify(finalCmd)}).strip()\n${ind}log_cmd(f${JSON.stringify(finalCmd)}, ${varName})\n`;
            } else {
              out += `${ind}${varName} = scpi.query(${JSON.stringify(finalCmd)}).strip()\n${ind}log_cmd(${JSON.stringify(finalCmd)}, ${varName})\n`;
            }
          } else {
            if (useFString) {
              out += `${ind}scpi.write(f${JSON.stringify(finalCmd)})\n`;
            } else {
              out += `${ind}scpi.write(${JSON.stringify(finalCmd)})\n`;
            }
          }
        }
      }
      return out;
    };

    const genStepsVxi11 = (items: Step[], ind = '    ', sweepContext?: { varName: string; value: string }): string => {
      let out = '';
      for (const s of items) {
        if (s.type === 'sweep') {
          const varName = s.params.variableName || 'value';
          const start = s.params.start ?? 0;
          const stop = s.params.stop ?? 10;
          const step = s.params.step ?? 1;
          const saveResults = s.params.saveResults || false;
          const resultVar = s.params.resultVariable || 'results';
          
          out += `${ind}# Sweep: ${varName} from ${start} to ${stop} step ${step}\n`;
          if (saveResults) {
            out += `${ind}${resultVar} = []\n`;
          }
          out += `${ind}${varName} = ${start}\n`;
          out += `${ind}while ${varName} <= ${stop}:\n`;
          
          if (s.children && s.children.length > 0) {
            const childInd = ind + '    ';
            const childOut = genStepsVxi11(s.children, childInd, { varName, value: `{${varName}}` });
            out += childOut;
            
            if (saveResults) {
              const hasQuery = s.children.some(child => child.type === 'query' && child.params?.saveAs);
              if (hasQuery) {
                const lastQuery = s.children.filter(c => c.type === 'query' && c.params?.saveAs).pop();
                if (lastQuery) {
                  const queryVar = lastQuery.params.saveAs || 'result';
                  out += `${childInd}${resultVar}.append({'${varName}': ${varName}, 'result': ${queryVar}})\n`;
                }
              }
            }
          } else {
            out += `${ind}    pass  # No commands in sweep\n`;
          }
          
          out += `${ind}    ${varName} += ${step}\n`;
          continue;
        }
        if (s.type === 'group' && s.children) {
          out += `${ind}# Group: ${s.label || 'Group'}\n`;
          out += genStepsVxi11(s.children, ind, sweepContext);
          continue;
        }
        if (s.type === 'sleep') {
          out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`;
          continue;
        }
        if (s.type === 'comment') {
          out += `${ind}# ${s.params.text || ''}\n`;
          continue;
        }
        if (s.type === 'python' && typeof s.params?.code === 'string') {
          out += formatPythonSnippet(s.params.code, ind);
          continue;
        }
        if (s.type === 'save_waveform') {
          const source = (s.params.source || 'CH1').toUpperCase();
          const fn = s.params.filename || xopt.waveformFilename;
          const format = s.params.format || xopt.waveformFormat;
          
          if (format === 'wfm') {
            // Save as .wfm format using SAVe:WAVEform command
            const wfmPath = fn.replace(/\//g, '\\');
            out += `${ind}# Save waveform as .wfm format\n`;
            out += `${ind}instrument.write(f"SAVe:WAVEform ${source},'C:\\\\${wfmPath}'")\n`;
            out += `${ind}instrument.ask("*OPC?")\n`;
            out += `${ind}# Download .wfm file from scope\n`;
            out += `${ind}instrument.write(f"FILESystem:READFile 'C:\\\\${wfmPath}'")\n`;
            out += `${ind}data = instrument.read_raw()\n`;
            out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
            out += `${ind}log_cmd('FILESystem:READFile', data)\n`;
          } else if (format === 'csv') {
            // Save as CSV format
            out += `${ind}# Read waveform as ASCII/CSV\n`;
            out += `${ind}instrument.write(":DATa:SOUrce ${source}")\n`;
            out += `${ind}instrument.write(":WAVeform:FORMat ASCii")\n`;
            out += `${ind}instrument.write(":WAVeform:DATA?")\n`;
            out += `${ind}data = instrument.read()\n`;
            out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_text(data)\n`;
            out += `${ind}log_cmd('WAVeform:DATA?', data)\n`;
          } else {
            // Default: binary format
            out += `${ind}# Read waveform as binary\n`;
            out += `${ind}instrument.write(":DATa:SOUrce ${source}")\n`;
            out += `${ind}instrument.write(":WAVeform:FORMat RIBinary")\n`;
            out += `${ind}instrument.write(":WAVeform:DATA?")\n`;
            out += `${ind}data = instrument.read_raw()\n`;
            out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
            out += `${ind}log_cmd('WAVeform:DATA?', data)\n`;
          }
          continue;
        }
        if (s.type === 'error_check') {
          const errCmd = s.params.command || 'ALLEV?';
          out += `${ind}try:\n${ind}    err = instrument.ask("${errCmd}")\n${ind}    log_cmd("${errCmd}", err)\n${ind}except Exception: pass\n`;
          continue;
        }
        
        // Handle set_and_query type in VXI-11 mode
        if (s.type === 'set_and_query') {
          let raw = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
          const cmdHeader = raw.replace(/\?$/, '').split(/\s+/)[0];
          const queryCmd = cmdHeader + '?';
          const paramValues = s.params.paramValues || {};
          const valueParam = paramValues['value'] || paramValues['Value'] || '';
          
          let writeCmd = raw.replace(/\?$/, '');
          if (writeCmd === cmdHeader && valueParam) {
            writeCmd = `${cmdHeader} ${valueParam}`;
          }
          
          const varName = s.params.saveAs || 'result';
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
          out += `${ind}instrument.write(${JSON.stringify(writeCmd)})\n`;
          out += `${ind}${varName} = instrument.ask(${JSON.stringify(queryCmd)})\n`;
          out += `${ind}log_cmd(${JSON.stringify(queryCmd)}, ${varName})\n`;
          continue;
        }
        
        if (s.type === 'query') {
          let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
          let needsFString = false;
          if (sweepContext) {
            const varPattern = new RegExp(`\\$\\{${sweepContext.varName}\\}`, 'g');
            if (varPattern.test(cmd)) {
              cmd = cmd.replace(varPattern, `{${sweepContext.varName}}`);
              needsFString = true;
            }
          }
          const cmdStr = needsFString ? `f${JSON.stringify(cmd)}` : JSON.stringify(cmd);
          out += `${ind}resp = instrument.ask(${cmdStr})\n`;
          if (s.params.saveAs) {
            out += `${ind}${s.params.saveAs} = resp\n`;
          }
          out += `${ind}log_cmd(${cmdStr}, resp)\n`;
        } else if (s.type === 'write') {
          let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
          let needsFString = false;
          if (sweepContext) {
            const varPattern = new RegExp(`\\$\\{${sweepContext.varName}\\}`, 'g');
            if (varPattern.test(cmd)) {
              cmd = cmd.replace(varPattern, `{${sweepContext.varName}}`);
              needsFString = true;
            }
          }
          const cmdStr = needsFString ? `f${JSON.stringify(cmd)}` : JSON.stringify(cmd);
          out += `${ind}instrument.write(${cmdStr})\n`;
          out += `${ind}log_cmd(${cmdStr}, "")\n`;
        }
      }
      return out;
    };

    const genStepsClassic = (items: Step[], ind = '    ', sweepContext?: { varName: string; value: string }): string => {
      let out = '';
      let hasStateRun = false;
      for (const s of items) {
        if (s.type === 'sweep') {
          const varName = s.params.variableName || 'value';
          const start = s.params.start ?? 0;
          const stop = s.params.stop ?? 10;
          const step = s.params.step ?? 1;
          const saveResults = s.params.saveResults || false;
          const resultVar = s.params.resultVariable || 'results';
          
          out += `${ind}# Sweep: ${varName} from ${start} to ${stop} step ${step}\n`;
          if (saveResults) {
            out += `${ind}${resultVar} = []\n`;
          }
          out += `${ind}${varName} = ${start}\n`;
          out += `${ind}while ${varName} <= ${stop}:\n`;
          
          if (s.children && s.children.length > 0) {
            const childInd = ind + '    ';
            const childOut = genStepsClassic(s.children, childInd, { varName, value: `{${varName}}` });
            out += childOut;
            
            if (saveResults) {
              const hasQuery = s.children.some(child => child.type === 'query' && child.params?.saveAs);
              if (hasQuery) {
                const lastQuery = s.children.filter(c => c.type === 'query' && c.params?.saveAs).pop();
                if (lastQuery) {
                  const queryVar = lastQuery.params.saveAs || 'result';
                  out += `${childInd}${resultVar}.append({'${varName}': ${varName}, 'result': ${queryVar}})\n`;
                }
              }
            }
          } else {
            out += `${ind}    pass  # No commands in sweep\n`;
          }
          
          out += `${ind}    ${varName} += ${step}\n`;
          continue;
        }
        if (s.type === 'group') {
          out += `${ind}# Group: ${s.label}\n`;
          if (s.children) out += genStepsClassic(s.children, ind, sweepContext);
          continue;
        }
        if (s.type === 'sleep') { 
          if (enablePrintMessages) out += `${ind}print("Sleeping for ${s.params.duration}s")\n`;
          out += `${ind}time.sleep(${Number(s.params.duration) || 0})\n`; 
          continue; 
        }
        if (s.type === 'comment') { 
          const commentText = s.params.text || s.label || '';
          out += `${ind}# ${commentText}\n`; 
          continue; 
        }
        if (s.type === 'python' && typeof s.params?.code === 'string') {
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Executing Python code'}")\n`;
          out += formatPythonSnippet(s.params.code, ind);
          continue;
        }
        
        // UPDATED: Waveform saving with format support
        if (s.type === 'save_waveform') {
          if (enablePrintMessages) {
            const source = (s.params.source || 'CH1').toUpperCase();
            const fn = s.params.filename || xopt.waveformFilename;
            out += `${ind}print("Saving waveform from ${source} to ${fn}")\n`;
          }
          const cmd = s.params.command || 'CURVe?';
          const fn = s.params.filename || xopt.waveformFilename;
          const source = (s.params.source || 'CH1').toUpperCase();
          const format = s.params.format || xopt.waveformFormat;
          const width = s.params.width || 1;
          const encoding = s.params.encoding || 'RIBinary';
          const start = s.params.start || 1;
          const stop = s.params.stop || 'None';
          
          if (format === 'wfm') {
            // Save as .wfm format using SAVe:WAVEform command
            const wfmPath = fn.replace(/\//g, '\\');
            out += `${ind}# Save waveform as .wfm format (Tektronix native)\n`;
            out += `${ind}scpi.write("SAVe:WAVEform ${source},'C:\\\\${wfmPath}'")\n`;
            out += `${ind}scpi.query("*OPC?")\n`;
            out += `${ind}# Download .wfm file from scope\n`;
            out += `${ind}scpi.write(f"FILESystem:READFile 'C:\\\\${wfmPath}'")\n`;
            out += `${ind}data = scpi.read_raw()\n`;
            out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
            out += `${ind}log_cmd('FILESystem:READFile', data)\n`;
            out += `${ind}print(f"  Saved .wfm file: {len(data):,} bytes")\n`;
          } else if (format === 'csv') {
            // Save as CSV format
            out += `${ind}# Read waveform as ASCII/CSV\n`;
            out += `${ind}scpi.write(":DATa:SOUrce ${source}")\n`;
            out += `${ind}scpi.write(":WAVeform:FORMat ASCii")\n`;
            out += `${ind}scpi.write(":WAVeform:DATA?")\n`;
            out += `${ind}data = scpi.read()\n`;
            out += `${ind}pathlib.Path(${JSON.stringify(fn)}).write_text(data)\n`;
            out += `${ind}log_cmd('WAVeform:DATA?', data)\n`;
            out += `${ind}print(f"  Saved CSV: {len(data):,} bytes")\n`;
          } else {
            // Default: binary format (.bin)
            if (cmd.includes('FILESYSTEM:READFILE')) {
              out += `${ind}scpi.write(${JSON.stringify(cmd)})\n${ind}data = scpi.read_raw()\n${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n`;
            } else if (cmd === 'CURVe?' || cmd.startsWith('CURV') || !cmd) {
              out += `${ind}# Read waveform from ${source} as binary\n${ind}preamble, data = read_waveform_binary(scpi, source='${source}', start=${start}, stop=${stop}, width=${width}, encoding='${encoding}')\n${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n${ind}log_cmd('CURVe?', data)\n${ind}print(f"  Waveform: {len(data):,} bytes, {preamble.get('num_points', 0):,} points")\n`;
            } else if (cmd.toUpperCase().includes('HARDCOPY') && cmd.toUpperCase().includes('DATA')) {
              out += `${ind}# Screen capture via FILESYSTEM route${xopt.enablePerformanceOptimization ? ' with optimized read_ieee_block' : ''}\n${ind}temp_file = "C:/TekScope/images/TekH001.PNG"\n${ind}scpi.write('HARDCOPY:PORT FILE')\n${ind}scpi.write('HARDCOPY:FORMAT PNG')\n${ind}scpi.write(f'HARDCOPY:FILENAME "{temp_file}"')\n${ind}scpi.write('HARDCOPY START')\n${ind}time.sleep(0.5)\n${ind}scpi.write(f'FILESYSTEM:READFILE "{temp_file}"')\n${xopt.enablePerformanceOptimization ? `${ind}data = read_ieee_block(scpi)\n` : `${ind}data = scpi.read_raw()\n`}${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n${ind}log_cmd('FILESYSTEM:READFILE', data)\n${ind}scpi.write(f'FILESYSTEM:DELETE "{temp_file}"')\n`;
            } else {
              out += `${ind}scpi.write(${JSON.stringify(cmd)})\n${ind}data = scpi.query_binary_values('', datatype='B', container=bytes)\n${ind}pathlib.Path(${JSON.stringify(fn)}).write_bytes(data)\n${ind}log_cmd(${JSON.stringify(cmd)}, data)\n`;
            }
          }
          continue;
        }
        
        if (s.type === 'error_check') {
          const errCmd = s.params.command || 'ALLEV?';
          out += `${ind}try:\n${ind}    err = scpi.query("${errCmd}")\n${ind}    log_cmd("${errCmd}", err)\n${ind}except Exception: pass\n`;
          continue;
        }
        
        // Handle set_and_query type - performs both SET and QUERY
        if (s.type === 'set_and_query') {
          let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
          const cmdHeader = cmd.replace(/\?$/, '').split(/\s+/)[0];
          const queryCmd = cmdHeader + '?';
          const paramValues = s.params.paramValues || {};
          const valueParam = paramValues['value'] || paramValues['Value'] || '';
          
          // Build write command with value
          let writeCmd = cmd.replace(/\?$/, '');
          if (writeCmd === cmdHeader && valueParam) {
            writeCmd = `${cmdHeader} ${valueParam}`;
          }
          
          const varName = s.params.saveAs || 'result';
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Set+Query'}")\n`;
          out += `${ind}scpi.write(${JSON.stringify(writeCmd)})\n`;
          out += `${ind}${varName} = scpi.query(${JSON.stringify(queryCmd)}).strip()\n`;
          out += `${ind}log_cmd(${JSON.stringify(queryCmd)}, ${varName})\n`;
          out += `${ind}print(f"  ${queryCmd}: {${varName}}")\n`;
          continue;
        }
        
        if (s.type !== 'query' && s.type !== 'write') continue;

        let cmd = subst(s.params.command, s.params.cmdParams || [], s.params.paramValues || {});
        // Substitute sweep variable if in sweep context
        let needsFString = false;
        if (sweepContext) {
          const varPattern = new RegExp(`\\$\\{${sweepContext.varName}\\}`, 'g');
          if (varPattern.test(cmd)) {
            cmd = cmd.replace(varPattern, `{${sweepContext.varName}}`);
            needsFString = true;
          }
        }
        
        // Check if this is a tm_devices high-level command (contains . notation)
        const isTmDevicesCommand = cmd.includes('.commands.') || cmd.includes('.add_') || cmd.includes('.save_') || 
                                    cmd.includes('.turn_') || cmd.includes('.set_and_check') || cmd.includes('.get_');
        
        const useTek = cmd.startsWith('TEKEXP:') && !isVxi11;
        const devVar = useTek ? 'tek' : 'scpi';

        if (s.type === 'query') {
          const varName = s.params.saveAs || 'result';
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Querying'}")\n`;
          // *OPC? queries are needed for proper synchronization (especially for SAVE:IMAGE and FILESYSTEM operations)
          if (cmd === '*OPC?') {
            out += `${ind}${devVar}.query("*OPC?")  # wait for operation to complete\n`;
          } else if (isTmDevicesCommand) {
            // tm_devices high-level command - output directly, no quotes
            const cmdStr = needsFString ? `f"${cmd}"` : cmd;
            out += `${ind}${varName} = ${cmdStr}\n${ind}print(f"  ${varName}: {${varName}}")\n`;
          } else {
            const cmdStr = needsFString ? `f${JSON.stringify(cmd)}` : JSON.stringify(cmd);
            out += `${ind}${varName} = ${devVar}.query(${cmdStr}).strip()\n${ind}log_cmd(${cmdStr}, ${varName})\n${ind}print(f"  ${cmd}: {${varName}}")\n`;
          }
          if (cmd === 'TEKEXP:STATE?' && hasStateRun) {
            const tv = useTek ? 'tek' : 'scpi';
            out += `${ind}# TekExpress run loop\n${ind}while ${tv}.query("TEKEXP:STATE?").strip('"') != 'READY':\n${ind}    state = ${tv}.query("TEKEXP:STATE?").strip('"')\n${ind}    if state == 'RUNNING':\n${ind}        sleep(2)\n${ind}        print("Application Status: RUNNING...")\n${ind}    elif state in ['WAIT','ERROR']:\n${ind}        info = ${tv}.query("TEKEXP:POPUP?")\n${ind}        parts = info.split(';')\n${ind}        if len(parts) >= 3:\n${ind}            responses = parts[2].split('=')[1].strip('"').split(',')\n${ind}            choice = 0  # TODO: choose programmatically\n${ind}            ${tv}.write(f'TEKEXP:POPUP "{responses[choice]}"')\n`;
          }
        } else {
          if (enablePrintMessages) out += `${ind}print("${s.label || 'Sending command'}")\n`;
          // CRITICAL: Don't allow HARDCopy:DATa? as a write command - it should be save_waveform
          if (cmd.toUpperCase().includes('HARDCOPY') && cmd.toUpperCase().includes('DATA')) {
            out += `${ind}# WARNING: HARDCopy:DATa? should use save_waveform step with FILESYSTEM route\n${ind}# Skipping this command - use save_waveform instead\n`;
          } else if (isTmDevicesCommand) {
            // tm_devices high-level command - output directly, no quotes
            const cmdStr = needsFString ? `f"${cmd}"` : cmd;
            out += `${ind}${cmdStr}\n`;
          } else {
            const cmdStr = needsFString ? `f${JSON.stringify(cmd)}` : JSON.stringify(cmd);
            out += `${ind}${devVar}.write(${cmdStr})\n`;
          }
          if (cmd === 'TEKEXP:STATE RUN') {
            hasStateRun = true;
            const tv = useTek ? 'tek' : 'scpi';
            out += `${ind}print("Starting TekExpress execution...")\n${ind}while ${tv}.query("TEKEXP:STATE?").strip('"') != 'RUNNING': sleep(1)\n`;
          }
        }
      }
      return out;
    };

    if (isTekHSI) {
      const host = config.connectionType === 'tcpip' ? config.host : '127.0.0.1';
      return (
        header +
        `
from tekhsi import TekHSIConnect

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="${host}")
    args = p.parse_args()
    
    print(f"Connecting via TekHSI to {args.host}:5000...")
    with TekHSIConnect(f"{args.host}:5000") as scope:
        print(f"✓ Connected: {args.host}:5000")
        print(f"✓ ID: {scope.idn}")

` +
        genStepsTekHSI(steps) +
        `
        print("✓ Complete")

if __name__ == "__main__":
    main()
`
      );
    }

    if (isHybrid) {
      const host = config.connectionType === 'tcpip' ? config.host : '127.0.0.1';
      
      // Check if we're using tm_devices commands (recursively check groups) - MUST check BEFORE generating code
      const hasTmDevicesCommands = (() => {
        const checkStep = (s: Step): boolean => {
          if (s.type === 'group' && s.children) {
            return s.children.some(checkStep);
          }
          if ((s.type === 'query' || s.type === 'write') && s.params.command) {
            const cmd = s.params.command || '';
            return cmd.includes('.commands.') || 
                   cmd.includes('.add_') || 
                   cmd.includes('.save_');
          }
          if (s.type === 'python' && s.params?.code) {
            const code = s.params.code || '';
            return code.includes('.commands.') || 
                   code.includes('.add_') || 
                   code.includes('.save_');
          }
          return false;
        };
        return steps.some(checkStep);
      })();
      
      const usesProcessWaveform = stepContainsProcessWaveform(steps);
      const processStub = usesProcessWaveform
        ? '    def process_waveform(wf):\n        """Placeholder for TekHSI waveform processing."""\n        pass\n\n'
        : '';
      const hybridSteps = genStepsHybrid(steps, '        ');
      
      if (hasTmDevicesCommands) {
        // tm_devices + TekHSI hybrid mode
        const deviceType = config.deviceType.toLowerCase();
        const deviceDriver = config.deviceDriver || '';
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _alias = config.alias || 'scope1';
        const visaBackendImport = config.visaBackend === 'pyvisa-py' ? 'PYVISA_PY_BACKEND' : 'SYSTEM_DEFAULT_VISA_BACKEND';
        const driverImport = deviceDriver ? `from tm_devices.drivers import ${deviceDriver}\n` : '';
        const deviceVarDeclaration = deviceDriver 
          ? `${deviceType}: ${deviceDriver} = device_manager.add_${deviceType}(f"{args.address}")`
          : `${deviceType} = device_manager.add_${deviceType}(f"{args.address}")`;
        
        // Process steps in order, separating tm_devices and TekHSI commands
        const isTekHSIStep = (s: Step): boolean => {
          if (s.type === 'save_waveform') return true;
          if (s.type === 'python' && s.params?.code) {
            const code = s.params.code;
            return (code.includes('scope.') && !code.includes('scope.commands.') && !code.includes('scope.add_') && !code.includes('scope.save_')) || 
                   code.includes('TekHSIConnect') || code.includes('access_data') || code.includes('get_data');
          }
          if (s.type === 'query' || s.type === 'write') {
            const cmd = s.params.command || '';
            return (cmd.startsWith('scope.') && !cmd.includes('.commands.') && !cmd.includes('.add_') && !cmd.includes('.save_')) || cmd.startsWith('#');
          }
          return false;
        };
        
        // Generate code with proper interleaving
        let stepsCode = '';
        let inTekHSIBlock = false;
        let tekhsiStepsAccumulator: Step[] = [];
        
        const flushTekHSIBlock = () => {
          if (tekhsiStepsAccumulator.length > 0) {
            const tekhsiCode = genStepsHybrid(tekhsiStepsAccumulator, '            ')
              .replace(/\bscope\.(?!commands\.|add_|save_)/g, 'connect.');
            stepsCode += `
        # Connect to instrument via TekHSI
        with TekHSIConnect(f"{${deviceType}.ip_address}:5000", ["ch1"]) as connect:
${tekhsiCode}`;
            tekhsiStepsAccumulator = [];
            inTekHSIBlock = false;
          }
        };
        
        const processSteps = (items: Step[], indent: string) => {
          for (const s of items) {
            if (s.type === 'group') {
              if (s.children) {
                stepsCode += `${indent}# Group: ${s.label}\n`;
                processSteps(s.children, indent);
              }
              continue;
            }
            
            if (isTekHSIStep(s)) {
              if (!inTekHSIBlock) {
                // Start TekHSI block (no need to flush, we're starting fresh)
                inTekHSIBlock = true;
              }
              tekhsiStepsAccumulator.push(s);
            } else {
              // tm_devices or SCPI step
              if (inTekHSIBlock) {
                // Close TekHSI block first
                flushTekHSIBlock();
              }
              
              // Generate this step as tm_devices/SCPI
              const stepCode = genStepsHybrid([s], indent)
                .replace(/scpi\.write/g, `${deviceType}.visa_resource.write`)
                .replace(/scpi\.query/g, `${deviceType}.visa_resource.query`)
                .replace(/scpi\./g, `${deviceType}.visa_resource.`)
                .replace(/\bscope\.commands\./g, `${deviceType}.commands.`)
                .replace(/\bscope\.add_/g, `${deviceType}.add_`)
                .replace(/\bscope\.save_/g, `${deviceType}.save_`);
              stepsCode += stepCode;
            }
          }
        };
        
        processSteps(steps, '        ');
        // Flush any remaining TekHSI steps
        flushTekHSIBlock();
        
        return (
          header +
          `
from tm_data_types import AnalogWaveform
from tm_devices import DeviceManager
from tm_devices.helpers import ${visaBackendImport}
${driverImport}from tekhsi import TekHSIConnect

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--address", default="${host}")
    args = p.parse_args()
    
    print(f"Connecting hybrid mode: tm_devices + TekHSI...")
    with DeviceManager(verbose=True) as device_manager:
        device_manager.visa_library = ${visaBackendImport}
        
        ${deviceVarDeclaration}
        print(f"✓ Connected: {${deviceType}.model}")
        ${deviceDriver ? `print(f"✓ Using ${deviceDriver} driver")` : `print(f"✓ Auto-detected driver: {${deviceType}.series}")`}

` +
          stepsCode + '\n' +
          `    print("✓ Disconnected")

if __name__ == "__main__":
    main()
`
        );
      } else {
        // PyVISA + TekHSI hybrid mode
        return (
          header +
          `
from tekhsi import TekHSIConnect
import pyvisa

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--visa", default="${getVisaResourceString()}")
    p.add_argument("--host", default="${host}")
    p.add_argument("--timeout", type=float, default=${config.timeout})
    args = p.parse_args()
    
    print(f"Connecting hybrid mode: PyVISA + TekHSI...")
    rm = pyvisa.ResourceManager()
    scpi = rm.open_resource(args.visa)
    scpi.timeout = int(args.timeout * 1000)
    scpi.write_termination = "\\n"
    scpi.read_termination = None  # binary safe
    ${xopt.enablePerformanceOptimization ? `scpi.chunk_size = 128 * 1024 * 1024  # 128 MB chunks for speed (performance optimization enabled)` : `# Using default chunk size`}
    print(f"✓ PyVISA connected")
    
    # TekHSI connection handled in context manager below

` +
          logBlock + '\n' +
          measurementsBlock + '\n' +
          processStub +
          `    with TekHSIConnect(f"{args.host}:5000") as scope:
        print(f"✓ TekHSI connected: {args.host}:5000")
` +
          (hybridSteps ? hybridSteps + '\n' : '') +
          `        print("✓ TekHSI session closed")
    scpi.close()
    rm.close()
    print("✓ Disconnected")

if __name__ == "__main__":
    main()
`
        );
      }
    }

    // VXI-11 (standalone vxi11 package)
    if (isVxi11) {
      const host = config.connectionType === 'tcpip' ? config.host : '127.0.0.1';
      return (
        header +
        `
import vxi11
import argparse
import time
import pathlib

` +
        binQueryHelper + `
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="${host}")
    p.add_argument("--timeout", type=float, default=${config.timeout})
    args = p.parse_args()
    
    print(f"Connecting via VXI-11 to {args.host}...")
    # VXI-11 connection (direct, no VISA dependency)
    instrument = vxi11.Instrument(args.host)
    instrument.timeout = int(args.timeout * 1000)  # milliseconds
    
    idn = instrument.ask("*IDN?")
    print(f"✓ Connected: {idn}")

` +
        (xopt.saveCsv
          ? `    logf = open(${JSON.stringify(xopt.csvName)}, "w", newline="", buffering=1)
    log = csv.writer(logf)
    log.writerow(["ts","cmd","resp_len"])
    
    def log_cmd(cmd, resp):
        try:
            n = len(resp) if isinstance(resp,(bytes,bytearray)) else len(str(resp))
        except Exception:
            n = -1
        log.writerow([time.time(), cmd, n])
        logf.flush()

`
          : `    def log_cmd(cmd, resp):
        pass

`) +
        genStepsVxi11(steps, '    ') +
        (xopt.saveCsv ? '\n    logf.close()' : '') +
        (xopt.exportMeasurements ? '\n    measurements_file.close()' : '') +
        `
    instrument.close()
    print("✓ Complete")

if __name__ == "__main__":
    main()
`
      );
    }

    // Pure PyVISA
    if (isPyVISA) {
      const resourceStr = getVisaResourceString();
      return (
        header +
        `
import pyvisa

` +
        binQueryHelper + `
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--visa", default="${resourceStr}")
    p.add_argument("--timeout", type=float, default=${config.timeout})
    args = p.parse_args()
    
    print(f"Connecting via ${config.backend === 'vxi11' ? 'VXI-11' : 'PyVISA'} to {args.visa}...")
    rm = pyvisa.ResourceManager()
    scpi = rm.open_resource(args.visa)
    scpi.timeout = int(args.timeout * 1000)
    scpi.write_termination = "\\n"
    ${config.connectionType === 'socket' ? `scpi.read_termination = "\\n"  # Socket requires line termination` : `scpi.read_termination = None  # binary safe`}
    ${xopt.enablePerformanceOptimization ? `scpi.chunk_size = 128 * 1024 * 1024  # 128 MB chunks for speed (performance optimization enabled)` : `# Using default chunk size`}
    
    idn = scpi.query("*IDN?").strip()
    print(f"✓ Connected: {idn}")

` +
        (hasTekExpress
          ? `    # TekExpress socket on port 5000
    tek = rm.open_resource(f"TCPIP0::{config.host}::5000::SOCKET")
    tek.timeout = int(args.timeout * 1000)
    tek.write_termination = "\\n"
    tek.read_termination = None
    print("✓ TekExpress ready")

`
          : '') +
        logBlock + '\n' +
        measurementsBlock + '\n' +
        genStepsClassic(steps) +
        `
    # Error queue tail
    try:
        err = scpi.query('ALLEV?').strip()
        log_cmd('ALLEV?', err)
    except Exception:
        pass
` +
        (xopt.saveCsv ? '\n    logf.close()' : '') +
        (xopt.exportMeasurements ? '\n    measurements_file.close()' : '') +
        `
    scpi.close()
    rm.close()
    print("✓ Complete")

if __name__ == "__main__":
    main()
`
      );
    }

    // tm_devices: Uses high-level API with fallback to VISA for advanced operations
    if (isTmDevices) {
      // For tm_devices, use just the host/IP address, not full VISA resource string
      const host = config.connectionType === 'tcpip' ? config.host : 
                   config.connectionType === 'socket' ? getVisaResourceString() : 
                   getVisaResourceString();
      const deviceType = config.deviceType.toLowerCase();
      const deviceDriver = config.deviceDriver || ''; // Empty = auto-detect
      const alias = config.alias || 'scope1';
      const visaBackendImport = config.visaBackend === 'pyvisa-py' ? 'PYVISA_PY_BACKEND' : 'SYSTEM_DEFAULT_VISA_BACKEND';
      
      // Check if we're using high-level commands (scope.commands, scope.add_, etc)
      const hasHighLevelCommands = steps.some(s => 
        (s.type === 'query' || s.type === 'write') && 
        s.params.command && 
        (s.params.command.includes('.commands.') || s.params.command.includes('.add_') || s.params.command.includes('.save_'))
      );
      
      const hasWaveformStep = steps.some(s => s.type === 'save_waveform' && (!s.params.command || s.params.command === 'CURVe?'));
      
      // Build import statements - only import driver if specified (for type hinting)
      const driverImport = deviceDriver ? `from tm_devices.drivers import ${deviceDriver}\n` : '';
      
      // Generate steps code, replacing scpi with visa for tm_devices
      // Use 4 spaces indentation to match the with DeviceManager block
      const stepsCode = genStepsClassic(steps, '        ')
        .replace(/scpi\.write/g, 'visa.write')
        .replace(/scpi\.query/g, 'visa.query')
        .replace(/scpi\./g, 'visa.')
        .replace(/read_ieee_block\(scpi\)/g, 'read_ieee_block(visa)')
        .replace(/read_waveform_binary\(scpi/g, 'read_waveform_binary(visa');
      
      // Use type hinting for driver specification (tm_devices doesn't accept device_driver parameter)
      const deviceVarDeclaration = deviceDriver 
        ? `${deviceType}: ${deviceDriver} = device_manager.add_${deviceType}(args.address${alias ? `, alias="${alias}"` : ''})`
        : `${deviceType} = device_manager.add_${deviceType}(args.address${alias ? `, alias="${alias}"` : ''})`;
      
      return (
        header +
        `
from tm_devices import DeviceManager
from tm_devices.helpers import ${visaBackendImport}
${driverImport}

` +
        (hasWaveformStep && !hasHighLevelCommands ? binQueryHelper : '') + `
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--address", default="${host}")
    args = p.parse_args()
    
    print(f"Connecting via tm_devices to {args.address}...")
    with DeviceManager(verbose=True) as device_manager:
        # Enable resetting devices when connecting and closing
        device_manager.setup_cleanup_enabled = True
        device_manager.teardown_cleanup_enabled = True
        
        # Set VISA backend
        device_manager.visa_library = ${visaBackendImport}
        
        # Add ${deviceType}${deviceDriver ? ` (${deviceDriver} driver via type hint)` : ' (auto-detect driver)'}
        ${deviceVarDeclaration}
        print(f"✓ Connected: {${deviceType}.model}")
        ${deviceDriver ? `print(f"✓ Using ${deviceDriver} driver")` : `print(f"✓ Auto-detected driver: {${deviceType}.series}")`}

` +
        (hasHighLevelCommands ? '' : `        # Access underlying VISA resource for low-level SCPI commands
        visa = ${deviceType}.visa_resource
        visa.read_termination = None  # binary safe${xopt.enablePerformanceOptimization ? '\n        visa.chunk_size = 128 * 1024 * 1024  # 128 MB chunks for speed (performance optimization enabled)' : ''}

`) +
        (!hasHighLevelCommands ? (() => {
          // For tm_devices, logBlock needs 8 spaces (inside with DeviceManager block)
          const tmLogBlock = xopt.saveCsv
            ? `        # Command logging (logs SCPI commands, not measurement data)
        logf = open(${JSON.stringify(xopt.csvName)}, "w", newline="", buffering=1)
        log = csv.writer(logf)
        log.writerow(["ts","cmd","resp_len"])
        
        def log_cmd(cmd, resp):
            try:
                n = len(resp) if isinstance(resp,(bytes,bytearray)) else len(str(resp))
            except Exception:
                n = -1
            log.writerow([time.time(), cmd, n])
            logf.flush()  # Flush immediately so data is visible

`
            : `        def log_cmd(cmd, resp):
            pass

`;

          const tmMeasurementsBlock = xopt.exportMeasurements
            ? `        # Measurement data export (actual measurement values)
        measurements_file = open(${JSON.stringify(xopt.measurementsFilename)}, "w", newline="")
        measurements_csv = csv.writer(measurements_file)
        measurements_csv.writerow(["timestamp", "measurement_type", "source", "value", "unit"])
        
        def save_measurement(meas_type, source, value, unit=""):
            measurements_csv.writerow([time.time(), meas_type, source, value, unit])
            measurements_file.flush()

`
            : `        def save_measurement(meas_type, source, value, unit=""):
            pass

`;
          return '\n' + tmLogBlock + '\n' + tmMeasurementsBlock;
        })() : '') +
        '\n' +
        stepsCode +
        (xopt.saveCsv && !hasHighLevelCommands ? '\n        logf.close()' : '') +
        (xopt.exportMeasurements && !hasHighLevelCommands ? '\n        measurements_file.close()' : '') +
        `
        print("✓ Complete")

if __name__ == "__main__":
    main()
`
      );
    }

    return "# Error: Unknown backend configuration";
  };

  const doExport = () => {
    triggerControls.thinking(); // Show thinking animation
    try {
      const code = generatePython();
      const blob = new Blob([code], { type: 'text/x-python' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = xopt.scriptName || 'tek_automation.py'; a.click();
      URL.revokeObjectURL(url);
      // Show celebration animation after a short delay
      setTimeout(() => {
        triggerControls.celebrate();
      }, 500);
    } catch (error) {
      triggerControls.error();
      console.error('Export failed:', error);
    }
  };

  const renderStep = (step: Step, depth = 0) => {
    const paletteItem = STEP_PALETTE.find((p) => p.type === step.type);
    const Icon = paletteItem?.icon || AlertCircle;
    const isSelected = selectedStep === step.id;
    const isMultiSelected = selectedSteps.includes(step.id);
    const isGroup = step.type === 'group';
    const isDragOver = dragOverGroup === step.id;

    return (
      <div key={step.id} style={{ marginLeft: `${depth * 16}px` }}>
        <div
          draggable
          onDragStart={(e) => {
            handleDragStart(e, step.id);
            e.dataTransfer.setData('text/plain', step.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => handleDragOver(e, step.id, false)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, step.id, false)}
          onClick={(e) => handleStepClick(step.id, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, stepId: step.id });
          }}
          className={`p-2.5 bg-white rounded-lg border-2 cursor-move transition-all mb-1.5 ${
            isSelected ? 'border-blue-500 shadow-md' :
            isMultiSelected ? 'border-blue-300 bg-blue-50 shadow-sm' :
            isDragOver ? 'border-green-500 bg-green-50' :
            'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isGroup && (
                <button
                  onClick={(e) => { e.stopPropagation(); updateStep(step.id, { collapsed: !step.collapsed }); }}
                  className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0"
                  title={step.collapsed ? 'Expand' : 'Collapse'}
                >
                  <ChevronRight size={14} className={`transition-transform ${step.collapsed ? '' : 'rotate-90'}`} />
                </button>
              )}
              <div className={`w-6 h-6 rounded ${paletteItem?.color} flex items-center justify-center flex-shrink-0`}>
                <Icon size={12} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  <span className="font-medium text-xs truncate">{step.label}</span>
                  {step.category && (
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${categoryColors[step.category] || 'bg-gray-100'}`}>
                      {step.category}
                    </span>
                  )}
                  {step.subcategory && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                      {step.subcategory}
                    </span>
                  )}
                  {step.category === 'TekHSI' && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded border border-red-300">
                      <Zap size={8} className="inline" /> gRPC
                    </span>
                  )}
                </div>
                {!isGroup && (
                  <div className="text-xs text-gray-500 truncate">
                    {step.type === 'query' && substituteSCPI(step.params.command, step.params.cmdParams || [], step.params.paramValues || {})}
                    {step.type === 'write' && substituteSCPI(step.params.command, step.params.cmdParams || [], step.params.paramValues || {})}
                    {step.type === 'set_and_query' && (() => {
                      const cmd = substituteSCPI(step.params.command || '', step.params.cmdParams || [], step.params.paramValues || {});
                      const cmdHeader = cmd.replace(/\?$/, '').split(/\s+/)[0];
                      const paramValues = step.params.paramValues || {};
                      const valueParam = paramValues['value'] || paramValues['Value'] || '';
                      // Build full command with value
                      let fullCmd = cmd.replace(/\?$/, '');
                      if (fullCmd === cmdHeader && valueParam) {
                        fullCmd = `${cmdHeader} ${valueParam}`;
                      }
                      return fullCmd;
                    })()}
                    {step.type === 'sleep' && `${step.params.duration}s`}
                    {step.type === 'comment' && `# ${step.params.text || step.label || ''}`}
                    {step.type === 'python' && ((step.params.code || '').split('\n')[0] || '').trim()}
                    {step.type === 'save_waveform' && `${step.params.source || 'CH1'} → ${step.params.filename || 'data.bin'}`}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                className="p-1 hover:bg-gray-100 rounded"
                title="Move up"
                onClick={(e) => { e.stopPropagation(); moveUp(step.id); }}
              >
                ▲
              </button>
              <button
                className="p-1 hover:bg-gray-100 rounded"
                title="Move down"
                onClick={(e) => { e.stopPropagation(); moveDown(step.id); }}
              >
                ▼
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteStep(step.id); }}
                className="p-1 hover:bg-red-100 text-red-600 rounded"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>

        {isGroup && !step.collapsed && (
          <div
            className={`ml-3 border-l-2 pl-2 ${isDragOver ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}
            onDragOver={(e) => handleDragOver(e, step.id, true)}
            onDrop={(e) => handleDrop(e, step.id, true)}
          >
            {step.children && step.children.map((c) => renderStep(c, depth + 1))}
            <button onClick={() => addStep('write', step.id)} className="w-full p-2 text-xs text-gray-500 hover:bg-gray-50 rounded border-2 border-dashed mt-1">
              + Add to group
            </button>
          </div>
        )}
      </div>
    );
  };

  // Get categories with command counts for library view
  // Categories are the groups from the SELECTED JSON file only
  const libraryCategories = useMemo(() => {
    const catMap = new Map<string, number>();
    
    // Find which JSON file corresponds to selected device family
    const selectedFile = Object.entries(FILE_TO_DEVICE_FAMILY).find(
      ([_, family]) => family.id === selectedDeviceFamily
    )?.[0];
    
    // Only count categories from commands that belong to the selected JSON file
    commandLibrary.filter(cmd => {
      if (!selectedFile) return true; // No filter if no file selected
      return cmd.sourceFile === selectedFile;
    }).forEach(cmd => {
      catMap.set(cmd.category, (catMap.get(cmd.category) || 0) + 1);
    });
    
    return Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [commandLibrary, selectedDeviceFamily]);

  // Debounced search for library view
  useEffect(() => {
    if (librarySearchTimeoutRef.current) {
      clearTimeout(librarySearchTimeoutRef.current);
    }
    librarySearchTimeoutRef.current = setTimeout(() => {
      setLibrarySearchDebounced(searchQuery);
      setLibraryVisibleCount(50); // Reset visible count on search
    }, 300);
    return () => {
      if (librarySearchTimeoutRef.current) {
        clearTimeout(librarySearchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const filteredCommands = useMemo(() => {
    const q = librarySearchDebounced.toLowerCase();
    
    return commandLibrary.filter((cmd) => {
      // STEP 1: Filter by device family (source file) - this is the PRIMARY filter
      // This ensures MSO commands only show when MSO is selected, DPO only when DPO is selected
      if (!isCommandCompatible(cmd)) {
        return false;
      }
      
      // STEP 2: Apply category filter
      const matchesCategory = selectedCategory === null || cmd.category === selectedCategory;
      if (!matchesCategory) {
        return false;
      }
      
      // STEP 3: Apply search filter if there's a search query
      if (q) {
        const searchableFields = [
          cmd.name,
          cmd.scpi,
          cmd.description,
          cmd.category,
          cmd.example,
          // Arguments text
          (cmd as any).arguments,
          // Parameter names and descriptions
          ...(cmd.params?.map(p => `${p.name} ${p.description || ''} ${p.options?.join(' ') || ''}`) || []),
          // Manual entry fields
          cmd.manualEntry?.arguments,
          cmd.manualEntry?.shortDescription,
          cmd.manualEntry?.commandGroup,
          cmd.manualEntry?.mnemonics?.join(' '),
          // Examples
          ...(cmd.manualEntry?.examples?.map((ex: any) => `${ex.description || ''} ${ex.codeExamples?.scpi?.code || ''}`) || []),
        ].filter(Boolean).map(s => String(s).toLowerCase());
        
        const matchesSearch = searchableFields.some(field => field.includes(q));
        if (!matchesSearch) {
          return false;
        }
      }
      
      return true;
    });
  }, [commandLibrary, librarySearchDebounced, selectedCategory, selectedDeviceFamily]);

  // Infinite scroll for library view
  const visibleLibraryCommands = useMemo(() => 
    filteredCommands.slice(0, libraryVisibleCount),
    [filteredCommands, libraryVisibleCount]
  );
  const hasMoreCommands = libraryVisibleCount < filteredCommands.length;

  // Reset visible count when filters change
  useEffect(() => {
    setLibraryVisibleCount(50);
  }, [librarySearchDebounced, selectedCategory, selectedDeviceFamily]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = libraryScrollSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreCommands) {
          setLibraryVisibleCount(prev => Math.min(prev + 50, filteredCommands.length));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreCommands, filteredCommands.length]);

  const findStep = (items: Step[], id: string): Step | null => {
    for (const i of items) {
      if (i.id === id) return i;
      if (i.children) {
        const f = findStep(i.children, id);
        if (f) return f;
      }
    }
    return null;
  };

  // Context menu items generator
  const getContextMenuItems = (stepId: string): ContextMenuItem[] => {
    const step = findStep(steps, stepId);
    if (!step) return [];

    const isGroup = step.type === 'group' || step.type === 'sweep';
    const isScpiStep = step.type === 'query' || step.type === 'write' || step.type === 'set_and_query';
    
    // Check if command supports both set and query (for Transform to Set+Query)
    const cmdType = (() => {
      if (!isScpiStep) return 'unknown';
      const cmd = step.params?.command || '';
      const libraryCmd = commandLibrary.find(c => {
        const cmdHeader = c.scpi.split(/\s/)[0].replace(/\?$/, '');
        const stepHeader = cmd.split(/\s/)[0].replace(/\?$/, '');
        return cmdHeader.toUpperCase() === stepHeader.toUpperCase();
      });
      if (libraryCmd?.manualEntry?.commandType) return libraryCmd.manualEntry.commandType;
      // Fallback: most SCPI commands support both set and query
      // Only pure query commands (like *IDN?) are query-only
      const isQueryOnlyCmd = cmd.trim().endsWith('?') && cmd.includes('*');
      return isQueryOnlyCmd ? 'query' : 'both';
    })();
    
    // Get all groups for "Move to Group" option
    const groups = steps.filter(s => s.type === 'group' || s.type === 'sweep');
    
    const items: ContextMenuItem[] = [
      {
        label: 'Duplicate',
        icon: <Copy size={14} />,
        onClick: () => duplicateStep(stepId)
      },
      {
        label: 'Copy',
        icon: <Copy size={14} />,
        onClick: () => {
          navigator.clipboard.writeText(JSON.stringify(step, null, 2));
          window.alert('Step copied to clipboard');
        }
      },
      { separator: true },
      {
        label: 'Move Up',
        icon: <ArrowUp size={14} />,
        onClick: () => moveUp(stepId)
      },
      {
        label: 'Move Down',
        icon: <ArrowDown size={14} />,
        onClick: () => moveDown(stepId)
      },
      { separator: true }
    ];

    // "Transform to Set+Query" for SCPI steps that support both
    if (isScpiStep && step.type !== 'set_and_query' && cmdType === 'both') {
      items.push({
        label: 'Transform to Set+Query',
        icon: <RefreshCw size={14} />,
        onClick: () => {
          updateStep(stepId, {
            type: 'set_and_query',
            label: step.label.replace(/ \((Set|Query)\)$/, '') + ' (Set+Query)',
            params: { ...step.params, saveAs: undefined }
          });
        }
      });
      items.push({ separator: true });
    }

    // "Add Python Snippet" for Set+Query steps with a saved variable
    if (step.type === 'set_and_query') {
      items.push({
        label: 'Add Python Snippet',
        icon: <Code2 size={14} />,
        onClick: () => {
          const varName = step.params?.saveAs;
          const cmd = step.params?.command || '';
          const cmdHeader = cmd.split(/\s+/)[0]?.replace(/\?$/, '') || 'command';
          
          if (!varName) {
            // Prompt user to enable Save Verified Value first
            const enableSave = window.confirm(
              'To use Python snippets, you need to enable "Save Verified Value" first.\n\n' +
              'Would you like to enable it now? A variable name will be auto-generated.'
            );
            if (enableSave) {
              // Generate a variable name
              const baseName = cmdHeader.split(':').pop()?.toLowerCase() || 'result';
              updateStep(stepId, { 
                params: { ...step.params, saveAs: baseName }
              });
              setSelectedStep(stepId);
            }
            return;
          }
          
          // Show snippet selection
          const snippetOptions = [
            '1. Assert value equals expected',
            '2. Assert value in range',
            '3. Conditional check (if/else)',
            '4. Log value to console',
            '5. Store in dictionary',
            '6. Custom snippet'
          ];
          
          const selection = window.prompt(
            `Select Python snippet to add after "${step.label}":\n\n` +
            snippetOptions.join('\n') +
            '\n\nEnter number (1-6):',
            '1'
          );
          
          if (!selection) return;
          
          // Extract the set value from the command (everything after the header)
          const cmdParts = cmd.split(/\s+/);
          const setValue = cmdParts.length > 1 ? cmdParts.slice(1).join(' ').replace(/^["']|["']$/g, '') : '';
          // Get the actual value from dropdown (paramValues) first
          const paramValues = step.params?.paramValues || {};
          const dropdownValue = paramValues['value'] || paramValues['Value'] || '';
          const defaultValue = dropdownValue || setValue || '';
          
          let code = '';
          const selNum = parseInt(selection);
          
          switch (selNum) {
            case 1: // Assert equals
              const expected = window.prompt(`Enter expected value for ${varName}:`, defaultValue);
              if (!expected) return;
              code = `# Verify ${cmdHeader} returned expected value\nassert ${varName} == "${expected}", f"Expected '${expected}', got '{${varName}}'"`;
              break;
            case 2: // Assert in range
              const minVal = window.prompt('Enter minimum value:', '0');
              const maxVal = window.prompt('Enter maximum value:', '100');
              if (!minVal || !maxVal) return;
              code = `# Verify ${cmdHeader} is within expected range\nvalue = float(${varName})\nassert ${minVal} <= value <= ${maxVal}, f"Value {value} out of range [${minVal}, ${maxVal}]"`;
              break;
            case 3: // Conditional
              code = `# Conditional check on ${cmdHeader}\nif ${varName} == "${defaultValue}":\n    print(f"${cmdHeader} matches expected value")\nelse:\n    print(f"${cmdHeader} mismatch: expected '${defaultValue}', got '{${varName}}'")`;
              break;
            case 4: // Log
              code = `# Log ${cmdHeader} value\nprint(f"${cmdHeader} = {${varName}}")`;
              break;
            case 5: // Store in dict
              code = `# Store ${cmdHeader} in results dictionary\nif 'results' not in dir():\n    results = {}\nresults['${cmdHeader.split(':').pop()?.toLowerCase() || 'value'}'] = ${varName}`;
              break;
            case 6: // Custom
              code = `# Custom snippet using ${varName}\n# ${varName} contains the query response from ${cmdHeader}`;
              break;
            default:
              return;
          }
          
          // Insert Python step after this step
          const newPythonStep: Step = {
            id: crypto.randomUUID(),
            type: 'python',
            label: `Python: ${['Assert equals', 'Assert range', 'Conditional', 'Log', 'Store', 'Custom'][selNum - 1] || 'Snippet'}`,
            params: { code }
          };
          
          // Insert after the current step
          const insertAfter = (arr: Step[], targetId: string, newItem: Step): Step[] => {
            const result: Step[] = [];
            for (const s of arr) {
              result.push(s);
              if (s.id === targetId) {
                result.push(newItem);
              }
              if (s.children) {
                s.children = insertAfter(s.children, targetId, newItem);
              }
            }
            return result;
          };
          commit(insertAfter(steps, stepId, newPythonStep));
          setSelectedStep(newPythonStep.id);
        }
      });
      items.push({ separator: true });
    }

    // "Create New Group" option
    items.push({
      label: 'Create New Group',
      icon: <Folder size={14} />,
      onClick: () => {
        const groupName = window.prompt('Enter group name:', 'New Group');
        if (groupName) {
          const newGroup: Step = {
            id: crypto.randomUUID(),
            type: 'group',
            label: groupName,
            params: {},
            children: [],
            collapsed: false
          };
          // Insert after the current step
          const insertAfter = (arr: Step[], targetId: string, newItem: Step): Step[] => {
            const result: Step[] = [];
            for (const s of arr) {
              result.push(s);
              if (s.id === targetId) {
                result.push(newItem);
              }
              if (s.children) {
                s.children = insertAfter(s.children, targetId, newItem);
              }
            }
            return result;
          };
          commit(insertAfter(steps, stepId, newGroup));
        }
      }
    });

    // "Move to Group" options for each existing group
    if (groups.length > 0 && !isGroup) {
      groups.forEach(group => {
        if (group.id !== stepId) {
          // Check if multiple steps are selected
          const stepsToMove = selectedSteps.length > 1 && selectedSteps.includes(stepId)
            ? steps.filter(s => selectedSteps.includes(s.id))
            : [step];
          
          items.push({
            label: selectedSteps.length > 1 && selectedSteps.includes(stepId)
              ? `Move ${selectedSteps.length} steps to ${group.label}`
              : `Move to ${group.label}`,
            icon: <Folder size={14} />,
            onClick: () => {
              // Remove all steps to move from current location
              const removeSteps = (arr: Step[]): Step[] => {
                return arr.filter(s => {
                  if (s.children) {
                    s.children = removeSteps(s.children);
                  }
                  return !stepsToMove.some(st => st.id === s.id);
                });
              };
              // Add all steps to target group
              const addToGroup = (arr: Step[]): Step[] => {
                return arr.map(s => {
                  if (s.id === group.id) {
                    return { ...s, children: [...(s.children || []), ...stepsToMove], collapsed: false };
                  }
                  if (s.children) {
                    s.children = addToGroup(s.children);
                  }
                  return s;
                });
              };
              const newSteps = addToGroup(removeSteps(steps));
              commit(newSteps);
              // Clear selection after moving
              if (selectedSteps.length > 1) {
                setSelectedSteps([]);
              }
            }
          });
        }
      });
      items.push({ separator: true });
    }

    if (isGroup) {
      items.push({
        label: step.collapsed ? 'Expand' : 'Collapse',
        icon: step.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />,
        onClick: () => updateStep(stepId, { collapsed: !step.collapsed })
      });
      items.push({
        label: 'Rename',
        icon: <Edit size={14} />,
        onClick: () => {
          const newName = window.prompt('Enter new name:', step.label);
          if (newName) updateStep(stepId, { label: newName });
        }
      });
      items.push({ separator: true });
    }

    items.push({
      label: 'Delete',
      icon: <Trash2 size={14} />,
      onClick: () => {
        if (window.confirm(`Delete "${step.label}"?`)) {
          deleteStep(stepId);
        }
      }
    });

    return items;
  };

  const selectedStepData = selectedStep ? findStep(steps, selectedStep) : null;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <img 
            src="/tek_logo.svg" 
            alt="Tektronix" 
            className="h-16 mb-8 mx-auto" 
          />
          <div className="flex items-center justify-center gap-3 mb-4">
            <div 
              className="w-4 h-4 bg-blue-500 rounded-full" 
              style={{ 
                animation: 'bounce-smooth 1.4s ease-in-out infinite',
                animationDelay: '0s',
                willChange: 'transform'
              }}
            ></div>
            <div 
              className="w-4 h-4 bg-blue-500 rounded-full" 
              style={{ 
                animation: 'bounce-smooth 1.4s ease-in-out infinite',
                animationDelay: '0.2s',
                willChange: 'transform'
              }}
            ></div>
            <div 
              className="w-4 h-4 bg-blue-500 rounded-full" 
              style={{ 
                animation: 'bounce-smooth 1.4s ease-in-out infinite',
                animationDelay: '0.4s',
                willChange: 'transform'
              }}
            ></div>
          </div>
          <div className="text-lg font-semibold">Loading...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md p-6 bg-white rounded-lg border border-red-300">
          <div className="text-red-600 font-semibold mb-2">Loading Error</div>
          <div className="text-sm text-gray-700 mb-4">{loadError}</div>
          <div className="text-xs text-gray-600">
            <p className="font-semibold mb-1">Folder structure:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="bg-gray-100 px-1">public/commands/</code></li>
              <li><code className="bg-gray-100 px-1">public/templates/</code></li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <CommandBrowser
        isOpen={showCommandBrowser}
        onClose={() => setShowCommandBrowser(false)}
        onSelect={(cmd) => commandBrowserCallback && commandBrowserCallback(cmd)}
        commands={commandLibrary.filter(isCommandCompatible)}
        categoryColors={categoryColors}
        triggerAnimation={triggerControls.triggerAnimation}
        selectedDeviceFamily={selectedDeviceFamily}
        setSelectedDeviceFamily={setSelectedDeviceFamily}
        deviceFamilies={deviceFamilies}
      />

      <div className="bg-white border-b">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/tek_logo.svg" alt="Tektronix" className="h-6" />
            <h1 className="text-xl font-bold text-gray-900">TekAutomate</h1>
            <span className="text-xs text-gray-500">
              {commandLibrary.length} cmds • {builtInTemplates.length} templates
            </span>
          </div>
          <div className="flex gap-2">
            <button 
              data-tour="builder-button"
              onClick={() => setCurrentView('builder')} 
              className={`px-3 py-1.5 rounded text-xs font-medium ${currentView === 'builder' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Builder
            </button>
            <button 
              data-tour="commands-button"
              onClick={() => {
                triggerControls.triggerAnimation('search');
                setCurrentView('library');
              }} 
              className={`px-3 py-1.5 rounded text-xs font-medium ${currentView === 'library' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Commands
            </button>
            <button 
              data-tour="templates-button"
              onClick={() => setCurrentView('templates')} 
              className={`px-3 py-1.5 rounded text-xs font-medium ${currentView === 'templates' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Templates
            </button>
            {enableFlowDesigner && (
              <button onClick={() => setCurrentView('flow-designer')} className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 ${currentView === 'flow-designer' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
                <GitBranch size={14} />
                Flow Designer
              </button>
            )}
            {currentView === 'builder' && (
              <>
                <button onClick={undo} title="Ctrl+Z" className="px-3 py-1.5 bg-gray-100 rounded text-xs font-medium" data-tour="undo-button"><Undo2 size={14} className="inline mr-1" />Undo</button>
                <button onClick={redo} title="Ctrl+Y" className="px-3 py-1.5 bg-gray-100 rounded text-xs font-medium" data-tour="redo-button"><Redo2 size={14} className="inline mr-1" />Redo</button>
                <div 
                  className="relative"
                  onMouseEnter={() => setShowFlowDropdown(true)}
                  onMouseLeave={() => setShowFlowDropdown(false)}
                >
                  <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium flex items-center gap-1" data-tour="flow-dropdown">
                    <FileJson size={14} />
                    Flow
                    <ChevronDown size={12} />
                  </button>
                  {showFlowDropdown && (
                    <div className="absolute top-full left-0 pt-1 bg-transparent z-50">
                      <div className="bg-white border border-gray-300 rounded shadow-lg min-w-[140px]">
                        <label 
                          className="block px-3 py-2 text-xs hover:bg-gray-100 cursor-pointer flex items-center gap-2"
                          htmlFor="importFlow"
                        >
                          <Upload size={14} />
                          Import Flow
                        </label>
                        <button 
                          onClick={exportFlowJson}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                        >
                          <FileJson size={14} />
                          Export Flow
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <input id="importFlow" ref={fileInputRef} type="file" accept="application/json" className="hidden"
                  onChange={async (e) => {
                    const inputEl = e.currentTarget;
                    const f = inputEl.files?.[0];
                    if (!f) return;
                    const replace = window.confirm('Replace current flow? Cancel = Append');
                    try {
                      triggerControls.thinking();
                      await importFlowJson(f, replace ? 'replace' : 'append');
                      triggerControls.success();
                    } catch (error) {
                      triggerControls.error();
                      console.error('Import failed:', error);
                    } finally {
                      if (inputEl) inputEl.value = '';
                    }
                  }}
                />
                <button 
                  data-tour="gen-code-button"
                  onClick={() => {
                    triggerControls.codegen();
                    setExportOpen(true);
                  }} 
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium whitespace-nowrap"
                  style={{ minWidth: '100px' }}
                >
                  <Code2 size={14} className="inline mr-1" />Gen Code
                </button>
                <div 
                  className="relative"
                  onMouseEnter={() => setShowHelpDropdown(true)}
                  onMouseLeave={() => setShowHelpDropdown(false)}
                >
                  <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium flex items-center gap-1" data-tour="help-dropdown">
                    <GraduationCap size={14} />
                    Help
                    <ChevronDown size={12} />
                  </button>
                  {showHelpDropdown && (
                    <div className="absolute top-full right-0 pt-1 bg-transparent z-50">
                      <div className="bg-white border border-gray-300 rounded shadow-lg min-w-[140px]">
                        <button 
                          onClick={() => { setShowWelcomeWizard(true); setShowHelpDropdown(false); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                        >
                          <GraduationCap size={14} />
                          Wizard
                        </button>
                        <button 
                          onClick={() => { setRunTour(true); setShowHelpDropdown(false); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                        >
                          <Zap size={14} />
                          Tour
                        </button>
                        <HelpDropdownAcademyButtonWrapper onClose={() => setShowHelpDropdown(false)} />
                        <div className="border-t border-gray-200 my-1"></div>
                        <button 
                          onClick={() => { setShowMascot(!showMascot); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                        >
                          <Monitor size={14} />
                          {showMascot ? 'Hide' : 'Show'} Mascot
                        </button>
                        <button 
                          onClick={() => { setShowAboutModal(true); setShowHelpDropdown(false); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2"
                        >
                          <AlertCircle size={14} />
                          About
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {currentView === 'builder' && showConfig && (
        <div className="bg-white border-b relative" data-tour="config-panel">
          {(() => {
            const deviceList = devices.length > 0 ? devices : [{ ...config, id: 'default' }];
            const INSTRUMENTS_PER_PAGE = 3;
            const devicePages = [];
            for (let i = 0; i < deviceList.length; i += INSTRUMENTS_PER_PAGE) {
              devicePages.push(deviceList.slice(i, i + INSTRUMENTS_PER_PAGE));
            }
            
            // Device Map pagination (also max 3 per page)
            const DEVICE_MAP_PER_PAGE = 3;
            const deviceMapPages = [];
            for (let i = 0; i < deviceList.length; i += DEVICE_MAP_PER_PAGE) {
              deviceMapPages.push(deviceList.slice(i, i + DEVICE_MAP_PER_PAGE));
            }
            
            const isSingleInstrument = deviceList.length === 1;
            // Skip Device Map pages for single instrument (shown inline)
            const effectiveDeviceMapPages = isSingleInstrument ? [] : deviceMapPages;
            const totalPages = devicePages.length + effectiveDeviceMapPages.length;
            const currentPage = currentDeviceIndex;
            const isDeviceMapPage = currentPage >= devicePages.length;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const _currentPageDevices = isDeviceMapPage 
              ? effectiveDeviceMapPages[currentPage - devicePages.length] || []
              : devicePages[currentPage] || [];
            const isCompactLayout = isSingleInstrument && !isDeviceMapPage;
            
            return (
              <>
                <div className={`flex items-center justify-between ${isCompactLayout ? 'px-2 py-0.5' : 'px-3 py-1'}`}>
                  <div className="flex items-center gap-2">
                    {/* Navigation Arrows - Moved to the left */}
                    {totalPages > 1 && (
                      <>
                        <button
                          onClick={() => setCurrentDeviceIndex(Math.max(0, currentPage - 1))}
                          disabled={currentPage === 0}
                          className="p-0.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Previous"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          onClick={() => setCurrentDeviceIndex(Math.min(totalPages - 1, currentPage + 1))}
                          disabled={currentPage >= totalPages - 1}
                          className="p-0.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Next"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </>
                    )}
                    <h2 className="text-xs font-semibold uppercase">
                      {devices.length > 1 ? `Instruments (${devices.length})` : 'Configuration'}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowManageInstruments(true)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium whitespace-nowrap"
                      title="Manage Instruments"
                      data-tour="add-instrument-button"
                      style={{ minWidth: '100px' }}
                    >
                      <Plus size={14} className="inline mr-1" />Instrument
                    </button>
                    {/* Beta Toggle */}
                    <label className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded cursor-pointer">
                      <span className="font-medium">Beta</span>
                      <input
                        type="checkbox"
                        checked={enableFlowDesigner}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setEnableFlowDesigner(enabled);
                          localStorage.setItem('enableFlowDesigner', String(enabled));
                          // If disabling and currently on flow-designer, switch to builder
                          if (!enabled) {
                            setCurrentView((prev) => prev === 'flow-designer' ? 'builder' : prev);
                          }
                        }}
                        className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </label>
                    <button onClick={() => setShowConfig(false)} className="text-xs text-gray-500">Hide</button>
                  </div>
                </div>

                {/* Horizontal Carousel Container */}
                <div className={`relative overflow-hidden ${isCompactLayout ? 'pb-1' : 'pb-2'}`}>

                  {/* Carousel Track */}
                  <div 
                    className="flex transition-transform duration-300 ease-in-out h-full"
                    style={{ transform: `translateX(-${currentPage * 100}%)` }}
                    onMouseDown={(e) => {
                      if (totalPages <= 1) return;
                      setCarouselStartX(e.clientX);
                      setIsDraggingCarousel(true);
                    }}
                    onMouseMove={(e) => {
                      if (!isDraggingCarousel) return;
                      e.preventDefault();
                    }}
                    onMouseUp={(e) => {
                      if (!isDraggingCarousel) return;
                      const deltaX = e.clientX - carouselStartX;
                      if (Math.abs(deltaX) > 50) {
                        if (deltaX > 0 && currentPage > 0) {
                          setCurrentDeviceIndex(currentPage - 1);
                        } else if (deltaX < 0 && currentPage < totalPages - 1) {
                          setCurrentDeviceIndex(currentPage + 1);
                        }
                      }
                      setIsDraggingCarousel(false);
                    }}
                    onMouseLeave={() => setIsDraggingCarousel(false)}
                  >
                    {/* Render device pages */}
                    {devicePages.map((pageDevices, pageIdx) => (
                      <div 
                        key={`page-${pageIdx}`}
                        className={`flex-shrink-0 ${isCompactLayout ? 'w-auto px-2' : 'w-full px-1'}`}
                        style={isCompactLayout ? {} : { minWidth: '100%' }}
                      >
                        {/* Standardized grid layout for all device counts */}
                        <div className={`grid gap-2 ${
                          // Calculate grid columns: if we have space for Add Instrument card, add it to count
                          (pageDevices.length === 1 && isCompactLayout && deviceList.length < 2) ? 'grid-cols-2' :
                          pageDevices.length === 1 ? 'grid-cols-1' :
                          pageDevices.length === 2 ? 'grid-cols-2' : 
                          'grid-cols-3'
                        }`}>
                          {/* Device Configuration Cards */}
                          <div className="contents">
                          {pageDevices.map((device) => {
                            const updateDeviceField = (field: keyof DeviceEntry, value: any) => {
                              if (devices.length > 0) {
                                updateDevice(device.id, { [field]: value });
                              } else {
                                setConfig({ ...config, [field]: value });
                              }
                            };
                            
                            return (
                              <div key={device.id} className={`border border-gray-200 rounded bg-white ${isCompactLayout ? 'p-1' : 'p-2'}`}>
                                {(() => {
                                  const visaResourceString = (() => {
                                    if (device.connectionType === 'tcpip') {
                                      return `TCPIP::${device.host}::INSTR`;
                                    } else if (device.connectionType === 'socket') {
                                      return `TCPIP::${device.host}::${device.port}::SOCKET`;
                                    } else if (device.connectionType === 'usb') {
                                      const serial = device.usbSerial ? `::${device.usbSerial}` : '';
                                      return `USB::${device.usbVendorId}::${device.usbProductId}${serial}::INSTR`;
                                    } else if (device.connectionType === 'gpib') {
                                      return `GPIB${device.gpibBoard}::${device.gpibAddress}::INSTR`;
                                    }
                                    return 'Unknown';
                                  })();
                                  
                                  return (
                                    <>
                                      {isCompactLayout ? (
                                        <>
                                          {/* Single-line compact layout for 1 instrument */}
                                          <div className="flex items-center gap-2 flex-wrap py-0 my-0">
                                          <div className="flex items-center gap-1">
                                            <label className="text-xs font-medium whitespace-nowrap">Name:</label>
                                            <input 
                                              type="text" 
                                              value={device.alias || ''} 
                                              onChange={(e) => updateDeviceField('alias', e.target.value)} 
                                              className="w-16 px-1 py-0.5 text-xs border rounded" 
                                              placeholder="scope1"
                                            />
                                          </div>
                                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                                            device.backend === 'tm_devices' ? 'bg-orange-100 text-orange-700' :
                                            device.backend === 'tekhsi' ? 'bg-green-100 text-green-700' :
                                            device.backend === 'hybrid' ? 'bg-blue-100 text-blue-700' :
                                            'bg-purple-100 text-purple-700'
                                          }`}>
                                            {device.backend}
                                          </span>
                                          <span className="text-xs font-mono text-gray-500 truncate min-w-[200px]">{visaResourceString}</span>
                                          
                                          {/* Connection */}
                                          <div className="flex items-center gap-1">
                                            <label className="text-xs font-medium whitespace-nowrap">Connection:</label>
                                            <select 
                                              value={device.connectionType} 
                                              onChange={(e) => {
                                                const newType = e.target.value as ConnectionType;
                                                let newPort = device.port;
                                                if (newType === 'socket' && device.port !== 4000) newPort = 4000;
                                                if (newType === 'socket') {
                                                  const socketBlocked = device.backend === 'tm_devices';
                                                  if (socketBlocked) return;
                                                }
                                                updateDeviceField('connectionType', newType);
                                                updateDeviceField('port', newPort);
                                              }} 
                                              className="w-20 px-1 py-0.5 text-xs border rounded"
                                            >
                                              <option value="tcpip">TCP/IP</option>
                                              <option value="socket" disabled={device.backend === 'tm_devices'}>Socket</option>
                                              <option value="usb">USB</option>
                                              <option value="gpib">GPIB</option>
                                            </select>
                                          </div>
                                          
                                          {/* Host/IP and Port - only for TCP/IP and Socket */}
                                          {(device.connectionType === 'tcpip' || device.connectionType === 'socket') && (
                                            <>
                                              <div className="flex items-center gap-1">
                                                <label className="text-xs font-medium whitespace-nowrap">Host/IP:</label>
                                                <input 
                                                  type="text" 
                                                  value={device.host} 
                                                  onChange={(e) => updateDeviceField('host', e.target.value)} 
                                                  className="w-24 px-1 py-0.5 text-xs border rounded" 
                                                  placeholder="127.0.0.1"
                                                />
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <label className="text-xs font-medium whitespace-nowrap">Port:</label>
                                                <input 
                                                  type="number" 
                                                  value={device.port} 
                                                  onChange={(e) => updateDeviceField('port', parseInt(e.target.value || '4000', 10))} 
                                                  disabled={device.connectionType === 'tcpip'}
                                                  className="w-16 px-1 py-0.5 text-xs border rounded disabled:bg-gray-100" 
                                                />
                                              </div>
                                            </>
                                          )}
                                          
                                          {/* USB fields */}
                                          {device.connectionType === 'usb' && (
                                            <>
                                              <div className="flex items-center gap-1">
                                                <label className="text-xs font-medium whitespace-nowrap">Vendor ID:</label>
                                                <input 
                                                  type="text" 
                                                  value={device.usbVendorId} 
                                                  onChange={(e) => updateDeviceField('usbVendorId', e.target.value)} 
                                                  className="w-20 px-1 py-0.5 text-xs font-mono border rounded" 
                                                  placeholder="0x0699"
                                                />
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <label className="text-xs font-medium whitespace-nowrap">Product ID:</label>
                                                <input 
                                                  type="text" 
                                                  value={device.usbProductId} 
                                                  onChange={(e) => updateDeviceField('usbProductId', e.target.value)} 
                                                  className="w-20 px-1 py-0.5 text-xs font-mono border rounded" 
                                                  placeholder="0x0522"
                                                />
                                              </div>
                                              {device.usbSerial && (
                                                <div className="flex items-center gap-1">
                                                  <label className="text-xs font-medium whitespace-nowrap">Serial:</label>
                                                  <input 
                                                    type="text" 
                                                    value={device.usbSerial} 
                                                    onChange={(e) => updateDeviceField('usbSerial', e.target.value)} 
                                                    className="w-20 px-1 py-0.5 text-xs font-mono border rounded" 
                                                    placeholder="Optional"
                                                  />
                                                </div>
                                              )}
                                            </>
                                          )}
                                          
                                          {/* GPIB fields */}
                                          {device.connectionType === 'gpib' && (
                                            <>
                                              <div className="flex items-center gap-1">
                                                <label className="text-xs font-medium whitespace-nowrap">Board:</label>
                                                <input 
                                                  type="number" 
                                                  value={device.gpibBoard} 
                                                  onChange={(e) => updateDeviceField('gpibBoard', parseInt(e.target.value || '0', 10))} 
                                                  className="w-16 px-1 py-0.5 text-xs border rounded"
                                                />
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <label className="text-xs font-medium whitespace-nowrap">Address:</label>
                                                <input 
                                                  type="number" 
                                                  value={device.gpibAddress} 
                                                  onChange={(e) => updateDeviceField('gpibAddress', parseInt(e.target.value || '1', 10))} 
                                                  min={1} 
                                                  max={30} 
                                                  className="w-16 px-1 py-0.5 text-xs border rounded"
                                                />
                                              </div>
                                            </>
                                          )}
                                          
                                          {/* Backend */}
                                          <div className="flex items-center gap-1">
                                            <label className="text-xs font-medium whitespace-nowrap">Backend:</label>
                                            <select 
                                              value={device.backend} 
                                              onChange={(e) => {
                                                const newBackend = e.target.value as Backend;
                                                if (newBackend === 'tm_devices' && device.connectionType === 'socket') {
                                                  updateDeviceField('backend', newBackend);
                                                  updateDeviceField('connectionType', 'tcpip');
                                                } else {
                                                  updateDeviceField('backend', newBackend);
                                                }
                                              }}
                                              className="w-24 px-1 py-0.5 text-xs border rounded"
                                            >
                                              <option value="pyvisa">PyVISA</option>
                                              <option value="tm_devices">tm_devices</option>
                                              <option value="vxi11">VXI-11</option>
                                              <option value="tekhsi">TekHSI</option>
                                              <option value="hybrid">Hybrid</option>
                                            </select>
                                          </div>
                                          
                                          {/* VISA Backend - only for tm_devices */}
                                          {device.backend === 'tm_devices' && (
                                            <div className="flex items-center gap-1">
                                              <label className="text-xs font-medium whitespace-nowrap">VISA Backend:</label>
                                              <select 
                                                value={device.visaBackend} 
                                                onChange={(e) => updateDeviceField('visaBackend', e.target.value)} 
                                                className="w-20 px-1 py-0.5 text-xs border rounded"
                                              >
                                                <option value="system">System</option>
                                                <option value="pyvisa-py">PyVISA-py</option>
                                              </select>
                                            </div>
                                          )}
                                          
                                          {/* Device Type - only for tm_devices */}
                                          {device.backend === 'tm_devices' && (
                                            <div className="flex items-center gap-1">
                                              <label className="text-xs font-medium whitespace-nowrap">Device Type:</label>
                                              <select 
                                                value={device.deviceType} 
                                                onChange={(e) => {
                                                  const newType = e.target.value as InstrumentConfig['deviceType'];
                                                  const firstDriver = TM_DEVICE_TYPES[newType].drivers[0] || '';
                                                  updateDeviceField('deviceType', newType);
                                                  updateDeviceField('deviceDriver', firstDriver);
                                                }} 
                                                className="w-28 px-1 py-0.5 text-xs border rounded"
                                              >
                                                {Object.entries(TM_DEVICE_TYPES).map(([key, val]) => (
                                                  <option key={key} value={key}>{val.label}</option>
                                                ))}
                                              </select>
                                            </div>
                                          )}
                                          
                                          {/* Driver - only for tm_devices */}
                                          {device.backend === 'tm_devices' && (
                                            <div className="flex items-center gap-1">
                                              <label className="text-xs font-medium whitespace-nowrap">Driver:</label>
                                              <select 
                                                value={device.deviceDriver} 
                                                onChange={(e) => updateDeviceField('deviceDriver', e.target.value)} 
                                                className="w-20 px-1 py-0.5 text-xs border rounded"
                                              >
                                                <option value="">Auto</option>
                                                {TM_DEVICE_TYPES[device.deviceType].drivers.length > 0 && (
                                                  TM_DEVICE_TYPES[device.deviceType].drivers.map(driver => (
                                                    <option key={driver} value={driver}>{driver}</option>
                                                  ))
                                                )}
                                              </select>
                                            </div>
                                          )}
                                          
                                          {/* TekHSI Device - only for tekhsi or hybrid */}
                                          {(device.backend === 'tekhsi' || device.backend === 'hybrid') && (
                                            <div className="flex items-center gap-1">
                                              <label className="text-xs font-medium whitespace-nowrap">TekHSI Device:</label>
                                              <select 
                                                value={device.tekhsiDevice || '6 Series MSO'} 
                                                onChange={(e) => updateDeviceField('tekhsiDevice', e.target.value)} 
                                                className="w-32 px-1 py-0.5 text-xs border rounded"
                                              >
                                                <option value="4 Series B MSO">4 Series B MSO</option>
                                                <option value="5 Series MSO">5 Series MSO</option>
                                                <option value="5 Series B MSO">5 Series B MSO</option>
                                                <option value="5 Series MSO (LP)">5 Series MSO (LP)</option>
                                                <option value="6 Series MSO">6 Series MSO</option>
                                                <option value="6 Series B MSO">6 Series B MSO</option>
                                                <option value="6 Series LPD">6 Series LPD</option>
                                              </select>
                                            </div>
                                          )}
                                        </div>
                                        
                                        {/* Device Map - Inline for single instrument within left column */}
                                        {(() => {
                                          if (deviceList.length !== 1) return null;
                                          const topologyNodes: DeviceEntry[] = devices.length > 0 ? devices : [{ ...config, id: 'default', enabled: true, x: 0, y: 0 }];
                                          const deviceGroupsMap = new Map<string, Step[]>();
                                          topologyNodes.forEach(d => {
                                            const groups = steps.filter(s => s.type === 'group' && s.boundDeviceId === d.id);
                                            deviceGroupsMap.set(d.id, groups);
                                          });
                                          
                                          const node = topologyNodes.find(d => d.id === device.id) || device;
                                          const deviceType = 'deviceType' in node ? node.deviceType : 'SCOPE';
                                          const IconComponent = getDeviceIcon(deviceType);
                                          const nodeGroups = deviceGroupsMap.get(node.id) || [];
                                          const isExpanded = expandedDeviceGroups.has(node.id);
                                          const nodeVisaResourceString = (() => {
                                            if (node.connectionType === 'tcpip') {
                                              return `TCPIP::${node.host}::INSTR`;
                                            } else if (node.connectionType === 'socket') {
                                              return `TCPIP::${node.host}::${node.port}::SOCKET`;
                                            } else if (node.connectionType === 'usb') {
                                              const serial = node.usbSerial ? `::${node.usbSerial}` : '';
                                              return `USB::${node.usbVendorId}::${node.usbProductId}${serial}::INSTR`;
                                            } else if (node.connectionType === 'gpib') {
                                              return `GPIB${node.gpibBoard}::${node.gpibAddress}::INSTR`;
                                            }
                                            return 'Unknown';
                                          })();
                                          
                                          return (
                                            <div className="mt-2 border border-gray-200 rounded bg-white p-2">
                                              <div className="text-xs font-semibold mb-1.5">Device Map</div>
                                              <div className="bg-gray-50 rounded p-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <IconComponent size={14} className="text-gray-600 flex-shrink-0" />
                                                      <div className="font-semibold text-xs whitespace-nowrap">{node.alias || 'Device'}</div>
                                                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex-shrink-0 ${
                                                        node.backend === 'tm_devices' ? 'bg-orange-100 text-orange-700' :
                                                        node.backend === 'tekhsi' ? 'bg-green-100 text-green-700' :
                                                        node.backend === 'hybrid' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-purple-100 text-purple-700'
                                                      }`}>
                                                        {node.backend}
                                                      </span>
                                                      <div className="text-[10px] text-gray-500 truncate flex-1 min-w-0">{TM_DEVICE_TYPES[deviceType]?.label || deviceType}</div>
                                                    </div>
                                                    
                                                    <div className="mb-1">
                                                      <div className="text-[10px]">
                                                        <span className="text-gray-500">Conn:</span>
                                                        <span className="ml-1 font-medium">{node.connectionType.toUpperCase()}</span>
                                                        <span className="mx-1 text-gray-400">|</span>
                                                        <span className="font-mono">{node.host || 'N/A'}</span>
                                                        {node.port && node.connectionType !== 'tcpip' && (
                                                          <span className="text-gray-500">:{node.port}</span>
                                                        )}
                                                      </div>
                                                      <div className="text-[10px] font-mono text-gray-600 truncate" title={nodeVisaResourceString}>
                                                        {nodeVisaResourceString}
                                                      </div>
                                                    </div>
                                                    
                                                    <div className="pt-1 border-t border-gray-200">
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setExpandedDeviceGroups(prev => {
                                                            const newSet = new Set(prev);
                                                            if (newSet.has(node.id)) {
                                                              newSet.delete(node.id);
                                                            } else {
                                                              newSet.add(node.id);
                                                            }
                                                            return newSet;
                                                          });
                                                        }}
                                                        className="flex items-center justify-between w-full text-[10px] text-gray-600 hover:text-gray-800"
                                                      >
                                                        <span>
                                                          <span className="font-medium">{nodeGroups.length}</span> group{nodeGroups.length !== 1 ? 's' : ''}
                                                        </span>
                                                        {nodeGroups.length > 0 && (
                                                          <ChevronRight 
                                                            size={12} 
                                                            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                          />
                                                        )}
                                                      </button>
                                                      
                                                      {isExpanded && nodeGroups.length > 0 && (
                                                        <div className="mt-1.5 space-y-1">
                                                          {nodeGroups.map(group => (
                                                            <button
                                                              key={group.id}
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                const findStep = (s: Step[]): Step | null => {
                                                                  for (const step of s) {
                                                                    if (step.id === group.id) return step;
                                                                    if (step.children) {
                                                                      const found = findStep(step.children);
                                                                      if (found) return found;
                                                                    }
                                                                  }
                                                                  return null;
                                                                };
                                                                const found = findStep(steps);
                                                                if (found) {
                                                                  setSelectedStep(found.id);
                                                                }
                                                              }}
                                                              className="w-full px-1.5 py-1 bg-blue-50 border border-blue-200 rounded text-[10px] hover:bg-blue-100 hover:border-blue-300 transition-colors text-left"
                                                            >
                                                              <div className="font-medium truncate">{group.label}</div>
                                                              {group.children && group.children.length > 0 && (
                                                                <div className="text-gray-500 mt-0.5">
                                                                  {group.children.length} step{group.children.length !== 1 ? 's' : ''}
                                                                </div>
                                                              )}
                                                            </button>
                                                          ))}
                                                        </div>
                                                      )}
                                                    </div>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </>
                                      ) : (
                                        /* Multi-row layout for multiple instruments */
                                        <>
                                          {/* Name, Backend Tag, and VISA Resource - All on one line */}
                                          <div className="flex items-center gap-2 mb-1.5">
                                            <div className="flex items-center gap-1">
                                              <label className="text-xs font-medium whitespace-nowrap">Name:</label>
                                              <input 
                                                type="text" 
                                                value={device.alias || ''} 
                                                onChange={(e) => updateDeviceField('alias', e.target.value)} 
                                                className="w-16 px-1 py-0.5 text-xs border rounded" 
                                                placeholder="scope1"
                                              />
                                            </div>
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                                              device.backend === 'tm_devices' ? 'bg-orange-100 text-orange-700' :
                                              device.backend === 'tekhsi' ? 'bg-green-100 text-green-700' :
                                              device.backend === 'hybrid' ? 'bg-blue-100 text-blue-700' :
                                              'bg-purple-100 text-purple-700'
                                            }`}>
                                              {device.backend}
                                            </span>
                                            <span className="text-xs font-mono text-gray-500 truncate flex-1 min-w-0">{visaResourceString}</span>
                                          </div>
                                          
                                          {/* Compact 3-column grid for Connection, Host/IP, Port */}
                                          <div className="grid grid-cols-3 gap-x-2 gap-y-1">
                                        <div>
                                          <label className="block text-xs font-medium mb-0.5">Connection</label>
                                          <select 
                                            value={device.connectionType} 
                                            onChange={(e) => {
                                              const newType = e.target.value as ConnectionType;
                                              let newPort = device.port;
                                              if (newType === 'socket' && device.port !== 4000) newPort = 4000;
                                              if (newType === 'socket') {
                                                const socketBlocked = device.backend === 'tm_devices';
                                                if (socketBlocked) return;
                                              }
                                              updateDeviceField('connectionType', newType);
                                              updateDeviceField('port', newPort);
                                            }} 
                                            className="w-full px-1 py-0.5 text-xs border rounded"
                                          >
                                            <option value="tcpip">TCP/IP</option>
                                            <option value="socket" disabled={device.backend === 'tm_devices'}>Socket</option>
                                            <option value="usb">USB</option>
                                            <option value="gpib">GPIB</option>
                                          </select>
                                        </div>
                                        {(device.connectionType === 'tcpip' || device.connectionType === 'socket') ? (
                                          <>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Host/IP</label>
                                              <input 
                                                type="text" 
                                                value={device.host} 
                                                onChange={(e) => updateDeviceField('host', e.target.value)} 
                                                className="w-full px-1 py-0.5 text-xs border rounded" 
                                                placeholder="192.168.1.1"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Port</label>
                                              <input 
                                                type="number" 
                                                value={device.port} 
                                                onChange={(e) => updateDeviceField('port', parseInt(e.target.value || '4000', 10))} 
                                                disabled={device.connectionType === 'tcpip'}
                                                className="w-full px-1 py-0.5 text-xs border rounded disabled:bg-gray-100" 
                                              />
                                            </div>
                                          </>
                                        ) : (
                                          <div className="col-span-2">
                                            <label className="block text-xs font-medium mb-0.5">Host/IP</label>
                                            <input 
                                              type="text" 
                                              value={device.host} 
                                              onChange={(e) => updateDeviceField('host', e.target.value)} 
                                              className="w-full px-1 py-0.5 text-xs border rounded" 
                                              placeholder="192.168.1.1"
                                              disabled={device.connectionType === 'usb' || device.connectionType === 'gpib'}
                                            />
                                          </div>
                                        )}
                                        
                                        {/* Backend selector - full width below grid */}
                                        <div className="col-span-2">
                                          <label className="block text-xs font-medium mb-0.5">Backend</label>
                                          <select 
                                            value={device.backend} 
                                            onChange={(e) => {
                                              const newBackend = e.target.value as Backend;
                                              if (newBackend === 'tm_devices' && device.connectionType === 'socket') {
                                                updateDeviceField('backend', newBackend);
                                                updateDeviceField('connectionType', 'tcpip');
                                              } else {
                                                updateDeviceField('backend', newBackend);
                                              }
                                            }}
                                            className="w-full px-1 py-0.5 text-xs border rounded"
                                          >
                                            <option value="pyvisa">PyVISA</option>
                                            <option value="tm_devices">tm_devices</option>
                                            <option value="vxi11">VXI-11</option>
                                            <option value="tekhsi">TekHSI</option>
                                            <option value="hybrid">Hybrid</option>
                                          </select>
                                        </div>
                                        
                                        {device.connectionType === 'usb' && (
                                          <>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Vendor ID</label>
                                              <input type="text" value={device.usbVendorId} onChange={(e) => updateDeviceField('usbVendorId', e.target.value)} className="w-full px-1 py-0.5 text-xs font-mono border rounded" placeholder="0x0699" />
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Product ID</label>
                                              <input type="text" value={device.usbProductId} onChange={(e) => updateDeviceField('usbProductId', e.target.value)} className="w-full px-1 py-0.5 text-xs font-mono border rounded" placeholder="0x0522" />
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Serial</label>
                                              <input type="text" value={device.usbSerial} onChange={(e) => updateDeviceField('usbSerial', e.target.value)} className="w-full px-1 py-0.5 text-xs font-mono border rounded" placeholder="Optional" />
                                            </div>
                                          </>
                                        )}
                                        
                                        {/* Backend selector for USB - full width */}
                                        {device.connectionType === 'usb' && (
                                          <div className="col-span-2">
                                            <label className="block text-xs font-medium mb-0.5">Backend</label>
                                            <select 
                                              value={device.backend} 
                                              onChange={(e) => updateDeviceField('backend', e.target.value as Backend)}
                                              className="w-full px-1 py-0.5 text-xs border rounded"
                                            >
                                              <option value="pyvisa">PyVISA</option>
                                              <option value="tm_devices">tm_devices</option>
                                              <option value="vxi11">VXI-11</option>
                                              <option value="tekhsi">TekHSI</option>
                                              <option value="hybrid">Hybrid</option>
                                            </select>
                                          </div>
                                        )}
                                        
                                        {device.connectionType === 'gpib' && (
                                          <>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Board</label>
                                              <input type="number" value={device.gpibBoard} onChange={(e) => updateDeviceField('gpibBoard', parseInt(e.target.value || '0', 10))} className="w-full px-1 py-0.5 text-xs border rounded" />
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Address</label>
                                              <input type="number" value={device.gpibAddress} onChange={(e) => updateDeviceField('gpibAddress', parseInt(e.target.value || '1', 10))} min={1} max={30} className="w-full px-1 py-0.5 text-xs border rounded" />
                                            </div>
                                          </>
                                        )}
                                        
                                        {/* Backend selector for GPIB - full width */}
                                        {device.connectionType === 'gpib' && (
                                          <div className="col-span-2">
                                            <label className="block text-xs font-medium mb-0.5">Backend</label>
                                            <select 
                                              value={device.backend} 
                                              onChange={(e) => updateDeviceField('backend', e.target.value as Backend)}
                                              className="w-full px-1 py-0.5 text-xs border rounded"
                                            >
                                              <option value="pyvisa">PyVISA</option>
                                              <option value="tm_devices">tm_devices</option>
                                              <option value="vxi11">VXI-11</option>
                                              <option value="tekhsi">TekHSI</option>
                                              <option value="hybrid">Hybrid</option>
                                            </select>
                                          </div>
                                        )}
                                        
                                        {(device.backend === 'tekhsi' || device.backend === 'hybrid') && (
                                          <div className="col-span-2">
                                            <label className="block text-xs font-medium mb-0.5">TekHSI Device</label>
                                            <select 
                                              value={device.tekhsiDevice || '6 Series MSO'} 
                                              onChange={(e) => updateDeviceField('tekhsiDevice', e.target.value)} 
                                              className="w-full px-1 py-0.5 text-xs border rounded"
                                            >
                                              <option value="4 Series B MSO">4 Series B MSO</option>
                                              <option value="5 Series MSO">5 Series MSO</option>
                                              <option value="5 Series B MSO">5 Series B MSO</option>
                                              <option value="5 Series MSO (LP)">5 Series MSO (LP)</option>
                                              <option value="6 Series MSO">6 Series MSO</option>
                                              <option value="6 Series B MSO">6 Series B MSO</option>
                                              <option value="6 Series LPD">6 Series LPD</option>
                                            </select>
                                          </div>
                                        )}
                                        
                                        {device.backend === 'tm_devices' && (
                                          <>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Device Type</label>
                                              <select 
                                                value={device.deviceType} 
                                                onChange={(e) => {
                                                  const newType = e.target.value as InstrumentConfig['deviceType'];
                                                  const firstDriver = TM_DEVICE_TYPES[newType].drivers[0] || '';
                                                  updateDeviceField('deviceType', newType);
                                                  updateDeviceField('deviceDriver', firstDriver);
                                                }} 
                                                className="w-full px-1 py-0.5 text-xs border rounded"
                                              >
                                                {Object.entries(TM_DEVICE_TYPES).map(([key, val]) => (
                                                  <option key={key} value={key}>{val.label}</option>
                                                ))}
                                              </select>
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">Driver</label>
                                              <select 
                                                value={device.deviceDriver} 
                                                onChange={(e) => updateDeviceField('deviceDriver', e.target.value)} 
                                                className="w-full px-1 py-0.5 text-xs border rounded"
                                              >
                                                <option value="">Auto</option>
                                                {TM_DEVICE_TYPES[device.deviceType].drivers.length > 0 && (
                                                  TM_DEVICE_TYPES[device.deviceType].drivers.map(driver => (
                                                    <option key={driver} value={driver}>{driver}</option>
                                                  ))
                                                )}
                                              </select>
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium mb-0.5">VISA Backend</label>
                                              <select 
                                                value={device.visaBackend} 
                                                onChange={(e) => updateDeviceField('visaBackend', e.target.value)} 
                                                className="w-full px-1 py-0.5 text-xs border rounded"
                                              >
                                                <option value="system">System</option>
                                                <option value="pyvisa-py">PyVISA-py</option>
                                              </select>
                                            </div>
                                          </>
                                        )}
                                        
                                      </div>
                                        </>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            );
                          })}
                          </div>
                          
                          {/* Add Instrument Card - Show in grid when single device in compact layout */}
                          {isCompactLayout && deviceList.length < 2 && pageDevices.length === 1 && (
                            <div className="bg-gray-50 rounded border border-gray-200 p-2">
                              <div
                                onClick={() => setShowDeviceTypeSelector(true)}
                                className="bg-white rounded border-2 border-dashed border-gray-200 cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-all h-full flex flex-col items-center justify-center min-h-[200px]"
                              >
                                <div className="text-2xl mb-1 text-gray-400">+</div>
                                <div className="text-xs font-semibold text-gray-600">Add Instrument</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">Click to select device type</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    {/* Device Map pages - Skip if single instrument (already shown inline) */}
                    {!isSingleInstrument && deviceMapPages.map((pageDevices, mapPageIdx) => {
                      const topologyNodes: DeviceEntry[] = devices.length > 0 ? devices : [{ ...config, id: 'default', enabled: true, x: 0, y: 0 }];
                      
                      // Get all groups for each device
                      const deviceGroupsMap = new Map<string, Step[]>();
                      topologyNodes.forEach(device => {
                        const groups = steps.filter(s => s.type === 'group' && s.boundDeviceId === device.id);
                        deviceGroupsMap.set(device.id, groups);
                      });
                      
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const _deviceMapPageIndex = devicePages.length + mapPageIdx;
                      const currentPageDevices = pageDevices;
                      
                      return (
                        <div 
                          key={`device-map-${mapPageIdx}`}
                          className="w-full flex-shrink-0 px-1"
                          style={{ minWidth: '100%' }}
                        >
                          <div className="text-xs font-semibold mb-1.5">Device Map</div>
                          <div className="bg-gray-50 rounded border border-gray-200 p-2">
                            {currentPageDevices.length === 0 ? (
                              <div className="text-center text-gray-400 py-4 text-xs">No instruments configured</div>
                            ) : (
                              <div className="space-y-2">
                                {/* Device Grid - Compact with Groups */}
                                <div className={`grid gap-2 ${
                                  currentPageDevices.length === 1 ? 'grid-cols-1' :
                                  currentPageDevices.length === 2 ? 'grid-cols-2' :
                                  'grid-cols-3'
                                }`}>
                                  {currentPageDevices.map((node: any) => {
                                    const deviceType = 'deviceType' in node ? node.deviceType : 'SCOPE';
                                    const IconComponent = getDeviceIcon(deviceType);
                                    const nodeGroups = deviceGroupsMap.get(node.id) || [];
                                    const isExpanded = expandedDeviceGroups.has(node.id);
                                    const visaResourceString = (() => {
                                      if (node.connectionType === 'tcpip') {
                                        return `TCPIP::${node.host}::INSTR`;
                                      } else if (node.connectionType === 'socket') {
                                        return `TCPIP::${node.host}::${node.port}::SOCKET`;
                                      } else if (node.connectionType === 'usb') {
                                        const serial = node.usbSerial ? `::${node.usbSerial}` : '';
                                        return `USB::${node.usbVendorId}::${node.usbProductId}${serial}::INSTR`;
                                      } else if (node.connectionType === 'gpib') {
                                        return `GPIB${node.gpibBoard}::${node.gpibAddress}::INSTR`;
                                      }
                                      return 'Unknown';
                                    })();
                                    
                                    return (
                                      <div
                                        key={node.id}
                                        className="bg-white rounded border border-gray-200"
                                      >
                                        {/* Device Card - Compact */}
                                        <div className="p-1.5">
                                          {/* Name, Backend Tag, and Type - All on one line */}
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <IconComponent size={14} className="text-gray-600 flex-shrink-0" />
                                            <div className="font-semibold text-xs whitespace-nowrap">{node.alias || 'Device'}</div>
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex-shrink-0 ${
                                              node.backend === 'tm_devices' ? 'bg-orange-100 text-orange-700' :
                                              node.backend === 'tekhsi' ? 'bg-green-100 text-green-700' :
                                              node.backend === 'hybrid' ? 'bg-blue-100 text-blue-700' :
                                              'bg-purple-100 text-purple-700'
                                            }`}>
                                              {node.backend}
                                            </span>
                                            <div className="text-[10px] text-gray-500 truncate flex-1 min-w-0">{TM_DEVICE_TYPES[deviceType as keyof typeof TM_DEVICE_TYPES]?.label || deviceType}</div>
                                          </div>
                                          
                                          {/* Connection Info - Very Compact */}
                                          <div className="mb-1">
                                            <div className="text-[10px]">
                                              <span className="text-gray-500">Conn:</span>
                                              <span className="ml-1 font-medium">{node.connectionType.toUpperCase()}</span>
                                              <span className="mx-1 text-gray-400">|</span>
                                              <span className="font-mono">{node.host || 'N/A'}</span>
                                              {node.port && node.connectionType !== 'tcpip' && (
                                                <span className="text-gray-500">:{node.port}</span>
                                              )}
                                            </div>
                                            <div className="text-[10px] font-mono text-gray-600 truncate" title={visaResourceString}>
                                              {visaResourceString}
                                            </div>
                                          </div>
                                          
                                          {/* Groups Section */}
                                          <div className="pt-1 border-t border-gray-200">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setExpandedDeviceGroups(prev => {
                                                  const newSet = new Set(prev);
                                                  if (newSet.has(node.id)) {
                                                    newSet.delete(node.id);
                                                  } else {
                                                    newSet.add(node.id);
                                                  }
                                                  return newSet;
                                                });
                                              }}
                                              className="flex items-center justify-between w-full text-[10px] text-gray-600 hover:text-gray-800"
                                            >
                                              <span>
                                                <span className="font-medium">{nodeGroups.length}</span> group{nodeGroups.length !== 1 ? 's' : ''}
                                              </span>
                                              {nodeGroups.length > 0 && (
                                                <ChevronRight 
                                                  size={12} 
                                                  className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                />
                                              )}
                                            </button>
                                            
                                            {/* Expanded Groups */}
                                            {isExpanded && nodeGroups.length > 0 && (
                                              <div className="mt-1.5 space-y-1">
                                                {nodeGroups.map(group => (
                                                  <button
                                                    key={group.id}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const findStep = (s: Step[]): Step | null => {
                                                        for (const step of s) {
                                                          if (step.id === group.id) return step;
                                                          if (step.children) {
                                                            const found = findStep(step.children);
                                                            if (found) return found;
                                                          }
                                                        }
                                                        return null;
                                                      };
                                                      const found = findStep(steps);
                                                      if (found) {
                                                        setSelectedStep(found.id);
                                                      }
                                                    }}
                                                    className="w-full px-1.5 py-1 bg-blue-50 border border-blue-200 rounded text-[10px] hover:bg-blue-100 hover:border-blue-300 transition-colors text-left"
                                                  >
                                                    <div className="font-medium truncate">{group.label}</div>
                                                    {group.children && group.children.length > 0 && (
                                                      <div className="text-gray-500 mt-0.5">
                                                        {group.children.length} step{group.children.length !== 1 ? 's' : ''}
                                                      </div>
                                                    )}
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                
                                {/* Device Map Pagination Info */}
                                {effectiveDeviceMapPages.length > 1 && (
                                  <div className="text-center text-[10px] text-gray-500 pt-1 border-t border-gray-200">
                                    Page {mapPageIdx + 1} of {effectiveDeviceMapPages.length}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Dot Indicators - Only show when not compact */}
                  {totalPages > 1 && !isCompactLayout && (
                    <div className="flex justify-center gap-1.5 mt-2">
                      {devicePages.map((_, pageIdx) => (
                        <button
                          key={pageIdx}
                          onClick={() => setCurrentDeviceIndex(pageIdx)}
                          className={`w-2 h-2 rounded-full transition-all ${
                            pageIdx === currentPage 
                              ? 'bg-blue-600 w-6' 
                              : 'bg-gray-300 hover:bg-gray-400'
                          }`}
                          title={`Page ${pageIdx + 1}`}
                        />
                      ))}
                      {effectiveDeviceMapPages.map((_, mapPageIdx) => {
                        const mapPageIndex = devicePages.length + mapPageIdx;
                        return (
                          <button
                            key={`map-${mapPageIdx}`}
                            onClick={() => setCurrentDeviceIndex(mapPageIndex)}
                            className={`w-2 h-2 rounded-full transition-all ${
                              currentPage === mapPageIndex
                                ? 'bg-blue-600 w-6' 
                                : 'bg-gray-300 hover:bg-gray-400'
                            }`}
                            title={`Device Map ${mapPageIdx + 1}`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Manage Instruments Overlay */}
      {showManageInstruments && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowManageInstruments(false)}>
          <div className="bg-white rounded-lg w-[90%] max-w-4xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Manage Instruments</h3>
              <button onClick={() => setShowManageInstruments(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {devices.map((device, idx) => {
                const visaString = (() => {
                  if (device.connectionType === 'tcpip') {
                    return `TCPIP::${device.host}::INSTR`;
                  } else if (device.connectionType === 'socket') {
                    return `TCPIP::${device.host}::${device.port}::SOCKET`;
                  } else if (device.connectionType === 'usb') {
                    const serial = device.usbSerial ? `::${device.usbSerial}` : '';
                    return `USB::${device.usbVendorId}::${device.usbProductId}${serial}::INSTR`;
                  } else if (device.connectionType === 'gpib') {
                    return `GPIB${device.gpibBoard}::${device.gpibAddress}::INSTR`;
                  }
                  return 'Unknown';
                })();
                
                return (
                  <div
                    key={device.id}
                    onClick={() => {
                      const INSTRUMENTS_PER_PAGE = 3;
                      const pageNumber = Math.floor(idx / INSTRUMENTS_PER_PAGE);
                      setCurrentDeviceIndex(pageNumber);
                      setShowManageInstruments(false);
                    }}
                    className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      Math.floor(idx / 3) === currentDeviceIndex 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-semibold text-sm">{device.alias || `Instrument ${idx + 1}`}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {TM_DEVICE_TYPES[device.deviceType]?.label || device.deviceType}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Delete this instrument?')) {
                            deleteDevice(device.id);
                            if (currentDeviceIndex >= devices.length - 1 && currentDeviceIndex > 0) {
                              setCurrentDeviceIndex(currentDeviceIndex - 1);
                            }
                          }
                        }}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Delete instrument"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{device.backend}</span>
                        <span className="text-gray-500 font-mono truncate">{visaString}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {/* Add Instrument Card - Matches device card styling */}
              <div
                onClick={() => setShowDeviceTypeSelector(true)}
                className="bg-gray-50 rounded border border-gray-200 cursor-pointer hover:border-gray-300 transition-all"
              >
                <div className="p-1.5 flex flex-col items-center justify-center">
                  <div className="text-2xl mb-1 text-gray-400">+</div>
                  <div className="text-xs font-semibold text-gray-600">Add Instrument</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Click to select device type</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Device Type Selector Modal */}
      {showDeviceTypeSelector && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowDeviceTypeSelector(false)}>
          <div className="bg-white rounded-lg w-[90%] max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Select Device Type</h3>
              <button onClick={() => setShowDeviceTypeSelector(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(TM_DEVICE_TYPES).map(([key, val]) => {
                const IconComponent = getDeviceIcon(key as InstrumentConfig['deviceType']);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      addDevice(key as InstrumentConfig['deviceType']);
                      const INSTRUMENTS_PER_PAGE = 3;
                      const newDeviceIndex = devices.length;
                      const pageNumber = Math.floor(newDeviceIndex / INSTRUMENTS_PER_PAGE);
                      setCurrentDeviceIndex(pageNumber);
                      setShowDeviceTypeSelector(false);
                      setShowManageInstruments(false);
                    }}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all flex flex-col items-center gap-2"
                  >
                    <IconComponent size={24} className="text-gray-600" />
                    <span className="text-sm font-medium">{val.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {currentView === 'builder' && (
        <div className="flex-1 flex overflow-hidden">
          <div 
            className="w-48 bg-white border-r p-2 overflow-y-auto"
            onClick={(e) => {
              // Collapse config panel when clicking in the Steps sidebar (empty space)
              const target = e.target as HTMLElement;
              const clickedOnInteractive = target.closest('button') || 
                                          target.closest('input') || 
                                          target.closest('select') ||
                                          target.closest('[draggable="true"]') || // Step palette items
                                          target.closest('.cursor-pointer'); // Step palette items
              
              if (!clickedOnInteractive && showConfig) {
                setShowConfig(false);
              }
            }}
          >
            <h3 className="text-xs font-semibold mb-2 uppercase">Steps</h3>
            <div className="space-y-1">
              {STEP_PALETTE.map((item) => {
                // Map step types to hover animations
                const getHoverAnimation = (stepType: StepType): TriggerAnimation | null => {
                  switch (stepType) {
                    case 'connect':
                      return 'connecting';
                    case 'disconnect':
                      return 'disconnect';
                    case 'save_waveform':
                      return 'save';
                    case 'query':
                      return 'query';
                    case 'write':
                      return 'write';
                    case 'sleep':
                      return 'sleep';
                    case 'python':
                      return 'processing';
                    default:
                      return null; // No specific animation for other steps
                  }
                };

                const hoverAnim = getHoverAnimation(item.type);

                return (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('stepType', item.type);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => {
                      // Trigger animation based on step type
                      switch (item.type) {
                        case 'write':
                          triggerControls.write();
                          break;
                        case 'query':
                          triggerControls.query();
                          break;
                        case 'disconnect':
                          triggerControls.disconnect();
                          break;
                        case 'sleep':
                          triggerControls.sleep();
                          break;
                        case 'connect':
                          triggerControls.connecting();
                          break;
                        case 'save_waveform':
                          triggerControls.save();
                          break;
                        case 'error_check':
                          triggerControls.error();
                          break;
                        default:
                          if (hoverAnim) {
                            triggerControls.triggerAnimation(hoverAnim);
                          }
                      }
                      addStep(item.type);
                    }}
                    className={`w-full p-2 rounded flex items-center gap-2 ${item.color} hover:opacity-80 text-xs cursor-pointer`}
                  >
                    <item.icon size={12} /><span className="text-xs font-medium">{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div 
            className="flex-1 bg-gray-50 p-3 overflow-y-auto" 
            onDragOver={handleDragOver} 
            onDrop={(e) => handleDrop(e)} 
            onClick={(e) => {
              // Collapse config panel when clicking in the steps area (empty space)
              // Only collapse if clicking on empty background, not on steps or interactive elements
              const target = e.target as HTMLElement;
              
              // Check if clicking on interactive elements or step elements
              const clickedOnInteractive = target.closest('[draggable="true"]') || // Step elements are draggable
                                          target.closest('button') || 
                                          target.closest('input') || 
                                          target.closest('select') ||
                                          target.closest('label') ||
                                          target.closest('.text-center'); // Empty state message
              
              // Only collapse if clicking on empty space (the gray background area)
              // This happens when clicking directly on the container or its padding area
              if (!clickedOnInteractive && showConfig) {
                setShowConfig(false);
              }
            }}
            data-tour="steps-panel"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Flow ({steps.length})</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">Enable print messages</span>
                  <button
                    onClick={() => setEnablePrintMessages(!enablePrintMessages)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      enablePrintMessages ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                    role="switch"
                    aria-checked={enablePrintMessages}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enablePrintMessages ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => commit([])} className="text-xs text-red-600 hover:underline">Clear</button>
                  <button 
                    onClick={() => setShowConfig(!showConfig)} 
                    className="px-2 py-1 hover:bg-gray-100 rounded flex items-center gap-1"
                    title={showConfig ? "Hide Config" : "Show Config"}
                    data-tour="show-config-button"
                  >
                    <Settings size={16} className={showConfig ? "text-blue-600" : "text-gray-500"} />
                    <span className="text-xs font-medium text-gray-700">Config</span>
                  </button>
                </div>
              </div>
            </div>
            {/* Multi-select toolbar */}
            {selectedSteps.length > 1 && (
              <div className="mb-2 p-2 bg-blue-100 border border-blue-300 rounded-lg flex items-center justify-between">
                <span className="text-xs font-medium text-blue-800">
                  {selectedSteps.length} steps selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={groupSelectedSteps}
                    className="px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 flex items-center gap-1"
                  >
                    <FolderOpen size={12} /> Group
                  </button>
                  <button
                    onClick={() => { setSelectedSteps([]); setSelectedStep(null); }}
                    className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            {steps.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-sm">Add steps or append a template</p>
              </div>
            ) : (
              <div>{steps.map((s) => renderStep(s))}</div>
            )}
          </div>

          <div 
            className="w-72 bg-white border-l p-3 overflow-y-auto"
            onClick={(e) => {
              // Collapse config panel when clicking in the Edit Step panel (empty space)
              const target = e.target as HTMLElement;
              const clickedOnInteractive = target.closest('button') || 
                                          target.closest('input') || 
                                          target.closest('select') ||
                                          target.closest('textarea') ||
                                          target.closest('label') ||
                                          target.closest('.cursor-pointer');
              
              if (!clickedOnInteractive && showConfig) {
                setShowConfig(false);
              }
            }}
          >
            {selectedStepData ? (
              <>
                <h3 className="text-sm font-semibold mb-2">Edit Step</h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Label</label>
                    <input type="text" value={selectedStepData.label} onChange={(e) => updateStep(selectedStepData.id, { label: e.target.value })} className="w-full px-2 py-1 text-xs border rounded" />
                  </div>

                  {(selectedStepData.type === 'query' || selectedStepData.type === 'write' || selectedStepData.type === 'set_and_query') && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Command</label>
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={selectedStepData.params.command}
                            onChange={(e) => {
                              const newCommand = e.target.value;
                              
                              // Auto-detect query vs write based on '?' at the end
                              const isQueryCommand = newCommand.trim().endsWith('?');
                              const shouldBeQuery = isQueryCommand && (selectedStepData.type === 'write' || selectedStepData.type === 'set_and_query');
                              const shouldBeWrite = !isQueryCommand && selectedStepData.type === 'query';
                              
                              // Try to find command in library and extract parameters
                              const libraryCommand = commandLibrary.find(cmd => {
                                const cmdScpi = cmd.scpi || '';
                                // Match header (before first space), removing query marker for comparison
                                const cmdHeader = cmdScpi.split(' ')[0].replace(/\?$/, '').replace(/\{.*?\}/g, '<x>');
                                const inputHeader = newCommand.split(' ')[0].replace(/\?$/, '');
                                return cmdHeader === inputHeader || cmdScpi === newCommand;
                              });
                              
                              let newParams = selectedStepData.params.cmdParams || [];
                              if (libraryCommand) {
                                // Extract parameters from library command
                                const extractedParams = extractCommandParameters(libraryCommand);
                                if (extractedParams.length > 0) {
                                  newParams = extractedParams;
                                }
                              }
                              
                              // Update step with new command and potentially new type
                              const updates: Partial<Step> = {
                                params: { 
                                  ...selectedStepData.params, 
                                  command: newCommand,
                                  cmdParams: newParams,
                                  paramValues: selectedStepData.params.paramValues || {}
                                }
                              };
                              
                              // Change step type if command type changed
                              if (shouldBeQuery) {
                                updates.type = 'query';
                              } else if (shouldBeWrite) {
                                updates.type = 'write';
                              }
                              
                              updateStep(selectedStepData.id, updates);
                            }}
                            className="flex-1 px-2 py-1 text-xs font-mono border rounded"
                          />
                          <button
                            onClick={() =>
                              openCommandBrowser((cmd) => {
                                // Extract parameters using the new syntax parser
                                const extractedParams = extractCommandParameters(cmd);
                                
                                // Determine command type and whether to add '?'
                                const commandType = cmd.manualEntry?.commandType || 'set';
                                const currentStepIsQuery = selectedStepData.type === 'query';
                                const commandEndsWithQuery = cmd.scpi.trim().endsWith('?');
                                
                                // If current step is query, and command supports query, add '?' if not present
                                let finalCommand = cmd.scpi;
                                let finalStepType = selectedStepData.type;
                                
                                if (currentStepIsQuery) {
                                  // User is on a query step - respect that
                                  if (!commandEndsWithQuery && (commandType === 'query' || commandType === 'both')) {
                                    // Add '?' to make it a query
                                    finalCommand = cmd.scpi.trim() + '?';
                                  }
                                  finalStepType = 'query';
                                } else {
                                  // User is on a write step - check command type
                                  if (commandType === 'query') {
                                    // Command is query-only, add '?' and change to query
                                    if (!commandEndsWithQuery) {
                                      finalCommand = cmd.scpi.trim() + '?';
                                    }
                                    finalStepType = 'query';
                                  } else if (commandEndsWithQuery) {
                                    // Command has '?', change to query
                                    finalStepType = 'query';
                                  } else {
                                    // Default to write
                                    finalStepType = 'write';
                                  }
                                }
                                
                                updateStep(selectedStepData.id, {
                                  label: cmd.name,
                                  category: cmd.category,
                                  subcategory: cmd.subcategory,
                                  type: finalStepType,
                                  params: { 
                                    ...selectedStepData.params, 
                                    command: finalCommand,
                                    cmdParams: extractedParams,
                                    paramValues: {}
                                  }
                                });
                              })
                            }
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            title="Browse commands"
                          >
                            <Search size={12} />
                          </button>
                          <button
                            onClick={() => setShowSCPIHelp(true)}
                            className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
                            title="Show command help"
                          >
                            <HelpCircle size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Trigger Type Selector for {A|B} commands */}
                      {selectedStepData.params.command?.includes('{A|B}') && (
                        <div className="p-2 bg-amber-50 rounded border border-amber-200">
                          <div className="text-xs font-semibold mb-2 text-amber-800">Trigger Type</div>
                          <div className="mb-2">
                            <label className="block text-xs mb-1 text-amber-700 font-medium">
                              Select A or B
                            </label>
                            <select
                              value={selectedStepData.params.paramValues?.['trigger_type'] || 'A'}
                              onChange={(e) => {
                                updateStep(selectedStepData.id, {
                                  params: {
                                    ...selectedStepData.params,
                                    paramValues: {
                                      ...(selectedStepData.params.paramValues || {}),
                                      trigger_type: e.target.value
                                    }
                                  }
                                });
                              }}
                              className="w-full px-2 py-1 text-xs border border-amber-300 rounded bg-white"
                            >
                              <option value="A">A (Primary Trigger)</option>
                              <option value="B">B (Secondary Trigger)</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* SCPI Editable Parameters */}
                      {(() => {
                        const command = selectedStepData.params.command || '';
                        if (!command) return null;
                        
                        try {
                          const parsed = parseSCPI(command);
                          let editableParams = detectEditableParameters(parsed);
                          
                          // Update currentValue for each param based on actual command content
                          editableParams = editableParams.map(param => {
                            const actualValue = command.slice(param.startIndex, param.endIndex);
                            // If the command has a concrete value (not <x>), use that as currentValue
                            if (!actualValue.includes('<x>')) {
                              return {
                                ...param,
                                currentValue: actualValue
                              };
                            }
                            return param;
                          });
                          
                          if (editableParams.length === 0) return null;
                          
                          // Try to find command in library to get argument names
                          const libraryCommand = commandLibrary.find(cmd => {
                            const cmdScpi = cmd.scpi || '';
                            // Match header (before first space)
                            const cmdHeader = cmdScpi.split(' ')[0].replace(/\{.*?\}/g, '<x>');
                            const inputHeader = command.split(' ')[0];
                            return cmdHeader === inputHeader || cmdScpi === command;
                          });
                          
                          // Helper to get better parameter labels
                          const getParameterLabel = (param: EditableParameter, index: number, parsed: ParsedSCPI): string => {
                            // First, try to get name from JSON arguments
                            if (libraryCommand?.params && libraryCommand.params.length > index) {
                              const jsonParam = libraryCommand.params[index];
                              if (jsonParam.name) {
                                // Capitalize first letter and add unit if available
                                const name = jsonParam.name.charAt(0).toUpperCase() + jsonParam.name.slice(1);
                                return name;
                              }
                            }
                            // For mnemonic types, use type name
                            if (param.type === 'channel') return 'Source';
                            if (param.type === 'reference') return 'Reference';
                            if (param.type === 'math') return 'Math';
                            if (param.type === 'bus') return 'Bus';
                            if (param.type === 'measurement') return 'Measurement';
                            if (param.type === 'cursor') return 'Cursor';
                            if (param.type === 'zoom') return 'Zoom';
                            if (param.type === 'search') return 'Search';
                            
                            // For numeric/enum, try to infer from command context
                            if (param.type === 'numeric' || param.type === 'enumeration') {
                              // Look at the mnemonic before this argument to infer meaning
                              const argIndex = param.position;
                              if (argIndex >= 0 && parsed.mnemonics.length > 0) {
                                const lastMnemonic = (parsed.mnemonics[parsed.mnemonics.length - 1] || '').toString().toUpperCase();
                                
                                // Common patterns
                                if (lastMnemonic.includes('SCALE') || lastMnemonic.includes('SCAL')) {
                                  return 'Scale (V/div)';
                                }
                                if (lastMnemonic.includes('POSITION') || lastMnemonic.includes('POS')) {
                                  return 'Position (divisions)';
                                }
                                if (lastMnemonic.includes('OFFSET') || lastMnemonic.includes('OFFS')) {
                                  return 'Offset (V)';
                                }
                                if (lastMnemonic.includes('WIDTH') || lastMnemonic.includes('WIDT')) {
                                  return 'Width';
                                }
                                if (lastMnemonic.includes('START') || lastMnemonic.includes('STAR')) {
                                  return 'Start';
                                }
                                if (lastMnemonic.includes('STOP')) {
                                  return 'Stop';
                                }
                                if (lastMnemonic.includes('DELAY') || lastMnemonic.includes('DELA')) {
                                  return 'Delay';
                                }
                                if (lastMnemonic.includes('DURATION') || lastMnemonic.includes('DURA')) {
                                  return 'Duration';
                                }
                                if (lastMnemonic.includes('LEVEL') || lastMnemonic.includes('LEVE')) {
                                  return 'Level';
                                }
                                if (lastMnemonic.includes('TIMEOUT') || lastMnemonic.includes('TIME')) {
                                  return 'Time';
                                }
                                if (lastMnemonic.includes('COUNT') || lastMnemonic.includes('COUN')) {
                                  return 'Count';
                                }
                                if (lastMnemonic.includes('NUM') || lastMnemonic.includes('NUMBER')) {
                                  return 'Number';
                                }
                                if (lastMnemonic.includes('RATE')) {
                                  return 'Rate';
                                }
                                if (lastMnemonic.includes('FREQUENCY') || lastMnemonic.includes('FREQ')) {
                                  return 'Frequency';
                                }
                              }
                              
                              // Default labels based on type
                              if (param.type === 'numeric') {
                                return 'Value';
                              }
                              if (param.type === 'enumeration') {
                                return 'Option';
                              }
                            }
                            
                            // Ensure currentValue is a string
                            return String(param.currentValue || '');
                          };
                          
                          // Determine section title based on mnemonic types
                          const mnemonicTypes = editableParams.map(p => p.mnemonicType).filter((t): t is NonNullable<typeof t> => !!t);
                          const getSectionTitle = () => {
                            if (mnemonicTypes.length === 0) return 'Editable Parameters';
                            const uniqueTypes: string[] = [];
                            for (const type of mnemonicTypes) {
                              if (type && !uniqueTypes.includes(type)) {
                                uniqueTypes.push(type);
                              }
                            }
                            if (uniqueTypes.length === 1) {
                              const type = uniqueTypes[0];
                              const titles: Record<string, string> = {
                                'channel': 'Channel',
                                'reference': 'Reference',
                                'math': 'Math',
                                'bus': 'Bus',
                                'measurement': 'Measurement',
                                'cursor': 'Cursor',
                                'zoom': 'Zoom',
                                'search': 'Search',
                                'plot': 'Plot',
                                'view': 'View',
                                'power': 'Power',
                                'histogram': 'Histogram',
                                'callout': 'Callout',
                                'mask': 'Mask',
                                'digital_bit': 'Digital Bit',
                                'area': 'Area',
                                'source': 'Source',
                                'edge': 'Edge',
                                'segment': 'Segment',
                                'point': 'Point',
                                'table': 'Table',
                              };
                              return titles[type] || 'Editable Parameters';
                            }
                            return 'Editable Parameters';
                          };
                          
                          return (
                            <div className="p-2 bg-green-50 rounded border border-green-200">
                              <div className="text-xs font-semibold mb-2 text-green-800">{getSectionTitle()}</div>
                              {editableParams.map((param, idx) => {
                                const label = getParameterLabel(param, idx, parsed);
                                // Get current value from command - extract the actual value from the command string
                                const currentValueInCommand = command.slice(param.startIndex, param.endIndex);
                                
                                // Determine the current value to display
                                let currentValue: string;
                                if (currentValueInCommand.includes('<x>')) {
                                  // If command has <x> placeholder, use first option (default to 1)
                                  currentValue = param.validOptions[0] || param.currentValue || '';
                                } else {
                                  // Extract the actual value from the command (e.g., "GSOurce2" from "GSOurce2")
                                  // Use the value directly from the command
                                  currentValue = currentValueInCommand;
                                  
                                  // For dropdowns, ensure the value matches one of the valid options
                                  // If not, try to find a matching option (case-insensitive)
                                  if (param.validOptions.length > 0) {
                                    const exactMatch = param.validOptions.find(opt => opt === currentValue);
                                    if (!exactMatch) {
                                      // Try case-insensitive match
                                      const caseInsensitiveMatch = param.validOptions.find(opt => 
                                        opt.toLowerCase() === currentValue.toLowerCase()
                                      );
                                      if (caseInsensitiveMatch) {
                                        currentValue = caseInsensitiveMatch;
                                      } else {
                                        // For special patterns like PG8Val, check if we can construct a match
                                        // The value should already be in validOptions if it was generated correctly
                                        // If not found, keep the extracted value (it will still work)
                                      }
                                    }
                                  }
                                }
                                
                                // Note: Auto-replacement of <x> with default value (1) is handled
                                // by the substituteSCPI function when building the final command
                                
                                return (
                                  <div key={idx} className="mb-2">
                                    <label className="block text-xs mb-1 text-green-700 font-medium">
                                      {label}
                                    </label>
                                    {param.validOptions.length > 0 ? (
                                      <select
                                        value={currentValue}
                                        onChange={(e) => {
                                          const newCommand = replaceParameter(command, param, e.target.value);
                                          updateStep(selectedStepData.id, {
                                            params: { ...selectedStepData.params, command: newCommand }
                                          });
                                        }}
                                        className="w-full px-2 py-1 text-xs border rounded bg-white"
                                      >
                                        {param.validOptions.map(opt => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        inputMode={param.type === 'numeric' ? 'decimal' : 'text'}
                                        value={param.currentValue}
                                        onChange={(e) => {
                                          const newCommand = replaceParameter(command, param, e.target.value);
                                          updateStep(selectedStepData.id, {
                                            params: { ...selectedStepData.params, command: newCommand }
                                          });
                                        }}
                                        className={`w-full px-2 py-1 text-xs border rounded bg-white ${param.type === 'numeric' ? 'font-mono' : ''}`}
                                        placeholder={param.type === 'numeric' ? 'Enter number' : 'Enter value'}
                                      />
                                    )}
                                    {param.description && (
                                      <p className="text-xs text-green-600 mt-1">{param.description}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        } catch (e) {
                          return null;
                        }
                      })()}

                      {selectedStepData.params.cmdParams && selectedStepData.params.cmdParams.length > 0 && (() => {
                        // Filter out mnemonic-related parameters that are already handled by editable parameters
                        // These are parameters like: math, waveview, channel, bus, ref, meas, cursor, search, plot, zoom
                        // which correspond to <x> placeholders in the SCPI command (e.g., MATH<x>, WAVEView<x>, CH<x>)
                        const command = selectedStepData.params.command || '';
                        
                        // List of mnemonic parameter names that should be excluded from Command Parameters
                        // because they're handled by the green "Editable Parameters" section or are for command path choices
                        const mnemonicParamNames = [
                          'x', 'n', 'math', 'waveview', 'channel', 'ch', 'bus', 'b', 
                          'ref', 'reference', 'meas', 'measurement', 'cursor', 'search', 
                          'plot', 'zoom', 'view', 'plotview', 'power', 'scope', 'histogram',
                          'trigger_type', 'trigger', 'trig', 'callout', 'mask', 'digital_bit', 
                          'area', 'd', 'source', 'gsource', 'source_num', 'pg', 'pw', 'amp', 'maxg', 'output' // For {A|B} trigger type selection, callout for CALLOUT<x>, mask, digital bit, area, source, and WBG parameters
                        ];
                        
                        // Also check if the command has any <x> placeholders
                        const hasPlaceholders = /<x>/i.test(command);
                        
                        // Filter out mnemonic parameters
                        // First pass: identify all parameters
                        const allParams = selectedStepData.params.cmdParams || [];
                        
                        // Check if there's a more specific named numeric parameter (not 'value') 
                        // that would be the actual command argument (not a mnemonic placeholder)
                        // Only skip 'value' if it's ALSO numeric (to avoid duplicates like Offset + value)
                        // Don't skip 'value' if it's an enumeration (like ON/OFF) - those are real options
                        const valueParam = allParams.find((p: CommandParam) => p.name.toLowerCase() === 'value');
                        const valueIsNumeric = valueParam && (valueParam.type === 'number' || valueParam.type === 'integer');
                        
                        const hasSpecificNumericParam = valueIsNumeric && allParams.some((p: CommandParam) => {
                          const pNameLower = p.name.toLowerCase();
                          // Must be a different parameter, numeric, and not a mnemonic placeholder
                          return pNameLower !== 'value' && 
                            (p.type === 'number' || p.type === 'integer') &&
                            !mnemonicParamNames.includes(pNameLower) &&
                            !(p.description?.toLowerCase().includes('<x>') || 
                              p.description?.toLowerCase().includes('where x is'));
                        });
                        
                        // For query commands, only show mnemonic parameters (like 'power', 'channel', etc.)
                        // Query commands don't have value parameters - they only return values
                        const isQueryStep = selectedStepData.type === 'query';
                        
                        // Get queryArguments from the library command's syntax
                        const stepCommand = selectedStepData.params.command || '';
                        const libraryCommandForStep = commandLibrary.find(cmd => {
                          const cmdScpi = cmd.scpi || '';
                          const cmdHeader = cmdScpi.split(/\s|\?/)[0];
                          const stepHeader = stepCommand.split(/\s|\?/)[0];
                          const normalize = (h: string) => h.replace(/\d+/g, '<x>').toLowerCase();
                          return normalize(cmdHeader) === normalize(stepHeader);
                        });
                        const queryArguments = (libraryCommandForStep as any)?.manualEntry?.syntax?.queryArguments || [];
                        
                        const filteredParams = allParams.filter((param: CommandParam) => {
                          const paramNameLower = param.name.toLowerCase();
                          
                          // NEW: Filter out queryOnly parameters when in query mode
                          if (isQueryStep && param.queryOnly) {
                            return false; // Hide queryOnly arguments in query commands
                          }
                          
                          // NEW: For query commands, only show arguments listed in queryArguments
                          if (isQueryStep && queryArguments.length > 0 && !queryArguments.includes(param.name)) {
                            return false; // Hide arguments not in queryArguments list
                          }
                          
                          // Skip mnemonic-related parameters, but be smart about 'source'
                          // 'source' should only be filtered if it's a mnemonic (like GSOurce<x>)
                          // For command arguments (like BUS:B<x>:ARINC429A:SOUrce CH1), keep it
                          if (paramNameLower === 'source') {
                            // Check if this is a mnemonic parameter by looking at the command structure
                            // If the command has a pattern like GSOurce<x> or SOUrce<x>, it's a mnemonic
                            const hasSourceMnemonic = /(GSOurce|SOUrce)(<x>|\d+)/i.test(command);
                            if (hasSourceMnemonic) {
                              return false; // It's a mnemonic, filter it out
                            }
                            // Otherwise, it's a command argument, keep it
                          } else if (mnemonicParamNames.includes(paramNameLower)) {
                            return false;
                          }
                          
                          // For query commands, skip ALL value parameters (they don't take arguments)
                          // Only mnemonic parameters (like 'power', 'channel') are needed for query commands
                          if (isQueryStep && paramNameLower === 'value') {
                            return false;
                          }
                          
                          // Skip generic numeric 'value' parameter if there's a more specific numeric parameter
                          // (e.g., skip 'value' when 'Offset' exists, but keep 'value' when it's ON/OFF enum)
                          if (paramNameLower === 'value' && hasSpecificNumericParam) {
                            return false;
                          }
                          
                          // Also skip if param description mentions it's for a mnemonic placeholder
                          if (param.description) {
                            const descLower = param.description.toLowerCase();
                            if (descLower.includes('<x>') || 
                                descLower.includes('where x is') || 
                                descLower.includes('waveview') ||
                                descLower.includes('math waveform number') ||
                                descLower.includes('channel number') ||
                                descLower.includes('trigger type') ||
                                descLower.includes('a or b')) {
                              return false;
                            }
                          }
                          
                          return true;
                        });
                        
                        // Sort parameters by priority: trigger_type > bus > value > others
                        const paramPriority: Record<string, number> = {
                          'trigger_type': 1,
                          'trigger': 2,
                          'bus': 3,
                          'value': 100, // value should come last
                        };
                        
                        const sortedParams = [...filteredParams].sort((a, b) => {
                          const aNameLower = a.name.toLowerCase();
                          const bNameLower = b.name.toLowerCase();
                          const aPriority = paramPriority[aNameLower] ?? 50;
                          const bPriority = paramPriority[bNameLower] ?? 50;
                          return aPriority - bPriority;
                        });
                        
                        if (sortedParams.length === 0) return null;
                        
                        return (
                          <div className="p-2 bg-blue-50 rounded border border-blue-200">
                            <div className="text-xs font-semibold mb-2">Command Parameters</div>
                            {sortedParams.map((param: CommandParam) => {
                            // Get default from examples if available - check paramValues first (from addCommandFromLibrary)
                            // If not in paramValues, try to extract from examples
                            let defaultValue = selectedStepData.params.paramValues?.[param.name];
                            
                            // If not already set from addCommandFromLibrary, try to extract from examples
                            if (defaultValue === undefined || defaultValue === null || defaultValue === '') {
                              defaultValue = param.default ?? '';
                              
                              // Find the library command from the step's command (not just selectedLibraryCommand)
                              const stepCommand = selectedStepData.params.command || '';
                              const libraryCommandForStep = commandLibrary.find(cmd => {
                                const cmdScpi = cmd.scpi || '';
                                // Match header (before first space) - normalize both
                                const cmdHeader = cmdScpi.split(/\s|\?/)[0];
                                const stepHeader = stepCommand.split(/\s|\?/)[0];
                                // Normalize by replacing numbers with <x> for comparison
                                const normalize = (h: string) => h.replace(/\d+/g, '<x>').toLowerCase();
                                return normalize(cmdHeader) === normalize(stepHeader);
                              });
                              
                              // Try to get example value from command examples (for all types, not just string/text)
                              const libraryCmd = libraryCommandForStep || selectedLibraryCommand;
                              const cmdExamples = (libraryCmd as any)?.examples || 
                                                  (libraryCmd as any)?.manualEntry?.examples || [];
                              const singleExample = (libraryCmd as any)?.example;
                              
                              if ((cmdExamples.length > 0 || singleExample) && selectedStepData.params.command) {
                                // Try both example formats
                                let exampleScpi = '';
                                if (singleExample && typeof singleExample === 'string' && singleExample.trim()) {
                                  exampleScpi = singleExample.trim();
                                } else {
                                  for (const example of cmdExamples) {
                                    if (example.scpi && typeof example.scpi === 'string') {
                                      exampleScpi = example.scpi.trim();
                                      break;
                                    }
                                    if (example.codeExamples?.scpi?.code) {
                                      exampleScpi = example.codeExamples.scpi.code.trim();
                                      break;
                                    }
                                  }
                                }
                                
                                if (exampleScpi) {
                                  // Extract arguments from example
                                  const spaceIndex = exampleScpi.indexOf(' ');
                                  if (spaceIndex > 0) {
                                    const argsString = exampleScpi.substring(spaceIndex + 1).trim();
                                    if (argsString && !argsString.endsWith('?')) {
                                      // Tokenize arguments
                                      const tokens = argsString.split(/\s+/).filter(t => t.length > 0);
                                      
                                      // Find this parameter's position in non-mnemonic params
                                      const mnemonicParamNames = ['measurement', 'source', 'source_num', 'channel', 'ch', 'bus', 'b', 
                                        'ref', 'reference', 'meas', 'math', 'cursor', 'search', 'plot', 'zoom', 'view', 
                                        'plotview', 'power', 'scope', 'histogram', 'callout', 'mask', 'digital_bit', 
                                        'area', 'd', 'gsource', 'g', 'pg', 'pw', 'amp', 'maxg', 'output'];
                                      
                                      const nonMnemonicParams = sortedParams.filter((p: CommandParam) => {
                                        const nameLower = p.name.toLowerCase();
                                        // For 'source', only filter if it's a mnemonic (like GSOurce<x>)
                                        if (nameLower === 'source') {
                                          const hasSourceMnemonic = /(GSOurce|SOUrce)(<x>|\d+)/i.test(command);
                                          if (hasSourceMnemonic) return false;
                                        }
                                        if (mnemonicParamNames.includes(nameLower)) return false;
                                        if (p.description && (
                                          p.description.toLowerCase().includes('<x>') || 
                                          p.description.toLowerCase().includes('where x is')
                                        )) return false;
                                        return true;
                                      });
                                      
                                      const paramIndex = nonMnemonicParams.findIndex(p => p.name === param.name);
                                      if (paramIndex >= 0 && paramIndex < tokens.length) {
                                        let token = tokens[paramIndex];
                                        // Remove quotes if present
                                        if ((token.startsWith('"') && token.endsWith('"')) || 
                                            (token.startsWith("'") && token.endsWith("'"))) {
                                          token = token.slice(1, -1);
                                        }
                                        
                                        // For numeric parameters, extract numeric value
                                        if (param.type === 'number' || param.type === 'integer') {
                                          const numericMatch = token.match(/-?\d+\.?\d*([eE][+-]?\d+)?/);
                                          if (numericMatch) {
                                            defaultValue = numericMatch[0];
                                          }
                                        } else {
                                          defaultValue = token;
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                            
                            const currentValue = selectedStepData.params.paramValues?.[param.name] ?? defaultValue;
                            // Ensure currentValue is a string before calling toUpperCase
                            const currentValueStr = String(currentValue || '');
                            
                            // NEW: Handle conditional values - filter options based on parent parameter
                            let availableOptions = param.options || [];
                            if (param.dependsOn && param.conditionalValues) {
                              const parentParamName = param.dependsOn;
                              const parentValue = selectedStepData.params.paramValues?.[parentParamName] || '';
                              // Find matching conditional values (case-insensitive match)
                              const matchingKey = Object.keys(param.conditionalValues).find(key => 
                                key.toLowerCase() === parentValue.toLowerCase()
                              );
                              if (matchingKey && param.conditionalValues[matchingKey]) {
                                availableOptions = param.conditionalValues[matchingKey];
                              } else {
                                // If no match, use all possible values from conditionalValues
                                const allConditionalValues = Object.values(param.conditionalValues).flat();
                                availableOptions = Array.from(new Set(allConditionalValues)); // Remove duplicates
                              }
                            }
                            
                            // Match numeric placeholders: <NR1>, <NR2>, <NR3>, <NRx>, <number>, <QString>
                            const numericPlaceholderRegex = /^<(NR\d*|number|NRx)>$/i;
                            const stringPlaceholderRegex = /^<QString>$/i;
                            
                            // Check if options contain a numeric or string placeholder
                            const numericPlaceholderOption = availableOptions.find(opt => numericPlaceholderRegex.test(opt));
                            const stringPlaceholderOption = availableOptions.find(opt => stringPlaceholderRegex.test(opt));
                            const hasNumericPlaceholder = !!numericPlaceholderOption;
                            
                            // Filter out placeholder options from dropdown - users can't "select" <number>
                            const filteredOptions = availableOptions.filter(opt => 
                              !numericPlaceholderRegex.test(opt) && !stringPlaceholderRegex.test(opt)
                            ) || [];
                            
                            // Determine if we need a hybrid UI (dropdown + number input)
                            const needsHybridInput = hasNumericPlaceholder && filteredOptions.length > 0;
                            const needsOnlyNumericInput = hasNumericPlaceholder && filteredOptions.length === 0;
                            
                            // Check if current value is a numeric input (not one of the enum options)
                            const isNumericValue = !filteredOptions.includes(currentValueStr) && 
                              (currentValueStr === '' || !isNaN(parseFloat(currentValueStr)));
                            
                            const isNumericPlaceholderSelected = !!numericPlaceholderOption && currentValueStr === numericPlaceholderOption;
                            const isCustomSelected = param.options && (currentValueStr.toUpperCase() === 'CUSTOM' || currentValueStr.toUpperCase() === 'CUSTOM');
                            const numericPlaceholderValue = selectedStepData.params.paramValues?.[`${param.name}_number`] ?? '1';
                            
                            return (
                              <div key={param.name} className="mb-2">
                                <label className="block text-xs mb-1">
                                  {param.name} {param.required && <span className="text-red-500">*</span>}
                                  {param.type === 'string' || param.type === 'text' ? (
                                    <span className="text-gray-400 ml-1">(text)</span>
                                  ) : null}
                                </label>
                                {param.type === 'number' || param.type === 'integer' ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={`Default: ${param.default}`}
                                    value={currentValueStr}
                                    onChange={(e) => {
                                      // Allow scientific notation, decimals, and negative numbers
                                      const val = e.target.value;
                                      updateStep(selectedStepData.id, {
                                        params: {
                                          ...selectedStepData.params,
                                          paramValues: {
                                            ...(selectedStepData.params.paramValues || {}),
                                            [param.name]: val
                                          }
                                        }
                                      });
                                    }}
                                    onKeyDown={(e) => {
                                      // Handle arrow keys for numeric increment/decrement
                                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        const currentVal = parseFloat(currentValueStr) || 0;
                                        // Determine step size based on value magnitude
                                        const absVal = Math.abs(currentVal);
                                        let step = 1;
                                        if (absVal < 0.0001) step = 0.00001;
                                        else if (absVal < 0.001) step = 0.0001;
                                        else if (absVal < 0.01) step = 0.001;
                                        else if (absVal < 0.1) step = 0.01;
                                        else if (absVal < 1) step = 0.1;
                                        else if (absVal < 10) step = 1;
                                        else if (absVal < 100) step = 10;
                                        else if (absVal < 1000) step = 100;
                                        else step = Math.pow(10, Math.floor(Math.log10(absVal)) - 1);
                                        
                                        const newVal = e.key === 'ArrowUp' ? currentVal + step : currentVal - step;
                                        // Format to avoid floating point issues
                                        const formatted = newVal.toPrecision(6).replace(/\.?0+$/, '');
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            paramValues: {
                                              ...(selectedStepData.params.paramValues || {}),
                                              [param.name]: formatted
                                            }
                                          }
                                        });
                                      }
                                    }}
                                    className="w-full px-2 py-1 text-xs border rounded font-mono"
                                  />
                                ) : (param.type === 'string' || param.type === 'text') && (param.inputType === 'color' || param.name.toLowerCase() === 'color') ? (
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="color"
                                      value={currentValueStr.startsWith('#') ? currentValueStr : (currentValueStr ? `#${currentValueStr.replace('#', '')}` : '#FF0000')}
                                      onChange={(e) => {
                                        const hexValue = e.target.value.toUpperCase();
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            paramValues: {
                                              ...(selectedStepData.params.paramValues || {}),
                                              [param.name]: hexValue
                                            }
                                          }
                                        });
                                      }}
                                      className="w-12 h-8 border rounded cursor-pointer"
                                      title="Pick a color"
                                    />
                                    <input
                                      type="text"
                                      placeholder={defaultValue ? `e.g. "${defaultValue}"` : '#FF0000'}
                                      value={currentValueStr}
                                      onChange={(e) => {
                                        let hexValue = e.target.value.toUpperCase();
                                        // Ensure it starts with # if it doesn't
                                        if (hexValue && !hexValue.startsWith('#')) {
                                          hexValue = '#' + hexValue;
                                        }
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            paramValues: {
                                              ...(selectedStepData.params.paramValues || {}),
                                              [param.name]: hexValue
                                            }
                                          }
                                        });
                                      }}
                                      className="flex-1 px-2 py-1 text-xs border rounded bg-white font-mono"
                                      pattern="^#[0-9A-Fa-f]{6}$"
                                    />
                                  </div>
                                ) : param.type === 'string' || param.type === 'text' ? (
                                  <input
                                    type="text"
                                    placeholder={defaultValue ? `e.g. "${defaultValue}"` : 'Enter text value'}
                                    value={currentValueStr}
                                    onChange={(e) =>
                                      updateStep(selectedStepData.id, {
                                        params: {
                                          ...selectedStepData.params,
                                          paramValues: {
                                            ...(selectedStepData.params.paramValues || {}),
                                            [param.name]: e.target.value
                                          }
                                        }
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs border rounded bg-white"
                                  />
                                ) : needsHybridInput ? (
                                  /* Hybrid UI: Dropdown for enum values + Number input */
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <select
                                      value={filteredOptions.includes(currentValueStr) ? currentValueStr : ''}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            paramValues: {
                                              ...(selectedStepData.params.paramValues || {}),
                                              [param.name]: newValue
                                            }
                                          }
                                        });
                                      }}
                                      className="flex-1 min-w-[80px] px-2 py-1 text-xs border rounded"
                                    >
                                      <option value="">-- or enter number --</option>
                                      {filteredOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                    <span className="text-xs text-gray-400 whitespace-nowrap">or</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="Number"
                                      value={!filteredOptions.includes(currentValueStr) ? currentValueStr : ''}
                                      onChange={(e) =>
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            paramValues: {
                                              ...(selectedStepData.params.paramValues || {}),
                                              [param.name]: e.target.value
                                            }
                                          }
                                        })
                                      }
                                      className="w-16 min-w-0 px-2 py-1 text-xs border rounded font-mono"
                                    />
                                  </div>
                                ) : needsOnlyNumericInput ? (
                                  /* Only numeric input - no enum options */
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={`Default: ${param.default ?? 1}`}
                                    value={currentValueStr}
                                    onChange={(e) =>
                                      updateStep(selectedStepData.id, {
                                        params: {
                                          ...selectedStepData.params,
                                          paramValues: {
                                            ...(selectedStepData.params.paramValues || {}),
                                            [param.name]: e.target.value
                                          }
                                        }
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs border rounded font-mono"
                                  />
                                ) : availableOptions && availableOptions.length > 0 ? (
                                  <>
                                    <select
                                      value={currentValueStr}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            paramValues: {
                                              ...(selectedStepData.params.paramValues || {}),
                                              [param.name]: newValue
                                            }
                                          }
                                        });
                                      }}
                                      className="w-full px-2 py-1 text-xs border rounded"
                                    >
                                      {availableOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                    {/* Show additional input when CUSTom is selected */}
                                    {isCustomSelected && (
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Enter custom value (e.g., 12500)"
                                        value={selectedStepData.params.paramValues?.[`${param.name}_custom`] ?? ''}
                                        onChange={(e) =>
                                          updateStep(selectedStepData.id, {
                                            params: {
                                              ...selectedStepData.params,
                                              paramValues: {
                                                ...(selectedStepData.params.paramValues || {}),
                                                [`${param.name}_custom`]: e.target.value
                                              }
                                            }
                                          })
                                        }
                                        className="w-full px-2 py-1 text-xs border rounded mt-2 font-mono"
                                      />
                                    )}
                                    {/* Show numeric input when numeric placeholder (<NRx>) is selected */}
                                    {isNumericPlaceholderSelected && (
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Enter numeric value (default 1)"
                                        value={numericPlaceholderValue}
                                        onChange={(e) =>
                                          updateStep(selectedStepData.id, {
                                            params: {
                                              ...selectedStepData.params,
                                              paramValues: {
                                                ...(selectedStepData.params.paramValues || {}),
                                                [`${param.name}_number`]: e.target.value
                                              }
                                            }
                                          })
                                        }
                                        className="w-full px-2 py-1 text-xs border rounded mt-2 font-mono"
                                      />
                                    )}
                                  </>
                                ) : (
                                  <input
                                    type="text"
                                    placeholder={`Default: ${param.default}`}
                                    value={currentValueStr}
                                    onChange={(e) =>
                                      updateStep(selectedStepData.id, {
                                        params: {
                                          ...selectedStepData.params,
                                          paramValues: {
                                            ...(selectedStepData.params.paramValues || {}),
                                            [param.name]: e.target.value
                                          }
                                        }
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs border rounded"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        );
                      })()}

                      {selectedStepData.type === 'query' && (() => {
                        // Helper to generate clean variable name from label
                        const generateVarName = (label: string): string => {
                          // Remove type suffixes and special chars, convert to lowercase, use first word
                          const cleaned = label
                            .replace(/ \((Set\+Query|Set|Query)\)$/i, '')
                            .replace(/[^a-zA-Z0-9_]/g, '_')
                            .replace(/_+/g, '_')
                            .replace(/^_|_$/g, '')
                            .toLowerCase();
                          // Take first word or first 20 chars
                          const firstWord = cleaned.split('_')[0] || cleaned.slice(0, 20);
                          return firstWord || 'result';
                        };
                        
                        // Check if variable name is unique across all steps
                        const isVarNameUnique = (name: string, currentStepId: string): boolean => {
                          const checkSteps = (items: Step[]): boolean => {
                            for (const step of items) {
                              if (step.id !== currentStepId && step.params?.saveAs === name) {
                                return false;
                              }
                              if (step.children && !checkSteps(step.children)) {
                                return false;
                              }
                            }
                            return true;
                          };
                          return checkSteps(steps);
                        };
                        
                        // Generate unique variable name
                        const getUniqueVarName = (label: string, currentStepId: string): string => {
                          const base = generateVarName(label);
                          if (isVarNameUnique(base, currentStepId)) return base;
                          // Add suffix if not unique
                          for (let i = 2; i <= 99; i++) {
                            const candidate = `${base}${i}`;
                            if (isVarNameUnique(candidate, currentStepId)) return candidate;
                          }
                          return `${base}_${Date.now()}`;
                        };
                        
                        return (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              id="useVariable"
                              checked={!!selectedStepData.params.saveAs}
                              onChange={(e) => {
                                const newSaveAs = e.target.checked 
                                  ? getUniqueVarName(selectedStepData.label || 'result', selectedStepData.id)
                                  : undefined;
                                updateStep(selectedStepData.id, { 
                                  params: { 
                                    ...selectedStepData.params, 
                                    saveAs: newSaveAs
                                  } 
                                });
                              }}
                              className="w-4 h-4"
                            />
                            <label htmlFor="useVariable" className="text-xs font-medium cursor-pointer">
                              Set Variable
                            </label>
                          </div>
                          {selectedStepData.params.saveAs && (
                            <div>
                              <label className="block text-xs font-medium mb-1">Variable Name</label>
                              <input
                                type="text"
                                value={selectedStepData.params.saveAs}
                                onChange={(e) =>
                                  updateStep(selectedStepData.id, { params: { ...selectedStepData.params, saveAs: e.target.value } })
                                }
                                className="w-full px-2 py-1 text-xs font-mono border rounded"
                                placeholder={generateVarName(selectedStepData.label || 'result')}
                              />
                            </div>
                          )}
                        </div>
                        );
                      })()}

                      {/* Set+Query: Save Verified Value option */}
                      {selectedStepData.type === 'set_and_query' && (() => {
                        // Helper to generate clean variable name from label
                        const generateVarName = (label: string): string => {
                          const cleaned = label
                            .replace(/ \((Set\+Query|Set|Query)\)$/i, '')
                            .replace(/[^a-zA-Z0-9_]/g, '_')
                            .replace(/_+/g, '_')
                            .replace(/^_|_$/g, '')
                            .toLowerCase();
                          const firstWord = cleaned.split('_')[0] || cleaned.slice(0, 20);
                          return firstWord || 'result';
                        };
                        
                        const isVarNameUnique = (name: string, currentStepId: string): boolean => {
                          const checkSteps = (items: Step[]): boolean => {
                            for (const step of items) {
                              if (step.id !== currentStepId && step.params?.saveAs === name) return false;
                              if (step.children && !checkSteps(step.children)) return false;
                            }
                            return true;
                          };
                          return checkSteps(steps);
                        };
                        
                        const getUniqueVarName = (label: string, currentStepId: string): string => {
                          const base = generateVarName(label);
                          if (isVarNameUnique(base, currentStepId)) return base;
                          for (let i = 2; i <= 99; i++) {
                            const candidate = `${base}${i}`;
                            if (isVarNameUnique(candidate, currentStepId)) return candidate;
                          }
                          return `${base}_${Date.now()}`;
                        };
                        
                        return (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              id="saveVerifiedValue"
                              checked={!!selectedStepData.params.saveAs}
                              onChange={(e) => {
                                const newSaveAs = e.target.checked 
                                  ? getUniqueVarName(selectedStepData.label || 'result', selectedStepData.id)
                                  : undefined;
                                updateStep(selectedStepData.id, { 
                                  params: { 
                                    ...selectedStepData.params, 
                                    saveAs: newSaveAs
                                  } 
                                });
                              }}
                              className="w-4 h-4"
                            />
                            <label htmlFor="saveVerifiedValue" className="text-xs font-medium cursor-pointer">
                              Save Verified Value
                            </label>
                          </div>
                          {selectedStepData.params.saveAs && (
                            <div>
                              <label className="block text-xs font-medium mb-1">Variable Name</label>
                              <input
                                type="text"
                                value={selectedStepData.params.saveAs}
                                onChange={(e) =>
                                  updateStep(selectedStepData.id, { params: { ...selectedStepData.params, saveAs: e.target.value } })
                                }
                                className="w-full px-2 py-1 text-xs font-mono border rounded"
                                placeholder={generateVarName(selectedStepData.label || 'result')}
                              />
                              
                              {/* Quick Python Snippet Button */}
                              <div className="mt-3 pt-3 border-t border-gray-200">
                                <label className="block text-xs font-medium mb-2">Add Python Snippet</label>
                                <div className="grid grid-cols-2 gap-1">
                                  <button
                                    onClick={() => {
                                      const varName = selectedStepData.params.saveAs;
                                      const cmd = selectedStepData.params.command || '';
                                      const cmdHeader = cmd.split(/\s+/)[0]?.replace(/\?$/, '') || 'command';
                                      // Extract the set value from the command (everything after the header)
                                      const cmdParts = cmd.split(/\s+/);
                                      const setValue = cmdParts.length > 1 ? cmdParts.slice(1).join(' ').replace(/^["']|["']$/g, '') : '';
                                      // Get the actual value from dropdown (paramValues) first, then fall back to command value
                                      const paramValues = selectedStepData.params.paramValues || {};
                                      const dropdownValue = paramValues['value'] || paramValues['Value'] || '';
                                      const expected = window.prompt(`Enter expected value for ${varName}:`, dropdownValue || setValue || '');
                                      if (!expected) return;
                                      const code = `# Verify ${cmdHeader} returned expected value\nassert ${varName} == "${expected}", f"Expected '${expected}', got '{${varName}}'"`;
                                      const newStep: Step = { id: crypto.randomUUID(), type: 'python', label: 'Python: Assert equals', params: { code } };
                                      const insertAfter = (arr: Step[], targetId: string, newItem: Step): Step[] => {
                                        const result: Step[] = [];
                                        for (const s of arr) { result.push(s); if (s.id === targetId) result.push(newItem); if (s.children) s.children = insertAfter(s.children, targetId, newItem); }
                                        return result;
                                      };
                                      commit(insertAfter(steps, selectedStepData.id, newStep));
                                      setSelectedStep(newStep.id);
                                    }}
                                    className="px-2 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded transition"
                                    title="Assert query result equals expected value"
                                  >
                                    Assert ==
                                  </button>
                                  <button
                                    onClick={() => {
                                      const varName = selectedStepData.params.saveAs;
                                      const cmd = selectedStepData.params.command || '';
                                      const cmdHeader = cmd.split(/\s+/)[0]?.replace(/\?$/, '') || 'command';
                                      // Extract the set value from the command
                                      const cmdParts = cmd.split(/\s+/);
                                      const setValue = cmdParts.length > 1 ? cmdParts.slice(1).join(' ').replace(/^["']|["']$/g, '') : '';
                                      // Get the actual value from dropdown (paramValues) first
                                      const paramValues = selectedStepData.params.paramValues || {};
                                      const dropdownValue = paramValues['value'] || paramValues['Value'] || '';
                                      const defaultValue = dropdownValue || setValue || 'ON';
                                      const code = `# Conditional check on ${cmdHeader}\nif ${varName} == "${defaultValue}":\n    print(f"${cmdHeader} matches expected value")\nelse:\n    print(f"${cmdHeader} mismatch: expected '${defaultValue}', got '{${varName}}'")`;
                                      const newStep: Step = { id: crypto.randomUUID(), type: 'python', label: 'Python: Conditional', params: { code } };
                                      const insertAfter = (arr: Step[], targetId: string, newItem: Step): Step[] => {
                                        const result: Step[] = [];
                                        for (const s of arr) { result.push(s); if (s.id === targetId) result.push(newItem); if (s.children) s.children = insertAfter(s.children, targetId, newItem); }
                                        return result;
                                      };
                                      commit(insertAfter(steps, selectedStepData.id, newStep));
                                      setSelectedStep(newStep.id);
                                    }}
                                    className="px-2 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded transition"
                                    title="Add if/else check on query result"
                                  >
                                    If/Else
                                  </button>
                                  <button
                                    onClick={() => {
                                      const varName = selectedStepData.params.saveAs;
                                      const cmd = selectedStepData.params.command || '';
                                      const cmdHeader = cmd.split(/\s+/)[0]?.replace(/\?$/, '') || 'command';
                                      const code = `# Log ${cmdHeader} value\nprint(f"${cmdHeader} = {${varName}}")`;
                                      const newStep: Step = { id: crypto.randomUUID(), type: 'python', label: 'Python: Log', params: { code } };
                                      const insertAfter = (arr: Step[], targetId: string, newItem: Step): Step[] => {
                                        const result: Step[] = [];
                                        for (const s of arr) { result.push(s); if (s.id === targetId) result.push(newItem); if (s.children) s.children = insertAfter(s.children, targetId, newItem); }
                                        return result;
                                      };
                                      commit(insertAfter(steps, selectedStepData.id, newStep));
                                      setSelectedStep(newStep.id);
                                    }}
                                    className="px-2 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded transition"
                                    title="Print query result to console"
                                  >
                                    Log
                                  </button>
                                  <button
                                    onClick={() => {
                                      const varName = selectedStepData.params.saveAs;
                                      const cmd = selectedStepData.params.command || '';
                                      const cmdHeader = cmd.split(/\s+/)[0]?.replace(/\?$/, '') || 'command';
                                      const minVal = window.prompt('Enter minimum value:', '0');
                                      const maxVal = window.prompt('Enter maximum value:', '100');
                                      if (!minVal || !maxVal) return;
                                      const code = `# Verify ${cmdHeader} is within expected range\nvalue = float(${varName})\nassert ${minVal} <= value <= ${maxVal}, f"Value {value} out of range [${minVal}, ${maxVal}]"`;
                                      const newStep: Step = { id: crypto.randomUUID(), type: 'python', label: 'Python: Assert range', params: { code } };
                                      const insertAfter = (arr: Step[], targetId: string, newItem: Step): Step[] => {
                                        const result: Step[] = [];
                                        for (const s of arr) { result.push(s); if (s.id === targetId) result.push(newItem); if (s.children) s.children = insertAfter(s.children, targetId, newItem); }
                                        return result;
                                      };
                                      commit(insertAfter(steps, selectedStepData.id, newStep));
                                      setSelectedStep(newStep.id);
                                    }}
                                    className="px-2 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded transition"
                                    title="Assert query result is within numeric range"
                                  >
                                    Range
                                  </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Quick add Python snippets using <span className="font-mono bg-gray-100 px-1 rounded">{selectedStepData.params.saveAs}</span></p>
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })()}
                    </>
                  )}

                  {selectedStepData.type === 'sleep' && (
                    <div>
                      <label className="block text-xs font-medium mb-1">Duration (s)</label>
                      <input
                        type="number"
                        step={0.1}
                        value={selectedStepData.params.duration}
                        onChange={(e) =>
                          updateStep(selectedStepData.id, { params: { ...selectedStepData.params, duration: parseFloat(e.target.value) } })
                        }
                        className="w-full px-2 py-1 text-xs border rounded"
                      />
                    </div>
                  )}

                  {selectedStepData.type === 'comment' && (
                    <div>
                      <label className="block text-xs font-medium mb-1">Comment Text</label>
                      <input
                        type="text"
                        value={selectedStepData.params.text || ''}
                        onChange={(e) =>
                          updateStep(selectedStepData.id, { params: { ...selectedStepData.params, text: e.target.value }, label: e.target.value || 'Comment' })
                        }
                        placeholder="Disabled *OPC due to timeout"
                        className="w-full px-2 py-1 text-xs border rounded"
                      />
                      <p className="text-xs text-gray-500 mt-1">This will appear as: # your comment text</p>
                    </div>
                  )}

                  {selectedStepData.type === 'python' && (
                    <div>
                      <label className="block text-xs font-medium mb-1">Python Snippet</label>
                      <textarea
                        value={selectedStepData.params.code || ''}
                        onChange={(e) => {
                          const newCode = e.target.value;
                          const prevFirst = (selectedStepData.params.code || '').split('\n')[0]?.trim();
                          const nextFirst = newCode.split('\n')[0]?.trim();
                          const shouldUpdateLabel = !selectedStepData.label || selectedStepData.label === 'Python' || selectedStepData.label === prevFirst;
                          updateStep(selectedStepData.id, {
                            params: { ...selectedStepData.params, code: newCode },
                            label: shouldUpdateLabel ? (nextFirst || 'Python') : selectedStepData.label
                          });
                        }}
                        rows={6}
                        className="w-full px-2 py-1 text-xs font-mono border rounded"
                        placeholder={"for i in range(10):\n    with scope.access_data():\n        waveform = scope.get_data('CH1')"}
                      />
                      <p className="text-xs text-gray-500 mt-1">Runs exactly as written. Use the <code>scope</code> object for TekHSI commands.</p>
                    </div>
                  )}

                  {selectedStepData.type === 'save_waveform' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Command (optional - leave blank for CURVe?)</label>
                        <input
                          type="text"
                          value={selectedStepData.params.command || ''}
                          onChange={(e) =>
                            updateStep(selectedStepData.id, { params: { ...selectedStepData.params, command: e.target.value } })
                          }
                          placeholder="CURVe? or FILESYSTEM:READFILE ..."
                          className="w-full px-2 py-1 text-xs font-mono border rounded"
                        />
                        <p className="text-xs text-gray-500 mt-1">Leave blank for standard waveform capture</p>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium mb-1">Source / Channel</label>
                        <input
                          type="text"
                          value={selectedStepData.params.source || 'CH1'}
                          onChange={(e) =>
                            updateStep(selectedStepData.id, { params: { ...selectedStepData.params, source: e.target.value.toUpperCase() } })
                          }
                          placeholder="CH1, CH2, MATH1"
                          className="w-full px-2 py-1 text-xs font-mono border rounded"
                        />
                        <p className="text-xs text-gray-500 mt-1">Channel: CH1-CH4, Math: MATH1-MATH4</p>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium mb-1">Waveform Format</label>
                        <select
                          value={selectedStepData.params.format || 'bin'}
                          onChange={(e) => {
                            const format = e.target.value as 'bin' | 'wfm' | 'csv';
                            const ext = format === 'bin' ? '.bin' : format === 'wfm' ? '.wfm' : '.csv';
                            const currentFilename = selectedStepData.params.filename || 'data.bin';
                            const baseName = currentFilename.replace(/\.(bin|wfm|csv)$/i, '');
                            updateStep(selectedStepData.id, { 
                              params: { 
                                ...selectedStepData.params, 
                                format: format,
                                filename: baseName + ext
                              } 
                            });
                          }}
                          className="w-full px-2 py-1 text-xs border rounded"
                        >
                          <option value="bin">Binary (.bin) - Fast, precise</option>
                          <option value="wfm">Tektronix (.wfm) - Native format</option>
                          <option value="csv">CSV (.csv) - Human readable</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          {(selectedStepData.params.format || 'bin') === 'bin' && 'Raw binary - fastest, full precision'}
                          {(selectedStepData.params.format || 'bin') === 'wfm' && 'Native format - can reload into scope'}
                          {(selectedStepData.params.format || 'bin') === 'csv' && 'ASCII format - slower, less precise'}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium mb-1">Data Width (bytes)</label>
                          <select
                            value={selectedStepData.params.width || 1}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, width: parseInt(e.target.value) } })
                            }
                            className="w-full px-2 py-1 text-xs border rounded"
                          >
                            <option value="1">1 byte (faster)</option>
                            <option value="2">2 bytes (precision)</option>
                          </select>
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium mb-1">Encoding</label>
                          <select
                            value={selectedStepData.params.encoding || 'RIBinary'}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, encoding: e.target.value } })
                            }
                            className="w-full px-2 py-1 text-xs border rounded"
                          >
                            <option value="RIBinary">RIBinary (signed)</option>
                            <option value="RPBinary">RPBinary (unsigned)</option>
                          </select>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium mb-1">Start Point</label>
                          <input
                            type="number"
                            value={selectedStepData.params.start || 1}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, start: parseInt(e.target.value) || 1 } })
                            }
                            className="w-full px-2 py-1 text-xs border rounded"
                            min="1"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium mb-1">Stop Point (blank = all)</label>
                          <input
                            type="text"
                            value={selectedStepData.params.stop === null ? '' : selectedStepData.params.stop}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, stop: e.target.value ? parseInt(e.target.value) : null } })
                            }
                            placeholder="Auto-detect"
                            className="w-full px-2 py-1 text-xs border rounded"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium mb-1">Filename</label>
                        <input
                          type="text"
                          value={selectedStepData.params.filename || 'data.bin'}
                          onChange={(e) =>
                            updateStep(selectedStepData.id, { params: { ...selectedStepData.params, filename: e.target.value } })
                          }
                          className="w-full px-2 py-1 text-xs font-mono border rounded"
                        />
                      </div>
                    </>
                  )}

                  {selectedStepData.type === 'error_check' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Error Query Command</label>
                        <input
                          type="text"
                          value={selectedStepData.params.command || 'ALLEV?'}
                          onChange={(e) =>
                            updateStep(selectedStepData.id, { params: { ...selectedStepData.params, command: e.target.value } })
                          }
                          placeholder="ALLEV?"
                          className="w-full px-2 py-1 text-xs font-mono border rounded"
                        />
                        <p className="text-xs text-gray-500 mt-1">Command to query instrument errors (default: ALLEV?)</p>
                      </div>
                    </>
                  )}

                  {selectedStepData.type === 'sweep' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Variable Name</label>
                        <input
                          type="text"
                          value={selectedStepData.params.variableName || 'value'}
                          onChange={(e) =>
                            updateStep(selectedStepData.id, { params: { ...selectedStepData.params, variableName: e.target.value || 'value' } })
                          }
                          placeholder="voltage, frequency, etc."
                          className="w-full px-2 py-1 text-xs font-mono border rounded"
                        />
                        <p className="text-xs text-gray-500 mt-1">Variable name to use in commands (e.g., use {"${value}"} in SCPI commands)</p>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">Start</label>
                          <input
                            type="number"
                            step="any"
                            value={selectedStepData.params.start ?? 0}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, start: parseFloat(e.target.value) || 0 } })
                            }
                            className="w-full px-2 py-1 text-xs border rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Stop</label>
                          <input
                            type="number"
                            step="any"
                            value={selectedStepData.params.stop ?? 10}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, stop: parseFloat(e.target.value) || 10 } })
                            }
                            className="w-full px-2 py-1 text-xs border rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Step</label>
                          <input
                            type="number"
                            step="any"
                            value={selectedStepData.params.step ?? 1}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, step: parseFloat(e.target.value) || 1 } })
                            }
                            className="w-full px-2 py-1 text-xs border rounded"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Sweep from Start to Stop in Step increments</p>
                      
                      <div className="mt-3 pt-3 border-t">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedStepData.params.saveResults || false}
                            onChange={(e) =>
                              updateStep(selectedStepData.id, { params: { ...selectedStepData.params, saveResults: e.target.checked } })
                            }
                            className="w-4 h-4"
                          />
                          <span className="text-xs font-medium">Save results to variable</span>
                        </label>
                        {selectedStepData.params.saveResults && (
                          <div className="mt-2">
                            <label className="block text-xs font-medium mb-1">Result Variable Name</label>
                            <input
                              type="text"
                              value={selectedStepData.params.resultVariable || 'results'}
                              onChange={(e) =>
                                updateStep(selectedStepData.id, { params: { ...selectedStepData.params, resultVariable: e.target.value || 'results' } })
                              }
                              placeholder="results"
                              className="w-full px-2 py-1 text-xs font-mono border rounded"
                            />
                            <p className="text-xs text-gray-500 mt-1">Results will be stored as a list in this variable</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-3 pt-3 border-t">
                        <label className="block text-xs font-medium mb-1">Assign to Instrument</label>
                        <select
                          value={selectedStepData.boundDeviceId || ''}
                          onChange={(e) => updateStep(selectedStepData.id, { boundDeviceId: e.target.value || undefined })}
                          className="w-full px-2 py-1 text-xs border rounded"
                        >
                          <option value="">Default (use first instrument)</option>
                          {devices.map((device) => (
                            <option key={device.id} value={device.id}>
                              {device.alias || `Instrument ${devices.indexOf(device) + 1}`} ({device.host || 'N/A'})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Select which instrument this sweep will use (child commands can override)</p>
                      </div>
                      
                      <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                        <p className="font-medium mb-1">💡 How to use:</p>
                        <ul className="list-disc list-inside space-y-1 text-blue-700">
                          <li>Add commands as children of this sweep step</li>
                          <li>Use {"${variableName}"} in SCPI commands to substitute the sweep value</li>
                          <li>Example: <code className="bg-blue-100 px-1 rounded">SOURce:VOLTage {"${value}"}</code></li>
                          <li>Results from query commands will be collected if "Save results" is enabled</li>
                        </ul>
                      </div>
                    </>
                  )}

                  {/* SCPI Preview - Set & Query */}
                  {selectedStepData.type === 'set_and_query' && (() => {
                    const cmd = substituteSCPI(
                      selectedStepData.params.command || '', 
                      selectedStepData.params.cmdParams || [], 
                      selectedStepData.params.paramValues || {}
                    ) || selectedStepData.params.command || '';
                    // For set_and_query: write command has the value, query command is just the header with ?
                    // Get the header (without trailing ? or value)
                    const cmdHeader = cmd.replace(/\?$/, '').split(/\s+/)[0];
                    const queryCmd = cmdHeader + '?';
                    
                    // Get the value from paramValues to append to write command
                    const paramValues = selectedStepData.params.paramValues || {};
                    const valueParam = paramValues['value'] || paramValues['Value'] || '';
                    
                    // Build write command: header + value (if not already in cmd)
                    let writeCmd = cmd.replace(/\?$/, ''); // Remove trailing ?
                    // If the command doesn't already have a value appended (just the header), add the value
                    if (writeCmd === cmdHeader && valueParam) {
                      writeCmd = `${cmdHeader} ${valueParam}`;
                    }
                    
                    const varName = selectedStepData.params.saveAs;
                    
                    return (
                      <div className="mt-3 space-y-2">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Python Preview</div>
                        {/* Step 1: Set */}
                        <div className="p-2 bg-slate-800 rounded text-[11px] font-mono break-all">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-bold text-green-400 bg-green-900/50 px-1.5 py-0.5 rounded">① SET</span>
                          </div>
                          <span className="text-yellow-400">scpi</span>
                          <span className="text-white">.</span>
                          <span className="text-blue-300">write</span>
                          <span className="text-white">(</span>
                          <span className="text-green-400">"{writeCmd}"</span>
                          <span className="text-white">)</span>
                        </div>
                        {/* Step 2: Verify */}
                        <div className="p-2 bg-slate-800 rounded text-[11px] font-mono break-all">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-bold text-blue-400 bg-blue-900/50 px-1.5 py-0.5 rounded">② VERIFY</span>
                          </div>
                          {varName && <><span className="text-blue-400">{varName}</span><span className="text-white"> = </span></>}
                          <span className="text-yellow-400">scpi</span>
                          <span className="text-white">.</span>
                          <span className="text-blue-300">query</span>
                          <span className="text-white">(</span>
                          <span className="text-green-400">"{queryCmd}"</span>
                          <span className="text-white">)</span>
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* SCPI Preview - Improved Layout */}
                  <div className={`mt-3 ${selectedStepData.type === 'set_and_query' ? 'hidden' : ''}`}>
                    <div className="text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Python Preview</div>
                    {selectedStepData.type === 'query' && (() => {
                      const cmd = substituteSCPI(
                        selectedStepData.params.command || '', 
                        selectedStepData.params.cmdParams || [], 
                        selectedStepData.params.paramValues || {}
                      ) || selectedStepData.params.command || '';
                      const isTmDevices = cmd.includes('.commands.') || cmd.includes('.add_') || cmd.includes('.save_');
                      const isTekHSI = (cmd.startsWith('scope.') && !isTmDevices) || cmd.startsWith('#');
                      const varName = selectedStepData.params.saveAs;
                      
                      if (isTmDevices || isTekHSI) {
                        return (
                          <div className="p-2 bg-slate-800 rounded text-[11px] font-mono text-green-400 break-all">
                            {varName && <span className="text-blue-400">{varName}</span>}
                            {varName && <span className="text-white"> = </span>}
                            <span className="text-green-400">{cmd}</span>
                          </div>
                        );
                      }
                      return (
                        <div className="p-2 bg-slate-800 rounded text-[11px] font-mono break-all">
                          {varName && <><span className="text-blue-400">{varName}</span><span className="text-white"> = </span></>}
                          <span className="text-yellow-400">scpi</span>
                          <span className="text-white">.</span>
                          <span className="text-blue-300">query</span>
                          <span className="text-white">(</span>
                          <span className="text-green-400">"{cmd}"</span>
                          <span className="text-white">)</span>
                        </div>
                      );
                    })()}
                    {selectedStepData.type === 'write' && (() => {
                      const cmd = substituteSCPI(
                        selectedStepData.params.command || '', 
                        selectedStepData.params.cmdParams || [], 
                        selectedStepData.params.paramValues || {}
                      ) || selectedStepData.params.command || '';
                      const isTmDevices = cmd.includes('.commands.') || cmd.includes('.add_') || cmd.includes('.save_');
                      const isTekHSI = (cmd.startsWith('scope.') && !isTmDevices) || cmd.startsWith('#');
                      if (isTmDevices || isTekHSI) {
                        return (
                          <div className="p-2 bg-slate-800 rounded text-[11px] font-mono text-green-400 break-all">
                            {cmd}
                          </div>
                        );
                      }
                      return (
                        <div className="p-2 bg-slate-800 rounded text-[11px] font-mono break-all">
                          <span className="text-yellow-400">scpi</span>
                          <span className="text-white">.</span>
                          <span className="text-blue-300">write</span>
                          <span className="text-white">(</span>
                          <span className="text-green-400">"{cmd}"</span>
                          <span className="text-white">)</span>
                        </div>
                      );
                    })()}
                    {selectedStepData.type === 'sleep' && `time.sleep(${selectedStepData.params.duration})`}
                    {selectedStepData.type === 'comment' && `# ${selectedStepData.params.text || selectedStepData.label || ''}`}
                    {selectedStepData.type === 'save_waveform' && (() => {
                      const cmd = selectedStepData.params.command || 'CURVe?';
                      const fn = selectedStepData.params.filename || 'data.bin';
                      const source = selectedStepData.params.source || 'CH1';
                      const width = selectedStepData.params.width || 1;
                      const encoding = selectedStepData.params.encoding || 'RIBinary';
                      const start = selectedStepData.params.start || 1;
                      const stop = selectedStepData.params.stop || 'None';
                      
                      if (cmd.includes('FILESYSTEM:READFILE')) {
                        // No log_cmd after binary read to avoid I/O issues
                        return `scpi.write(${JSON.stringify(cmd)})\ndata = scpi.read_raw()\npathlib.Path("${fn}").write_bytes(data)`;
                      } else if (cmd === 'CURVe?' || cmd.startsWith('CURV') || !cmd) {
                        return `preamble, data = read_waveform_binary(scpi, source='${source}', start=${start}, stop=${stop}, width=${width}, encoding='${encoding}')\npathlib.Path("${fn}").write_bytes(data)`;
                      } else {
                        return `scpi.write("${cmd}")\ndata = scpi.query_binary_values('', datatype='B', container=bytes)\npathlib.Path("${fn}").write_bytes(data)`;
                      }
                    })()}
                    {selectedStepData.type === 'group' && `# Group: ${selectedStepData.label}`}
                    {selectedStepData.type === 'sweep' && (() => {
                      const varName = selectedStepData.params.variableName || 'value';
                      const start = selectedStepData.params.start ?? 0;
                      const stop = selectedStepData.params.stop ?? 10;
                      const step = selectedStepData.params.step ?? 1;
                      const saveResults = selectedStepData.params.saveResults || false;
                      const resultVar = selectedStepData.params.resultVariable || 'results';
                      const childCount = selectedStepData.children?.length || 0;
                      let preview = `# Sweep: ${varName} from ${start} to ${stop} step ${step}\n`;
                      preview += `${varName} = ${start}\n`;
                      preview += `while ${varName} <= ${stop}:\n`;
                      preview += `    # ${childCount} command(s) here\n`;
                      if (saveResults) {
                        preview += `    ${resultVar} = []  # Results will be collected here\n`;
                      }
                      return preview;
                    })()}
                    {selectedStepData.type === 'error_check' && (() => {
                      const cmd = selectedStepData.params.command || 'ALLEV?';
                      return `try:\n    err = scpi.query("${cmd}")\n    log_cmd("${cmd}", err)\nexcept Exception:\n    pass`;
                    })()}
                  {selectedStepData.type === 'connect' && (() => {
                    const instId = selectedStepData.params?.instrumentId || selectedStepData.params?.instrumentIds?.[0];
                    const inst = devices.find(d => d.id === instId);
                    const printIdn = selectedStepData.params?.printIdn ? '\nprint(f"IDN: {scpi.query(\'*IDN?\')}")' : '';
                    return inst ? `# Connect to ${inst.alias}${printIdn}` : '# Connect step';
                  })()}
                  {selectedStepData.type === 'disconnect' && (() => {
                    const instIds = selectedStepData.params?.instrumentIds || (selectedStepData.params?.instrumentId ? [selectedStepData.params.instrumentId] : []);
                    if (instIds.length === 0) return '# Disconnect all instruments';
                    const insts = instIds.map((id: string) => devices.find((d: DeviceEntry) => d.id === id)).filter((d: DeviceEntry | undefined): d is DeviceEntry => d !== undefined);
                    return insts.length > 0 ? `# Disconnect: ${insts.map((i: DeviceEntry) => i.alias).join(', ')}` : '# Disconnect step';
                  })()}
                  </div>
                  
                  {/* Connect Step Properties */}
                  {selectedStepData.type === 'connect' && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Instrument(s) to Connect</label>
                        <div className="border border-gray-300 rounded max-h-40 overflow-y-auto p-2 space-y-1">
                          {devices.filter(d => d.enabled).map((device) => {
                            const isSelected = selectedStepData.params?.instrumentIds?.includes(device.id) || selectedStepData.params?.instrumentId === device.id;
                            return (
                              <label key={device.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const currentIds = selectedStepData.params?.instrumentIds || (selectedStepData.params?.instrumentId ? [selectedStepData.params.instrumentId] : []);
                                    if (e.target.checked) {
                                      const newIds = [...currentIds, device.id];
                                      if (newIds.length === 1) {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentId: device.id,
                                            instrumentIds: []
                                          }
                                        });
                                      } else {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentIds: newIds,
                                            instrumentId: ''
                                          }
                                        });
                                      }
                                    } else {
                                      const newIds = currentIds.filter((id: string) => id !== device.id);
                                      if (newIds.length === 0) {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentIds: [],
                                            instrumentId: ''
                                          }
                                        });
                                      } else if (newIds.length === 1) {
                                        const remainingDevice = devices.find(d => d.id === newIds[0]);
                                        if (remainingDevice) {
                                          updateStep(selectedStepData.id, {
                                            params: {
                                              ...selectedStepData.params,
                                              instrumentId: remainingDevice.id,
                                              instrumentIds: []
                                            }
                                          });
                                        }
                                      } else {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentIds: newIds,
                                            instrumentId: ''
                                          }
                                        });
                                      }
                                    }
                                  }}
                                  className="w-4 h-4"
                                />
                                <span className="text-xs flex-1">
                                  {device.alias} ({device.deviceType}) - {device.backend}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Select one or more instruments to connect.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t">
                        <input
                          type="checkbox"
                          id="print-idn-connect"
                          checked={selectedStepData.params?.printIdn || false}
                          onChange={(e) =>
                            updateStep(selectedStepData.id, {
                              params: { ...selectedStepData.params, printIdn: e.target.checked }
                            })
                          }
                          className="w-4 h-4"
                        />
                        <label htmlFor="print-idn-connect" className="text-xs font-medium cursor-pointer">
                          Print IDN after connection
                        </label>
                      </div>
                      <p className="text-xs text-gray-500">
                        Query and print *IDN? after connecting to verify the connection
                      </p>
                    </div>
                  )}

                  {/* Disconnect Step Properties */}
                  {selectedStepData.type === 'disconnect' && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Instrument(s) to Disconnect</label>
                        <div className="border border-gray-300 rounded max-h-40 overflow-y-auto p-2 space-y-1">
                          <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={!selectedStepData.params?.instrumentIds?.length && !selectedStepData.params?.instrumentId}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  updateStep(selectedStepData.id, {
                                    params: {
                                      ...selectedStepData.params,
                                      instrumentIds: [],
                                      instrumentId: ''
                                    }
                                  });
                                }
                              }}
                              className="w-4 h-4"
                            />
                            <span className="text-xs font-medium text-blue-600">All instruments</span>
                          </label>
                          {devices.filter(d => d.enabled).map((device) => {
                            const isSelected = selectedStepData.params?.instrumentIds?.includes(device.id) || selectedStepData.params?.instrumentId === device.id;
                            return (
                              <label key={device.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const currentIds = selectedStepData.params?.instrumentIds || (selectedStepData.params?.instrumentId ? [selectedStepData.params.instrumentId] : []);
                                    if (e.target.checked) {
                                      const newIds = [...currentIds, device.id];
                                      if (newIds.length === 1) {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentId: device.id,
                                            instrumentIds: []
                                          }
                                        });
                                      } else {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentIds: newIds,
                                            instrumentId: ''
                                          }
                                        });
                                      }
                                    } else {
                                      const newIds = currentIds.filter((id: string) => id !== device.id);
                                      if (newIds.length === 0) {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentIds: [],
                                            instrumentId: ''
                                          }
                                        });
                                      } else if (newIds.length === 1) {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentId: newIds[0],
                                            instrumentIds: []
                                          }
                                        });
                                      } else {
                                        updateStep(selectedStepData.id, {
                                          params: {
                                            ...selectedStepData.params,
                                            instrumentIds: newIds,
                                            instrumentId: ''
                                          }
                                        });
                                      }
                                    }
                                  }}
                                  className="w-4 h-4"
                                />
                                <span className="text-xs flex-1">
                                  {device.alias} ({device.deviceType})
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Select specific instruments or check "All instruments" to disconnect everything.
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Device Selection for Groups */}
                  {selectedStepData.type === 'group' && (
                    <div className="mt-3 pt-3 border-t">
                      <label className="block text-xs font-medium mb-1">Assign to Instrument</label>
                      <select
                        value={selectedStepData.boundDeviceId || ''}
                        onChange={(e) => updateStep(selectedStepData.id, { boundDeviceId: e.target.value || undefined })}
                        className="w-full px-2 py-1 text-xs border rounded"
                      >
                        <option value="">Default (use first instrument)</option>
                        {devices.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.alias || `Instrument ${devices.indexOf(device) + 1}`} ({device.host || 'N/A'})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Select which instrument this group will use for its commands
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">Select a step to edit</p>
              </div>
            )}
          </div>
        </div>
      )}

      {currentView === 'library' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Category Sidebar */}
          <div className="w-48 bg-white border-r overflow-y-auto">
            <div className="p-3 border-b">
              <h3 className="text-xs font-semibold text-gray-700 uppercase mb-2">Categories</h3>
              <button
                onClick={() => {
                  setSelectedCategory(null);
                  setLibraryVisibleCount(50);
                }}
                className={`w-full text-left px-3 py-2 text-sm rounded transition ${
                  selectedCategory === null
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                All ({commandLibrary.filter(isCommandCompatible).length})
              </button>
            </div>
            <div className="p-2 space-y-1">
              {libraryCategories.map(({ name, count }) => (
                <button
                  key={name}
                  onClick={() => toggleCategory(name)}
                  className={`w-full text-left px-3 py-2 text-sm rounded transition flex items-center justify-between ${
                    selectedCategory === name
                      ? `${categoryColors[name] || 'bg-blue-100 text-blue-700'} font-medium`
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="truncate">{name}</span>
                  <span className={`text-xs ml-2 ${
                    selectedCategory === name ? 'text-blue-600' : 'text-gray-400'
                  }`}>
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Command List - Middle Panel */}
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
            {/* Search Bar */}
            <div className="p-3 border-b bg-white">
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search commands..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-20 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                  <span className="absolute right-3 top-2 text-xs text-gray-400">{filteredCommands.length} commands</span>
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-24 top-2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="relative" title={deviceFamilies.find(f => f.id === selectedDeviceFamily)?.tooltip || ''}>
                  <select
                    value={selectedDeviceFamily}
                    onChange={(e) => {
                      setSelectedDeviceFamily(e.target.value);
                      setLibraryVisibleCount(50);
                      setSelectedLibraryCommand(null);
                      setSearchQuery(''); // Reset search filter
                      setSelectedCategory(null); // Reset category filter
                    }}
                    className="appearance-none text-xs pl-6 pr-6 py-1.5 bg-blue-50 border border-blue-200 rounded cursor-pointer hover:bg-blue-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    title={deviceFamilies.find(f => f.id === selectedDeviceFamily)?.tooltip || ''}
                  >
                    {deviceFamilies.map(family => (
                      <option key={family.id} value={family.id} title={family.tooltip || ''}>
                        {family.icon} {family.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600 pointer-events-none" />
                </div>
                {lazyLoading && (
                  <div className="flex items-center gap-2 text-xs text-blue-600">
                    <div className="animate-spin h-3 w-3 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                    <span>Loading...</span>
                  </div>
                )}
              </div>
            </div>

            {filteredCommands.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  {lazyLoading ? (
                    <>
                      <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-lg font-medium">Loading commands...</p>
                      <p className="text-sm mt-2 text-gray-500">Please wait while commands are being loaded</p>
                    </>
                  ) : (
                    <>
                      <Search size={48} className="mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">No commands found</p>
                      <p className="text-sm mt-2">Try adjusting your search or category filter</p>
                    </>
                  )}
                  {!lazyLoading && (searchQuery || selectedCategory) && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedCategory(null);
                      }}
                      className="mt-4 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {visibleLibraryCommands.map((cmd, idx) => (
                      <div
                        key={`${cmd.scpi}-${idx}`}
                        className={`p-3 bg-white border rounded-lg hover:border-blue-400 hover:shadow-md transition cursor-pointer group ${
                          selectedLibraryCommand?.scpi === cmd.scpi ? 'border-blue-500 ring-2 ring-blue-200' : ''
                        }`}
                        onClick={() => setSelectedLibraryCommand(cmd)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="font-semibold text-sm text-gray-900">{cmd.name}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${categoryColors[cmd.category] || 'bg-gray-100 text-gray-700'}`}>
                                {cmd.category}
                              </span>
                              {cmd.subcategory && (
                                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                                  {cmd.subcategory}
                                </span>
                              )}
                              {cmd.tekhsi && (
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded border border-red-300">
                                  <Zap size={10} className="inline" /> gRPC
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                              {cmd.scpi}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addCommandFromLibrary(cmd);
                            }}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition opacity-0 group-hover:opacity-100"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {/* Infinite scroll sentinel - INSIDE scrollable container */}
                    <div 
                      ref={libraryScrollSentinelRef} 
                      className="py-4 text-center"
                    >
                      <div className="text-xs text-gray-500">
                        {hasMoreCommands ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="animate-pulse">Loading more...</span>
                            <span className="text-gray-400">({visibleLibraryCommands.length} of {filteredCommands.length})</span>
                          </span>
                        ) : (
                          <span>Showing all {filteredCommands.length} commands</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Command Properties & Preview - Right Panel */}
          <div className="w-80 bg-white border-l overflow-y-auto">
            {selectedLibraryCommand ? (
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-white">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-900 mb-1">{selectedLibraryCommand.name}</h3>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${categoryColors[selectedLibraryCommand.category] || 'bg-gray-100 text-gray-700'}`}>
                          {selectedLibraryCommand.category}
                        </span>
                        {selectedLibraryCommand.subcategory && (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {selectedLibraryCommand.subcategory}
                          </span>
                        )}
                        {selectedLibraryCommand.manualEntry?.commandType && (
                          <>
                            {(selectedLibraryCommand.manualEntry.commandType === 'set' || selectedLibraryCommand.manualEntry.commandType === 'both') && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Set</span>
                            )}
                            {(selectedLibraryCommand.manualEntry.commandType === 'query' || selectedLibraryCommand.manualEntry.commandType === 'both' || selectedLibraryCommand.scpi.trim().endsWith('?')) && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Query</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedLibraryCommand(null)}
                      className="p-1 hover:bg-gray-100 rounded"
                    >
                      <X size={16} className="text-gray-400" />
                    </button>
                  </div>
                </div>

                {/* Command Syntax */}
                <div className="p-4 border-b">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2">Command</h4>
                  <div className="font-mono text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded border border-blue-200 break-all">
                    {selectedLibraryCommand.scpi}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(selectedLibraryCommand.scpi)}
                    className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Copy size={12} /> Copy command
                  </button>
                </div>

                {/* Description */}
                <div className="p-4 border-b">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2">Description</h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {selectedLibraryCommand.description || 'No description available.'}
                  </p>
                </div>

                {/* Syntax Details */}
                {selectedLibraryCommand.manualEntry?.syntax && (() => {
                  const fixedSyntax = fixSyntaxDisplay(selectedLibraryCommand.manualEntry.syntax, selectedLibraryCommand.params);
                  return (
                    <div className="p-4 border-b">
                      <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2">Syntax</h4>
                      <div className="space-y-2">
                        {fixedSyntax.set && (
                          <div>
                            <span className="text-xs font-medium text-emerald-700">Set Command:</span>
                            <div className="font-mono text-xs bg-gray-900 text-green-400 px-2 py-1.5 rounded mt-1 break-all">
                              {fixedSyntax.set}
                            </div>
                          </div>
                        )}
                        {fixedSyntax.query && (
                          <div>
                            <span className="text-xs font-medium text-blue-700">Query Command:</span>
                            <div className="font-mono text-xs bg-gray-900 text-blue-400 px-2 py-1.5 rounded mt-1 break-all">
                              {fixedSyntax.query}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Arguments */}
                {selectedLibraryCommand.manualEntry?.arguments && Array.isArray(selectedLibraryCommand.manualEntry.arguments) && selectedLibraryCommand.manualEntry.arguments.length > 0 && (
                  <div className="p-4 border-b">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2">Arguments</h4>
                    <div className="space-y-2">
                      {selectedLibraryCommand.manualEntry.arguments.map((arg, idx) => (
                        <div key={idx} className="bg-gray-50 rounded p-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs font-semibold text-purple-700">{arg.name}</span>
                            {arg.type && (
                              <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">{arg.type}</span>
                            )}
                          </div>
                          {arg.description && (
                            <p className="text-xs text-gray-600">{arg.description}</p>
                          )}
                          {arg.validValues?.values && Array.isArray(arg.validValues.values) && arg.validValues.values.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {arg.validValues.values.slice(0, 6).map((val: string, vIdx: number) => (
                                <span key={vIdx} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                                  {val}
                                </span>
                              ))}
                              {arg.validValues.values.length > 6 && (
                                <span className="text-xs text-gray-500">+{arg.validValues.values.length - 6} more</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Query Response */}
                {selectedLibraryCommand.manualEntry?.queryResponse && (
                  <div className="p-4 border-b">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2">Query Response</h4>
                    <div className="space-y-1">
                      {selectedLibraryCommand.manualEntry.queryResponse.type && (
                        <div className="text-xs"><span className="font-medium text-gray-700">Type:</span> {selectedLibraryCommand.manualEntry.queryResponse.type}</div>
                      )}
                      {selectedLibraryCommand.manualEntry.queryResponse.format && (
                        <div className="text-xs"><span className="font-medium text-gray-700">Format:</span> {selectedLibraryCommand.manualEntry.queryResponse.format}</div>
                      )}
                      {selectedLibraryCommand.manualEntry.queryResponse.example && (
                        <div className="font-mono text-xs bg-gray-50 px-2 py-1 rounded mt-1">{selectedLibraryCommand.manualEntry.queryResponse.example}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Examples */}
                {selectedLibraryCommand.manualEntry?.examples && Array.isArray(selectedLibraryCommand.manualEntry.examples) && selectedLibraryCommand.manualEntry.examples.length > 0 && (
                  <div className="p-4 border-b">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2">Examples</h4>
                    <div className="space-y-3">
                      {selectedLibraryCommand.manualEntry.examples.slice(0, 3).map((ex, idx) => (
                        <div key={idx} className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                          {/* SCPI Code Block - shown first */}
                          {ex.codeExamples?.scpi?.code && (
                            <div className="font-mono text-xs bg-gray-900 text-green-400 px-3 py-2">
                              {ex.codeExamples.scpi.code}
                            </div>
                          )}
                          {/* Description - formatted below */}
                          {ex.description && (
                            <div className="px-3 py-2 bg-gray-50">
                              <p className="text-xs text-gray-600 leading-relaxed italic">
                                {ex.description}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="p-4 mt-auto border-t bg-gray-50">
                  <div className="flex gap-2">
                    <button
                      onClick={() => addCommandFromLibrary(selectedLibraryCommand)}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> Add to Flow
                    </button>
                    <button
                      onClick={() => setShowLibraryDetailModal(true)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 transition"
                      title="View full details"
                    >
                      <BookOpen size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6">
                <AlertCircle size={48} className="mb-4 opacity-30" />
                <p className="text-sm font-medium">No command selected</p>
                <p className="text-xs mt-2 text-center">Click on a command to view its properties and preview</p>
              </div>
            )}
          </div>

          {/* Command Detail Modal (for full view) */}
          <CommandDetailModal
            isOpen={showLibraryDetailModal}
            onClose={() => {
              setShowLibraryDetailModal(false);
            }}
            command={selectedLibraryCommand}
            onAddToFlow={(cmd) => {
              addCommandFromLibrary(cmd);
              setShowLibraryDetailModal(false);
            }}
            categoryColor={selectedLibraryCommand ? (categoryColors[selectedLibraryCommand.category] || 'bg-blue-100 text-blue-700 border-blue-300') : undefined}
          />

        </div>
      )}

      {currentView === 'templates' && (
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-5xl mx-auto">
            <div className="flex justify-between mb-4">
              <h2 className="text-lg font-bold">Templates</h2>
              <div className="flex gap-2">
                <button onClick={importTemplate} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs"><Upload size={14} className="inline mr-1" />Import Template</button>
              </div>
            </div>

            {/* Template Tabs */}
            <div className="mb-4">
              <div className="flex gap-2 border-b">
                <button
                  onClick={() => setTemplateTab('builtin')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                    templateTab === 'builtin' 
                      ? 'border-blue-600 text-blue-600' 
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  📊 Built-in Templates
                </button>
                <button
                  onClick={() => setTemplateTab('tekexpress')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                    templateTab === 'tekexpress' 
                      ? 'border-blue-600 text-blue-600' 
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  ⚡ TekExpress Templates
                </button>
                <button
                  onClick={() => setTemplateTab('user')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                    templateTab === 'user' 
                      ? 'border-blue-600 text-blue-600' 
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  💾 Your Templates
                </button>
              </div>
            </div>

            {/* Built-in Templates Tab */}
            {templateTab === 'builtin' && (
              <div>
                <div className="mb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {['pyvisa', 'tm_devices', 'tekhsi', 'hybrid'].map((backend) => (
                      <button
                        key={backend}
                        onClick={() => toggleBackend(backend)}
                        className={`px-2 py-1 text-xs rounded border transition ${
                          selectedBackends.includes(backend) 
                            ? backend === 'pyvisa' ? 'bg-purple-100 text-purple-700 border-purple-300 font-semibold' :
                              backend === 'tm_devices' ? 'bg-green-100 text-green-700 border-green-300 font-semibold' :
                              backend === 'tekhsi' ? 'bg-red-100 text-red-700 border-red-300 font-semibold' :
                              'bg-blue-100 text-blue-700 border-blue-300 font-semibold'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {backend === 'tm_devices' ? '🔧 tm_devices' : 
                         backend === 'tekhsi' ? '⚡ TekHSI' : 
                         backend === 'hybrid' ? 'PyVISA + TekHSI' :
                         'PyVISA'}
                      </button>
                    ))}
                  </div>
                </div>
                {builtInTemplates.filter(t => {
                  const notTekExpress = !t.name.toLowerCase().includes('tekexpress') && !t.description.toLowerCase().includes('tekexpress');
                  if (selectedBackends.length === 0) return notTekExpress;
                  if (!t.backend) return false;
                  // For hybrid templates, check if either 'hybrid' or both 'pyvisa' and 'tekhsi' are selected
                  if (t.backend === 'hybrid') {
                    return selectedBackends.includes('hybrid') || (selectedBackends.includes('pyvisa') && selectedBackends.includes('tekhsi'));
                  }
                  return selectedBackends.includes(t.backend) && notTekExpress;
                }).length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p className="text-sm">No built-in templates available</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {builtInTemplates
                      .filter(t => {
                        const notTekExpress = !t.name.toLowerCase().includes('tekexpress') && !t.description.toLowerCase().includes('tekexpress');
                        if (selectedBackends.length === 0) return notTekExpress;
                        if (!t.backend) return false;
                        // For hybrid templates, check if either 'hybrid' or both 'pyvisa' and 'tekhsi' are selected
                        if (t.backend === 'hybrid') {
                          return selectedBackends.includes('hybrid') || (selectedBackends.includes('pyvisa') && selectedBackends.includes('tekhsi'));
                        }
                        return selectedBackends.includes(t.backend) && notTekExpress;
                      })
                      .map((t, idx) => (
                        <div 
                          key={idx} 
                          className="p-3 bg-white border rounded hover:shadow-md transition"
                          data-tour={t.name === 'Hello Scope' ? 'hello-scope-template' : undefined}
                        >
                          <div className="font-semibold text-sm mb-1">{t.name}</div>
                          <div className="flex gap-1 mb-2 flex-wrap">
                            {t.backend && (
                              <>
                                {t.backend === 'hybrid' ? (
                                  <>
                                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-300">
                                      PyVISA
                                    </span>
                                    <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
                                      ⚡ TekHSI
                                    </span>
                                  </>
                                ) : (
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    t.backend === 'tm_devices' ? 'bg-green-100 text-green-700 border border-green-300' :
                                    t.backend === 'tekhsi' ? 'bg-red-100 text-red-700 border border-red-300' :
                                    'bg-purple-100 text-purple-700'
                                  }`}>
                                    {t.backend === 'tm_devices' ? '🔧 tm_devices' : 
                                     t.backend === 'tekhsi' ? '⚡ TekHSI' : 
                                     t.backend}
                                  </span>
                                )}
                              </>
                            )}
                            {t.deviceType && (
                              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded border border-blue-300">
                                {TM_DEVICE_TYPES[t.deviceType]?.label || t.deviceType}
                              </span>
                            )}
                            {t.deviceDriver && (
                              <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded border border-indigo-300">
                                {t.deviceDriver}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 my-2">{t.description}</div>
                          <div className="flex gap-2">
                            <button onClick={() => loadTemplateAppend(t)} className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Append as Group</button>
                            <button onClick={() => exportTemplate(t)} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">Export</button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* TekExpress Templates Tab */}
            {templateTab === 'tekexpress' && (
              <div>
                {builtInTemplates.filter(t => t.name.toLowerCase().includes('tekexpress') || t.description.toLowerCase().includes('tekexpress')).length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p className="text-sm">No TekExpress templates available</p>
                    <p className="text-xs mt-2">TekExpress templates will appear here when available</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {builtInTemplates
                      .filter(t => t.name.toLowerCase().includes('tekexpress') || t.description.toLowerCase().includes('tekexpress'))
                      .map((t, idx) => (
                        <div key={idx} className="p-3 bg-white border rounded hover:shadow-md transition">
                          <div className="font-semibold text-sm mb-1">{t.name}</div>
                          <div className="flex gap-1 mb-2 flex-wrap">
                            {t.backend && (
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                t.backend === 'tm_devices' ? 'bg-green-100 text-green-700 border border-green-300' :
                                t.backend === 'tekhsi' ? 'bg-red-100 text-red-700 border border-red-300' :
                                'bg-purple-100 text-purple-700'
                              }`}>
                                {t.backend === 'tm_devices' ? '🔧 tm_devices' : 
                                 t.backend === 'tekhsi' ? '⚡ TekHSI' : 
                                 t.backend}
                              </span>
                            )}
                            <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded border border-orange-300">
                              ⚡ TekExpress
                            </span>
                            {t.deviceType && (
                              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded border border-blue-300">
                                {TM_DEVICE_TYPES[t.deviceType]?.label || t.deviceType}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 my-2">{t.description}</div>
                          <div className="flex gap-2">
                            <button onClick={() => loadTemplateAppend(t)} className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Append as Group</button>
                            <button onClick={() => exportTemplate(t)} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">Export</button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Your Templates Tab */}
            {templateTab === 'user' && (
              <div>
                {userTemplates.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p className="text-sm">No saved templates yet</p>
                    <p className="text-xs mt-2">Use "Save" button in Builder to save your workflows</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {userTemplates.map((t, idx) => (
                      <div key={idx} className="p-3 bg-white border rounded hover:shadow-md transition">
                        <div className="font-semibold text-sm mb-1">{t.name}</div>
                        <div className="text-xs text-gray-600 my-2">{t.description}</div>
                        {t.backend && (
                          <div className="mb-2 flex gap-1 flex-wrap">
                            {t.backend === 'hybrid' ? (
                              <>
                                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded border border-blue-300">
                                  PyVISA
                                </span>
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded border border-red-300">
                                  ⚡ TekHSI
                                </span>
                              </>
                            ) : (
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                t.backend === 'tm_devices' ? 'bg-green-100 text-green-700 border border-green-300' :
                                t.backend === 'tekhsi' ? 'bg-red-100 text-red-700 border border-red-300' :
                                'bg-gray-100 text-gray-700 border border-gray-300'
                              }`}>
                                {t.backend === 'tm_devices' ? '🔧 tm_devices' : 
                                 t.backend === 'tekhsi' ? '⚡ TekHSI' : 
                                 t.backend}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => loadTemplateAppend(t)} className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Append</button>
                          <button onClick={() => exportTemplate(t)} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">Export</button>
                          <button onClick={() => deleteUserTemplate(idx)} className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200" title="Delete template">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Flow Builder Page */}
      {currentView === 'flow-designer' && (
        <FlowBuilder
          devices={devices.length > 0 ? devices : [{ ...config, id: 'default', enabled: true, x: 0, y: 0 }]}
          steps={steps}
          onStepsChange={(newSteps) => {
            // Sync Flow Designer changes back to Builder steps
            commit(newSteps);
          }}
          templates={[...builtInTemplates, ...userTemplates]}
          flow={flowBuilderState}
          onFlowChange={setFlowBuilderState}
          onExportPython={(code) => {
            // Download the generated Python code
            const blob = new Blob([code], { type: 'text/python' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'flow_automation.py';
            a.click();
            URL.revokeObjectURL(url);
          }}
        />
      )}

      {/* Device Edit Drawer - shown when device is selected */}
      {editingDevice && (
        <div className="fixed right-0 top-0 bottom-0 w-80 bg-white border-l shadow-xl z-50 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Edit Device</h3>
            <button
              onClick={() => { setEditingDevice(null); _setSelectedNode(null); }}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </div>
          
          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Alias</label>
              <input
                type="text"
                value={editingDevice.alias}
                onChange={(e) => updateDevice(editingDevice.id, { alias: e.target.value })}
                className="w-full px-2 py-1 border rounded text-xs"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Device Type</label>
              <select
                value={editingDevice.deviceType}
                onChange={(e) => updateDevice(editingDevice.id, { deviceType: e.target.value as InstrumentConfig['deviceType'] })}
                className="w-full px-2 py-1 border rounded text-xs"
              >
                {Object.keys(TM_DEVICE_TYPES).map(type => (
                  <option key={type} value={type}>{TM_DEVICE_TYPES[type as keyof typeof TM_DEVICE_TYPES].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Backend</label>
              <select
                value={editingDevice.backend}
                onChange={(e) => updateDevice(editingDevice.id, { backend: e.target.value as Backend })}
                className="w-full px-2 py-1 border rounded text-xs"
              >
                <option value="pyvisa">PyVISA</option>
                <option value="tm_devices">tm_devices</option>
                <option value="vxi11">VXI-11</option>
                <option value="tekhsi">TekHSI</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Connection Type</label>
              <select
                value={editingDevice.connectionType}
                onChange={(e) => updateDevice(editingDevice.id, { connectionType: e.target.value as ConnectionType })}
                className="w-full px-2 py-1 border rounded text-xs"
              >
                <option value="tcpip">TCP/IP</option>
                <option value="socket">Socket</option>
                <option value="usb">USB</option>
                <option value="gpib">GPIB</option>
              </select>
            </div>
            {(editingDevice.connectionType === 'tcpip' || editingDevice.connectionType === 'socket') && (
              <>
                <div>
                  <label className="block font-semibold mb-1">Host</label>
                  <input
                    type="text"
                    value={editingDevice.host}
                    onChange={(e) => updateDevice(editingDevice.id, { host: e.target.value })}
                    className="w-full px-2 py-1 border rounded text-xs font-mono"
                  />
                </div>
                {editingDevice.connectionType === 'socket' && (
                  <div>
                    <label className="block font-semibold mb-1">Port</label>
                    <input
                      type="number"
                      value={editingDevice.port}
                      onChange={(e) => updateDevice(editingDevice.id, { port: parseInt(e.target.value) || 4000 })}
                      className="w-full px-2 py-1 border rounded text-xs"
                    />
                  </div>
                )}
              </>
            )}
            <div>
              <label className="block font-semibold mb-1">VISA Resource</label>
              <div className="text-gray-600 font-mono text-xs bg-gray-50 p-2 rounded break-all">
                {(() => {
                  if (editingDevice.connectionType === 'tcpip') {
                    return `TCPIP::${editingDevice.host}::INSTR`;
                  } else if (editingDevice.connectionType === 'socket') {
                    return `TCPIP::${editingDevice.host}::${editingDevice.port}::SOCKET`;
                  } else if (editingDevice.connectionType === 'usb') {
                    const serial = editingDevice.usbSerial ? `::${editingDevice.usbSerial}` : '';
                    return `USB::${editingDevice.usbVendorId}::${editingDevice.usbProductId}${serial}::INSTR`;
                  } else if (editingDevice.connectionType === 'gpib') {
                    return `GPIB${editingDevice.gpibBoard}::${editingDevice.gpibAddress}::INSTR`;
                  }
                  return 'Unknown';
                })()}
              </div>
            </div>
            <div className="pt-3 border-t">
              <button
                onClick={() => {
                  if (window.confirm('Delete this device?')) {
                    deleteDevice(editingDevice.id);
                    setEditingDevice(null);
                    _setSelectedNode(null);
                  }
                }}
                className="w-full px-3 py-2 bg-red-600 text-white rounded text-xs hover:bg-red-700"
              >
                Delete Device
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto p-4" onClick={() => setExportOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl p-8 shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Code2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Generate Python Code</h2>
                  <p className="text-sm text-gray-500">Configure export settings for your automation script</p>
                </div>
              </div>
              <button onClick={() => {
                setExportOpen(false);
                triggerControls.triggerAnimation('idle');
              }} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Script Name
                </label>
                <input 
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                  value={xopt.scriptName} 
                  onChange={(e) => setXopt({ ...xopt, scriptName: e.target.value.trim() })} 
                  placeholder="my_automation_script.py"
                />
              </div>
              
              {/* Performance Optimization Toggle */}
              <div className={`border border-gray-200 rounded-lg p-4 ${config.backend !== 'pyvisa' ? 'bg-gray-50 opacity-60' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <span className={`text-sm font-semibold ${config.backend !== 'pyvisa' ? 'text-gray-400' : 'text-gray-700'}`}>
                      Enable Performance Optimization
                    </span>
                    <p className={`text-xs mt-1 ${config.backend !== 'pyvisa' ? 'text-gray-400' : 'text-gray-500'}`}>
                      {config.backend !== 'pyvisa' 
                        ? 'Only available for PyVISA backend' 
                        : 'Use 128 MB chunks for faster data transfer'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (config.backend === 'pyvisa') {
                        setXopt({ ...xopt, enablePerformanceOptimization: !xopt.enablePerformanceOptimization });
                      }
                    }}
                    disabled={config.backend !== 'pyvisa'}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.backend !== 'pyvisa' 
                        ? 'bg-gray-300 cursor-not-allowed' 
                        : xopt.enablePerformanceOptimization 
                          ? 'bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2' 
                          : 'bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                    }`}
                    role="switch"
                    aria-checked={xopt.enablePerformanceOptimization}
                    aria-disabled={config.backend !== 'pyvisa'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        xopt.enablePerformanceOptimization && config.backend === 'pyvisa' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
              
              {/* Data Export Options */}
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-sm font-semibold text-gray-700 mb-3">Data Export Options</div>
                
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={xopt.saveCsv} 
                      onChange={(e) => setXopt({ ...xopt, saveCsv: e.target.checked })} 
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Command Log CSV</span>
                  </label>
                  
                  {xopt.saveCsv && (
                    <input 
                      className="w-full border border-gray-300 rounded p-2 text-xs ml-6" 
                      value={xopt.csvName} 
                      onChange={(e) => setXopt({ ...xopt, csvName: e.target.value.trim() })} 
                      placeholder="command_log.csv"
                    />
                  )}
                  
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={xopt.exportMeasurements} 
                      onChange={(e) => setXopt({ ...xopt, exportMeasurements: e.target.checked })} 
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Measurement Data CSV</span>
                  </label>
                  
                  {xopt.exportMeasurements && (
                    <input 
                      className="w-full border border-gray-300 rounded p-2 text-xs ml-6" 
                      value={xopt.measurementsFilename} 
                      onChange={(e) => setXopt({ ...xopt, measurementsFilename: e.target.value.trim() })} 
                      placeholder="measurements.csv"
                    />
                  )}
                </div>
                
                <p className="text-xs text-gray-500 mt-3">
                  Command Log: SCPI commands with timestamps • Measurement Data: Query results (frequency, voltage, etc.)
                </p>
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-gray-700">
                <strong>💡 Tip:</strong> Waveform format can be configured per step in the Step Properties panel. Files save to the script's directory by default.
              </p>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button 
                className="px-5 py-2.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors" 
                onClick={() => {
                  setExportOpen(false);
                  triggerControls.triggerAnimation('idle');
                }}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                onClick={() => {
                  doExport();
                  setExportOpen(false);
                  triggerControls.celebrate();
                }}
              >
                <Download size={16} />
                Export Script
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.stepId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      <WelcomeWizard
        isOpen={showWelcomeWizard}
        onClose={() => {
          setShowWelcomeWizard(false);
          localStorage.setItem('tekautomate_wizard_shown', 'true');
        }}
        onComplete={(wizardData: WizardData) => {
          // Helper function to map DeviceFamily to deviceType
          const mapDeviceFamilyToType = (family: DeviceFamily | null): InstrumentConfig['deviceType'] => {
            switch (family) {
              case 'oscilloscope_mso':
              case 'oscilloscope_70k':
                return 'SCOPE';
              case 'awg':
                return 'AWG';
              case 'smu':
                return 'SMU';
              case 'other':
                return 'SCOPE'; // Default to SCOPE for "other"
              default:
                return 'SCOPE';
            }
          };

          // Helper function to map DeviceFamily to modelFamily
          const mapDeviceFamilyToModelFamily = (family: DeviceFamily | null): string => {
            switch (family) {
              case 'oscilloscope_mso':
                return 'MSO4/5/6 Series';
              case 'oscilloscope_70k':
                return '70K Series';
              case 'awg':
                return 'AWG Series';
              case 'smu':
                return 'SMU Series';
              case 'other':
                return 'Other';
              default:
                return 'MSO4/5/6 Series';
            }
          };

          // Helper function to map BackendChoice to Backend
          const mapBackendChoiceToBackend = (choice: BackendChoice | null): Backend => {
            switch (choice) {
              case 'pyvisa':
                return 'pyvisa';
              case 'tm_devices':
                return 'tm_devices';
              case 'tekhsi':
                return 'tekhsi';
              default:
                return 'pyvisa';
            }
          };

          // Helper function to get default driver for device type
          const getDefaultDriver = (deviceType: InstrumentConfig['deviceType']): string => {
            const drivers = TM_DEVICE_TYPES[deviceType]?.drivers;
            return drivers && drivers.length > 0 ? drivers[0] : '';
          };

          // Helper function to generate steps based on intent
          const generateStepsFromIntent = (intent: Intent | null, deviceId: string): Step[] => {
            if (!intent || intent === 'empty') {
              return [];
            }

            const steps: Step[] = [];

            // Step 1: Connect
            steps.push({
              id: crypto.randomUUID(),
              type: 'connect',
              label: 'Connect',
              params: {
                instrumentId: deviceId,
                instrumentIds: [deviceId],
                printIdn: false
              },
              collapsed: false
            });

            switch (intent) {
              case 'connection_check':
                // Connect → Query: *IDN?
                steps.push({
                  id: crypto.randomUUID(),
                  type: 'query',
                  label: 'Query',
                  params: {
                    command: '*IDN?',
                    saveAs: 'result',
                    cmdParams: [],
                    paramValues: {}
                  },
                  boundDeviceId: deviceId,
                  collapsed: false
                });
                break;

              case 'screen_capture':
                // Connect → Write: SAVe:IMAGe:INKSaver ON → Save Waveform: Source=Screen
                steps.push({
                  id: crypto.randomUUID(),
                  type: 'write',
                  label: 'Write',
                  params: {
                    command: 'SAVe:IMAGe:INKSaver ON',
                    cmdParams: [],
                    paramValues: {}
                  },
                  boundDeviceId: deviceId,
                  collapsed: false
                });
                steps.push({
                  id: crypto.randomUUID(),
                  type: 'save_waveform',
                  label: 'Save Waveform',
                  params: {
                    source: 'Screen',
                    filename: 'capture.png',
                    command: '',
                    width: 1,
                    encoding: 'RIBinary',
                    start: 1,
                    stop: null,
                    format: 'bin'
                  },
                  boundDeviceId: deviceId,
                  collapsed: false
                });
                break;

              case 'acquire_data':
                // Connect → Write: DATa:SOUrce CH1 → Save Waveform: Source=CH1
                steps.push({
                  id: crypto.randomUUID(),
                  type: 'write',
                  label: 'Write',
                  params: {
                    command: 'DATa:SOUrce CH1',
                    cmdParams: [],
                    paramValues: {}
                  },
                  boundDeviceId: deviceId,
                  collapsed: false
                });
                steps.push({
                  id: crypto.randomUUID(),
                  type: 'save_waveform',
                  label: 'Save Waveform',
                  params: {
                    source: 'CH1',
                    filename: 'data.bin',
                    command: '',
                    width: 1,
                    encoding: 'RIBinary',
                    start: 1,
                    stop: null,
                    format: 'bin'
                  },
                  boundDeviceId: deviceId,
                  collapsed: false
                });
                break;
            }

            return steps;
          };

          // Parse host to extract IP and port
          const parseHost = (host: string): { ip: string; port: number } => {
            if (host.includes(':')) {
              const [ip, portStr] = host.split(':');
              return { ip, port: parseInt(portStr, 10) || 5000 };
            }
            return { ip: host, port: 5000 };
          };

          const { ip, port } = parseHost(wizardData.host);
          const deviceType = mapDeviceFamilyToType(wizardData.deviceFamily);
          const backend = mapBackendChoiceToBackend(wizardData.backend);
          const modelFamily = mapDeviceFamilyToModelFamily(wizardData.deviceFamily);
          const deviceDriver = getDefaultDriver(deviceType);

          // Create new device entry
          const newDevice: DeviceEntry = {
            id: `device-${Date.now()}`,
            connectionType: 'tcpip',
            host: ip,
            port: port,
            usbVendorId: '0x0699',
            usbProductId: '0x0522',
            usbSerial: '',
            gpibBoard: 0,
            gpibAddress: 1,
            backend: backend,
            timeout: 5.0,
            modelFamily: modelFamily,
            deviceType: deviceType,
            deviceDriver: deviceDriver,
            alias: `${deviceType.toLowerCase()}1`,
            visaBackend: 'system',
            enabled: true,
            x: 200,
            y: 200,
            status: 'offline'
          };

          // Update devices - replace existing or add new
          setDevices(prevDevices => {
            if (prevDevices.length === 0) {
              return [newDevice];
            }
            // Replace first device with new one
            return [newDevice, ...prevDevices.slice(1)];
          });

          // Update config to match new device
          setConfig({
            ...config,
            host: ip,
            port: port,
            backend: backend,
            deviceType: deviceType,
            modelFamily: modelFamily,
            deviceDriver: deviceDriver,
            alias: newDevice.alias
          });

          // Generate and set steps based on intent
          const generatedSteps = generateStepsFromIntent(wizardData.intent, newDevice.id);
          commit(generatedSteps);

          // Store wizard data in localStorage
          localStorage.setItem('tekautomate_wizard_shown', 'true');
          localStorage.setItem('tekautomate_wizard_data', JSON.stringify(wizardData));

          setShowWelcomeWizard(false);

          // Trigger success animation
          triggerControls.success();

          // Optionally start tour after wizard
          setTimeout(() => {
            const shouldStartTour = window.confirm('Would you like to take a quick tour of the interface?');
            if (shouldStartTour) {
              setRunTour(true);
            }
          }, 500);
        }}
      />

      <InteractiveTour
        run={runTour}
        onComplete={() => {
          setRunTour(false);
          localStorage.setItem('tekautomate_tour_completed', 'true');
        }}
        onSkip={() => {
          setRunTour(false);
        }}
      />

      {showTekHSIInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowTekHSIInfo(false)}>
          <div className="bg-white rounded-lg w-[700px] max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-semibold">TekHSI Information</h3>
              </div>
              <button onClick={() => setShowTekHSIInfo(false)} className="text-gray-500 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-semibold mb-2">Supported Devices</h4>
                <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
                  <p className="text-xs font-medium text-yellow-800 mb-1">TekHSI is only supported on the following devices:</p>
                  <ul className="text-xs text-yellow-700 list-disc list-inside space-y-1">
                    <li>4 Series B MSO</li>
                    <li>5 Series MSO</li>
                    <li>5 Series B MSO</li>
                    <li>5 Series MSO (LP)</li>
                    <li>6 Series MSO</li>
                    <li>6 Series B MSO</li>
                    <li>6 Series LPD</li>
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Mixing TekHSI and PyVISA</h4>
                <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2 text-xs">
                  <p><strong>TekHSI is compatible with PyVISA.</strong> You can mix PyVISA with TekHSI. This has some advantages over just using PyVISA:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li><strong>Faster data transfer:</strong> TekHSI is much faster than using curve queries, because no data transformation is done on the scope, only the underlying binary data is moved. This means there is no need to process the data on the instrument side, the buffers are directly moved.</li>
                    <li><strong>Background data reception:</strong> TekHSI receives the data in a background thread. So when mixing PyVISA and TekHSI, often data arrival appears to take little or no time.</li>
                    <li><strong>Less code:</strong> TekHSI requires much less code than the normal processing of curve commands.</li>
                    <li><strong>Easy data export:</strong> The waveform output from TekHSI is easy to use with file readers/writers that allow this data to be quickly exported using the <code className="bg-blue-100 px-1 rounded">tm_data_types</code> module.</li>
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Usage Tips</h4>
                <ul className="list-disc list-inside space-y-1 text-xs ml-2">
                  <li>Use PyVISA/tm_devices for SCPI command and control (configuration, setup)</li>
                  <li>Use TekHSI for fast waveform data acquisition</li>
                  <li>TekHSI connects on port 5000 (gRPC)</li>
                  <li>Both connections can be active simultaneously</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button 
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                onClick={() => setShowTekHSIInfo(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAboutModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Zap className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Tek Automator</h2>
                  <p className="text-sm text-gray-500">Version 1.0</p>
                </div>
              </div>
              <button onClick={() => setShowAboutModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-gray-700">
              <div>
                <h3 className="font-semibold text-lg mb-2">About</h3>
                <p className="text-sm leading-relaxed">
                  Tek Automator is a powerful visual programming tool for automating Tektronix test equipment. 
                  Build complex test sequences with an intuitive drag-and-drop interface, generate Python code, 
                  and streamline your test automation workflow.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">Features</h3>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>Visual workflow builder with drag-and-drop interface</li>
                  <li>Support for multiple instrument backends (PyVISA, tm_devices, VXI-11, TekHSI)</li>
                  <li>Comprehensive command library with 1000+ SCPI commands</li>
                  <li>Python code generation with optimized performance</li>
                  <li>Template system for common test scenarios</li>
                  <li>Interactive tour and setup wizard</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">Resources</h3>
                <div className="text-sm space-y-1">
                  <p>Documentation: Check the <code className="bg-gray-100 px-1 rounded">docs/</code> folder</p>
                  <p>Support: Contact your Tektronix representative</p>
                </div>
              </div>

              <div className="pt-4 border-t">
                <p className="text-xs text-gray-500 text-center">
                  © 2024 Tektronix, Inc. All rights reserved.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button 
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                onClick={() => setShowAboutModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trigger Mascot - Bottom Right Corner */}
      {(showMascot || mascotTemporarilyShown) && (
        <TriggerMascot 
          animation={triggerControls.animation}
          position="bottom-right"
          size="medium"
          errorMessage={triggerControls.errorMessage}
          onHide={() => setShowMascot(false)}
          onAnimationComplete={() => {
            // Reset to idle after animation completes (unless it's tour or codegen which are continuous)
            if (triggerControls.animation !== 'idle' && triggerControls.animation !== 'tour' && triggerControls.animation !== 'codegen') {
              triggerControls.triggerAnimation('idle');
            }
            // If mascot was temporarily shown for an error, hide it again
            if (mascotTemporarilyShown) {
              setMascotTemporarilyShown(false);
            }
          }}
        />
      )}
      <AcademyModal />
      
      {/* SCPI Help Modal - Uses CommandDetailModal for consistent display */}
      {showSCPIHelp && selectedStepData && (() => {
        const command = selectedStepData?.params?.command || '';
        if (!command) return null;
        
        try {
          // Try to find manual entry from loaded commands
          // Handle <x> placeholders in library commands by converting them to regex patterns
          const libraryCommand = commandLibrary.find(cmd => {
            const cmdScpi = cmd.scpi || '';
            const cmdHeader = cmdScpi.split(' ')[0];
            const inputHeader = command.split(' ')[0];
            
            // Direct match
            if (cmdHeader.toLowerCase() === inputHeader.toLowerCase()) return true;
            
            // Pattern match: convert <x> placeholders to regex that matches numbers
            // e.g., "POWer:POWer<x>:CLRESPONSE" -> "POWer:POWer\d+:CLRESPONSE"
            const patternStr = cmdHeader
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
              .replace(/<x>/gi, '\\d+');  // Replace <x> with number pattern
            
            try {
              const pattern = new RegExp(`^${patternStr}$`, 'i');
              return pattern.test(inputHeader);
            } catch {
              return false;
            }
          });
          
          // If we found a library command, use CommandDetailModal for full display
          if (libraryCommand) {
            return (
              <CommandDetailModal
                isOpen={showSCPIHelp}
                onClose={() => setShowSCPIHelp(false)}
                command={libraryCommand}
                categoryColor={
                  libraryCommand.category ? 
                    (categoryColors[libraryCommand.category] || 'bg-gray-100 text-gray-700 border-gray-300') :
                    'bg-blue-100 text-blue-700 border-blue-300'
                }
              />
            );
          }
          
          // Fallback: create a basic CommandLibraryItem from the step data
          const stepParams = selectedStepData.params.cmdParams || [];
          const commandHeader = command.split(' ')[0];
          const commandName = commandHeader.split(':').pop()?.replace('?', '').replace(/<x>/gi, '') || 'Command';
          
          const fallbackCommand: CommandLibraryItem = {
            name: commandName,
            scpi: command,
            description: `SCPI command: ${command}`,
            category: selectedStepData.category || 'General',
            params: stepParams,
          };
          
          return (
            <CommandDetailModal
              isOpen={showSCPIHelp}
              onClose={() => setShowSCPIHelp(false)}
              command={fallbackCommand}
              categoryColor="bg-gray-100 text-gray-700 border-gray-300"
            />
          );
        } catch (e) {
          // Error fallback
          const commandHeader = command.split(' ')[0];
          const commandName = commandHeader.split(':').pop()?.replace('?', '') || 'Command';
          
          const errorFallbackCommand: CommandLibraryItem = {
            name: commandName,
            scpi: command,
            description: `SCPI command: ${command}`,
            category: 'General',
          };
          
          return (
            <CommandDetailModal
              isOpen={showSCPIHelp}
              onClose={() => setShowSCPIHelp(false)}
              command={errorFallbackCommand}
              categoryColor="bg-gray-100 text-gray-700 border-gray-300"
            />
          );
        }
      })()}
      </div>
  );
}

/* ===================== App Wrapper with Provider ===================== */
function App() {
  return (
    <AcademyProvider>
      <AppInner />
    </AcademyProvider>
  );
}

export default App;


