# Read the extracted groups
exec(open('scripts/extract_more_groups.py').read())

groups = [
    ("Digital", "Use the commands in the Digital Command Group to acquire up to 64 digital signals and analyze them. Digital channels are only available when a digital probe is attached to the super channel.", digital),
    ("Digital Power Management", "Use the commands in the DPM command group for Digital Power Management functionality. Requires option 5-DPM (5 Series MSO instruments) or 6-DPM (6 Series MSO instrument).", dpm),
    ("Display", "Display commands control general instrument settings, such as the intensity of the graticule, stacked or overlay display mode, and the fastacq color palette. Display commands also control how and where waveforms are shown, their position on screen, and zoom settings applied to the view.", display),
    ("DVM", "Use the commands in the DVM command group for Digital Voltmeter functionality. Requires DVM option (free with product registration).", dvm),
    ("Ethernet", "Use the commands in the Ethernet Command Group to set up the 10BASE-T, 100BASE-TX, 1000BASE-TX or 100BASE-T Ethernet remote interface.", ethernet),
    ("File System", "Use the commands in the File System Command Group to help you use the built-in hard disk drive. You can use the commands to list directory contents, create and delete directories, and create, copy, read, rename, or delete files.", filesystem),
    ("Histogram", "Use the commands in the Histogram command group for Histogram functionality.", histogram)
]

for group_name, description, commands in groups:
    print(f'    "{group_name}": {{')
    print(f'        "description": "{description}",')
    print(f'        "commands": [')
    for cmd in commands:
        print(f'            "{cmd}",')
    print(f'        ]')
    print(f'    }},')










