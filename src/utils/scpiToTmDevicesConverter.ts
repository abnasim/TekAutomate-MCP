/**
 * SCPI to tm_devices Converter
 * 
 * Converts SCPI commands to tm_devices command paths based on docstrings
 */

/**
 * Convert SCPI command to tm_devices path
 * Example: "CH1:SCALE 1.0" -> "ch[1].scale.write(1.0)"
 * Example: "*IDN?" -> "commands.idn.query()"
 */
export function convertSCPIToTmDevices(scpiCommand: string): {
  path: string;
  method: string;
  value?: string;
  success: boolean;
  message?: string;
} {
  const trimmed = scpiCommand.trim();
  
  // Check if it's a query (ends with ?)
  const isQuery = trimmed.endsWith('?');
  const baseCommand = isQuery ? trimmed.slice(0, -1) : trimmed;
  
  // Split command and arguments
  const parts = baseCommand.split(/\s+/);
  const commandPart = parts[0];
  const value = parts.slice(1).join(' ');
  
  // Convert SCPI path to tm_devices path
  const pathParts = commandPart.split(':').filter(p => p.length > 0);
  
  if (pathParts.length === 0) {
    return {
      path: '',
      method: 'query',
      success: false,
      message: 'Invalid SCPI command'
    };
  }
  
  // Build tm_devices path
  const tmPath: string[] = [];
  
  for (const part of pathParts) {
    // Check for channel/index patterns (CH1, MATH2, etc.)
    const indexMatch = part.match(/^([A-Z]+)(\d+)$/i);
    if (indexMatch) {
      const baseName = indexMatch[1].toLowerCase();
      const index = indexMatch[2];
      
      // Convert to indexed access (e.g., CH1 -> ch[1])
      tmPath.push(`${baseName}[${index}]`);
    } else {
      // Regular path component - convert to lowercase
      tmPath.push(part.toLowerCase());
    }
  }
  
  // Determine method
  let method = isQuery ? 'query' : 'write';
  if (!isQuery && !value) {
    // If it's not a query and has no value, it might be a property getter
    method = 'query';
  }
  
  // Build final path (join with dots)
  const path = tmPath.join('.');
  
  return {
    path,
    method,
    value: value || undefined,
    success: true
  };
}

/**
 * Convert tm_devices path to SCPI command
 * Example: "ch[1].scale" with value "1.0" -> "CH1:SCALE 1.0"
 * Example: "commands.idn.query()" -> "*IDN?"
 */
export function convertTmDevicesToSCPI(path: string, method: string, value?: string): {
  scpiCommand: string;
  success: boolean;
  message?: string;
} {
  if (!path) {
    return {
      scpiCommand: '',
      success: false,
      message: 'Invalid tm_devices path'
    };
  }
  
  // Remove 'commands.' prefix if present
  let workingPath = path.startsWith('commands.') ? path.slice(9) : path;
  
  // Split path into components
  const parts = workingPath.split('.');
  const scpiParts: string[] = [];
  
  for (const part of parts) {
    // Check for indexed access (e.g., ch[1])
    const indexMatch = part.match(/^([a-z]+)\[(\d+)\]$/i);
    if (indexMatch) {
      const baseName = indexMatch[1].toUpperCase();
      const index = indexMatch[2];
      // Convert to SCPI format (e.g., ch[1] -> CH1)
      scpiParts.push(`${baseName}${index}`);
    } else {
      // Regular component - convert to uppercase
      scpiParts.push(part.toUpperCase());
    }
  }
  
  // Build SCPI command
  let scpiCommand = scpiParts.join(':');
  
  // Add query mark if it's a query
  if (method === 'query' || method === 'verify') {
    scpiCommand += '?';
  } else if (method === 'write' && value) {
    // Add value for write commands
    scpiCommand += ` ${value}`;
  }
  
  return {
    scpiCommand,
    success: true
  };
}
