#!/usr/bin/env python3
"""Scan JSON file for all mnemonic patterns with <x> placeholders"""

import json
import re
from collections import defaultdict

def scan_mnemonic_patterns(file_path):
    """Scan JSON file for all unique mnemonic patterns"""
    
    print(f"Reading {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    patterns = defaultdict(set)
    commands_with_patterns = []
    
    if 'groups' in data:
        for group_name, group_data in data['groups'].items():
            if 'commands' in group_data:
                for item in group_data['commands']:
                    if isinstance(item, dict):
                        scpi = item.get('scpi', '')
                        if not scpi:
                            continue
                        
                        # Split by colon to get mnemonics
                        mnemonics = scpi.split(':')
                        for mnemonic in mnemonics:
                            # Check for <x> placeholder
                            if '<x>' in mnemonic:
                                # Extract base pattern (e.g., CH<x>_DALL -> CH<x>_DALL)
                                patterns[mnemonic].add(scpi)
                                commands_with_patterns.append({
                                    'scpi': scpi,
                                    'mnemonic': mnemonic,
                                    'group': group_name
                                })
    
    print(f"\n=== Found {len(patterns)} unique mnemonic patterns with <x> ===\n")
    
    # Group by base pattern
    base_patterns = defaultdict(set)
    for pattern in patterns.keys():
        # Extract base (e.g., CH<x>_DALL -> CH<x>)
        base_match = re.match(r'^([A-Z]+)(<x>|\d+)', pattern, re.I)
        if base_match:
            base = base_match.group(1).upper()
            base_patterns[base].add(pattern)
        else:
            base_patterns['OTHER'].add(pattern)
    
    # Print grouped by base
    for base in sorted(base_patterns.keys()):
        print(f"\n{base}:")
        for pattern in sorted(base_patterns[base]):
            count = len(patterns[pattern])
            print(f"  {pattern} ({count} commands)")
    
    # Find patterns that might not be handled
    print("\n\n=== Patterns that might need special handling ===")
    special_patterns = []
    for pattern in sorted(patterns.keys()):
        # Check if it has suffixes or special formats
        if '_' in pattern or pattern not in [
            'CH<x>', 'REF<x>', 'MATH<x>', 'B<x>', 'BUS<x>', 
            'MEAS<x>', 'CURSOR<x>', 'ZOOM<x>', 'SEARCH<x>',
            'PLOT<x>', 'WAVEView<x>', 'PLOTView<x>', 'POWer<x>',
            'HISTogram<x>', 'CALLOUT<x>'
        ]:
            special_patterns.append(pattern)
    
    for pattern in sorted(special_patterns):
        print(f"  {pattern}")
    
    return patterns, commands_with_patterns

if __name__ == '__main__':
    patterns, commands = scan_mnemonic_patterns('public/commands/mso_commands_final.json')
    print(f"\n\nTotal commands with <x> patterns: {len(commands)}")

