#!/usr/bin/env python3
"""
Fix corrupted examples in mso_commands_final.json

This script fixes two types of corruption:
1. Examples with description text instead of SCPI commands (e.g., "This command", "Sets or", "Queries")
2. Examples from wrong commands that got mixed in during extraction

The script preserves ALL commands - it only cleans up corrupted examples within each command.
"""

import json
import re
import os
import shutil
from datetime import datetime
from pathlib import Path


def get_command_header(scpi_command: str) -> str:
    """
    Extract the command header pattern from a SCPI command.
    Examples:
        "CH2:SV:STOPFrequency?" -> "CH:SV:STOPFrequency"
        "ACQuire:FASTAcq:PALEtte" -> "ACQuire:FASTAcq:PALEtte"
        "CH<x>:TERmination" -> "CH:TERmination"
    """
    # Remove query marker
    header = scpi_command.rstrip('?')
    # Remove channel/index numbers and placeholders
    header = re.sub(r'<[^>]+>', '', header)  # Remove <x>, <NR1>, etc.
    header = re.sub(r'\d+', '', header)      # Remove numbers
    # Normalize to uppercase for comparison
    return header.upper()


def is_corrupted_example(example_code: str, command_scpi: str, command_header: str = None) -> bool:
    """
    Check if an example is corrupted.
    
    Returns True if:
    - Example starts with description words
    - Example doesn't match the current command's pattern
    - Example is empty or just whitespace
    """
    if not example_code or not example_code.strip():
        return True
    
    code = example_code.strip()
    
    # Check for description text instead of SCPI commands
    description_starters = [
        'This command',
        'Sets or',
        'Queries',
        'Returns',
        'Specifies',
        'The command',
        'This query',
        'sets the',
        'queries the',
        'returns the',
    ]
    
    code_lower = code.lower()
    for starter in description_starters:
        if code_lower.startswith(starter.lower()):
            return True
    
    # Check if example contains description text embedded (e.g., "CH4:TERMINATION 50.0E+0 establishes 50 Ω")
    if ' establishes ' in code_lower or ' indicating ' in code_lower:
        # Check if the command header matches - if so, it might still be valid but with embedded description
        if command_header:
            example_header = get_command_header(code.split()[0] if code.split() else code)
            if example_header != command_header:
                return True
    
    # Check if example belongs to a different command
    if command_header:
        # Get the first word/command from the example
        first_part = code.split()[0] if code.split() else code
        first_part = first_part.split('?')[0]  # Remove query marker for comparison
        example_header = get_command_header(first_part)
        
        # If headers don't match, it's from a different command
        if example_header and command_header and example_header != command_header:
            # Allow for some flexibility - check if it's a related subcommand
            if not example_header.startswith(command_header) and not command_header.startswith(example_header):
                return True
    
    return False


def clean_examples(examples: list, command_scpi: str) -> list:
    """
    Clean a list of examples, removing corrupted ones.
    """
    if not examples:
        return examples if examples is not None else []
    
    command_header = get_command_header(command_scpi)
    cleaned = []
    
    for example in examples:
        if isinstance(example, dict):
            # Handle both formats:
            # 1. {"scpi": "...", "description": "..."}
            # 2. {"description": "...", "codeExamples": {"scpi": {"code": "..."}}}
            
            example_code = None
            
            if 'scpi' in example:
                example_code = example.get('scpi', '')
            elif 'codeExamples' in example:
                code_examples = example.get('codeExamples', {})
                if isinstance(code_examples, dict) and 'scpi' in code_examples:
                    scpi_obj = code_examples['scpi']
                    if isinstance(scpi_obj, dict):
                        example_code = scpi_obj.get('code', '')
                    else:
                        example_code = scpi_obj
            
            if example_code and not is_corrupted_example(example_code, command_scpi, command_header):
                cleaned.append(example)
            # If no example_code found but has description, keep it
            elif example_code is None and example.get('description'):
                cleaned.append(example)
    
    return cleaned


def fix_command(command: dict) -> dict:
    """
    Fix a single command by cleaning its examples.
    """
    scpi = command.get('scpi', '')
    
    # Clean main examples
    if 'examples' in command:
        command['examples'] = clean_examples(command['examples'], scpi)
    
    # Clean _manualEntry examples
    if '_manualEntry' in command and 'examples' in command['_manualEntry']:
        command['_manualEntry']['examples'] = clean_examples(
            command['_manualEntry']['examples'], scpi
        )
    
    return command


def fix_json_file(input_path: str, output_path: str = None):
    """
    Fix the entire JSON file.
    """
    if output_path is None:
        output_path = input_path
    
    print(f"Reading {input_path}...")
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Track statistics
    total_commands = 0
    total_examples_before = 0
    total_examples_after = 0
    commands_with_fixes = 0
    
    # Process each group
    groups = data.get('groups', {})
    for group_name, group_data in groups.items():
        commands = group_data.get('commands', [])
        
        for i, command in enumerate(commands):
            total_commands += 1
            
            # Count examples before (handle None values)
            examples_before = len(command.get('examples') or [])
            manual_examples_before = 0
            if '_manualEntry' in command:
                manual_examples_before = len(command['_manualEntry'].get('examples') or [])
            total_examples_before += examples_before + manual_examples_before
            
            # Fix the command
            fixed_command = fix_command(command)
            commands[i] = fixed_command
            
            # Count examples after (handle None values)
            examples_after = len(fixed_command.get('examples') or [])
            manual_examples_after = 0
            if '_manualEntry' in fixed_command:
                manual_examples_after = len(fixed_command['_manualEntry'].get('examples') or [])
            total_examples_after += examples_after + manual_examples_after
            
            # Track if any fixes were made
            if examples_before != examples_after or manual_examples_before != manual_examples_after:
                commands_with_fixes += 1
                print(f"  Fixed: {command.get('scpi', 'UNKNOWN')} - removed {(examples_before + manual_examples_before) - (examples_after + manual_examples_after)} corrupted example(s)")
    
    # Write the fixed JSON
    print(f"\nWriting fixed JSON to {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total commands processed: {total_commands}")
    print(f"Commands with fixes: {commands_with_fixes}")
    print(f"Examples before: {total_examples_before}")
    print(f"Examples after: {total_examples_after}")
    print(f"Corrupted examples removed: {total_examples_before - total_examples_after}")
    print(f"\nAll {total_commands} commands preserved!")
    
    return {
        'total_commands': total_commands,
        'commands_fixed': commands_with_fixes,
        'examples_removed': total_examples_before - total_examples_after
    }


def main():
    # Paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    input_file = project_root / 'public' / 'commands' / 'mso_commands_final.json'
    
    # Create backup with timestamp
    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    backup_file = project_root / 'public' / 'commands' / f'mso_commands_final_backup_{timestamp}.json'
    
    print(f"Creating backup: {backup_file}")
    shutil.copy(input_file, backup_file)
    
    # Fix the JSON
    stats = fix_json_file(str(input_file))
    
    print(f"\nBackup saved to: {backup_file}")
    print("Original file has been updated with fixes.")


if __name__ == '__main__':
    main()

