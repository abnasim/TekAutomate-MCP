# SCPI Extraction Enhancements

## Overview
Enhanced `extract_scpi_from_word_font_aware_DPO.py` to better capture enumeration options (`{OPTIONS}`) from the Word document, even when they appear in non-standard locations.

## Problems Fixed

### 1. Missing `{OPTIONS}` in Syntax Lines
**Problem**: Many commands had enumeration options listed in the Arguments section or on continuation lines, but the syntax field was missing them.

**Example**:
- **Before**: `syntax: ["SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition"]`
- **After**: `syntax: ["SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition {ERRor|DATA|IDANDDATA|EOF|IDentifier|ACKMISS|SOF|FRAMEtype}"]`

### 2. Options in Arguments Section
**Problem**: Options were sometimes only mentioned in the Arguments text, not in the Syntax section.

**Solution**: Added `enhance_syntax_with_arguments()` function that:
- Scans Arguments text for `{OPTIONS}` patterns
- Extracts comma/pipe-separated option lists
- Merges them into the syntax field

### 3. Syntax Continuation Lines
**Problem**: Syntax lines with options might not be in Lucida Console font or might be continuation lines.

**Solution**: Enhanced extraction to:
- Look for `{OPTIONS}` patterns in Arguments section
- Merge options found in Arguments into existing syntax
- Accept syntax-like patterns even if not in Lucida Console font

## Code Changes

### 1. Enhanced Syntax Line Detection (lines ~567-600)
```python
# ENHANCED: Look for {OPTIONS} patterns in Arguments section or continuation lines
if current_section in ["syntax", "arguments"]:
    options_pattern = r'\{([A-Z][A-Za-z0-9]*(?:\|[A-Z][A-Za-z0-9]*)+)\}'
    if re.search(options_pattern, text):
        # Merge options into syntax...
```

### 2. New Function: `enhance_syntax_with_arguments()` (lines ~670-720)
```python
def enhance_syntax_with_arguments(syntax_list, arguments_text, command_header):
    """Enhance syntax by extracting {OPTIONS} from Arguments text if missing from syntax"""
    # Looks for {OPTIONS} patterns
    # Extracts comma/pipe-separated lists
    # Merges into syntax
```

### 3. Post-Processing Enhancement (line ~680)
```python
# ENHANCED: Merge options from Arguments into syntax if missing
validated_syntax = enhance_syntax_with_arguments(validated_syntax, args_text, header)
```

## Expected Results

After re-extraction, commands should have:
- ✅ Complete `{OPTIONS}` in syntax field
- ✅ Proper enumeration parameters with all options
- ✅ Better parameter detection from enhanced syntax

## Usage

1. **Re-run extraction**:
   ```bash
   python scripts/extract_scpi_from_word_font_aware_DPO.py
   ```

2. **Verify results**:
   - Check that commands now have `{OPTIONS}` in syntax
   - Verify parameters are detected correctly
   - Compare with PDF manual for accuracy

3. **Review edge cases**:
   - Some commands may still need manual review
   - Use `generate_review_report.py` to identify remaining issues

## Testing

Test with known problematic commands:
- `SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition` - Should have 8 options
- `ACQuire:MODe` - Should have options like SAMple, PEAKdetect, etc.
- Commands with options in Arguments section

## Notes

- The enhancement is **non-destructive** - it only adds missing options, doesn't remove existing ones
- Options extracted from Arguments text are merged into syntax, making them available to `detect_params()`
- The original extraction logic remains intact - this is an enhancement layer
