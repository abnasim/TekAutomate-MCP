"""Check expected command count from mapping"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from command_groups_mapping import COMMAND_GROUPS

total = sum(len(g.get('commands', [])) for g in COMMAND_GROUPS.values())
print(f"Expected commands from mapping: {total}")
print(f"Groups: {len(COMMAND_GROUPS)}")
print(f"\nTop 10 groups by command count:")
for name, data in sorted(COMMAND_GROUPS.items(), key=lambda x: len(x[1].get('commands', [])), reverse=True)[:10]:
    print(f"  {name}: {len(data.get('commands', []))}")










