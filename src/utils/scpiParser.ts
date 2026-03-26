/**
 * SCPI Command Parser
 * 
 * Parses SCPI commands into structured components:
 * - Header (command name)
 * - Mnemonics (hierarchical components)
 * - Arguments (values, types)
 * - Query detection
 */

import { ParsedSCPI, SCPIArgument, ArgumentType } from '../types/scpi';

/**
 * Parse a SCPI command into structured components
 * 
 * @param command - The SCPI command string (e.g., "DATa:SOUrce CH1" or "CH1:SCAle?")
 * @returns Parsed SCPI structure
 */
export function parseSCPI(command: string): ParsedSCPI {
  if (!command || typeof command !== 'string') {
    return createEmptyParsed(command);
  }

  // Remove leading/trailing whitespace
  const trimmed = command.trim();
  if (!trimmed) {
    return createEmptyParsed(command);
  }

  // Check for query (ends with ?)
  const isQuery = trimmed.endsWith('?');
  const commandWithoutQuery = isQuery ? trimmed.slice(0, -1).trim() : trimmed;

  // Check for leading colon (concatenated command)
  const hasLeadingColon = commandWithoutQuery.startsWith(':');
  const commandWithoutColon = hasLeadingColon 
    ? commandWithoutQuery.slice(1).trim() 
    : commandWithoutQuery;

  // Check if this is a TekExpress command - they have special parsing
  const isTekExp = isTekExpressCommand(command);
  
  let header = commandWithoutColon;
  let argsString = '';
  let mnemonics: string[] = [];

  if (isTekExp) {
    // For TekExpress commands, arguments start after the first comma
    // Format: TEKEXP:SELECT DEVICE,"<DeviceName>" or TEKEXP:SELECT TEST,"<TestName>",<Value>
    // DEVICE/TEST are part of the command path, not arguments
    const commaIndex = commandWithoutColon.indexOf(',');
    if (commaIndex > 0) {
      header = commandWithoutColon.slice(0, commaIndex).trim();
      argsString = commandWithoutColon.slice(commaIndex + 1).trim();
    }
    // Parse mnemonics (separated by colons and spaces for TekExpress)
    // TEKEXP:SELECT DEVICE -> ["TEKEXP", "SELECT", "DEVICE"]
    const headerParts = header.split(/[: ]/).filter(m => m.length > 0);
    mnemonics = headerParts;
  } else {
    // Standard SCPI parsing - arguments separated by space
    const spaceIndex = commandWithoutColon.indexOf(' ');
    if (spaceIndex > 0) {
      header = commandWithoutColon.slice(0, spaceIndex);
      argsString = commandWithoutColon.slice(spaceIndex + 1).trim();
    }
    // Parse mnemonics (separated by colons).
    // Strip SCPI notation brackets [ ] from each token so that optional-path mnemonics
    // like [:SOURce<x>] are correctly detected as "SOURce<x>" by the parameter detector.
    mnemonics = header.split(':')
      .map(m => m.replace(/[[\]]/g, ''))
      .filter(m => m.length > 0);
  }

  // Parse arguments
  const arguments_ = parseArguments(argsString);

  return {
    header,
    mnemonics,
    arguments: arguments_,
    isQuery,
    originalCommand: command,
    hasLeadingColon,
  };
}

/**
 * Parse arguments from argument string
 */
function parseArguments(argsString: string): SCPIArgument[] {
  if (!argsString) {
    return [];
  }

  const arguments_: SCPIArgument[] = [];
  let currentIndex = 0;
  let position = 0;

  // Handle quoted strings first
  const quotedStringRegex = /^(["'])(?:(?=(\\?))\2.)*?\1/;
  // Handle numeric values (including scientific notation)
  const numericRegex = /^-?\d+\.?\d*([eE][+-]?\d+)?/;
  // Handle enumeration/text values (alphanumeric, may include special chars)
  const textRegex = /^[A-Za-z0-9_]+(?::[A-Za-z0-9_]+)*/;
  // Handle mnemonic patterns (CH1, REF2, MATH1, B1, MEAS1, CALLOUT1, etc.)
  const mnemonicRegex = /^(CH\d+|REF\d+|MATH\d+|BUS\d+|B\d+|MEAS\d+|CURSOR\d+|ZOOM\d+|SEARCH\d+|PLOT\d+|WAVEView\d+|PLOTView\d+|MATHFFTView\d+|CALLOUT\d+)/i;

  while (currentIndex < argsString.length) {
    // Skip whitespace and commas
    while (currentIndex < argsString.length && 
           (argsString[currentIndex] === ' ' || argsString[currentIndex] === ',')) {
      currentIndex++;
    }

    if (currentIndex >= argsString.length) break;

    const remaining = argsString.slice(currentIndex);
    let match: RegExpMatchArray | null = null;
    let argType: ArgumentType = 'unknown';
    let value = '';
    let endIndex = currentIndex;

    // Try quoted string first
    match = remaining.match(quotedStringRegex);
    if (match) {
      value = match[0];
      argType = 'quoted_string';
      endIndex = currentIndex + match[0].length;
    }
    // Try mnemonic pattern
    else {
      match = remaining.match(mnemonicRegex);
      if (match) {
        value = match[0];
        argType = 'mnemonic';
        endIndex = currentIndex + match[0].length;
      }
      // Try numeric
      else {
        match = remaining.match(numericRegex);
        if (match) {
          value = match[0];
          argType = 'numeric';
          endIndex = currentIndex + match[0].length;
        }
        // Try text/enumeration
        else {
          match = remaining.match(textRegex);
          if (match) {
            value = match[0];
            // Check if it looks like an enumeration (all caps or mixed case word)
            if (/^[A-Z][A-Za-z0-9]*$/.test(value)) {
              argType = 'enumeration';
            } else {
              argType = 'unknown';
            }
            endIndex = currentIndex + match[0].length;
          }
          // Fallback: take until next space or comma
          else {
            const nextSpace = remaining.indexOf(' ');
            const nextComma = remaining.indexOf(',');
            let nextDelimiter = nextSpace;
            if (nextDelimiter < 0 || (nextComma >= 0 && nextComma < nextDelimiter)) {
              nextDelimiter = nextComma;
            }
            
            if (nextDelimiter > 0) {
              value = remaining.slice(0, nextDelimiter);
              endIndex = currentIndex + nextDelimiter;
            } else {
              value = remaining;
              endIndex = argsString.length;
            }
            argType = 'unknown';
          }
        }
      }
    }

    if (value) {
      arguments_.push({
        value: value.trim(),
        type: argType,
        position,
        startIndex: currentIndex,
        endIndex,
      });
      position++;
    }

    currentIndex = endIndex;
  }

  return arguments_;
}

/**
 * Create empty parsed structure
 */
function createEmptyParsed(originalCommand: string): ParsedSCPI {
  return {
    header: '',
    mnemonics: [],
    arguments: [],
    isQuery: false,
    originalCommand,
    hasLeadingColon: false,
  };
}

/**
 * Parse concatenated commands (semicolon-separated)
 * 
 * @param commandString - Command string that may contain multiple commands
 * @returns Array of parsed commands
 */
export function parseConcatenatedCommands(commandString: string): ParsedSCPI[] {
  if (!commandString) {
    return [];
  }

  // Split by semicolon, but be careful with quoted strings
  const commands: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < commandString.length; i++) {
    const char = commandString[i];
    
    if ((char === '"' || char === "'") && (i === 0 || commandString[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      }
      current += char;
    } else if (char === ';' && !inQuotes) {
      if (current.trim()) {
        commands.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    commands.push(current.trim());
  }

  return commands.map(cmd => parseSCPI(cmd));
}

/**
 * Reconstruct command from parsed structure
 * 
 * @param parsed - Parsed SCPI structure
 * @param separator - Separator to use between arguments (' ' for space, ',' for comma). Defaults to space.
 * @returns Reconstructed command string
 */
export function reconstructCommand(parsed: ParsedSCPI, separator: string = ' '): string {
  let result = '';

  if (parsed.hasLeadingColon) {
    result += ':';
  }

  result += parsed.header;

  if (parsed.arguments.length > 0) {
    // For comma-separated commands, add space after header before first comma
    // For space-separated commands, use space as separator
    if (separator === ',') {
      result += ' ' + parsed.arguments.map(arg => arg.value).join(',');
    } else {
      result += ' ' + parsed.arguments.map(arg => arg.value).join(' ');
    }
  }

  if (parsed.isQuery) {
    result += '?';
  }

  return result;
}

/**
 * Check if a command is a TekExpress command
 * 
 * @param command - The SCPI command string
 * @returns True if the command is a TekExpress command
 */
export function isTekExpressCommand(command: string): boolean {
  if (!command || typeof command !== 'string') return false;
  return command.trim().toUpperCase().startsWith('TEKEXP:');
}


