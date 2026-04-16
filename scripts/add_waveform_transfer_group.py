# Read the groups
exec(open('scripts/extract_vertical_waveform_groups.py').read())

# Read the mapping file to find insertion point
with open('scripts/command_groups_mapping.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point
insert_marker = '    # More groups will be added as you share them\n}'
before_marker = content.split(insert_marker)[0]

# Format the new group with detailed description for Academy
new_groups = ''

# Waveform Transfer - with detailed description for Academy articles
new_groups += '    "Waveform Transfer": {\n'
new_groups += '        "description": "Use the commands in the Waveform Transfer Command Group to transfer waveform data points from the instrument. Waveform data points are a collection of values that define a waveform. One data value usually represents one data point in the waveform record. When working with envelope waveforms, each data value is either the minimum or maximum of a min/max pair. Before you transfer waveform data, you must specify the data format, record length, and waveform source. Data formats: Acquired waveform data uses eight or more bits to represent each data point. The number of bits used depends on the acquisition mode specified when you acquired the data. Data acquired in SAMple or ENVelope mode uses eight bits per waveform data point. Data acquired in AVERage mode uses up to 14 bits per point. The instrument can transfer waveform data in either ASCII or binary format. You specify the format with the DATa:ENCdg command. The instrument uses signed, 4 byte integers and floating point values; it does not support unsigned floating point values. ASCII data: Data is represented by signed integer or floating point values. Use ASCII to obtain more readable and easier to format output than binary. However, ASCII can require more bytes to send the same values than it does with binary. This can reduce transmission speeds. Binary data: Data can be represented by signed integer or floating point values. The range of the values depends on the byte width specified. When the byte width is one, signed integer data ranges from -128 to 127, and positive integer values range from 0 to 255. When the byte width is two, the values range from -32768 to 32767. When a MATH (or REF that came from a MATH) is used, 32-bit floating point values are used that are four bytes in width. The defined binary formats specify the order in which the bytes are transferred. The following are the four binary formats: RIBinary specifies signed integer data-point representation with the most significant byte transferred first. SRIBinary is the same as RIBinary except that the byte order is swapped, meaning that the least significant byte is transferred first. This format is useful when transferring data to PCs. RFBinary specifies floating point data-point representation with the most significant byte transferred first. SRFBinary is the same as RFBinary except that the byte order is swapped, meaning that the least significant byte is transferred first. This format is useful when transferring data to PCs. Waveform data and record lengths: You can transfer multiple points for each waveform record. You can transfer a portion of the waveform or you can transfer the entire record. You can use the DATa:STARt and DATa:STOP commands to specify the first and last data points of the waveform record. When transferring data from the instrument, you must specify the first and last data points in the waveform record. Setting DATa:STARt to 1 and DATa:STOP to the record length will always return the entire waveform. Waveform data locations and memory allocation: The DATa:SOUrce command specifies the waveform source when transferring a waveform from the instrument. Waveform preamble: Each waveform that you transfer has an associated waveform preamble that contains information such as the horizontal scale, the vertical scale, and other settings in effect when the waveform was created. Refer to the individual WFMOutpre? commands for more information. Scaling waveform data: Once you transfer the waveform data to the controller, you can convert the data points into voltage values for analysis using information from the waveform preamble. Transferring waveform data from the instrument: You can transfer waveforms from the instrument to an external controller using the following sequence: 1. Select the waveform source(s) using DATa:SOUrce. 2. Specify the waveform data format using DATa:ENCdg. 3. Specify the number of bytes per data point using WFMOutpre:BYT_Nr. Note: MATH waveforms (and REF waveforms that came from a MATH) are always set to four bytes. 4. Specify the portion of the waveform that you want to transfer using DATa:STARt and DATa:STOP. 5. Transfer waveform preamble information using WFMOutpre. 6. Transfer waveform data from the instrument using CURVe?.",\n'
new_groups += '        "commands": [\n'
for cmd in waveform_transfer:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    }\n'

# Write the new content
new_content = before_marker + new_groups + insert_marker
with open('scripts/command_groups_mapping.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Added Waveform Transfer group to mapping file")
print("Note: Vertical group description provided but commands not listed yet - will add when provided")










