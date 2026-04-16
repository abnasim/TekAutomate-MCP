#!/usr/bin/env python3
"""
Merge and Optimize Command JSON Files

This script:
1. Merges commands from multiple sources (cleaned, v2, complete, detailed)
2. Prioritizes detailed entries over basic ones
3. Removes duplicates intelligently
4. Generates final optimized JSON
"""

import json
from pathlib import Path
from typing import Dict, List, Set
from collections import defaultdict

def normalize_header(header: str) -> str:
    """Normalize command header for comparison."""
    # Remove query marker
    normalized = header.split('?')[0].strip()
    # Normalize case
    normalized = normalized.upper()
    # Normalize variable mnemonics
    normalized = normalized.replace('CH1', 'CH<X>').replace('CH2', 'CH<X>').replace('CH3', 'CH<X>').replace('CH4', 'CH<X>')
    normalized = normalized.replace('REF1', 'REF<X>').replace('REF2', 'REF<X>').replace('REF3', 'REF<X>').replace('REF4', 'REF<X>')
    normalized = normalized.replace('MATH1', 'MATH<X>').replace('MATH2', 'MATH<X>').replace('MATH3', 'MATH<X>').replace('MATH4', 'MATH<X>')
    normalized = normalized.replace('MEAS1', 'MEAS<X>').replace('MEAS2', 'MEAS<X>').replace('MEAS3', 'MEAS<X>')
    normalized = normalized.replace('B1', 'B<X>').replace('B2', 'B<X>').replace('B3', 'B<X>')
    return normalized

def merge_commands(sources: List[Dict]) -> List[Dict]:
    """Merge commands from multiple sources, prioritizing detailed entries."""
    command_map = {}  # normalized_header -> best command entry
    
    for source_name, commands in sources:
        print(f"Processing {source_name}: {len(commands)} commands")
        
        for cmd in commands:
            header = cmd.get('header', '')
            if not header:
                continue
            
            normalized = normalize_header(header)
            
            # Check if we already have this command
            if normalized in command_map:
                existing = command_map[normalized]
                
                # Prioritize: detailed > v2 > cleaned > basic
                existing_score = score_command_detail(existing)
                new_score = score_command_detail(cmd)
                
                if new_score > existing_score:
                    command_map[normalized] = cmd
                    print(f"  Upgraded: {header} (score {new_score} > {existing_score})")
            else:
                command_map[normalized] = cmd
    
    return list(command_map.values())

def score_command_detail(cmd: Dict) -> int:
    """Score command by how detailed it is (higher = more detailed)."""
    score = 0
    
    # Has arguments
    if cmd.get('arguments') and len(cmd.get('arguments', [])) > 0:
        score += 10
    
    # Has syntax
    if cmd.get('syntax'):
        score += 5
    
    # Has code examples
    if cmd.get('codeExamples') and len(cmd.get('codeExamples', [])) > 0:
        score += 8
    
    # Has related commands
    if cmd.get('relatedCommands') and len(cmd.get('relatedCommands', [])) > 0:
        score += 2
    
    # Has notes
    if cmd.get('notes') and len(cmd.get('notes', [])) > 0:
        score += 2
    
    # Has manual reference
    if cmd.get('manualReference'):
        score += 3
    
    # Has query response info
    if cmd.get('queryResponse'):
        score += 3
    
    # Has description
    if cmd.get('description') and len(cmd.get('description', '')) > 50:
        score += 5
    
    return score

def main():
    """Main entry point."""
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    commands_dir = project_root / 'public' / 'commands'
    
    sources = []
    
    # Load cleaned v1
    cleaned_file = commands_dir / 'mso_commands_cleaned.json'
    if cleaned_file.exists():
        with open(cleaned_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            sources.append(('cleaned_v1', data.get('commands', [])))
    
    # Load v2 extracted
    v2_file = commands_dir / 'mso_commands_extracted_v2.json'
    if v2_file.exists():
        with open(v2_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            sources.append(('extracted_v2', data.get('commands', [])))
    
    # Load detailed mso_commands.json
    detailed_file = commands_dir / 'mso_commands.json'
    if detailed_file.exists():
        with open(detailed_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            sources.append(('detailed', data.get('commands', [])))
    
    # Load complete commands
    complete_file = commands_dir / 'mso_commands_complete.json'
    if complete_file.exists():
        with open(complete_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Convert complete format to standard format
            commands = []
            if 'commands_by_section' in data:
                for section, section_commands in data['commands_by_section'].items():
                    for cmd in section_commands:
                        if isinstance(cmd, dict) and 'command' in cmd:
                            header = cmd['command'].split(' ')[0].split('?')[0]
                            commands.append({
                                'id': header.lower().replace(':', '_').replace('<', '').replace('>', ''),
                                'header': header,
                                'scpi': cmd['command'],
                                'description': cmd.get('description', ''),
                                'shortDescription': cmd.get('description', '').split('.')[0],
                                'category': section.lower().replace(' ', '_'),
                                'commandType': 'both' if cmd.get('type') == 'both' else (cmd.get('type', 'set')),
                                'commandGroup': section,
                                'mnemonics': header.split(':'),
                            })
            sources.append(('complete', commands))
    
    if not sources:
        print("No source files found!")
        return
    
    # Merge commands
    print(f"\nMerging commands from {len(sources)} sources...")
    merged_commands = merge_commands(sources)
    
    print(f"\nMerged {len(merged_commands)} unique commands")
    
    # Generate final output
    output_data = {
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
        'commands': merged_commands
    }
    
    output_file = commands_dir / 'mso_commands_final.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"Final merged file written to: {output_file}")
    
    # Statistics
    category_counts = defaultdict(int)
    for cmd in merged_commands:
        category_counts[cmd.get('category', 'unknown')] += 1
    
    print(f"\nFinal statistics:")
    print(f"  Total commands: {len(merged_commands)}")
    print(f"  Categories: {len(category_counts)}")
    print(f"\nTop categories:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1])[:10]:
        print(f"  {cat}: {count}")

if __name__ == '__main__':
    main()


