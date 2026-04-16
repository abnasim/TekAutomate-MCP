import json

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

# Find ACQuire:STATE
for group in d['groups'].values():
    for cmd in group['commands']:
        if cmd['scpi'] == 'ACQuire:STATE':
            print(f"SCPI: {cmd['scpi']}")
            print(f"Syntax: {cmd['syntax']}")
            print(f"Params ({len(cmd['params'])}): {json.dumps(cmd['params'], indent=2)}")
            break








