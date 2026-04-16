#!/usr/bin/env python3
"""
Validate and Cleanup Extracted Command JSON

This script:
1. Removes invalid entries (Syntax, Related, Note, etc.)
2. Validates command structure
3. Removes duplicates
4. Fixes common issues
5. Generates statistics
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Set
from collections import defaultdict

INVALID_HEADERS = {
    'Syntax', 'Arguments', 'Examples', 'Group', 'Conditions', 'Related',
    'Note', 'Appendix', 'Table', 'Command', 'Description', 'Figure',
    'There', 'Most', 'With', 'An', 'The', 'SET', 'FACtory', 'SAME',
    'RATed', 'PPOWer', 'EARCH', 'TIMe', 'VISual', 'DATa', 'CURVe',
    'WFMOUTPRE', 'RF', 'SV', 'Note:', 'Related:', 'Syntax:'
}

def is_valid_command(cmd: Dict) -> bool:
    """Check if command is valid."""
    header = cmd.get('header', '')
    
    # Must have valid header
    if not header or header in INVALID_HEADERS:
        return False
    
    # Must have colon (except * commands)
    if ':' not in header and not header.startswith('*'):
        return False
    
    # Must have minimum length
    if len(header) < 3:
        return False
    
    # Must match SCPI pattern
    if not re.match(r'^[A-Z*][A-Za-z0-9<>:*]+', header):
        return False
    
    return True

def clean_command(cmd: Dict) -> Dict:
    """Clean up a command entry."""
    # Remove None values from optional fields
    cleaned = {k: v for k, v in cmd.items() if v is not None}
    
    # Ensure required fields
    if 'id' not in cleaned:
        header = cleaned.get('header', '')
        cleaned['id'] = header.lower().replace(':', '_').replace('<', '').replace('>', '').replace('?', '').replace('*', 'star')
    
    # Clean description
    if 'description' in cleaned:
        cleaned['description'] = cleaned['description'].strip()[:1000]  # Limit length
    
    if 'shortDescription' in cleaned:
        cleaned['shortDescription'] = cleaned['shortDescription'].strip()[:200]
    
    # Ensure category is valid
    if 'category' not in cleaned or not cleaned['category']:
        cleaned['category'] = 'miscellaneous'
    
    # Clean arguments
    if 'arguments' in cleaned and cleaned['arguments']:
        cleaned['arguments'] = [arg for arg in cleaned['arguments'] if arg.get('name')]
    
    # Clean codeExamples
    if 'codeExamples' in cleaned and cleaned['codeExamples']:
        cleaned['codeExamples'] = [ex for ex in cleaned['codeExamples'] if ex.get('codeExamples')]
    
    return cleaned

def validate_and_cleanup(input_file: str, output_file: str):
    """Validate and cleanup the extracted JSON."""
    print(f"Loading {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    commands = data.get('commands', [])
    print(f"Original commands: {len(commands)}")
    
    # Filter invalid commands
    valid_commands = []
    invalid_commands = []
    seen_headers = set()
    duplicates = []
    
    for cmd in commands:
        header = cmd.get('header', '')
        
        # Check validity
        if not is_valid_command(cmd):
            invalid_commands.append(header)
            continue
        
        # Check duplicates
        if header in seen_headers:
            duplicates.append(header)
            continue
        
        seen_headers.add(header)
        
        # Clean and add
        cleaned = clean_command(cmd)
        valid_commands.append(cleaned)
    
    print(f"\nValidation Results:")
    print(f"  Valid commands: {len(valid_commands)}")
    print(f"  Invalid commands: {len(invalid_commands)}")
    print(f"  Duplicates removed: {len(duplicates)}")
    
    if invalid_commands:
        print(f"\nSample invalid headers: {invalid_commands[:10]}")
    
    if duplicates:
        print(f"\nSample duplicates: {duplicates[:10]}")
    
    # Statistics by category
    category_counts = defaultdict(int)
    for cmd in valid_commands:
        category_counts[cmd.get('category', 'unknown')] += 1
    
    print(f"\nCommands by category:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")
    
    # Update data
    data['commands'] = valid_commands
    
    # Write cleaned output
    print(f"\nWriting cleaned data to {output_file}...")
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"Done! Cleaned {len(valid_commands)} commands written to {output_file}")
    
    # Generate report
    report_file = output_path.parent / f"{output_path.stem}_report.txt"
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("Command Extraction Validation Report\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"Total commands extracted: {len(valid_commands)}\n")
        f.write(f"Invalid commands removed: {len(invalid_commands)}\n")
        f.write(f"Duplicates removed: {len(duplicates)}\n\n")
        f.write("Commands by category:\n")
        for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
            f.write(f"  {cat}: {count}\n")
        f.write("\n")
        if invalid_commands:
            f.write("Invalid headers found:\n")
            for header in invalid_commands[:50]:
                f.write(f"  - {header}\n")
    
    print(f"Report written to {report_file}")

def main():
    """Main entry point."""
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    input_file = project_root / 'public' / 'commands' / 'mso_commands_extracted.json'
    output_file = project_root / 'public' / 'commands' / 'mso_commands_cleaned.json'
    
    if not input_file.exists():
        print(f"Error: Input file not found: {input_file}")
        return
    
    validate_and_cleanup(str(input_file), str(output_file))

if __name__ == '__main__':
    main()


