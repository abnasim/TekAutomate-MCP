#!/usr/bin/env python3
"""Rename and update metadata for MSO commands JSON file."""

import json
from pathlib import Path

script_dir = Path(__file__).parent
project_root = script_dir.parent

# Read the file
input_file = project_root / 'public' / 'commands' / 'mso_commands_final.json'
print(f"Reading {input_file}...")

with open(input_file, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Update metadata
data['manual'] = 'MSO 2/4/5/6/7 Series Programmer Manual'
data['shortName'] = 'MSO 4/5/6/7 Series'
data['instruments'] = ['MSO2', 'MSO4', 'MSO5', 'MSO6', 'MSO7']
data['description'] = 'SCPI commands for Tektronix MSO 2, 4, 5, 6, and 7 Series Mixed Signal Oscilloscopes'

# Write to new filename in public folder
output_public = project_root / 'public' / 'commands' / 'mso_2_4_5_6_7.json'
print(f"Writing {output_public}...")
with open(output_public, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

# Also copy to build folder
output_build = project_root / 'build' / 'commands' / 'mso_2_4_5_6_7.json'
print(f"Writing {output_build}...")
with open(output_build, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("\nDone! Created:")
print(f"  - {output_public}")
print(f"  - {output_build}")

total = data.get('metadata', {}).get('total_commands', 'unknown')
print(f"\nTotal commands: {total}")
print(f"Short name: {data.get('shortName')}")
print(f"Instruments: {data.get('instruments')}")





