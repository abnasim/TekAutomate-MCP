/**
 * TM Devices Docstrings Loader
 * 
 * Loads and indexes the tm_devices_docstrings.json file to provide
 * SCPI syntax information for commands that may not have it in manual entries.
 */

import { publicAssetUrl } from './publicUrl';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _docstringsCache: Map<string, any> | null = null;
let docstringsData: any = null;
let docstringsLoading: Promise<any> | null = null;

/**
 * Normalize a command string for lookup
 * Converts "OUTPut1:POLarity" to "output1.polarity" format
 */
function normalizeCommandForLookup(command: string): string {
  if (!command) return '';
  
  // Remove query marker
  const cmd = command.replace(/\?$/, '').trim();
  
  // Convert to lowercase and replace colons with dots
  // "OUTPut1:POLarity" -> "output1.polarity"
  return cmd.toLowerCase().replace(/:/g, '.');
}

/**
 * Find matching docstring entry for a command
 * 
 * IMPORTANT: tm_devices uses command trees, not flat paths. Composed paths like
 * "display.mathfftview1.cursor.mode" are valid in Python but may not exist as single
 * leaf entries in the JSON. This function walks up the tree to find valid entries.
 * 
 * Tries multiple lookup strategies:
 * 1. Direct path match (e.g., "output1.polarity")
 * 2. Command header match (e.g., "OUTPUT1:POLARITY" -> "output1.polarity")
 * 3. Try progressively shorter paths for composed/nested commands
 * 4. Match by scpiSyntax header directly
 * 
 * The docstrings JSON has a flat structure with device family prefixes in keys:
 * "DPO7AX.display.colors", "AFG3K.output1.polarity", etc.
 * 
 * NOTE: Truncated usage text in docstrings comes from tm_devices source, not JSON corruption.
 * We detect it but do NOT attempt to auto-complete.
 */
function findDocstringEntry(command: string, docstrings: any): any | null {
  if (!command || !docstrings) return null;
  
  const normalized = normalizeCommandForLookup(command);
  const commandHeader = command.split(/\s|\?/)[0].toLowerCase();
  const headerNormalized = commandHeader.replace(/:/g, '.');
  
  // Strategy 1: Direct lookup by path (search across all device families)
  // Keys are like "DPO7AX.display.colors" or "AFG3K.output1.polarity"
  for (const [fullKey, value] of Object.entries(docstrings)) {
    if (typeof value !== 'object' || value === null) continue;
    
    // Extract the path from the key (remove device family prefix)
    // "DPO7AX.display.colors" -> "display.colors"
    const keyParts = fullKey.split('.');
    const pathFromKey = keyParts.slice(1).join('.').toLowerCase();
    
    // Check if path matches
    if (pathFromKey === normalized) {
      // Verify scpiSyntax matches if available
      const scpiSyntax = (value as any).scpiSyntax || '';
      if (scpiSyntax) {
        const syntaxHeader = scpiSyntax.split(/\s/)[0].toLowerCase();
        if (syntaxHeader === commandHeader) {
          return value;
        }
      } else {
        // If no scpiSyntax, return if path matches
        return value;
      }
    }
  }
  
  // Strategy 2: Try progressively shorter paths (for nested commands like display.mathfftview1.cursor.mode)
  const pathParts = headerNormalized.split('.');
  for (let i = pathParts.length; i > 0; i--) {
    const partialPath = pathParts.slice(0, i).join('.');
    
    for (const [fullKey, value] of Object.entries(docstrings)) {
      if (typeof value !== 'object' || value === null) continue;
      
      const keyParts = fullKey.split('.');
      const pathFromKey = keyParts.slice(1).join('.').toLowerCase();
      
      if (pathFromKey === partialPath) {
        // Verify the scpiSyntax matches the command header
        const scpiSyntax = (value as any).scpiSyntax || '';
        if (scpiSyntax) {
          const syntaxHeader = scpiSyntax.split(/\s/)[0].toLowerCase();
          if (syntaxHeader === commandHeader || syntaxHeader.startsWith(commandHeader.split(':')[0])) {
            return value;
          }
        } else {
          // If no scpiSyntax, still return it if path matches
          return value;
        }
      }
    }
  }
  
  // Strategy 3: Match by scpiSyntax header directly
  for (const [, value] of Object.entries(docstrings)) {
    if (typeof value !== 'object' || value === null) continue;
    
    const scpiSyntax = (value as any).scpiSyntax || '';
    if (scpiSyntax) {
      const syntaxHeader = scpiSyntax.split(/\s/)[0].toLowerCase();
      if (syntaxHeader === commandHeader) {
        return value;
      }
    }
  }
  
  // Strategy 4: Match by path in the value object (fallback)
  for (const [, value] of Object.entries(docstrings)) {
    if (typeof value !== 'object' || value === null) continue;
    
    const entryPath = (value as any).path?.toLowerCase() || '';
    if (entryPath === headerNormalized || entryPath === normalized) {
      return value;
    }
  }
  
  return null;
}

/**
 * Load docstrings from JSON file (lazy load, cached)
 */
export async function loadDocstrings(): Promise<any> {
  if (docstringsData) {
    return docstringsData;
  }
  
  // If already loading, return the existing promise
  if (docstringsLoading) {
    return docstringsLoading;
  }
  
  docstringsLoading = (async () => {
    try {
      const response = await fetch(publicAssetUrl('commands/tm_devices_docstrings.json'));
      if (!response.ok) {
        console.warn('Failed to load tm_devices_docstrings.json:', response.statusText);
        return null;
      }
      docstringsData = await response.json();
      return docstringsData;
    } catch (error) {
      console.warn('Error loading tm_devices_docstrings.json:', error);
      return null;
    } finally {
      docstringsLoading = null;
    }
  })();
  
  return docstringsLoading;
}

/**
 * Get scpiSyntax synchronously (if docstrings are already loaded)
 * Returns null if not loaded yet
 */
export function getScpiSyntaxSync(command: string): string | null {
  if (!command || !docstringsData) return null;
  
  const entry = findDocstringEntry(command, docstringsData);
  if (entry && entry.scpiSyntax) {
    return entry.scpiSyntax;
  }
  
  return null;
}

/**
 * Get scpiSyntax for a command from docstrings
 * @param command - The SCPI command (e.g., "OUTPut1:POLarity")
 * @returns The scpiSyntax string or null if not found
 */
export async function getScpiSyntaxFromDocstrings(command: string): Promise<string | null> {
  if (!command) return null;
  
  const docstrings = await loadDocstrings();
  if (!docstrings) return null;
  
  // Try to find matching entry
  const entry = findDocstringEntry(command, docstrings);
  if (entry && entry.scpiSyntax) {
    return entry.scpiSyntax;
  }
  
  return null;
}

/**
 * Get full docstring entry for a command
 * @param command - The SCPI command
 * @returns The docstring entry object or null
 */
export async function getDocstringEntry(command: string): Promise<any | null> {
  if (!command) return null;
  
  const docstrings = await loadDocstrings();
  if (!docstrings) return null;
  
  return findDocstringEntry(command, docstrings);
}

/**
 * Preload docstrings (call this early in app initialization)
 */
export async function preloadDocstrings(): Promise<void> {
  await loadDocstrings();
}
