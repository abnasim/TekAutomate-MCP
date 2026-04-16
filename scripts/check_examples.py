import json

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

# Find CLRESPONSE:INPUTSOurce
for group in d['groups'].values():
    for cmd in group['commands']:
        if 'CLRESPONSE:INPUTSOurce' in cmd['scpi']:
            print(f"SCPI: {cmd['scpi']}")
            print(f"\nExamples:")
            for ex in cmd['examples'][:3]:
                print(f"  SCPI: {ex['scpi']}")
                print(f"  Desc: {ex['description'][:80]}...")
                print()
            break








