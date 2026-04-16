"""Check which JSON command files exist and what they contain"""
import json
import os

files_to_check = [
    'mso_2_4_5_6_7.json',
    'MSO_DPO_5k_7k_70K.json',
    'dpojet.json',
    'tekexpress.json'
]

print("Checking JSON files in public/commands:\n")

for filename in files_to_check:
    filepath = f'public/commands/{filename}'
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Check if it has groups structure
            if 'groups' in data:
                groups = list(data['groups'].keys())
                total_commands = sum(len(g.get('commands', [])) for g in data['groups'].values())
                manual = data.get('manual', 'Unknown')
                
                # Check for AFG commands
                has_afg = any('AFG' in g.upper() for g in groups)
                
                print(f"[OK] {filename}")
                print(f"   Manual: {manual[:60]}...")
                print(f"   Groups: {len(groups)}")
                print(f"   Commands: {total_commands}")
                print(f"   Has AFG: {has_afg}")
                print()
        except Exception as e:
            print(f"[ERROR] {filename}: Error reading - {e}\n")
    else:
        print(f"[MISSING] {filename}: File not found\n")

