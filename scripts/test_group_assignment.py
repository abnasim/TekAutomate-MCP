"""Test the group assignment functionality"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_scpi_enhanced import get_group_for_command, normalize_command

print('Testing group assignment:')
print('=' * 60)

test_commands = [
    "ACQuire:STATE",
    "TRIGger:A:EDGE:SOUrce",
    "MEASUrement:MEAS<x>:TYPe",
    "BUS:B<x>:CAN:CONDition",
    "SEARCH:SEARCH<x>:TRIGger:A:EDGE:SOUrce",
    "POWer:POWer<x>:AUTOSet",
    "SV:CH<x>:RF_MAGnitude:FORMat",
    "*IDN?",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:STATe"
]

for cmd in test_commands:
    group = get_group_for_command(cmd)
    print(f'{cmd:50s} -> {group or "NOT FOUND"}')

print('=' * 60)
print('Group assignment test complete!')










