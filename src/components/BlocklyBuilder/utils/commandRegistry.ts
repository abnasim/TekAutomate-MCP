/**
 * Command Registry for Blockly Blocks
 * 
 * Provides access to command metadata (parameters, options) for SCPI blocks.
 * This is populated from the App's command library and used by blocks to
 * show proper dropdown options for parameters.
 */

export interface CommandParam {
  name: string;
  type: string;
  default?: any;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

export interface CommandMetadata {
  name: string;
  scpi: string;
  description: string;
  category: string;
  params?: CommandParam[];
}

// Global command registry - populated by BlocklyBuilder from App's command library
const commandRegistry = new Map<string, CommandMetadata>();

/**
 * Normalize a command header for lookup
 * Removes arguments, query marks, and normalizes case
 */
function normalizeHeader(command: string): string {
  return command
    .trim()
    .toUpperCase()
    .replace(/\?$/, '')           // Remove query mark
    .split(/\s+/)[0]              // Get just the header (before arguments)
    .replace(/\{[^}]+\}/g, '')    // Remove template placeholders
    .replace(/<[^>]+>/g, '');     // Remove <x> placeholders
}

/**
 * Set the command registry from the App's command library
 * Called by BlocklyBuilder when it receives the commands prop
 */
export function setCommandRegistry(commands: CommandMetadata[]): void {
  commandRegistry.clear();
  
  commands.forEach(cmd => {
    const normalizedHeader = normalizeHeader(cmd.scpi);
    if (normalizedHeader) {
      commandRegistry.set(normalizedHeader, cmd);
    }
  });
  
  if (process.env.NODE_ENV === 'development') {
    console.debug(`Command registry populated with ${commandRegistry.size} commands`);
  }
}

/**
 * Look up command metadata by SCPI command string
 * Returns the command metadata including parameter options
 */
export function lookupCommand(command: string): CommandMetadata | undefined {
  const normalizedHeader = normalizeHeader(command);
  return commandRegistry.get(normalizedHeader);
}

/**
 * Get parameter options for a specific command and parameter index
 * Returns the options array if available, empty array otherwise
 */
export function getParameterOptions(command: string, paramIndex: number): string[] {
  const metadata = lookupCommand(command);
  if (!metadata || !metadata.params || paramIndex >= metadata.params.length) {
    return [];
  }
  
  const param = metadata.params[paramIndex];
  return param.options || [];
}

/**
 * Get all parameter metadata for a command
 */
export function getCommandParams(command: string): CommandParam[] {
  const metadata = lookupCommand(command);
  return metadata?.params || [];
}

/**
 * Check if command registry is populated
 */
export function isRegistryPopulated(): boolean {
  return commandRegistry.size > 0;
}

/**
 * Get registry size for debugging
 */
export function getRegistrySize(): number {
  return commandRegistry.size;
}
