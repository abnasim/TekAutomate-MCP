# Read the groups
exec(open('scripts/extract_self_spectrum_status_trigger_groups.py').read())

# Read the mapping file to find insertion point
with open('scripts/command_groups_mapping.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point
insert_marker = '    # More groups will be added as you share them\n}'
before_marker = content.split(insert_marker)[0]

# Format the new groups
new_groups = ''

# Self Test
new_groups += '    "Self Test": {\n'
new_groups += '        "description": "The Self test commands control the selection and execution of diagnostic tests.",\n'
new_groups += '        "commands": [\n'
for cmd in self_test:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Spectrum view
new_groups += '    "Spectrum view": {\n'
new_groups += '        "description": "The Spectrum view commands control the selection and execution of spectrum analysis.",\n'
new_groups += '        "commands": [\n'
for cmd in spectrum_view:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Status and Error
new_groups += '    "Status and Error": {\n'
new_groups += '        "description": "Use the commands in the Status and Error command Group to determine the status of the instrument and control events. Several commands and queries used with the instrument are common to all devices. The IEEE Std 488.2-1987 defines these commands and queries. The common commands begin with an asterisk (*) character.",\n'
new_groups += '        "commands": [\n'
for cmd in status_error:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Trigger
new_groups += '    "Trigger": {\n'
new_groups += '        "description": "Use the commands in the Trigger Command Group to control all aspects of triggering for the instrument. There are two triggers: A and B. Where appropriate, the command set has parallel constructions for each trigger. You can set the A or B triggers to edge mode. Edge triggering lets you display a waveform at or near the point where the signal passes through a voltage level of your choosing. You can also set A or B triggers to pulse or logic modes. With pulse triggering, the instrument triggers whenever it detects a pulse of a certain width or height. Logic triggering lets you logically combine the signals on one or more channels. The instrument then triggers when it detects a certain combination of signal levels. The trigger types of Pulse Width, Timeout, Runt, Window, and Rise/Fall Time can be further qualified by a logic pattern. This is referred to as logic qualification.",\n'
new_groups += '        "commands": [\n'
for cmd in trigger:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    }\n'

# Write the new content
new_content = before_marker + new_groups + insert_marker
with open('scripts/command_groups_mapping.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Added 4 new groups to mapping file")










