# Issue Summary: mso_commands.json Analysis

## Main Problem: Data Misalignment

Your script **IS extracting data**, but it's getting **assigned to the wrong commands**.

### Example of the Problem

**Command**: `PLOT:PLOT<x>:RAILNUM` (a Plot command)
- ❌ **Group**: "Acquisition" (should be "Plot")
- ❌ **Syntax**: `ACQuire:MODe` (this is a different command's syntax!)
- ❌ **Arguments**: About averages (belongs to ACQuire:NUMAVg)
- ❌ **Examples**: About ACQUIRE:MAXSAMPLERATE (different command)

**Command**: `ACQuire:NUMAVg`
- ❌ **Description**: "CURVe?" (just a query, not a description)
- ❌ **Arguments**: About SAMple, PEAKdetect (belongs to ACQuire:MODe)
- ❌ **Examples**: About ACQUIRE:NUMACQ (different command)

## Root Cause

The script is:
1. ✅ Detecting commands correctly
2. ✅ Detecting section headers (Group, Syntax, etc.)
3. ❌ **NOT properly finalizing commands before starting new ones**

This means:
- When a new command is detected, the previous command's sections are still being collected
- Section data gets saved to the wrong command
- Commands get mixed up

## What's Happening

```
Command 1 detected → Start collecting description
"Group" detected → Switch to GROUP state, collect "Acquisition"
"Syntax" detected → Switch to SYNTAX state, collect syntax lines
Command 2 detected → finalize_command() called
  BUT: The GROUP and SYNTAX data gets saved to Command 2 instead of Command 1!
```

## The Fix Needed

Your `finalize_command()` function needs to:
1. Save the current buffer BEFORE finalizing
2. Ensure all section data is properly assigned to the current command
3. Reset state BEFORE starting a new command

## Current Code Issue

In your script, when you detect a new command:
```python
if is_header:
    finalize_command()  # This should save previous command
    # Start new command
    current_cmd = {...}
    state = "DESCRIPTION"
    buffer = []
```

But `finalize_command()` might not be saving the buffer correctly, or the buffer contains data that should have been saved earlier.

## Recommended Fix

1. **Ensure buffer is saved on state transitions**:
```python
if line_lower.startswith("group"):
    save_buffer_to_field()  # Save current section (description)
    state = "GROUP"
    buffer = []
```

2. **Ensure buffer is saved in finalize_command**:
```python
def finalize_command():
    if current_cmd:
        save_buffer_to_field()  # Save whatever section we're in
        # ... rest of finalization
```

3. **Add validation**: Check that section data makes sense for the command (e.g., a Plot command shouldn't have Acquisition group)

## Quick Test

Add this debug output to see what's happening:
```python
def finalize_command():
    if current_cmd:
        print(f"Finalizing: {current_cmd['scpi']}")
        print(f"  Current state: {state}")
        print(f"  Buffer size: {len(buffer)}")
        print(f"  Group will be: {current_cmd.get('group')}")
        save_buffer_to_field()
        # ... rest
```

This will show you which command is getting which data.










