/**
 * SCPI Command Data Quality Audit Script
 * 
 * Detects common issues in command JSON data:
 * 1. Missing value parameters (e.g., COLOR<x>, MEAS<x> in arguments)
 * 2. Duplicate/redundant parameters
 * 3. Parameters that should be enumerations but aren't
 * 4. Mismatched syntax vs params
 * 5. Commands with {A|B|C} patterns missing proper source handling
 */

const fs = require('fs');
const path = require('path');

// Patterns that indicate a value parameter is needed
const VALUE_PATTERNS = [
  { pattern: /COLOR<[xX]>/i, name: 'color', range: [0, 47], prefix: 'COLOR' },
  { pattern: /MEAS<[xX]>/i, name: 'measurement', range: [1, 8], prefix: 'MEAS' },
  { pattern: /CH<[xX]>/i, name: 'channel', range: [1, 8], prefix: 'CH' },
  { pattern: /MATH<[xX]>/i, name: 'math', range: [1, 4], prefix: 'MATH' },
  { pattern: /REF<[xX]>/i, name: 'reference', range: [1, 4], prefix: 'REF' },
  { pattern: /BUS<[xX]>/i, name: 'bus', range: [1, 4], prefix: 'B' },
  { pattern: /SEARCH<[xX]>/i, name: 'search', range: [1, 8], prefix: 'SEARCH' },
  { pattern: /CURSOR<[xX]>/i, name: 'cursor', range: [1, 2], prefix: 'CURSOR' },
  { pattern: /PLOT<[xX]>/i, name: 'plot', range: [1, 4], prefix: 'PLOT' },
  { pattern: /D<[xX]>/i, name: 'digital', range: [0, 15], prefix: 'D' },
];

// Patterns in syntax that indicate value arguments (not path mnemonics)
const ARGUMENT_VALUE_PATTERNS = [
  { pattern: /\s+COLOR<[xX]>/i, name: 'color', range: [0, 47], prefix: 'COLOR' },
  { pattern: /\s+<NR\d*>/i, name: 'value', type: 'number' },
  { pattern: /\s+<QString>/i, name: 'value', type: 'string' },
];

class CommandAuditor {
  constructor() {
    this.issues = [];
    this.stats = {
      totalCommands: 0,
      commandsWithIssues: 0,
      issuesByType: {}
    };
  }

  addIssue(command, type, message, severity = 'warning') {
    this.issues.push({
      scpi: command.scpi,
      name: command.name,
      type,
      message,
      severity
    });
    this.stats.issuesByType[type] = (this.stats.issuesByType[type] || 0) + 1;
  }

  auditCommand(cmd) {
    const issues = [];
    
    // Get syntax string
    const syntax = this.getSyntax(cmd);
    const params = cmd.params || [];
    const paramNames = params.map(p => p.name?.toLowerCase());

    // Check 1: Missing value parameters in syntax
    this.checkMissingValueParams(cmd, syntax, params);

    // Check 2: Redundant/duplicate parameters
    this.checkDuplicateParams(cmd, params);

    // Check 3: {A|B|C} patterns without proper handling
    this.checkChoicePatterns(cmd, syntax, params);

    // Check 4: Value parameter showing wrong options
    this.checkValueParamOptions(cmd, syntax, params);

    // Check 5: Missing options for enumeration types
    this.checkMissingEnumOptions(cmd, params);

    return issues;
  }

  getSyntax(cmd) {
    // Try multiple sources for syntax
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

  checkMissingValueParams(cmd, syntax, params) {
    // If command already has params defined, skip this check
    // (params were likely added manually to fix the issue)
    if (params && params.length > 0) {
      return;
    }
    
    // Check if syntax has value arguments that aren't in params
    for (const vp of ARGUMENT_VALUE_PATTERNS) {
      if (vp.pattern.test(syntax)) {
        // This syntax has a value argument - check if params has it
        const hasParam = params.some(p => {
          const pName = p.name?.toLowerCase();
          return pName === vp.name || pName === 'value' || 
                 (vp.prefix && p.options?.some(o => o.startsWith(vp.prefix)));
        });

        if (!hasParam) {
          this.addIssue(cmd, 'missing_value_param', 
            `Syntax has ${vp.name} argument but no matching parameter. Syntax: ${syntax.substring(0, 100)}`,
            'error');
        }
      }
    }
  }

  checkDuplicateParams(cmd, params) {
    // Check for params that serve the same purpose
    const sourceParams = params.filter(p => {
      const name = p.name?.toLowerCase();
      return ['source', 'channel', 'ch', 'math', 'ref', 'reference'].includes(name);
    });

    if (sourceParams.length > 2) {
      // Having channel, math, reference is okay for {CH|MATH|REF} commands
      // But having source + channel + math + reference is redundant
      const hasSource = sourceParams.some(p => p.name?.toLowerCase() === 'source');
      const hasIndividual = sourceParams.some(p => 
        ['channel', 'ch', 'math', 'ref', 'reference'].includes(p.name?.toLowerCase())
      );
      
      if (hasSource && hasIndividual && sourceParams.length > 3) {
        this.addIssue(cmd, 'redundant_params',
          `Has both 'source' enumeration and individual channel/math/ref params`,
          'warning');
      }
    }

    // Check for duplicate value params
    const valueParams = params.filter(p => {
      const name = p.name?.toLowerCase();
      return name === 'value' || p.type === 'enumeration';
    });

    // Check if value param has options that should be in a different param
    const valueParam = params.find(p => p.name?.toLowerCase() === 'value');
    if (valueParam?.options) {
      const hasMnemonicOptions = valueParam.options.some(o => 
        /^(CH|MATH|REF)<[xX]>$/i.test(o)
      );
      if (hasMnemonicOptions && valueParam.options.length <= 5) {
        this.addIssue(cmd, 'wrong_value_options',
          `Value param has mnemonic placeholders (${valueParam.options.join(', ')}) instead of actual values`,
          'error');
      }
    }
  }

  checkChoicePatterns(cmd, syntax, params) {
    // If command already has params defined, skip this check
    if (params && params.length > 0) {
      return;
    }
    
    // Check for {CH<x>|MATH<x>|REF<x>} patterns
    const choiceMatch = syntax.match(/\{([^}]+)\}/g);
    if (choiceMatch) {
      for (const choice of choiceMatch) {
        const options = choice.slice(1, -1).split('|');
        
        // If it's a source choice pattern
        if (options.some(o => /CH<[xX]>/i.test(o))) {
          // Should have a way to select between CH/MATH/REF
          const hasSourceSelection = params.some(p => {
            if (p.name?.toLowerCase() === 'source' && p.options) {
              return p.options.some(o => /^(CH|MATH|REF)\d+$/i.test(o));
            }
            return false;
          });

          // Or individual params for each type
          const hasIndividualParams = 
            params.some(p => ['channel', 'ch'].includes(p.name?.toLowerCase())) ||
            params.some(p => ['math'].includes(p.name?.toLowerCase())) ||
            params.some(p => ['ref', 'reference'].includes(p.name?.toLowerCase()));

          if (!hasSourceSelection && !hasIndividualParams) {
            this.addIssue(cmd, 'missing_source_selection',
              `Has choice pattern ${choice} but no source selection parameter`,
              'warning');
          }
        }
      }
    }
  }

  checkValueParamOptions(cmd, syntax, params) {
    // Check if value param options match what syntax expects
    const valueParam = params.find(p => p.name?.toLowerCase() === 'value');
    if (!valueParam) return;

    // Check for COLOR<x> in syntax
    if (/COLOR<[xX]>/i.test(syntax)) {
      const hasColorOptions = valueParam.options?.some(o => /^COLOR\d+$/i.test(o));
      if (!hasColorOptions) {
        this.addIssue(cmd, 'wrong_value_type',
          `Syntax expects COLOR<x> but value param has: ${(valueParam.options || []).slice(0, 5).join(', ')}`,
          'error');
      }
    }
  }

  checkMissingEnumOptions(cmd, params) {
    for (const param of params) {
      if (param.type === 'enumeration' && (!param.options || param.options.length === 0)) {
        this.addIssue(cmd, 'missing_enum_options',
          `Parameter '${param.name}' is enumeration but has no options`,
          'warning');
      }
    }
  }

  auditFile(filePath) {
    console.log(`\nAuditing: ${path.basename(filePath)}`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    let data;
    
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.error(`  Failed to parse JSON: ${e.message}`);
      return;
    }

    // Extract commands from various JSON structures
    let commands = [];
    
    if (Array.isArray(data)) {
      // Direct array of commands
      commands = data;
    } else if (data.commands && Array.isArray(data.commands)) {
      // { commands: [...] }
      commands = data.commands;
    } else if (data.groups && typeof data.groups === 'object') {
      // MSO format: { groups: { GroupName: { commands: [...] }, ... } }
      for (const groupName of Object.keys(data.groups)) {
        const group = data.groups[groupName];
        if (group.commands && Array.isArray(group.commands)) {
          commands.push(...group.commands);
        }
      }
    } else if (typeof data === 'object') {
      // Try to find any array of objects with 'scpi' property
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0 && data[key][0].scpi) {
          commands.push(...data[key]);
        }
      }
    }

    if (commands.length === 0) {
      console.log('  No commands found (may be different format)');
      return;
    }

    console.log(`  Found ${commands.length} commands`);
    this.stats.totalCommands += commands.length;

    const commandsWithIssues = new Set();
    
    for (const cmd of commands) {
      if (!cmd.scpi) continue; // Skip invalid entries
      const beforeCount = this.issues.length;
      this.auditCommand(cmd);
      if (this.issues.length > beforeCount) {
        commandsWithIssues.add(cmd.scpi);
      }
    }

    this.stats.commandsWithIssues += commandsWithIssues.size;
    console.log(`  Commands with issues: ${commandsWithIssues.size}`);
  }

  generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('AUDIT REPORT');
    console.log('='.repeat(80));
    
    console.log(`\nTotal commands audited: ${this.stats.totalCommands}`);
    console.log(`Commands with issues: ${this.stats.commandsWithIssues}`);
    console.log(`Total issues found: ${this.issues.length}`);
    
    console.log('\nIssues by type:');
    for (const [type, count] of Object.entries(this.stats.issuesByType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Group issues by type
    const byType = {};
    for (const issue of this.issues) {
      if (!byType[issue.type]) byType[issue.type] = [];
      byType[issue.type].push(issue);
    }

    // Show sample issues for each type
    console.log('\n' + '-'.repeat(80));
    console.log('SAMPLE ISSUES BY TYPE');
    console.log('-'.repeat(80));

    for (const [type, issues] of Object.entries(byType)) {
      console.log(`\n## ${type} (${issues.length} total)`);
      
      // Show first 5 examples
      const samples = issues.slice(0, 5);
      for (const issue of samples) {
        console.log(`  - ${issue.scpi}`);
        console.log(`    ${issue.message}`);
      }
      if (issues.length > 5) {
        console.log(`  ... and ${issues.length - 5} more`);
      }
    }

    // Write full report to file
    const reportPath = path.join(__dirname, 'audit-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      stats: this.stats,
      issues: this.issues
    }, null, 2));
    console.log(`\nFull report written to: ${reportPath}`);

    // Write issues CSV for easy review
    const csvPath = path.join(__dirname, 'audit-issues.csv');
    const csvLines = ['SCPI,Type,Severity,Message'];
    for (const issue of this.issues) {
      csvLines.push(`"${issue.scpi}","${issue.type}","${issue.severity}","${issue.message.replace(/"/g, '""')}"`);
    }
    fs.writeFileSync(csvPath, csvLines.join('\n'));
    console.log(`CSV report written to: ${csvPath}`);
  }
}

// Main execution
const auditor = new CommandAuditor();

// Find command files
const commandsDir = path.join(__dirname, '..', 'public', 'commands');
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.json'));

console.log('SCPI Command Data Quality Audit');
console.log('================================');
console.log(`Found ${files.length} command files`);

for (const file of files) {
  auditor.auditFile(path.join(commandsDir, file));
}

auditor.generateReport();
