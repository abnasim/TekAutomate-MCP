exec(open('scripts/command_groups_mapping.py').read())

print('=' * 60)
print('COMMAND GROUPS MAPPING - COMPLETE')
print('=' * 60)
print(f'Total groups: {len(COMMAND_GROUPS)}')
print(f'Total commands: {sum(len(g["commands"]) for g in COMMAND_GROUPS.values())}')
print('\nAll groups:')
for i, name in enumerate(sorted(COMMAND_GROUPS.keys()), 1):
    cmd_count = len(COMMAND_GROUPS[name]["commands"])
    print(f'{i:2d}. {name:40s} ({cmd_count:4d} commands)')
print('\n' + '=' * 60)
print('Mapping file is ready for PDF parsing!')
print('=' * 60)










