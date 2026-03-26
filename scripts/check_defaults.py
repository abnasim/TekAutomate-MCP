import json

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

# Check commands with numeric params
test_patterns = ['AUTOETHERnet:THRESHold', 'AFG:AMPLitude', 'HORizontal:SAMPLERate', 'ACQuire:NUMAVg']

print("=== Checking Example Defaults ===\n")

for g in d['groups'].values():
    for cmd in g['commands']:
        for pattern in test_patterns:
            if pattern in cmd['scpi']:
                print(f"SCPI: {cmd['scpi']}")
                print(f"  Examples: {[e.get('scpi', '')[:50] for e in cmd.get('examples', [])[:2]]}")
                for p in cmd['params']:
                    if p['name'] in ['value', 'label']:
                        print(f"  Param '{p['name']}': default = {p.get('default')}")
                print()

# Count how many have defaults now
total_numeric = 0
with_default = 0
for g in d['groups'].values():
    for cmd in g['commands']:
        for p in cmd.get('params', []):
            if p.get('type') in ['integer', 'float', 'string'] and p.get('name') in ['value', 'label']:
                total_numeric += 1
                if p.get('default') is not None:
                    with_default += 1

print(f"\n=== Summary ===")
print(f"Numeric/string params with defaults: {with_default}/{total_numeric} ({100*with_default/total_numeric:.1f}%)")








