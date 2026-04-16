import json
with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    d = json.load(f)
for c in d['groups'].get('Plot', {}).get('commands', []):
    if 'Threshold' in c['scpi']:
        print(f"SCPI: {c['scpi']}")
        print(f"Syntax: {c.get('syntax')}")
        print(f"Params: {c.get('params')}")
        print(f"Examples: {c.get('examples')[:2] if c.get('examples') else 'None'}")
        print()








