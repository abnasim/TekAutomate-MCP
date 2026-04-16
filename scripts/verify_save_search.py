exec(open('scripts/command_groups_mapping.py').read())

print('Command Groups Summary:')
print(f'Total groups: {len(COMMAND_GROUPS)}')
print(f'Total commands: {sum(len(g["commands"]) for g in COMMAND_GROUPS.values())}')
print('\nLast 3 groups:')
for name in ['Save and Recall', 'Save on', 'Search and Mark']:
    print(f'  {name}: {len(COMMAND_GROUPS[name]["commands"])} commands')










