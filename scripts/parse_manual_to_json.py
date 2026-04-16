#!/usr/bin/env python3
"""
Parse MSO Programmer Manual text file and extract all SCPI commands
into structured JSON format matching our template.

Usage: python parse_manual_to_json.py
"""

import re
import json
from typing import Dict, List, Optional, Tuple
from pathlib import Path

# Command pattern - matches SCPI commands (may have <x> placeholders)
COMMAND_PATTERN = re.compile(r'^([A-Z][A-Za-z0-9<>:]*\??)(?:\s|$)')
GROUP_PATTERN = re.compile(r'^Group\s*$', re.IGNORECASE)
SYNTAX_PATTERN = re.compile(r'^Syntax\s*$', re.IGNORECASE)
ARGUMENTS_PATTERN = re.compile(r'^Arguments?\s*$', re.IGNORECASE)
EXAMPLES_PATTERN = re.compile(r'^Examples?\s*$', re.IGNORECASE)
CONDITIONS_PATTERN = re.compile(r'^Conditions?\s*$', re.IGNORECASE)

# Section headers that indicate new command groups
SECTION_HEADERS = [
    'Acquisition command group',
    'Act on event command group',
    'Bus command group',
    'Channel',
    'Cursor commands',
    'Data',
    'Display control command group',
    'Horizontal command group',
    'Math command group',
    'Measurement command group',
    'Save and Recall command group',
    'Search and Mark command group',
    'Trigger command group',
    'Waveform Transfer command group',
    'Vertical command group',
]

def normalize_command(command: str) -> str:
    """Normalize command string - remove leading colons, clean up."""
    command = command.strip()
    if command.startswith(':'):
        command = command[1:]
    return command

def extract_header(command: str) -> str:
    """Extract command header (before first space or ?)."""
    # Remove query marker for header
    header = command.split('?')[0].split()[0] if '?' in command else command.split()[0]
    return normalize_command(header)

def extract_mnemonics(header: str) -> List[str]:
    """Extract mnemonic components from header."""
    return [m for m in header.split(':') if m]

def detect_command_type(syntax: str) -> str:
    """Detect if command is 'set', 'query', or 'both'."""
    has_set = not syntax.strip().endswith('?')
    has_query = '?' in syntax
    if has_set and has_query:
        return 'both'
    elif has_query:
        return 'query'
    else:
        return 'set'

def parse_argument_type(arg_desc: str) -> Tuple[str, Dict]:
    """Parse argument description and determine type and valid values."""
    arg_desc = arg_desc.strip()
    
    # Check for numeric types
    if '<NR1>' in arg_desc or '<NR2>' in arg_desc or '<NR3>' in arg_desc:
        format_type = 'NR1' if '<NR1>' in arg_desc else ('NR2' if '<NR2>' in arg_desc else 'NR3')
        # Try to extract range
        range_match = re.search(r'range is ([\d.]+)\s*V?\s*to\s*([\d.]+)\s*V?', arg_desc, re.IGNORECASE)
        min_val = float(range_match.group(1)) if range_match else None
        max_val = float(range_match.group(2)) if range_match else None
        
        # Try to extract unit
        unit_match = re.search(r'(volts?|V|mV|samples?|acquisitions?)', arg_desc, re.IGNORECASE)
        unit = unit_match.group(1) if unit_match else None
        
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
    """Parse a single command entry from the text file.
    
    Returns: (command_dict, next_line_index) or None if not a valid command entry
    """
    if start_idx >= len(lines):
        return None
    
    # Find command name (should be at start_idx or shortly after)
    command_name = None
    desc_start = None
    
    for i in range(start_idx, min(start_idx + 10, len(lines))):
        line = lines[i].strip()
        if not line:
            continue
        
        # Check if this looks like a command
        match = COMMAND_PATTERN.match(line)
        if match and ':' in line and len(line) < 100:
            command_name = normalize_command(match.group(1))
            desc_start = i + 1
            break
    
    if not command_name:
        return None
    
    # Collect description (until we hit Group, Syntax, Arguments, Examples, or next command)
    description_lines = []
    i = desc_start
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        
        # Check for section markers
        if GROUP_PATTERN.match(line) or SYNTAX_PATTERN.match(line) or \
           ARGUMENTS_PATTERN.match(line) or EXAMPLES_PATTERN.match(line) or \
           CONDITIONS_PATTERN.match(line):
            break
        
        # Check for next command
        if COMMAND_PATTERN.match(line) and ':' in line and i > desc_start:
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
    
    # Look for Group, Syntax, Arguments, Examples sections
    section_start = i
    current_section = None
    
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
            i += 1
            continue
        
        if ARGUMENTS_PATTERN.match(line):
            current_section = 'arguments'
            i += 1
            continue
        
        if EXAMPLES_PATTERN.match(line):
            current_section = 'examples'
            i += 1
            continue
        
        # Check for next command (end of this entry)
        if COMMAND_PATTERN.match(line) and ':' in line and current_section:
            break
        
        # Process section content
        if current_section == 'conditions':
            conditions.append(line)
        elif current_section == 'syntax':
            # Syntax can be on one or multiple lines
            syntax_line = line
            if syntax_set is None:
                # Check if it has both set and query
                if '?' in syntax_line:
                    parts = syntax_line.split('?')
                    if len(parts) == 2:
                        syntax_set = parts[0].strip()
                        syntax_query = parts[1].strip() + '?'
                    else:
                        syntax_query = syntax_line
                else:
                    syntax_set = syntax_line
        elif current_section == 'arguments':
            # Arguments are usually descriptions of each argument
            if line and not line.startswith('B<x>') and '<x>' not in line:
                # This might be an argument description
                arg_name_match = re.search(r'^([A-Z<]+[>x]?)\s+is\s+', line, re.IGNORECASE)
                if arg_name_match:
                    arg_name = arg_name_match.group(1).lower().replace('<', '').replace('>', '').replace('x', '')
                    arg_desc = line
                    arg_type, valid_values = parse_argument_type(arg_desc)
                    arguments.append({
                        'name': arg_name or 'value',
                        'type': arg_type,
                        'required': True,
                        'position': len(arguments),
                        'description': arg_desc,
                        'validValues': valid_values
                    })
        elif current_section == 'examples':
            examples.append(line)
        
        i += 1
    
    # Build command dictionary
    header = extract_header(command_name)
    command_type = detect_command_type(syntax_set or syntax_query or command_name)
    
    # Generate ID from command
    cmd_id = header.lower().replace(':', '_').replace('<', '').replace('>', '').replace('?', '')
    
    command_dict = {
        'id': cmd_id,
        'category': group.lower().replace(' ', '_').replace('command_group', '').strip('_'),
        'scpi': command_name,
        'header': header,
        'mnemonics': extract_mnemonics(header),
        'commandType': command_type,
        'shortDescription': description.split('.')[0] if description else '',
        'description': description,
        'instruments': {
            'families': ['MSO4', 'MSO5', 'MSO6', 'MSO7'],
            'models': ['MSO4XB', 'MSO5XB', 'MSO6XB', 'MSO58LP', 'LPD64'],
            'exclusions': []
        },
        'arguments': arguments,
        'syntax': {
            'set': syntax_set,
            'query': syntax_query,
        } if syntax_set or syntax_query else None,
        'codeExamples': [],
        'relatedCommands': [],
        'commandGroup': group,
        'notes': conditions if conditions else None
    }
    
    # Parse examples into codeExamples format
    if examples:
        example_text = ' '.join(examples)
        # Try to extract example commands
        example_commands = re.findall(r'([A-Z][A-Za-z0-9<>:]*\s+[^?]+(?:\?)?)', example_text)
        for ex_cmd in example_commands[:2]:  # Limit to 2 examples
            ex_cmd = ex_cmd.strip()
            if ex_cmd:
                is_query = ex_cmd.endswith('?')
                result_desc = None
                if 'might return' in example_text.lower():
                    result_match = re.search(r'might return\s+([^,]+)', example_text, re.IGNORECASE)
                    if result_match:
                        result_desc = result_match.group(1).strip()
                
                command_dict['codeExamples'].append({
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
    
    # Find command groups
    while i < len(lines):
        line = lines[i].strip()
        
        # Check for section headers
        for section in SECTION_HEADERS:
            if section.lower() in line.lower() and len(line) < 100:
                current_group = section.replace(' command group', '').replace(' commands', '')
                print(f"Found section: {current_group}")
                break
        
        # Try to parse a command entry
        result = parse_command_entry(lines, i, current_group)
        if result:
            cmd_dict, next_idx = result
            if cmd_dict:
                commands.append(cmd_dict)
                print(f"  Parsed: {cmd_dict['header']}")
            i = next_idx
        else:
            i += 1
        
        # Progress indicator
        if i % 1000 == 0:
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
    output_file = project_root / 'public' / 'commands' / 'mso_commands_extracted.json'
    
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


