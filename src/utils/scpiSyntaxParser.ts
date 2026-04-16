/**
 * SCPI Syntax Parser
 * 
 * Parses SCPI command syntax to extract parameters with options.
 * Handles patterns like:
 * - {<NR1>|OFF|ON}
 * - {LOW|MEDium|HIGH}
 * - <NR3>
 * - <QString>
 * - etc.
 */

import { CommandParam } from '../types/scpi';
import { getScpiSyntaxSync } from './tmDevicesDocstrings';

/**
 * Parse SCPI command syntax to extract parameters with options
 * 
 * @param syntax - The SCPI command syntax (e.g., "DISplay:GLObal:MATH<x>:STATE {<NR1>|OFF|ON}")
 * @param command - The actual command string (e.g., "DISplay:GLObal:MATH1:STATE")
 * @returns Array of CommandParam objects
 */
export function parseSCPISyntax(syntax: string, command: string): CommandParam[] {
  const params: CommandParam[] = [];
  
  if (!syntax || !command) return params;
  const isQuery = command.trim().endsWith('?');
  
  // For query commands, only extract mnemonic parameters (like <x> in POWer<x>)
  // Query commands don't have value parameters - they only return values
  // So we should skip all value parameter extraction for query commands
  
  // First, identify mnemonic parameters (like <x> in MATH<x>) that are already handled
  // by editable parameters - we should skip creating CommandParams for these
  const mnemonicParamPattern = /(CH|REF|MATH|MEAS|BUS|B|CURSOR|ZOOM|SEARCH|PLOT|WAVEView|PLOTView|MATHFFTView|REFFFTView|SPECView|CALLOUT|POWer|GSOurce|SOUrce)(<x>|\{x\})/gi;
  // Also handle patterns with <x> in the middle (before "Val" or "Voltage" or "VOLTage")
  const specialParamPattern = /(PG|PW|AMP|FREQ|SPAN|RIPPLEFREQ)(<x>|\d+)(Val|VOLTage)|(MAXG|OUTPUT)(<x>|\d+)(Voltage|VOLTage)/gi;
  const mnemonicParams = new Set<string>();
  let mnemonicMatch;
  while ((mnemonicMatch = mnemonicParamPattern.exec(syntax)) !== null) {
    mnemonicParams.add('x'); // The <x> parameter is already handled by editable parameters
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  while ((mnemonicMatch = specialParamPattern.exec(syntax)) !== null) {
    mnemonicParams.add('x'); // The <x> parameter in patterns like PG<x>Val, MAXG<x>Voltage, OUTPUT<x>VOLTage is already handled
  }
  
  // For query commands, skip all value parameter extraction
  // Only mnemonic parameters are needed for query commands
  if (isQuery) {
    return params; // Query commands don't have value parameters
  }
  
  // Find all parameter patterns in the syntax
  // Pattern 1: {<TYPE>|OPTION1|OPTION2|...} - options with type
  const optionsPattern = /\{([^}]+)\}/g;
  let match;
  let paramIndex = 0;
  
  while ((match = optionsPattern.exec(syntax)) !== null) {
    const content = match[1];
    const options = content.split('|').map(opt => opt.trim()).filter(opt => opt.length > 0);
    
    // If there's only one option and it doesn't contain <TYPE> or options,
    // it's likely a parameter name in curly braces like {decodeFileName}
    // Treat it as a text parameter instead of an enumeration
    if (options.length === 1 && !content.includes('<') && !content.includes('|')) {
      const beforeMatch = syntax.substring(0, match.index);
      const lastMnemonic = beforeMatch.split(':').pop()?.split(' ')[0] || '';
      
      // Use the content as the parameter name (e.g., decodeFileName)
      const paramName = options[0].charAt(0).toUpperCase() + options[0].slice(1).replace(/([A-Z])/g, ' $1').trim();
      
      params.push({
        name: paramName || inferParameterName(lastMnemonic, paramIndex),
        type: 'text',
        default: '',
        required: true,
        options: undefined,
      });
      
      paramIndex++;
      continue;
    }
    
    // Check if it contains a type like <NR1>, <NR3>, etc.
    const typePattern = /<([A-Z][A-Za-z0-9]*)>/;
    const typeMatch = content.match(typePattern);
    const scpiType = typeMatch ? typeMatch[1] : undefined;
    
    // Skip if this is a mnemonic parameter (like <x>) that's already handled
    if (scpiType === 'x' && mnemonicParams.has('x')) {
      paramIndex++;
      continue;
    }
    
    // Determine parameter name from context
    const beforeMatch = syntax.substring(0, match.index);
    const lastMnemonic = beforeMatch.split(':').pop()?.split(' ')[0] || '';
    const paramName = inferParameterName(lastMnemonic, paramIndex);
    
    // Default value preference: first literal option; otherwise use first option (keeps dropdown aligned with options)
    const isPlaceholder = (opt: string) => opt.startsWith('<') && opt.endsWith('>');
    const firstLiteral = options.find(opt => !isPlaceholder(opt));
    const defaultValue: any = firstLiteral !== undefined ? firstLiteral : options[0];
    
    params.push({
      name: paramName,
      type: 'enumeration',
      default: defaultValue,
      required: true,
      options: options,
    });
    
    paramIndex++;
  }
  
  // Pattern 2: <TYPE> without options (like <NR3>, <QString>, <file_path>, <data>, <string>)
  // Handle comma-separated arguments and both uppercase and lowercase type names
  const standaloneTypePattern = /<([A-Za-z_][A-Za-z0-9_]*)>/g;
  
  while ((match = standaloneTypePattern.exec(syntax)) !== null) {
    const scpiType = match[1];
    const matchIndex = match.index;
    
    // Skip if this type was already captured in an options pattern
    let alreadyCaptured = false;
    // Reset regex lastIndex for fresh search
    optionsPattern.lastIndex = 0;
    let optMatch;
    while ((optMatch = optionsPattern.exec(syntax)) !== null) {
      if (matchIndex >= optMatch.index! && matchIndex < optMatch.index! + optMatch[0].length) {
        alreadyCaptured = true;
        break;
      }
    }
    
    if (alreadyCaptured) continue;
    
    // Check if this is part of a mnemonic like MATH<x> (already handled by mnemonic detection)
    const beforeType = syntax.substring(0, matchIndex);
    const afterType = syntax.substring(matchIndex + match[0].length);
    const beforeChar = beforeType[beforeType.length - 1];
    const afterChar = afterType[0];
    
    // If it's part of a mnemonic (like MATH<x>), skip it
    // Also skip if it's the 'x' parameter that's already handled by editable parameters
    if ((/[A-Za-z]/.test(beforeChar) && /[A-Za-z]/.test(afterChar)) || 
        (scpiType === 'x' && mnemonicParams.has('x'))) {
      continue;
    }
    
    // This is a standalone argument type - create a parameter for it
    const beforeMatch = syntax.substring(0, matchIndex);
    const lastMnemonic = beforeMatch.split(':').pop()?.split(' ')[0] || '';
    
    // Infer parameter name from the type itself (e.g., <file_path> → "File Path")
    let paramName = scpiType.replace(/_/g, ' ').split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    
    // Fallback to inferring from mnemonic if type name is too generic
    if (['data', 'value'].includes(scpiType.toLowerCase())) {
      paramName = inferParameterName(lastMnemonic, paramIndex);
    }
    
    let defaultValue: any = undefined;
    if (scpiType === 'NR1' || scpiType === 'NR2' || scpiType === 'NR3') {
      defaultValue = 1;
    }
    
    params.push({
      name: paramName,
      type: scpiType.startsWith('NR') ? 'number' : 'text',
      default: defaultValue,
      required: true,
      options: undefined,
    });
    
    paramIndex++;
  }
  
  // Pattern 3: Check if command has arguments that aren't in syntax
  // This handles cases like "DISplay:PLOTView1:CURSor:SCREEN:AYPOSition" where
  // the syntax might not show the argument but the command needs one
  const commandParts = command.split(' ');
  if (!isQuery && commandParts.length === 1) {
    // Command has no arguments, but check if syntax suggests one should exist
    // Look for common patterns that require arguments
    const lastMnemonic = command.split(':').pop() || '';
    if (lastMnemonic.match(/POSITION|POS|OFFSET|OFFS|SCALE|SCAL|LEVEL|LEVE|WIDTH|WIDT|SIZE|SIZ|DELAY|DELA|DURATION|DURA|START|STOP|COUNT|COUN|RATE|FREQUENCY|FREQ/i)) {
      // This command likely needs a numeric argument
      // Check if we already have a param for this
      const hasParam = params.some(p => 
        p.name.toLowerCase().includes(lastMnemonic.toLowerCase().substring(0, 3))
      );
      
      if (!hasParam) {
        params.push({
          name: inferParameterName(lastMnemonic, paramIndex),
          type: 'number',
          default: undefined,
          required: false,
          options: undefined,
        });
      }
    }
  }
  
  return params;
}

/**
 * Infer parameter name from mnemonic context
 */
function inferParameterName(mnemonic: string, index: number): string {
  const upper = mnemonic.toUpperCase();
  
  // Don't infer from mnemonics with <x> or trailing digits - these are selectors, not parameters
  // e.g., "POSITION<x>", "POSITION1", "CH1", "B2" are mnemonics, not parameter names
  if (upper.includes('<X>') || /\d$/.test(upper)) {
    return 'Value'; // Generic name for parameters after mnemonic selectors
  }
  
  // Common patterns
  if (upper.includes('STATE')) return 'State';
  if (upper.includes('POSITION') || upper.includes('POS')) return 'Position';
  if (upper.includes('OFFSET') || upper.includes('OFFS')) return 'Offset';
  if (upper.includes('SCALE') || upper.includes('SCAL')) return 'Scale';
  if (upper.includes('SIZE') || upper.includes('SIZ')) return 'Size';
  if (upper.includes('WIDTH') || upper.includes('WIDT')) return 'Width';
  if (upper.includes('START')) return 'Start';
  if (upper.includes('STOP')) return 'Stop';
  if (upper.includes('DELAY') || upper.includes('DELA')) return 'Delay';
  if (upper.includes('DURATION') || upper.includes('DURA')) return 'Duration';
  if (upper.includes('LEVEL') || upper.includes('LEVE')) return 'Level';
  if (upper.includes('COUNT') || upper.includes('COUN')) return 'Count';
  if (upper.includes('RATE')) return 'Rate';
  if (upper.includes('FREQUENCY') || upper.includes('FREQ')) return 'Frequency';
  if (upper.includes('VALUE') || upper.includes('VAL')) return 'Value';
  if (upper.includes('MODE')) return 'Mode';
  if (upper.includes('TYPE')) return 'Type';
  if (upper.includes('SOURCE') || upper.includes('SOUR')) return 'Source';
  
  // Default based on index
  return index === 0 ? 'Value' : `Parameter ${index + 1}`;
}

/**
 * Extract parameters from command library entry
 * Combines syntax parsing with manual entry parsing
 * Also checks tm_devices_docstrings.json for scpiSyntax if not in manualEntry
 */
export function extractCommandParameters(
  cmd: { scpi: string; manualEntry?: any; params?: CommandParam[] }
): CommandParam[] {
  const addInferredArgsFromExamples = (
    base: CommandParam[],
    manualEntry: any,
    command: string
  ): CommandParam[] => {
    // If we already have a 'value' parameter with a numeric type, don't try to infer more
    // This prevents adding duplicate parameters like 'Stop' when 'value' already exists
    const hasNumericValueParam = base.some(p => 
      (p.name || '').toLowerCase() === 'value' && 
      (p.type === 'number' || p.type === 'integer')
    );
    if (hasNumericValueParam) return base;
    
    if (!manualEntry?.examples || !Array.isArray(manualEntry.examples)) return base;

    // Use the full command as the header, not just manualEntry.header
    // This ensures we match the full command path like "SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition"
    // instead of just "SEARCH"
    const header = command.split(' ')[0].replace(/\?$/, '') || '';
    if (!header) return base;

    const headerEscaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/<x>/gi, '\\d+')  // Replace <x> with \d+ to match any number
      .replace(/<[^>]+>/g, '[^\\s]+');  // Replace other placeholders with non-whitespace matcher
    const lastMnemonic = header.split(':').pop() || '';

    const tokenizeArgs = (text: string): string[] => {
      const tokens: string[] = [];
      const regex = /"[^"]*"|'[^']*'|#[^\s,]+|[^\s,]+/g;
      let m;
      let foundQuotedString = false;
      
      while ((m = regex.exec(text)) !== null) {
        const token = m[0];
        
        // Track if we found a quoted string
        if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          foundQuotedString = true;
          tokens.push(token);
          continue;
        }
        
        // If we've found a quoted string or ANY token and the next token looks like description text, stop
        if (tokens.length > 0) {
          // Check if this looks like description text (common description words or lowercase text that's not SCPI)
          const isDescriptionWord = /^(saves?|the|a|an|at|in|on|to|for|with|from|by|is|are|was|were|will|would|could|should|may|might|can|must|do|does|did|has|have|had|be|been|being|image|location|specified|file|path|directory|sets?|specifies|indicates|turns?|enables?|selects?|determines?|controls?|queries?|returns?)$/i.test(token);
          const isLowercaseText = token.length > 0 && token[0] === token[0].toLowerCase() && !token.match(/^(CH|MATH|REF|BUS|B)(\d+)$/i) && !token.match(/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
          
          if (isDescriptionWord || (isLowercaseText && tokens.length > 0)) {
            // Stop tokenizing - we've hit description text after the command arguments
            break;
          }
        }
        
        tokens.push(token);
      }
      return tokens;
    };

    const classifyToken = (token: string): { type: 'number' | 'text' | 'block' | 'source'; value?: any; options?: string[] } => {
      if (!token) return { type: 'text' };
      if (token.startsWith('#')) return { type: 'block', value: undefined };
      if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        return { type: 'text', value: token.slice(1, -1) };
      }
      // Check for channel/source patterns like CH5, MATH1, REF2
      const sourceMatch = token.match(/^(CH|MATH|REF)(\d+)$/i);
      if (sourceMatch) {
        const prefix = sourceMatch[1].toUpperCase();
        const options = prefix === 'CH' 
          ? ['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'CH8']
          : prefix === 'MATH'
          ? ['MATH1', 'MATH2', 'MATH3', 'MATH4']
          : ['REF1', 'REF2', 'REF3', 'REF4'];
        return { type: 'source', value: token.toUpperCase(), options };
      }
      // Check for bus patterns like B1, BUS2
      const busMatch = token.match(/^(BUS|B)(\d+)$/i);
      if (busMatch) {
        return { type: 'source', value: token.toUpperCase(), options: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'] };
      }
      const numMatch = token.match(/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
      if (numMatch) return { type: 'number', value: token };
      return { type: 'text', value: token };
    };

    let augmented = [...base];
    
    // Count how many numeric arguments we already have
    const existingNumericCount = base.filter(p => 
      p.type === 'number' || p.type === 'integer'
    ).length;

    for (const ex of manualEntry.examples) {
      const scpiCode = ex?.codeExamples?.scpi?.code || ex?.scpi || '';
      if (!scpiCode) continue;
      const afterHeaderMatch = scpiCode.match(new RegExp(`${headerEscaped}\\??\\s+(.+)$`, 'i'));
      if (!afterHeaderMatch) continue;
      const argSection = afterHeaderMatch[1];
      const tokens = tokenizeArgs(argSection);
      if (tokens.length === 0) continue;
      
      // If we already have enough numeric params to cover the example tokens, skip inference
      if (existingNumericCount >= tokens.length) continue;

      tokens.forEach((tok, idx) => {
        // Skip if this position is already covered by an existing param
        if (idx < base.length) return;
        
        const classification = classifyToken(tok);
        const name = inferParameterName(lastMnemonic, augmented.length + idx);
        const exists = augmented.some(p => (p.name || '').toLowerCase() === name.toLowerCase());
        if (exists) return;
        
        // Handle source types (CH, MATH, REF) with options
        if (classification.type === 'source') {
          augmented.push({
            name,
            type: 'enumeration',
            default: classification.value,
            required: true,
            options: classification.options,
          });
        } else {
          augmented.push({
            name,
            type: classification.type === 'number' ? 'number' : 'text',
            default: classification.type === 'number' ? classification.value ?? '1' : classification.value,
            required: true,
            options: undefined,
          });
        }
      });

      // Only use the first example that yields args to avoid duplicating from multiple examples
      if (augmented.length > base.length) {
        break;
      }
    }

    return augmented;
  };

  // Check if this is a TekExpress command - they use a different structure
  const isTekExp = cmd.scpi.trim().toUpperCase().startsWith('TEKEXP:');
  
  // If params already exist and are well-formed, use them
  if (cmd.params && cmd.params.length > 0) {
    // For TekExpress commands, don't parse syntax or infer from examples - use params as-is
    if (isTekExp) {
      return cmd.params;
    }
    
    // Enhance params with options from syntax if available
    if (cmd.manualEntry?.syntax) {
      // For query commands, only use query syntax (which has no value parameters)
      // For set/both commands, use set syntax (which has value parameters)
      const isQuery = cmd.scpi.trim().endsWith('?');
      const syntax = isQuery 
        ? (cmd.manualEntry.syntax.query || '') 
        : (cmd.manualEntry.syntax.set || cmd.manualEntry.syntax.query || '');
      const syntaxParams = parseSCPISyntax(syntax, cmd.scpi);
      
      // Merge syntax params with existing params and append any new ones discovered
      const merged = cmd.params.map((param) => {
        const match = syntaxParams.find(sp => sp.name.toLowerCase() === (param.name || '').toLowerCase());
        if (match && !param.options && match.options) {
          return { ...param, options: match.options };
        }
        return param;
      });
      // Append syntax-derived params that were not in the existing list
      // BUT skip generic type-based parameters (like "Nr3" from <NR3>, "Qstring" from <QString>)
      // if we already have a proper "value" or similar parameter - these are just placeholder names
      const hasProperValueParam = merged.some(p => 
        (p.name || '').toLowerCase() === 'value' || 
        (p.name || '').toLowerCase().includes('threshold') ||
        (p.name || '').toLowerCase().includes('position') ||
        (p.name || '').toLowerCase().includes('offset') ||
        (p.name || '').toLowerCase().includes('scale')
      );
      
      syntaxParams.forEach(sp => {
        const exists = merged.some(p => (p.name || '').toLowerCase() === sp.name.toLowerCase());
        if (exists) return;
        
        // Skip generic type-based parameter names if we already have proper params
        // These are like "Nr3" (from <NR3>), "Qstring" (from <QString>), etc.
        const isGenericTypeName = /^(nr\d+|qstring|nrf|data|string)$/i.test(sp.name);
        if (hasProperValueParam && isGenericTypeName) {
          return; // Skip this - we already have a proper named parameter
        }
        
        merged.push(sp);
      });
      // If still missing numeric arguments, try to infer from examples
      return addInferredArgsFromExamples(merged, cmd.manualEntry, cmd.scpi);
    }
    
    return addInferredArgsFromExamples(cmd.params, cmd.manualEntry, cmd.scpi);
  }
  
  // Try to extract from manual entry syntax
  // For TekExpress commands, skip syntax parsing - go directly to arguments
  let syntax: string | null = null;
  if (cmd.manualEntry?.syntax && !isTekExp) {
    // For query commands, only use query syntax (which has no value parameters)
    // For set/both commands, use set syntax (which has value parameters)
    const isQuery = cmd.scpi.trim().endsWith('?');
    syntax = isQuery 
      ? (cmd.manualEntry.syntax.query || '') 
      : (cmd.manualEntry.syntax.set || cmd.manualEntry.syntax.query || '');
  }
  
  // If no syntax found in manualEntry, try to get it from tm_devices_docstrings.json (synchronously if loaded)
  if (!syntax && !isTekExp) {
    try {
      const docstringSyntax = getScpiSyntaxSync(cmd.scpi);
      if (docstringSyntax) {
        syntax = docstringSyntax;
      }
    } catch (error) {
      // Silently fail - docstrings are optional
      console.debug('Could not get docstring syntax:', error);
    }
  }
  
  if (syntax && !isTekExp) {
    const parsed = parseSCPISyntax(syntax, cmd.scpi);
    return addInferredArgsFromExamples(parsed, cmd.manualEntry, cmd.scpi);
  }
  
  // Try to extract from manual entry arguments
  if (cmd.manualEntry?.arguments && Array.isArray(cmd.manualEntry.arguments)) {
    const isQuery = cmd.scpi.trim().endsWith('?');
    const queryArguments = cmd.manualEntry.syntax?.queryArguments || [];
    
    const mapped = cmd.manualEntry.arguments.map((arg: any) => {
      // Check if this argument should be shown
      // If queryOnly is true, only show in SET commands (not queries)
      if (arg.queryOnly && isQuery) {
        return null; // Skip this argument
      }
      
      // If in query mode, only show arguments listed in queryArguments
      if (isQuery && queryArguments.length > 0 && !queryArguments.includes(arg.name)) {
        return null; // Skip this argument
      }
      
      // Get options - check for conditionalValues first, then fall back to values
      let options: string[] = [];
      if (arg.validValues?.conditionalValues && arg.dependsOn) {
        // For conditional values, we'll use all possible values initially
        // The UI will filter based on parent selection
        const allConditionalValues = Object.values(arg.validValues.conditionalValues).flat() as string[];
        options = Array.from(new Set(allConditionalValues)); // Remove duplicates
      } else {
        options = arg.validValues?.values || arg.validValues?.examples || [];
      }
      
      // For TekExpress commands with quoted_string type, extract default from syntax if not provided
      let defaultValue = arg.defaultValue;
      if (!defaultValue && arg.type === 'quoted_string' && cmd.manualEntry?.syntax?.set) {
        // Extract placeholder from syntax like "TEKEXP:SELECT DEVICE,\"<DeviceName>\""
        // Look for all quoted placeholders like "<DeviceName>" or "<SuiteName>"
        const quotedPlaceholderPattern = /"<([^>]+)>"/g;
        const matches = Array.from(cmd.manualEntry.syntax.set.matchAll(quotedPlaceholderPattern)) as RegExpMatchArray[];
        // Get the placeholder at the argument's position (0-indexed)
        const argPosition = arg.position !== undefined ? arg.position : 0;
        if (matches[argPosition] && matches[argPosition][1]) {
          // Extract just the placeholder name without angle brackets
          defaultValue = matches[argPosition][1] as string;
        }
      }
      
      // Fall back to first option if no default value found
      if (!defaultValue && options.length > 0) {
        defaultValue = options[0];
      }
      
      return {
        name: arg.name || 'Value',
        type: arg.type === 'numeric' ? 'number' : (arg.type === 'enumeration' ? 'enumeration' : 'text'),
        default: defaultValue,
        required: arg.required || false,
        options: options.length > 0 ? options : undefined,
        dependsOn: arg.dependsOn, // Store dependency info
        conditionalValues: arg.validValues?.conditionalValues, // Store conditional mapping
        queryOnly: arg.queryOnly, // Store queryOnly flag
        position: arg.position, // Store position for proper ordering
      };
    }).filter((p: CommandParam | null): p is CommandParam => p !== null);
    
    // Sort by position if available (for TekExpress commands)
    const sorted = mapped.sort((a: CommandParam, b: CommandParam) => {
      const posA = a.position !== undefined ? a.position : 999;
      const posB = b.position !== undefined ? b.position : 999;
      return posA - posB;
    });
    
    // For TekExpress commands, don't infer additional args - arguments are already properly defined
    const isTekExp = cmd.scpi.trim().toUpperCase().startsWith('TEKEXP:');
    if (isTekExp) {
      return sorted; // Return sorted arguments as-is for TekExpress
    }
    
    return addInferredArgsFromExamples(sorted, cmd.manualEntry, cmd.scpi);
  }
  
  return addInferredArgsFromExamples([], cmd.manualEntry, cmd.scpi);
}

