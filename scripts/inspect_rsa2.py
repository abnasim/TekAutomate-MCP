import json, re
from collections import Counter, defaultdict

with open('public/commands/rsa.json', encoding='utf-8') as f:
    data = json.load(f)

groups = data['groups']

# Collect ALL commands across all groups
all_cmds = []
for gname, gdata in groups.items():
    for cmd in gdata.get('commands', []):
        all_cmds.append(cmd)

print('Total commands:', len(all_cmds))
print()

# Show sample commands with their scpi field
print('Sample SCPI strings (first 20):')
for cmd in all_cmds[:20]:
    scpi = cmd.get('scpi', cmd.get('command', '?'))
    print(f'  {scpi}')

print()
# Extract root node from scpi
def get_root(scpi):
    # Remove optional brackets, get first token before colon or space
    s = scpi.strip().lstrip('[')
    # handle *commands
    if s.startswith('*'):
        return 'IEEE_Common'
    # get first segment
    part = re.split(r'[:\s]', s)[0].rstrip(']')
    # strip numeric suffix (TRACe1 -> TRACe)
    part = re.sub(r'\d+$', '', part)
    return part.upper()

roots = Counter()
for cmd in all_cmds:
    scpi = cmd.get('scpi', cmd.get('command', ''))
    root = get_root(scpi)
    roots[root] += 1

print('Root nodes found (sorted by count):')
for root, count in roots.most_common():
    print(f'  {root}: {count} commands')
