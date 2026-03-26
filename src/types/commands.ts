/**
 * Command Library Types
 * 
 * Types for command library items and parameters
 */

import { ParsedSCPI, EditableParameter, ManualCommandEntry } from './scpi';

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
  scpiStructure?: ParsedSCPI;
  editableParameters?: EditableParameter[];
  manualReference?: {
    section?: string;
    page?: number;
    examples?: string[];
  };
  // Full manual entry from mso_commands.json
  manualEntry?: ManualCommandEntry;
}
