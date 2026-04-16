"""Verify POLARITY command examples extraction - check no-space pattern"""
import json
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(PROJECT_ROOT, "public", "commands", "mso_commands_final.json")

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find POLARITY command
print("=== Searching for SEARCH:SEARCH<x>:TRIGger:A:WINdow:POLarity ===\n")
found = False
for group_name, group_data in data['groups'].items():
    for cmd in group_data['commands']:
        if 'POLarity' in cmd['scpi'] and 'WINdow' in cmd['scpi']:
            found = True
            print(f"Found: {cmd['scpi']}")
            print(f"Group: {cmd.get('group', 'N/A')}")
            print(f"\nExample field: {cmd.get('example', 'N/A')}")
            
            manual_entry = cmd.get('_manualEntry', {})
            examples = manual_entry.get('examples', [])
            print(f"\nExamples array ({len(examples)} examples):")
            for i, ex in enumerate(examples):
                code_examples = ex.get('codeExamples', {})
                scpi_code = code_examples.get('scpi', {}).get('code', 'N/A')
                desc = ex.get('description', 'N/A')
                print(f"\n  Example {i+1}:")
                print(f"    SCPI: {scpi_code}")
                print(f"    Description: {desc}")
            break
    if found:
        break

if not found:
    print("Command not found")










