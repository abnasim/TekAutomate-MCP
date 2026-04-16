"""Quick verification of extracted commands"""
import json
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(PROJECT_ROOT, "public", "commands", "mso_commands_final.json")

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Total groups: {len(data['groups'])}")
total_commands = sum(len(g['commands']) for g in data['groups'].values())
print(f"Total commands: {total_commands}\n")

# Check specific commands
test_commands = [
    "ACQuire:FASTAVerage:STATE",
    "ACQuire:FASTAcq:PALEtte",
    "ACQuire:STATE",
    "ACTONEVent:MEASUrement:ACTION:SAVEIMAGE:STATE"
]

print("=== Command Quality Check ===")
for cmd_name in test_commands:
    found = False
    for group_name, group_data in data['groups'].items():
        for cmd in group_data['commands']:
            if cmd['scpi'] == cmd_name:
                found = True
                print(f"\n{cmd_name}:")
                print(f"  Group: {cmd.get('group', 'N/A')}")
                print(f"  Description: {cmd.get('description', 'N/A')[:100]}...")
                print(f"  Syntax lines: {len(cmd.get('syntax', []))}")
                print(f"  Has examples: {bool(cmd.get('example'))}")
                break
        if found:
            break
    if not found:
        print(f"\n{cmd_name}: NOT FOUND")










