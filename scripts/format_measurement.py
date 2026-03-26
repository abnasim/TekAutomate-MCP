# Read the measurement commands
exec(open('scripts/extract_measurement_group.py').read())

print('    "Measurement": {')
print('        "description": "Use the commands in the Measurement Command Group to control the automated measurement system. Measurement commands can set and query measurement parameters. You can assign parameters, such as waveform sources and reference levels, differently for each measurement.",')
print('        "commands": [')
for cmd in measurement:
    print(f'            "{cmd}",')
print('        ]')
print('    },')










