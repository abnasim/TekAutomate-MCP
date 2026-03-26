with open('scripts/bus_commands_list.txt', 'r') as f:
    cmds = [l.strip() for l in f if l.strip()]

print(f'        "Bus": {{')
print(f'            "description": "Use the commands in the Bus Command Group to configure a bus. These commands let you specify the bus type, specify the signals to be used in the bus, and specify its display style.",')
print(f'            "commands": [')
for cmd in cmds:
    print(f'                "{cmd}",')
print(f'            ]')
print(f'        }},')










