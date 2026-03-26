#!/usr/bin/env python3
"""Update MSO JSON metadata with correct instrument names."""

import json
from pathlib import Path
from collections import OrderedDict

script_dir = Path(__file__).parent
project_root = script_dir.parent

for folder in ['public/commands', 'build/commands']:
    filepath = project_root / folder / 'mso_2_4_5_6_7.json'
    print(f"Reading {filepath}...")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Update metadata with correct names
    data['manual'] = '4/5/6/7 Series MSO Programmer Manual'
    data['shortName'] = '4/5/6/7 Series MSO'
    data['description'] = 'SCPI commands for Tektronix 4/5/6/7 Series Mixed Signal Oscilloscopes'
    data['instruments'] = ['MSO4XB', 'MSO5XB', 'MSO58LP', 'MSO6XB', 'LPD64']
    
    # Reorder keys - put metadata at top
    ordered = OrderedDict()
    ordered['version'] = data.get('version', '2.0')
    ordered['manual'] = data.get('manual')
    ordered['shortName'] = data.get('shortName')
    ordered['description'] = data.get('description')
    ordered['instruments'] = data.get('instruments')
    ordered['metadata'] = data.get('metadata')
    ordered['groups'] = data.get('groups')
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(ordered, f, indent=2, ensure_ascii=False)
    
    print(f"Updated: {filepath}")

print()
print("New metadata:")
print(f"  shortName: {ordered['shortName']}")
print(f"  instruments: {ordered['instruments']}")
print()
print("Done!")





