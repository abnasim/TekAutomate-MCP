"""
Validation test for option inference improvements
"""
import json

# Load the enhanced JSON
with open('public/commands/MSO_DPO_5k_7k_70K.json', encoding='utf-8') as f:
    data = json.load(f)

# Test cases: (command, expected_options or None if shouldn't have options)
test_cases = [
    ('BUS:B<x>:TYPe', ['CAN', 'FLEXRAY', 'LIN', 'PCIE', 'SPI', 'USB']),
    ('COUnter:LOGTable', ['OFF', 'ON']),
    ('BUS:B<x>:I2C:CLOCk:SOUrce', ['CH1', 'CH2', 'CH3', 'CH4', 'D0', 'MATH1']),
    ('ACQuire:NUMSAMples', None),  # Should NOT have options (numeric param)
    ('DATa:SOUrce', None),  # Should NOT have options (uses placeholders)
]

print('='*60)
print('VALIDATION TESTS')
print('='*60)

passed = 0
failed = 0

for cmd_scpi, expected_options in test_cases:
    # Find the command
    cmd = None
    for group in data['groups'].values():
        for c in group['commands']:
            if c['scpi'] == cmd_scpi:
                cmd = c
                break
        if cmd:
            break
    
    if not cmd:
        print(f'\nFAIL: {cmd_scpi}')
        print(f'  Command not found!')
        failed += 1
        continue
    
    # Get value parameter options
    value_param = None
    for p in cmd.get('params', []):
        if p.get('name') == 'value':
            value_param = p
            break
    
    actual_options = value_param.get('options') if value_param else None
    
    # Validate
    if expected_options is None:
        # Should NOT have options
        if actual_options is None:
            print(f'\n[PASS] {cmd_scpi}')
            print(f'  Correctly has NO value options (as expected)')
            passed += 1
        else:
            print(f'\n[FAIL] {cmd_scpi}')
            print(f'  Expected: NO OPTIONS')
            print(f'  Got: {actual_options}')
            failed += 1
    else:
        # Should have options
        if actual_options and all(exp in actual_options for exp in expected_options):
            print(f'\n[PASS] {cmd_scpi}')
            print(f'  Expected (subset): {expected_options}')
            print(f'  Got: {actual_options[:8]}{"..." if len(actual_options) > 8 else ""}')
            passed += 1
        else:
            print(f'\n[FAIL] {cmd_scpi}')
            print(f'  Expected (at least): {expected_options}')
            print(f'  Got: {actual_options}')
            failed += 1

print(f'\n{"="*60}')
print(f'RESULTS: {passed} passed, {failed} failed')
print(f'{"="*60}')
