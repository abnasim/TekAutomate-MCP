"""Verify examples extraction - check if SCPI and descriptions are separated"""
import json
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(PROJECT_ROOT, "public", "commands", "mso_commands_final.json")

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find a command with SEARCH and POLarity
print("=== Searching for SEARCH:SEARCH1:TRIGger:A:LOGIc:POLarity ===")
found = False
for group_name, group_data in data['groups'].items():
    for cmd in group_data['commands']:
        if 'SEARCH' in cmd['scpi'] and 'POLarity' in cmd['scpi']:
            found = True
            print(f"\nFound: {cmd['scpi']}")
            print(f"Group: {cmd.get('group', 'N/A')}")
            print(f"\nExample field: {cmd.get('example', 'N/A')}")
            
            manual_entry = cmd.get('_manualEntry', {})
            examples = manual_entry.get('examples', [])
            print(f"\nExamples array ({len(examples)} examples):")
            for i, ex in enumerate(examples[:3]):  # Show first 3
                code_examples = ex.get('codeExamples', {})
                scpi_code = code_examples.get('scpi', {}).get('code', 'N/A')
                desc = ex.get('description', 'N/A')
                print(f"  Example {i+1}:")
                print(f"    SCPI: {scpi_code[:80]}...")
                print(f"    Description: {desc[:80]}...")
            break
    if found:
        break

if not found:
    print("Command not found. Checking any command with examples...")
    for group_name, group_data in data['groups'].items():
        for cmd in group_data['commands']:
            examples = cmd.get('_manualEntry', {}).get('examples', [])
            if examples:
                print(f"\nFound command with examples: {cmd['scpi']}")
                print(f"Example field: {cmd.get('example', 'N/A')[:100]}...")
                print(f"First example SCPI: {examples[0].get('codeExamples', {}).get('scpi', {}).get('code', 'N/A')[:80]}...")
                break
        if examples:
            break










