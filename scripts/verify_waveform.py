exec(open('scripts/command_groups_mapping.py').read())

print('Command Groups Summary:')
print(f'Total groups: {len(COMMAND_GROUPS)}')
print(f'Total commands: {sum(len(g["commands"]) for g in COMMAND_GROUPS.values())}')
if 'Waveform Transfer' in COMMAND_GROUPS:
    print(f'\nWaveform Transfer: {len(COMMAND_GROUPS["Waveform Transfer"]["commands"])} commands')
    print(f'Description length: {len(COMMAND_GROUPS["Waveform Transfer"]["description"])} characters')










