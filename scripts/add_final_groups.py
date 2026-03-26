# Read the groups
exec(open('scripts/extract_final_groups.py').read())

# Read the mapping file to find insertion point
with open('scripts/command_groups_mapping.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point
insert_marker = '    # More groups will be added as you share them\n}'
before_marker = content.split(insert_marker)[0]

# Format the new groups
new_groups = ''

# Miscellaneous
new_groups += '    "Miscellaneous": {\n'
new_groups += '        "description": "Miscellaneous commands do not fit into other categories. Several commands and queries are common to all devices. The 488.2-1987 standard defines these commands. The common commands begin with an asterisk (*) character.",\n'
new_groups += '        "commands": [\n'
for cmd in miscellaneous:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Plot
new_groups += '    "Plot": {\n'
new_groups += '        "description": "Plot commands let you select the type and control the appearance of your plots.",\n'
new_groups += '        "commands": [\n'
for cmd in plot:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Power
new_groups += '    "Power": {\n'
new_groups += '        "description": "Use the commands in the Power command group for power measurement functionality.",\n'
new_groups += '        "commands": [\n'
for cmd in power:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    }\n'

# Write the new content
new_content = before_marker + new_groups + insert_marker
with open('scripts/command_groups_mapping.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Added 3 new groups to mapping file")










