exec(open('scripts/command_groups_mapping.py').read())

print('Command Groups Summary:')
print(f'Total groups: {len(COMMAND_GROUPS)}')
print(f'Total commands: {sum(len(g["commands"]) for g in COMMAND_GROUPS.values())}')
print('\nLast 4 groups:')
for name in ['Self Test', 'Spectrum view', 'Status and Error', 'Trigger']:
    print(f'  {name}: {len(COMMAND_GROUPS[name]["commands"])} commands')










