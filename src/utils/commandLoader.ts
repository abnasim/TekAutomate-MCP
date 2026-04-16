/**
 * Command Loader Utility
 * 
 * Handles loading commands from different JSON formats and converting them
 * to a unified CommandLibraryItem format. Supports:
 * - mso_commands_complete.json (standard format for all equipment)
 * - mso_commands.json (detailed format with full manual data)
 * - Legacy format (old category-based files)
 */

import { getCategoryDisplayName } from './categoryMapping';

// SCPI parsing deferred to first use (modal open) to keep startup fast.

// CommandLibraryItem interface (matches App.tsx)
interface CommandLibraryItem {
  name: string;
  scpi: string;
  description: string;
  category: string;
  subcategory?: string;
  params?: Array<{
    name: string;
    type: string;
    default?: any;
    required?: boolean;
    options?: string[];
    min?: number;
    max?: number;
    unit?: string;
    description?: string;
  }>;
  example?: string;
  tekhsi?: boolean;
  scpiStructure?: any;
  editableParameters?: any[];
  manualReference?: {
    section?: string;
    page?: number;
    examples?: string[];
  };
  manualEntry?: any;
}

/**
 * Map section names from manual to category IDs
 * Based on 34 command groups from MSO Programmer Manual
 */
const SECTION_TO_CATEGORY_MAP: Record<string, string> = {
  // Core Acquisition & Control
  'Acquisition': 'acquisition',
  'Act on event': 'miscellaneous',
  
  // Channel & Signal Configuration
  'Channel': 'channels',
  'Channels': 'channels',
  'Reference': 'channels',
  
  // Data & Waveform
  'Data': 'data',
  'Waveform': 'waveform',
  'Waveform Transfer': 'waveform',
  
  // Display & Visualization
  'Display': 'display',
  'Display Control': 'display',
  'Cursor': 'cursor',
  'Cursor Commands': 'cursor',
  'Math': 'math',
  'Math Waveforms': 'math',
  'Spectrum View': 'math',
  'Zoom': 'miscellaneous',
  
  // Trigger & Timing
  'Trigger': 'trigger',
  'Trigger Control': 'trigger',
  'Horizontal': 'horizontal',
  'Horizontal Settings': 'horizontal',
  
  // Measurement & Analysis
  'Measurement': 'measurement',
  'Measurements': 'measurement',
  'Power Measurements': 'measurement',
  'Search': 'miscellaneous',
  'Search and Mark': 'miscellaneous',
  'Search triggers': 'miscellaneous',
  'Search triggers, marks, waveform analysis': 'miscellaneous',
  
  // Bus & Protocol
  'Bus': 'bus',
  'Bus Configuration': 'bus',
  
  // System & Storage
  'System': 'system',
  'File System': 'file_system',
  'Save/Recall': 'save-recall',
  'Save and Recall': 'save-recall',
  
  // Other
  'Miscellaneous': 'miscellaneous',
  
  // Handle long section names (extracted from manual descriptions)
  'Use the commands in the Measurement Command Group to control the automated measurement system.': 'measurement',
  'Use the commands in the Save and Recall Command Group to store and retrieve internal waveforms and settings. When you save a': 'save-recall',
};

/**
 * Category colors - Color-coded by command group
 * Matches the color scheme used throughout the application
 */
export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  // Core Acquisition & Control (Blue)
  'acquisition': 'bg-blue-100 text-blue-700 border-blue-300',
  
  // Channel & Signal Configuration (Cyan)
  'channels': 'bg-cyan-100 text-cyan-700 border-cyan-300',
  
  // Data & Waveform Transfer (Indigo)
  'data': 'bg-indigo-100 text-indigo-700 border-indigo-300',
  'waveform': 'bg-indigo-100 text-indigo-700 border-indigo-300',
  
  // Display & Visualization (Pink)
  'display': 'bg-pink-100 text-pink-700 border-pink-300',
  
  // Trigger & Timing (Purple)
  'trigger': 'bg-purple-100 text-purple-700 border-purple-300',
  
  // Measurement & Analysis (Green)
  'measurement': 'bg-green-100 text-green-700 border-green-300',
  
  // Cursor (Lime)
  'cursor': 'bg-lime-100 text-lime-700 border-lime-300',
  
  // Bus & Protocol (Yellow)
  'bus': 'bg-yellow-100 text-yellow-700 border-yellow-300',
  
  // Horizontal/Timing (Red)
  'horizontal': 'bg-red-100 text-red-700 border-red-300',
  
  // Math & Spectrum (Violet)
  'math': 'bg-violet-100 text-violet-700 border-violet-300',
  
  // System & Storage (Gray/Teal)
  'system': 'bg-slate-100 text-slate-700 border-slate-300',
  'file_system': 'bg-gray-100 text-gray-700 border-gray-300',
  'save-recall': 'bg-teal-100 text-teal-700 border-teal-300',
  
  // Miscellaneous (Slate)
  'miscellaneous': 'bg-slate-100 text-slate-700 border-slate-300',
};

/**
 * Load commands from mso_commands_complete.json format (standard format for all equipment)
 * 
 * Expected structure:
 * {
 *   "metadata": { "total_commands": ..., "equipment": "...", ... },
 *   "commands_by_section": {
 *     "Section Name": [
 *       { "section": "...", "command": "...", "description": "...", "type": "set|query" }
 *     ]
 *   }
 * }
 */
export function loadCompleteCommandsFile(data: any): {
  commands: CommandLibraryItem[];
  colors: Record<string, string>;
  loadedCommandIds: Set<string>;
  metadata?: any;
} {
  const commands: CommandLibraryItem[] = [];
  const colors: Record<string, string> = { ...DEFAULT_CATEGORY_COLORS };
  const loadedCommandIds = new Set<string>();

  if (!data.commands_by_section) {
    return { commands, colors, loadedCommandIds, metadata: data.metadata };
  }

  // Process each section
  Object.entries(data.commands_by_section).forEach(([sectionName, sectionCommands]: [string, any]) => {
    // Skip malformed sections
    if (!Array.isArray(sectionCommands)) return;
    
    // Skip invalid section names (parsing artifacts)
    if (sectionName.toLowerCase().includes('the commands by') || 
        sectionName.trim().length === 0 ||
        sectionName === 'undefined') {
      return;
    }
    
    // Map section to category
    const categoryId = SECTION_TO_CATEGORY_MAP[sectionName] || 'miscellaneous';
    
    // Use a clean category name for display (uses manual mapping + auto-shortening)
    const categoryName = getCategoryDisplayName(sectionName);
    
    // Set color for this category
    const categoryColor = DEFAULT_CATEGORY_COLORS[categoryId] || DEFAULT_CATEGORY_COLORS['miscellaneous'];
    colors[categoryId] = categoryColor;
    // Also set color by section name for direct lookup
    colors[sectionName] = categoryColor;

    // Process each command in the section
    sectionCommands.forEach((cmd: any) => {
      if (!cmd.command) return; // Skip invalid entries
      
      const commandStr = cmd.command.trim();
      if (!commandStr) return;
      
      // Create unique ID from command header (before space or ?)
      const commandHeader = commandStr.split(/\s|\?/)[0].toLowerCase();
      loadedCommandIds.add(commandHeader);
      
      // Defer SCPI parsing to first use (e.g. when opening command detail) for faster startup
      
      // Extract enhanced data if available (from mso_commands.json format)
      // Note: Removed instruments/families/models - commands are backward compatible
      let manualEntry: any = undefined;
      if (cmd.arguments || cmd.codeExamples || cmd.syntax || cmd.relatedCommands) {
        manualEntry = {
          command: commandStr,
          header: commandStr.split(/\s|\?/)[0],
          mnemonics: commandStr.split(/\s|\?/)[0].split(':'),
          commandType: cmd.type === 'query' ? 'query' : (cmd.type === 'both' ? 'both' : 'set'),
          description: cmd.description || '',
          shortDescription: cmd.description?.split('.')[0] || '',
          // Removed instruments field - commands are backward compatible
          arguments: cmd.arguments || [],
          syntax: cmd.syntax || undefined,
          examples: cmd.codeExamples || [],
          relatedCommands: cmd.relatedCommands || [],
          commandGroup: sectionName,
          manualReference: cmd.manualReference || { section: sectionName },
          notes: cmd.notes || undefined,
        };
      }
      
      // Convert arguments to params format for compatibility
      // Preserve TekExpress-specific fields: position, queryOnly, dependsOn, conditionalValues
      const params = cmd.arguments?.map((arg: any) => ({
        name: arg.name || 'value',
        type: arg.type || 'string',
        required: arg.required !== false,
        options: arg.validValues?.values || arg.validValues?.examples || undefined,
        min: arg.validValues?.min,
        max: arg.validValues?.max,
        unit: arg.validValues?.unit,
        description: arg.description,
        position: arg.position, // Preserve position for TekExpress commands
        queryOnly: arg.queryOnly, // Preserve queryOnly flag
        dependsOn: arg.dependsOn, // Preserve dependency info
        conditionalValues: arg.validValues?.conditionalValues, // Preserve conditional values
      })) || [];
      
      // Get first example code if available
      const example = cmd.codeExamples?.[0]?.codeExamples?.scpi?.code || undefined;
      
      // Create command entry
      const commandItem: CommandLibraryItem = {
        name: cmd.description || commandStr,
        scpi: commandStr,
        description: cmd.description || '',
        category: categoryName,
        subcategory: undefined,
        params: params,
        example: example,
        tekhsi: false,
        scpiStructure: undefined,
        editableParameters: undefined,
        manualReference: {
          section: sectionName,
          page: cmd.manualReference?.page,
        },
        manualEntry: manualEntry,
      };
      
      commands.push(commandItem);
    });
  });

  return { commands, colors, loadedCommandIds, metadata: data.metadata };
}

/**
 * Normalize command header for comparison (removes variable parts)
 */
export function normalizeCommandHeader(command: string): string {
  if (!command) return '';
  
  // Remove query marker
  let normalized = command.split('?')[0].trim();
  
  // Remove arguments (everything after first space)
  normalized = normalized.split(/\s/)[0];

  // Normalize trigger selector variants:
  // - library form: TRIGger:{A|B}:...
  // - concrete form: TRIGger:A:... or TRIGger:B:...
  normalized = normalized
    .replace(/\{A\|B\}/gi, '<trig_ab>')
    .replace(/:A(?=:|$)/gi, ':<trig_ab>')
    .replace(/:B(?=:|$)/gi, ':<trig_ab>');
  
  // Normalize variable mnemonics to patterns
  // Handle CHx_Dy before CHx so digital channel form is preserved
  normalized = normalized
    .replace(/CH(\d+)_D(\d+)/gi, 'CH<x>_D<y>');

  // First handle patterns with <x> in the middle (before "Val" or "Voltage" or "VOLTage")
  normalized = normalized
    .replace(/PG(\d+)Val/gi, 'PG<x>Val')
    .replace(/PW(\d+)Val/gi, 'PW<x>Val')
    .replace(/AMP(\d+)Val/gi, 'AMP<x>Val')
    .replace(/FREQ(\d+)Val/gi, 'FREQ<x>Val')
    .replace(/SPAN(\d+)Val/gi, 'SPAN<x>Val')
    .replace(/RIPPLEFREQ(\d+)Val/gi, 'RIPPLEFREQ<x>Val')
    .replace(/MAXG(\d+)Voltage/gi, 'MAXG<x>Voltage')
    .replace(/OUTPUT(\d+)VOLTage/gi, 'OUTPUT<x>VOLTage');
  
  // Then handle standard patterns with <x> at the end
  normalized = normalized
    .replace(/CH\d+/gi, 'CH<x>')
    .replace(/REF\d+/gi, 'REF<x>')
    .replace(/MATH\d+/gi, 'MATH<x>')
    .replace(/MEAS\d+/gi, 'MEAS<x>')
    .replace(/B\d+/gi, 'B<x>')
    .replace(/BUS\d+/gi, 'BUS<x>')
    .replace(/CURSOR\d+/gi, 'CURSOR<x>')
    .replace(/ZOOM\d+/gi, 'ZOOM<x>')
    .replace(/SEARCH\d+/gi, 'SEARCH<x>')
    .replace(/PLOT\d+/gi, 'PLOT<x>')
    .replace(/WAVEView\d+/gi, 'WAVEView<x>')
    .replace(/PLOTView\d+/gi, 'PLOTView<x>')
    .replace(/MATHFFTView\d+/gi, 'MATHFFTView<x>')
    .replace(/REFFFTView\d+/gi, 'REFFFTView<x>')
    .replace(/SPECView\d+/gi, 'SPECView<x>')
    .replace(/POWer\d+/gi, 'POWer<x>')
    .replace(/GSOurce\d+/gi, 'GSOurce<x>')
    .replace(/SOUrce\d+/gi, 'SOUrce<x>')
    .toLowerCase();
  
  return normalized;
}
