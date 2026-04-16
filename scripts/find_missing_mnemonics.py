#!/usr/bin/env python3
"""Find mnemonic patterns that might not be detected by the parameter detector"""

import json
import re
from collections import defaultdict

def find_missing_mnemonics(file_path):
    """Find all mnemonic patterns with <x> that might not be handled"""
    
    print(f"Reading {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Known patterns that are handled
    known_patterns = {
        'CH<x>', 'REF<x>', 'MATH<x>', 'B<x>', 'BUS<x>', 'MEAS<x>',
        'CURSOR<x>', 'ZOOM<x>', 'SEARCH<x>', 'PLOT<x>', 'WAVEView<x>',
        'PLOTView<x>', 'POWer<x>', 'HISTogram<x>', 'CALLOUT<x>',
        'MASK<x>', 'D<x>', 'AREA<x>', 'MATHFFTView<x>', 'REFFFTView<x>',
        'SPECView<x>', 'SOUrce<x>', 'GSOurce<x>'
    }
    
    # Also check with suffixes
    known_with_suffix = set()
    for pattern in known_patterns:
        known_with_suffix.add(pattern)
        known_with_suffix.add(pattern + '_DALL')
        known_with_suffix.add(pattern + '_D<x>')
        known_with_suffix.add(pattern + '_D0')
        known_with_suffix.add(pattern + '_D1')
    
    all_patterns = defaultdict(set)
    potentially_missing = []
    
    if 'groups' in data:
        for group_name, group_data in data['groups'].items():
            if 'commands' in group_data:
                for item in group_data['commands']:
                    if isinstance(item, dict):
                        scpi = item.get('scpi', '')
                        if not scpi or '<x>' not in scpi:
                            continue
                        
                        # Split by colon to get mnemonics
                        mnemonics = scpi.split(':')
                        for mnemonic in mnemonics:
                            if '<x>' in mnemonic:
                                # Normalize to uppercase for comparison
                                normalized = mnemonic.upper()
                                
                                # Check if this pattern is known
                                is_known = False
                                for known in known_patterns:
                                    if normalized.startswith(known.upper().replace('<X>', '')):
                                        # Check if it matches with or without suffix
                                        base_pattern = known.upper()
                                        if normalized == base_pattern or \
                                           normalized.startswith(base_pattern.replace('<X>', '')):
                                            is_known = True
                                            break
                                
                                if not is_known:
                                    # Check if it's a variation we should know about
                                    base_match = re.match(r'^([A-Z]+)(<X>|\d+)', normalized)
                                    if base_match:
                                        base = base_match.group(1)
                                        all_patterns[base].add(mnemonic)
                                        potentially_missing.append({
                                            'pattern': mnemonic,
                                            'scpi': scpi,
                                            'group': group_name,
                                            'base': base
                                        })
    
    print(f"\n=== Potentially Missing Mnemonic Patterns ===\n")
    print(f"Total unique patterns found: {len(set(p['pattern'] for p in potentially_missing))}\n")
    
    # Group by base
    by_base = defaultdict(list)
    for item in potentially_missing:
        by_base[item['base']].append(item)
    
    for base in sorted(by_base.keys()):
        patterns = set(p['pattern'] for p in by_base[base])
        print(f"{base}:")
        for pattern in sorted(patterns):
            count = sum(1 for p in potentially_missing if p['pattern'] == pattern)
            print(f"  {pattern} ({count} commands)")
        print()
    
    # Show some examples
    print("\n=== Example Commands with Missing Patterns ===\n")
    seen_patterns = set()
    for item in potentially_missing[:20]:  # Show first 20
        if item['pattern'] not in seen_patterns:
            print(f"{item['pattern']}:")
            print(f"  Command: {item['scpi']}")
            print(f"  Group: {item['group']}")
            print()
            seen_patterns.add(item['pattern'])
    
    return potentially_missing

if __name__ == '__main__':
    missing = find_missing_mnemonics('public/commands/mso_commands_final.json')
    print(f"\nTotal commands with potentially missing patterns: {len(missing)}")






