/**
 * SCPI Command Data Fix Script
 * 
 * Automatically fixes common data quality issues found by the audit:
 * 1. Adds missing <QString> value parameters
 * 2. Adds missing COLOR<x> parameters
 * 3. Fixes redundant source parameters
 */

const fs = require('fs');
const path = require('path');

class CommandFixer {
  constructor() {
    this.fixes = [];
    this.stats = {
      filesProcessed: 0,
      commandsFixed: 0,
      fixesByType: {}
    };
  }

  logFix(scpi, type, description) {
    this.fixes.push({ scpi, type, description });
    this.stats.fixesByType[type] = (this.stats.fixesByType[type] || 0) + 1;
    this.stats.commandsFixed++;
  }

  getSyntax(cmd) {
    if (cmd.syntax && Array.isArray(cmd.syntax)) {
      return cmd.syntax.join(' ');
    }
    if (cmd.manualEntry?.syntax) {
      const s = cmd.manualEntry.syntax;
      if (typeof s === 'string') return s;
      return `${s.set || ''} ${s.query || ''}`;
    }
    if (cmd._manualEntry?.syntax) {
      const s = cmd._manualEntry.syntax;
      if (typeof s === 'string') return s;
      return `${s.set || ''} ${s.query || ''}`;
    }
    return cmd.scpi || '';
  }

  fixCommand(cmd) {
    if (!cmd.params) cmd.params = [];
    const syntax = this.getSyntax(cmd);
    let fixed = false;

    // Fix 1: Add missing <QString> parameter
    if (/\s+<QString>/i.test(syntax) || /\s+<Qstring>/i.test(syntax)) {
      const hasStringParam = cmd.params.some(p => 
        p.type === 'string' || 
        (p.name?.toLowerCase() === 'value' && !p.options?.length)
      );
      if (!hasStringParam) {
        // Try to infer a better parameter name from the command
        let paramName = 'value';
        let description = 'String value (quoted string)';
        
        const scpiLower = (cmd.scpi || '').toLowerCase();
        if (scpiLower.includes('filename') || scpiLower.includes('file')) {
          paramName = 'filename';
          description = 'File path or name';
        } else if (scpiLower.includes('label') || scpiLower.includes('name')) {
          paramName = 'name';
          description = 'Label or name string';
        } else if (scpiLower.includes('pattern')) {
          paramName = 'pattern';
          description = 'Pattern string';
        } else if (scpiLower.includes('address') || scpiLower.includes('addr')) {
          paramName = 'address';
          description = 'Address value';
        } else if (scpiLower.includes('symbol')) {
          paramName = 'symbol';
          description = 'Symbol string';
        } else if (scpiLower.includes('unit')) {
          paramName = 'unit';
          description = 'Unit string';
        }
        
        cmd.params.push({
          name: paramName,
          type: 'string',
          required: true,
          default: '',
          description: description
        });
        this.logFix(cmd.scpi, 'add_string_param', `Added missing string parameter: ${paramName}`);
        fixed = true;
      }
    }

    // Fix 2: Add missing COLOR<x> parameter
    if (/\s+COLOR<[xX]>/i.test(syntax)) {
      const hasColorParam = cmd.params.some(p => 
        p.name?.toLowerCase() === 'color' || 
        p.options?.some(o => /^COLOR\d+$/i.test(o))
      );
      if (!hasColorParam) {
        const colorOptions = [];
        for (let i = 0; i <= 47; i++) {
          colorOptions.push(`COLOR${i}`);
        }
        cmd.params.push({
          name: 'color',
          type: 'enumeration',
          required: true,
          default: 'COLOR0',
          options: colorOptions,
          description: 'COLOR<x> specifies the color (0-47)'
        });
        this.logFix(cmd.scpi, 'add_color_param', 'Added missing COLOR<x> parameter');
        fixed = true;
      }
    }

    // Fix 3: Fix value param with wrong options (mnemonic placeholders instead of actual values)
    const valueParam = cmd.params.find(p => p.name?.toLowerCase() === 'value');
    if (valueParam?.options) {
      const hasMnemonicPlaceholders = valueParam.options.some(o => 
        /^(CH|MATH|REF)<[xX]>$/i.test(o)
      );
      // Only fix if ALL options are placeholders (not mixed with real values)
      const allPlaceholders = valueParam.options.every(o => 
        /^(CH|MATH|REF)<[xX]>$/i.test(o) || /^<.*>$/i.test(o)
      );
      
      if (hasMnemonicPlaceholders && allPlaceholders && valueParam.options.length <= 5) {
        // Check syntax for what the actual value should be
        if (/\s+COLOR<[xX]>/i.test(syntax)) {
          const colorOptions = [];
          for (let i = 0; i <= 47; i++) {
            colorOptions.push(`COLOR${i}`);
          }
          valueParam.options = colorOptions;
          valueParam.default = 'COLOR0';
          valueParam.description = 'COLOR<x> specifies the color (0-47)';
          this.logFix(cmd.scpi, 'fix_value_options', 'Fixed value param to use COLOR options');
          fixed = true;
        }
      }
    }

    // Fix 4: Remove redundant source param when individual params exist
    const hasSource = cmd.params.some(p => p.name?.toLowerCase() === 'source');
    const hasChannel = cmd.params.some(p => ['channel', 'ch'].includes(p.name?.toLowerCase()));
    const hasMath = cmd.params.some(p => p.name?.toLowerCase() === 'math');
    const hasRef = cmd.params.some(p => ['ref', 'reference'].includes(p.name?.toLowerCase()));
    
    if (hasSource && hasChannel && hasMath && hasRef) {
      // Remove the redundant 'source' param since we have individual params
      const sourceIdx = cmd.params.findIndex(p => p.name?.toLowerCase() === 'source');
      if (sourceIdx >= 0) {
        cmd.params.splice(sourceIdx, 1);
        this.logFix(cmd.scpi, 'remove_redundant_source', 'Removed redundant source param (individual params exist)');
        fixed = true;
      }
    }

    return fixed;
  }

  processFile(filePath) {
    console.log(`\nProcessing: ${path.basename(filePath)}`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    let data;
    
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.error(`  Failed to parse JSON: ${e.message}`);
      return false;
    }

    let modified = false;
    let commandCount = 0;

    // Handle MSO format: { groups: { GroupName: { commands: [...] }, ... } }
    if (data.groups && typeof data.groups === 'object') {
      for (const groupName of Object.keys(data.groups)) {
        const group = data.groups[groupName];
        if (group.commands && Array.isArray(group.commands)) {
          for (const cmd of group.commands) {
            if (!cmd.scpi) continue;
            commandCount++;
            if (this.fixCommand(cmd)) {
              modified = true;
            }
          }
        }
      }
    }
    // Handle array format
    else if (Array.isArray(data)) {
      for (const cmd of data) {
        if (!cmd.scpi) continue;
        commandCount++;
        if (this.fixCommand(cmd)) {
          modified = true;
        }
      }
    }
    // Handle { commands: [...] } format
    else if (data.commands && Array.isArray(data.commands)) {
      for (const cmd of data.commands) {
        if (!cmd.scpi) continue;
        commandCount++;
        if (this.fixCommand(cmd)) {
          modified = true;
        }
      }
    }

    console.log(`  Processed ${commandCount} commands`);
    this.stats.filesProcessed++;

    if (modified) {
      // Write back the fixed data
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  ✓ File updated with fixes`);
      return true;
    } else {
      console.log(`  No fixes needed`);
      return false;
    }
  }

  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('FIX REPORT');
    console.log('='.repeat(60));
    
    console.log(`\nFiles processed: ${this.stats.filesProcessed}`);
    console.log(`Commands fixed: ${this.stats.commandsFixed}`);
    
    console.log('\nFixes by type:');
    for (const [type, count] of Object.entries(this.stats.fixesByType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    if (this.fixes.length > 0) {
      console.log('\nSample fixes:');
      for (const fix of this.fixes.slice(0, 10)) {
        console.log(`  - ${fix.scpi}: ${fix.description}`);
      }
      if (this.fixes.length > 10) {
        console.log(`  ... and ${this.fixes.length - 10} more`);
      }
    }

    // Write full fix log
    const logPath = path.join(__dirname, 'fix-log.json');
    fs.writeFileSync(logPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      stats: this.stats,
      fixes: this.fixes
    }, null, 2));
    console.log(`\nFull fix log written to: ${logPath}`);
  }
}

// Main execution
const fixer = new CommandFixer();

// Find command files
const commandsDir = path.join(__dirname, '..', 'public', 'commands');
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.json'));

console.log('SCPI Command Data Fix Script');
console.log('============================');
console.log(`Found ${files.length} command files`);

// Only process specific files that we know have issues
const filesToFix = [
  'mso_2_4_5_6_7.json',
  'MSO_DPO_5k_7k_70K.json'
];

for (const file of files) {
  if (filesToFix.includes(file)) {
    fixer.processFile(path.join(commandsDir, file));
  }
}

fixer.generateReport();

console.log('\n✓ Done! Run the audit script again to verify fixes.');
