#!/usr/bin/env python3
"""
Cleanup script for mso_commands.json
Removes invalid entries, fixes data issues, and validates structure.
"""

import json
import re
from pathlib import Path

# Patterns for validation
CMD_PATTERN = re.compile(r'^[:*]?[A-Za-z]+(?::[A-Za-z0-9<>]+)+(?:\?)?$|^[*][A-Z]{2,}\??$')
VALID_GROUPS = {
    'Acquisition', 'Act On Event', 'AFG', 'Alias', 'Bus', 'Calibration',
    'Callout', 'Cursor', 'Digital', 'Digital Power Management (DPM)',
    'Display control', 'DVM', 'Ethernet', 'File system', 'Histogram',
    'History', 'Horizontal', 'Inverter Motors and Drive Analysis (IMDA)',
    'Mask', 'Math', 'Measurement', 'Miscellaneous', 'Plot', 'Power',
    'Save and Recall', 'Save on', 'Search and Mark', 'Self Test',
    'Spectrum view', 'Status and Error', 'Trigger', 'Vertical',
    'Waveform Transfer', 'Wide Band Gap Analysis (WBG)', 'Zoom'
}

def is_valid_command(cmd):
    """Check if command has valid structure."""
    if not cmd.get('scpi'):
        return False
    
    scpi = cmd['scpi'].strip()
    if not CMD_PATTERN.match(scpi):
        return False
    
    return True

def clean_description(desc):
    """Clean up description text."""
    if not desc:
        return None
    
    desc = desc.strip()
    
    # Remove descriptions that are clearly wrong (table of contents, etc.)
    bad_patterns = [
        r'^Command\.+1903',  # Page numbers
        r'^Queues\.+1904',
        r'^Contents$',
        r'^Preface$',
        r'^Getting Started$',
        r'^Command syntax$',
        r'^Command groups$',
        r'^Commands listed in alphabetical order$',
        r'^Status and events$',
        r'^Appendices$',
        r'^Glossary$',
        r'^Appendix [A-E]:',
        r'^Table \d+:',
        r'^Symbol Meaning$',
        r'^Legacy oscilloscope command',
        r'^New command alias$',
    ]
    
    for pattern in bad_patterns:
        if re.match(pattern, desc, re.IGNORECASE):
            return None
    
    # Remove descriptions that contain these bad patterns anywhere
    if any(phrase in desc for phrase in [
        'Command syntax\nClearing the instrument',
        'Command entry\nThe following rules',
        'Abbreviating\nYou can abbreviate',
        'Concatenating\nYou can concatenate',
        'When concatenating commands',
        'Here are some invalid concatenations',
        'If the header is on:',
        'If the header is off:',
        'Table 4: Comparison',
        'Table 2: Symbols',
        'Table 3: Command message',
    ]):
        return None
    
    # Remove descriptions that are just query commands or syntax
    first_word = desc.split()[0] if desc.split() else ''
    if desc.startswith((':', '*')) and ':' in desc and len(desc) < 100:
        # Might be a command, not a description
        if CMD_PATTERN.match(first_word):
            return None
    
    # Remove descriptions that start with numbers followed by commands (example text)
    if re.match(r'^\d+[;:]', desc):
        return None
    
    # Remove descriptions that are clearly concatenation examples
    if any(pattern in desc for pattern in [
        ';:ACQuire', ';:DISplay', ';:TRIGger',
        'NORMal;:ACQuire', 'ENVelope;:ACQuire',
        'DOTsonly OFF;ACQuire', 'TEMPerature;FASTAcq',
        '1;*OPC', 'no colon before', 'extra colon before'
    ]):
        return None
    
    # Remove descriptions that are too long (likely captured wrong content)
    if len(desc) > 1000:
        # Try to extract first meaningful sentence
        sentences = desc.split('.')
        for sentence in sentences:
            sentence = sentence.strip()
            # Skip sentences that are clearly wrong
            if any(bad in sentence for bad in ['Command syntax', 'Table', 'Symbol']):
                continue
            if len(sentence) > 30 and len(sentence) < 500:
                return sentence + '.'
        return None
    
    # Remove very short descriptions that are likely wrong
    if len(desc) < 10:
        return None
    
    return desc

def clean_syntax(syntax):
    """Clean up syntax array."""
    if not syntax:
        return None
    
    if isinstance(syntax, list):
        cleaned = []
        for item in syntax:
            if isinstance(item, str):
                item = item.strip()
                # Remove non-syntax entries
                if item and not item.startswith('Commands listed'):
                    if CMD_PATTERN.match(item.split()[0] if item.split() else ''):
                        cleaned.append(item)
                    elif '<' in item or '{' in item:  # Has argument syntax
                        cleaned.append(item)
        
        return cleaned if cleaned else None
    
    return None

def clean_related_commands(related):
    """Clean up related commands."""
    if not related:
        return None
    
    if isinstance(related, list):
        cleaned = []
        for cmd in related:
            if isinstance(cmd, str):
                cmd = cmd.strip()
                # Only keep actual commands
                if CMD_PATTERN.match(cmd):
                    cleaned.append(cmd)
                elif cmd.lower() in ['commands', 'command']:
                    # Skip generic words
                    continue
        
        return cleaned if cleaned else None
    
    return None

def clean_arguments(args):
    """Clean up arguments text."""
    if not args:
        return None
    
    if isinstance(args, str):
        args = args.strip()
        # Remove arguments that are clearly wrong (general syntax explanations)
        if 'Command syntax' in args or 'Table' in args[:50]:
            return None
        
        # Remove arguments that are too long (likely captured wrong section)
        if len(args) > 2000:
            return None
        
        return args if args else None
    
    return None

def clean_examples(examples):
    """Clean up examples text."""
    if not examples:
        return None
    
    if isinstance(examples, str):
        examples = examples.strip()
        # Remove examples that are clearly wrong
        if 'Command syntax' in examples or 'Getting Started' in examples:
            return None
        
        # Remove examples that are too long
        if len(examples) > 2000:
            return None
        
        return examples if examples else None
    
    return None

def validate_group(group):
    """Validate group name."""
    if not group:
        return None
    
    group = group.strip()
    
    # Check if it's a valid group name
    for valid_group in VALID_GROUPS:
        if valid_group.lower() in group.lower() or group.lower() in valid_group.lower():
            return valid_group
    
    # If it's close to a valid group, return it
    if len(group) > 3 and len(group) < 100:
        return group
    
    return None

def cleanup_command(cmd):
    """Clean up a single command entry."""
    if not is_valid_command(cmd):
        return None
    
    cleaned = {
        'scpi': cmd['scpi'].strip(),
        'description': clean_description(cmd.get('description')),
        'conditions': cmd.get('conditions') if cmd.get('conditions') else None,
        'group': validate_group(cmd.get('group')),
        'syntax': clean_syntax(cmd.get('syntax')),
        'relatedCommands': clean_related_commands(cmd.get('relatedCommands')),
        'arguments': clean_arguments(cmd.get('arguments')),
        'examples': clean_examples(cmd.get('examples'))
    }
    
    # Remove commands that have no useful data
    # At minimum, need description OR (group AND syntax)
    has_minimal_data = (
        cleaned['description'] or
        (cleaned['group'] and cleaned['syntax'])
    )
    
    if not has_minimal_data:
        return None
    
    return cleaned

def main():
    input_file = Path('public/commands/mso_commands.json')
    output_file = Path('public/commands/mso_commands_cleaned.json')
    
    print(f"Loading {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"Original commands: {len(data.get('commands', []))}")
    
    # Clean up commands
    cleaned_commands = []
    removed_count = 0
    
    for cmd in data.get('commands', []):
        cleaned = cleanup_command(cmd)
        if cleaned:
            cleaned_commands.append(cleaned)
        else:
            removed_count += 1
    
    print(f"Cleaned commands: {len(cleaned_commands)}")
    print(f"Removed commands: {removed_count}")
    
    # Create output structure
    output_data = {
        'category': data.get('category', 'All'),
        'instruments': data.get('instruments', ['MSO4', 'MSO5', 'MSO6', 'MSO7']),
        'commands': cleaned_commands
    }
    
    # Statistics
    with_group = sum(1 for c in cleaned_commands if c.get('group'))
    with_syntax = sum(1 for c in cleaned_commands if c.get('syntax'))
    with_description = sum(1 for c in cleaned_commands if c.get('description'))
    with_examples = sum(1 for c in cleaned_commands if c.get('examples'))
    with_arguments = sum(1 for c in cleaned_commands if c.get('arguments'))
    with_related = sum(1 for c in cleaned_commands if c.get('relatedCommands'))
    
    print(f"\nStatistics:")
    print(f"  Commands with group: {with_group}")
    print(f"  Commands with syntax: {with_syntax}")
    print(f"  Commands with description: {with_description}")
    print(f"  Commands with examples: {with_examples}")
    print(f"  Commands with arguments: {with_arguments}")
    print(f"  Commands with relatedCommands: {with_related}")
    
    # Save cleaned file
    print(f"\nSaving to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print("Cleanup complete!")
    print(f"\nOutput saved to: {output_file}")

if __name__ == '__main__':
    main()

