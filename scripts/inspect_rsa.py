import json

with open('public/commands/rsa.json', encoding='utf-8') as f:
    data = json.load(f)

print('Metadata:', data.get('metadata', {}))
groups = data.get('groups', {})
print('Type of groups:', type(groups))
print('Total groups:', len(groups))
print()

if isinstance(groups, dict):
    keys = list(groups.keys())
    print('First 15 group keys:')
    for k in keys[:15]:
        g = groups[k]
        cmds = g.get('commands', [])
        print(f'  "{k}" — {len(cmds)} commands')
    print()
    print('Last 5 group keys:')
    for k in keys[-5:]:
        g = groups[k]
        cmds = g.get('commands', [])
        print(f'  "{k}" — {len(cmds)} commands')
    print()
    # Show full structure of first command
    first_key = keys[0]
    first_group = groups[first_key]
    print('First group full structure:')
    print(json.dumps(first_group, indent=2)[:2000])

elif isinstance(groups, list):
    print('First 15 groups:')
    for i, g in enumerate(groups[:15]):
        name = g.get('name', '?')
        cmds = g.get('commands', [])
        print(f'  [{i}] "{name}" — {len(cmds)} commands')
    print()
    print('First group full structure:')
    print(json.dumps(groups[0], indent=2)[:2000])
