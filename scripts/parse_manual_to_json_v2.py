#!/usr/bin/env python3
"""
Improved Parser for MSO Programmer Manual text file
Extracts all SCPI commands into structured JSON format.

This version:
- Better command detection (filters false positives)
- Improved argument parsing
- Better example extraction
- Section/group detection
"""

import re
import json
from typing import Dict, List, Optional, Tuple
from pathlib import Path

# Patterns
COMMAND_PATTERN = re.compile(r'^([A-Z][A-Za-z0-9<>:]*\??)(?:\s|$)')
VALID_COMMAND_PATTERN = re.compile(r'^[A-Z][A-Za-z0-9<>:]+:[A-Za-z0-9<>:]+')  # Must have at least one colon
INVALID_HEADERS = {'Syntax', 'Arguments', 'Examples', 'Group', 'Conditions', 'Related', 
                   'Note', 'Appendix', 'Table', 'Command', 'Description', 'Figure',
                   'There', 'Most', 'With', 'An', 'The', 'SET', 'FACtory', 'SAME',
                   'RATed', 'PPOWer', 'EARCH', 'TIMe', 'VISual', 'DATa', 'CURVe',
                   'WFMOUTPRE', 'RF', 'SV'}

GROUP_PATTERN = re.compile(r'^Group\s*$', re.IGNORECASE)
SYNTAX_PATTERN = re.compile(r'^Syntax\s*$', re.IGNORECASE)
ARGUMENTS_PATTERN = re.compile(r'^Arguments?\s*$', re.IGNORECASE)
EXAMPLES_PATTERN = re.compile(r'^Examples?\s*$', re.IGNORECASE)
CONDITIONS_PATTERN = re.compile(r'^Conditions?\s*$', re.IGNORECASE)
RELATED_PATTERN = re.compile(r'^Related\s*$', re.IGNORECASE)
NOTE_PATTERN = re.compile(r'^Note:?\s*$', re.IGNORECASE)

# Section headers
SECTION_HEADERS = [
    'Acquisition command group',
    'Act on event command group',
    'AFG Command Group',
    'Alias command group',
    'Bus command group',
    'Calibration command group',
    'Callout command group',
    'Cursor commands',
    'Digital command group',
    'Digital Power Management (DPM) command group',
    'Display control command group',
    'DVM command group',
    'Ethernet command group',
    'File system command group',
    'Histogram group',
    'History group',
    'Horizontal command group',
    'Inverter Motors and Drive Analysis (IMDA) Group',
    'Mask command group',
    'Math command group',
    'Measurement command group',
    'Miscellaneous command group',
    'Plot command group',
    'Power command group',
    'Save and Recall command group',
    'Save on command group',
    'Search and Mark command group',
    'Self Test command group',
    'Spectrum view command group',
    'Status and Error command group',
    'Trigger command group',
    'Vertical command group',
    'Waveform Transfer command group',
    'Wide Band Gap Analysis (WBG) command group',
    'Zoom command group',
]

def normalize_command(command: str) -> str:
    """Normalize command string."""
    command = command.strip()
    if command.startswith(':'):
        command = command[1:]
    return command

def extract_header(command: str) -> str:
    """Extract command header (before first space or ?)."""
    header = command.split('?')[0].split()[0] if '?' in command else command.split()[0]
    return normalize_command(header)

def extract_mnemonics(header: str) -> List[str]:
    """Extract mnemonic components from header."""
    return [m for m in header.split(':') if m]

def detect_command_type(syntax_set: Optional[str], syntax_query: Optional[str]) -> str:
    """Detect if command is 'set', 'query', or 'both'."""
    has_set = syntax_set is not None and syntax_set.strip()
    has_query = syntax_query is not None and syntax_query.strip()
    if has_set and has_query:
        return 'both'
    elif has_query:
        return 'query'
    elif has_set:
        return 'set'
    else:
        return 'both'  # Default assumption

def is_valid_command(header: str) -> bool:
    """Check if this looks like a valid SCPI command."""
    if not header or len(header) < 3:
        return False
    if header in INVALID_HEADERS:
        return False
    if not VALID_COMMAND_PATTERN.match(header):
        return False
    # Must have at least one colon (except * commands)
    if ':' not in header and not header.startswith('*'):
        return False
    # Filter out common false positives
    if header.lower() in ['syntax', 'arguments', 'examples', 'group', 'related', 'note']:
        return False
    return True

def parse_argument_description(arg_desc: str) -> Tuple[str, Dict]:
    """Parse argument description and determine type and valid values."""
    arg_desc = arg_desc.strip()
    
    # Check for numeric types (NR1, NR2, NR3)
    nr_match = re.search(r'<NR([123])>', arg_desc)
    if nr_match:
        format_type = f'NR{nr_match.group(1)}'
        # Try to extract range
        range_match = re.search(r'range is ([\d.E+-]+)\s*(?:V|volts?|mV|samples?|acquisitions?)?\s*to\s*([\d.E+-]+)\s*(?:V|volts?|mV|samples?|acquisitions?)?', arg_desc, re.IGNORECASE)
        min_val = float(range_match.group(1)) if range_match else None
        max_val = float(range_match.group(2)) if range_match else None
        
        # Try to extract unit
        unit_match = re.search(r'(volts?|V|mV|samples?|acquisitions?|seconds?|Hz)', arg_desc, re.IGNORECASE)
        unit = unit_match.group(1).lower() if unit_match else None
        
        return 'numeric', {
            'type': 'numeric',
            'format': format_type,
            'min': min_val,
            'max': max_val,
            'unit': unit
        }
    
    # Check for mnemonic types (CH<x>, REF<x>, MATH<x>, etc.)
    if '<x>' in arg_desc or re.search(r'CH\d+|REF\d+|MATH\d+|MEAS\d+|B\d+', arg_desc):
        mnemonic_type = None
        if 'channel' in arg_desc.lower() or 'CH' in arg_desc:
            mnemonic_type = 'channel'
        elif 'reference' in arg_desc.lower() or 'REF' in arg_desc:
            mnemonic_type = 'reference'
        elif 'math' in arg_desc.lower() or 'MATH' in arg_desc:
            mnemonic_type = 'math'
        elif 'bus' in arg_desc.lower() or 'B<' in arg_desc:
            mnemonic_type = 'bus'
        elif 'measurement' in arg_desc.lower() or 'MEAS' in arg_desc:
            mnemonic_type = 'measurement'
        
        # Extract range if available
        range_info = {}
        if mnemonic_type == 'channel':
            range_info = {'channels': {'min': 1, 'max': 4}}
        elif mnemonic_type == 'reference':
            range_info = {'references': {'min': 1, 'max': 4}}
        elif mnemonic_type == 'math':
            range_info = {'math': {'min': 1, 'max': 4}}
        elif mnemonic_type == 'bus':
            range_info = {'bus': {'min': 1, 'max': 8}}
        elif mnemonic_type == 'measurement':
            range_info = {'measurements': {'min': 1, 'max': 8}}
        
        pattern = None
        if mnemonic_type == 'channel':
            pattern = 'CH<x>'
        elif mnemonic_type == 'reference':
            pattern = 'REF<x>'
        elif mnemonic_type == 'math':
            pattern = 'MATH<x>'
        elif mnemonic_type == 'bus':
            pattern = 'B<x>'
        elif mnemonic_type == 'measurement':
            pattern = 'MEAS<x>'
        
        return 'mnemonic', {
            'type': 'mnemonic_range',
            'pattern': pattern,
            'range': range_info,
            'mnemonicType': mnemonic_type
        }
    
    # Check for enumeration (options in braces or listed)
    enum_match = re.search(r'\{([^}]+)\}', arg_desc)
    if enum_match:
        options = [opt.strip() for opt in enum_match.group(1).split('|')]
        return 'enumeration', {
            'type': 'enumeration',
            'values': options,
            'caseSensitive': False
        }
    
    # Default to string
    return 'quoted_string', {
        'type': 'quoted_string'
    }

def parse_command_entry(lines: List[str], start_idx: int, current_group: str) -> Optional[Tuple[Dict, int]]:
    """Parse a single command entry from the text file."""
    if start_idx >= len(lines):
        return None
    
    # Find command name
    command_name = None
    desc_start = None
    
    for i in range(start_idx, min(start_idx + 15, len(lines))):
        line = lines[i].strip()
        if not line:
            continue
        
        # Check if this looks like a command
        match = COMMAND_PATTERN.match(line)
        if match:
            potential_cmd = normalize_command(match.group(1))
            header = extract_header(potential_cmd)
            
            # Validate it's a real command
            if is_valid_command(header) and len(line) < 150:
                command_name = potential_cmd
                desc_start = i + 1
                break
    
    if not command_name:
        return None
    
    header = extract_header(command_name)
    
    # Collect description (until we hit section markers or next command)
    description_lines = []
    i = desc_start
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        
        # Check for section markers
        if (GROUP_PATTERN.match(line) or SYNTAX_PATTERN.match(line) or 
            ARGUMENTS_PATTERN.match(line) or EXAMPLES_PATTERN.match(line) or 
            CONDITIONS_PATTERN.match(line) or RELATED_PATTERN.match(line) or
            NOTE_PATTERN.match(line)):
            break
        
        # Check for next command
        match = COMMAND_PATTERN.match(line)
        if match:
            next_header = extract_header(normalize_command(match.group(1)))
            if is_valid_command(next_header) and i > desc_start:
                break
        
        description_lines.append(line)
        i += 1
    
    description = ' '.join(description_lines).strip()
    
    # Parse sections
    conditions = []
    group = current_group
    syntax_set = None
    syntax_query = None
    arguments = []
    examples = []
    notes = []
    related = []
    
    # Look for Group, Syntax, Arguments, Examples sections
    current_section = None
    syntax_lines = []
    arg_lines = []
    example_lines = []
    
    while i < len(lines):
        line = lines[i].strip()
        
        if not line:
            i += 1
            continue
        
        # Check for section headers
        if GROUP_PATTERN.match(line):
            current_section = 'group'
            i += 1
            if i < len(lines):
                group = lines[i].strip()
                i += 1
            continue
        
        if CONDITIONS_PATTERN.match(line):
            current_section = 'conditions'
            i += 1
            continue
        
        if SYNTAX_PATTERN.match(line):
            current_section = 'syntax'
            syntax_lines = []
            i += 1
            continue
        
        if ARGUMENTS_PATTERN.match(line):
            current_section = 'arguments'
            arg_lines = []
            i += 1
            continue
        
        if EXAMPLES_PATTERN.match(line):
            current_section = 'examples'
            example_lines = []
            i += 1
            continue
        
        if RELATED_PATTERN.match(line):
            current_section = 'related'
            i += 1
            continue
        
        if NOTE_PATTERN.match(line):
            current_section = 'notes'
            i += 1
            continue
        
        # Check for next command (end of this entry)
        match = COMMAND_PATTERN.match(line)
        if match:
            next_header = extract_header(normalize_command(match.group(1)))
            if is_valid_command(next_header) and current_section:
                break
        
        # Process section content
        if current_section == 'conditions':
            conditions.append(line)
        elif current_section == 'syntax':
            syntax_lines.append(line)
        elif current_section == 'arguments':
            arg_lines.append(line)
        elif current_section == 'examples':
            example_lines.append(line)
        elif current_section == 'notes':
            notes.append(line)
        elif current_section == 'related':
            related.append(line)
        
        i += 1
    
    # Process syntax
    if syntax_lines:
        syntax_text = ' '.join(syntax_lines)
        # Split set and query forms
        if '?' in syntax_text:
            parts = re.split(r'\s+([A-Z][A-Za-z0-9<>:]*\?)', syntax_text)
            if len(parts) >= 3:
                syntax_set = parts[0].strip()
                syntax_query = parts[1].strip() if len(parts) > 1 else None
            else:
                # Try simpler split
                if '?' in syntax_text:
                    idx = syntax_text.find('?')
                    syntax_query = syntax_text[:idx+1].strip()
                    syntax_set = syntax_text[idx+1:].strip() if len(syntax_text) > idx+1 else None
        else:
            syntax_set = syntax_text.strip()
    
    # Process arguments
    if arg_lines:
        arg_text = ' '.join(arg_lines)
        # Look for argument definitions
        # Pattern: <NRx> is... or B<x> is... or CH<x> specifies...
        arg_matches = re.finditer(r'([A-Z<]+[>x]?|B<x>|CH<x>|REF<x>|MATH<x>|MEAS<x>)\s+is\s+([^\.]+)', arg_text, re.IGNORECASE)
        for idx, match in enumerate(arg_matches):
            arg_name = match.group(1).lower().replace('<', '').replace('>', '').replace('x', '')
            arg_desc = match.group(2).strip()
            
            if not arg_name:
                arg_name = f'arg{idx}'
            
            arg_type, valid_values = parse_argument_description(arg_desc)
            arguments.append({
                'name': arg_name or 'value',
                'type': arg_type,
                'required': True,
                'position': len(arguments),
                'description': arg_desc,
                'validValues': valid_values
            })
    
    # Process examples
    if example_lines:
        example_text = ' '.join(example_lines)
        # Extract example commands
        # Look for patterns like "COMMAND value" or "COMMAND?" or "COMMAND? might return..."
        example_patterns = [
            r'([A-Z][A-Za-z0-9<>:]+(?:\s+[^\s]+)?\??)',
            r'([A-Z][A-Za-z0-9<>:]+(?:\s+[A-Z0-9<>]+)?\??)\s+might return',
        ]
        
        found_examples = []
        for pattern in example_patterns:
            matches = re.finditer(pattern, example_text)
            for match in matches:
                ex_cmd = match.group(1).strip()
                if is_valid_command(extract_header(ex_cmd)) and ex_cmd not in found_examples:
                    found_examples.append(ex_cmd)
                    if len(found_examples) >= 3:  # Limit to 3 examples
                        break
        
        for ex_cmd in found_examples[:3]:
            is_query = ex_cmd.endswith('?')
            result_desc = None
            
            # Try to find result description
            result_match = re.search(rf'{re.escape(ex_cmd)}\s+might return\s+([^,\.]+)', example_text, re.IGNORECASE)
            if result_match:
                result_desc = result_match.group(1).strip()
            
            examples.append({
                'description': f"{'Query' if is_query else 'Set'} {header}",
                'codeExamples': {
                    'scpi': {
                        'code': ex_cmd,
                        'library': 'SCPI',
                        'description': f"Raw SCPI {'query' if is_query else 'command'}"
                    }
                },
                'result': result_desc,
                'resultDescription': result_desc
            })
    
    # Build command dictionary
    command_type = detect_command_type(syntax_set, syntax_query)
    
    # Generate ID from command
    cmd_id = header.lower().replace(':', '_').replace('<', '').replace('>', '').replace('?', '').replace('*', 'star')
    
    command_dict = {
        'id': cmd_id,
        'category': group.lower().replace(' ', '_').replace('command_group', '').replace('commands', '').strip('_') or 'miscellaneous',
        'scpi': command_name,
        'header': header,
        'mnemonics': extract_mnemonics(header),
        'commandType': command_type,
        'shortDescription': description.split('.')[0][:100] if description else '',
        'description': description[:500] if description else '',
        'instruments': {
            'families': ['MSO4', 'MSO5', 'MSO6', 'MSO7'],
            'models': ['MSO4XB', 'MSO5XB', 'MSO6XB', 'MSO58LP', 'LPD64'],
            'exclusions': []
        },
        'arguments': arguments if arguments else None,
        'syntax': {
            'set': syntax_set,
            'query': syntax_query,
        } if syntax_set or syntax_query else None,
        'codeExamples': examples if examples else None,
        'relatedCommands': related[:10] if related else None,
        'commandGroup': group,
        'notes': conditions + notes if (conditions or notes) else None
    }
    
    return command_dict, i

def parse_manual_file(file_path: str) -> Dict:
    """Parse the entire manual file and extract all commands."""
    print(f"Reading {file_path}...")
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    print(f"File has {len(lines)} lines")
    
    commands = []
    current_group = 'Miscellaneous'
    i = 0
    seen_commands = set()
    
    # Find command groups
    while i < len(lines):
        line = lines[i].strip()
        
        # Check for section headers
        for section in SECTION_HEADERS:
            if section.lower() in line.lower() and len(line) < 150:
                current_group = section.replace(' command group', '').replace(' commands', '').replace(' group', '')
                print(f"Found section: {current_group}")
                break
        
        # Try to parse a command entry
        result = parse_command_entry(lines, i, current_group)
        if result:
            cmd_dict, next_idx = result
            if cmd_dict and cmd_dict['header'] not in seen_commands:
                seen_commands.add(cmd_dict['header'])
                commands.append(cmd_dict)
                if len(commands) % 100 == 0:
                    print(f"  Parsed {len(commands)} commands...")
            i = next_idx
        else:
            i += 1
        
        # Progress indicator
        if i % 5000 == 0:
            print(f"  Processed {i}/{len(lines)} lines, found {len(commands)} commands...")
    
    print(f"\nTotal commands extracted: {len(commands)}")
    
    return {
        'version': '1.0.0',
        'manual': {
            'title': '4-5-6 Series MSO Programmer Manual',
            'file': '4-5-6_MSO_Programmer_077189801_RevA.pdf',
            'revision': 'A',
            'models': ['MSO4XB', 'MSO5XB', 'MSO58LP', 'MSO6XB', 'LPD64'],
            'families': ['MSO4', 'MSO5', 'MSO6', 'MSO7']
        },
        'categories': [
            {'id': 'acquisition', 'name': 'Acquisition', 'color': 'bg-blue-100 text-blue-700 border-blue-300'},
            {'id': 'channels', 'name': 'Channels', 'color': 'bg-cyan-100 text-cyan-700 border-cyan-300'},
            {'id': 'data', 'name': 'Data', 'color': 'bg-indigo-100 text-indigo-700 border-indigo-300'},
            {'id': 'display', 'name': 'Display', 'color': 'bg-pink-100 text-pink-700 border-pink-300'},
            {'id': 'trigger', 'name': 'Trigger', 'color': 'bg-purple-100 text-purple-700 border-purple-300'},
            {'id': 'measurement', 'name': 'Measurement', 'color': 'bg-green-100 text-green-700 border-green-300'},
            {'id': 'waveform', 'name': 'Waveform Transfer', 'color': 'bg-orange-100 text-orange-700 border-orange-300'},
            {'id': 'cursor', 'name': 'Cursor', 'color': 'bg-lime-100 text-lime-700 border-lime-300'},
            {'id': 'bus', 'name': 'Bus', 'color': 'bg-yellow-100 text-yellow-700 border-yellow-300'},
            {'id': 'horizontal', 'name': 'Horizontal', 'color': 'bg-red-100 text-red-700 border-red-300'},
            {'id': 'file_system', 'name': 'File System', 'color': 'bg-gray-100 text-gray-700 border-gray-300'},
            {'id': 'miscellaneous', 'name': 'Miscellaneous', 'color': 'bg-slate-100 text-slate-700 border-slate-300'}
        ],
        'commands': commands
    }

def main():
    """Main entry point."""
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    input_file = project_root / '4-5-6_MSO_Programmer_077189801_RevA.txt'
    output_file = project_root / 'public' / 'commands' / 'mso_commands_extracted_v2.json'
    
    if not input_file.exists():
        print(f"Error: Input file not found: {input_file}")
        return
    
    # Parse the manual
    data = parse_manual_file(str(input_file))
    
    # Write output
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"\nExtracted {len(data['commands'])} commands")
    print(f"Output written to: {output_file}")

if __name__ == '__main__':
    main()


