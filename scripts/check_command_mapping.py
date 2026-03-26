"""Check why commands aren't matching the mapping"""
import json
import sys
sys.path.insert(0, 'scripts')
from command_groups_mapping_DPO import COMMAND_TO_GROUP

# Load extracted commands
with open('public/commands/MSO_DPO_5k_7k_70K.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

misc_commands = [c['scpi'] for c in data['groups']['Miscellaneous']['commands']]

print(f"Total Miscellaneous commands: {len(misc_commands)}")
print(f"\nChecking first 50 commands...\n")

found = 0
not_found = []
parent_found = []

for cmd in misc_commands[:50]:
    base = cmd.replace('?', '').strip()
    
    # Check exact match
    if base in COMMAND_TO_GROUP or cmd in COMMAND_TO_GROUP:
        found += 1
        continue
    
    # Check if parent command exists (e.g., AUXIn:PRObe:DEGAUSS:STATE? -> AUXIn:PRObe:DEGAUSS)
    parts = base.split(':')
    parent_match = None
    for i in range(len(parts) - 1, 0, -1):
        parent = ':'.join(parts[:i])
        if parent in COMMAND_TO_GROUP:
            parent_match = (parent, COMMAND_TO_GROUP[parent])
            break
    
    if parent_match:
        parent_found.append((cmd, parent_match))
    else:
        not_found.append(cmd)

print(f"Exact matches: {found}")
print(f"Parent matches: {len(parent_found)}")
print(f"Not found: {len(not_found)}")

print(f"\nFirst 10 parent matches:")
for cmd, (parent, group) in parent_found[:10]:
    print(f"  {cmd} -> parent {parent} ({group})")

print(f"\nFirst 10 not found:")
for cmd in not_found[:10]:
    print(f"  {cmd}")



