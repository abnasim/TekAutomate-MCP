import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.command_groups_mapping import COMMAND_GROUPS

print('Command Groups Summary:')
print(f'Total groups: {len(COMMAND_GROUPS)}')
print(f'Total commands: {sum(len(g["commands"]) for g in COMMAND_GROUPS.values())}')
print('\nLast 3 groups:')
for name in ['Miscellaneous', 'Plot', 'Power']:
    print(f'  {name}: {len(COMMAND_GROUPS[name]["commands"])} commands')

