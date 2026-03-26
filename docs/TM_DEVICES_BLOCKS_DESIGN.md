# tm_devices Block Design Specification

## Problem Statement

Currently, GPT is forced to emit SCPI commands in `python_code` blocks because Blockly lacks first-class blocks for tm_devices operations. This creates:
- Verbose XML with many `python_code` blocks
- Loss of semantic structure
- Harder validation and error checking
- Inconsistent code generation

## Required tm_devices Blocks

### 1. FastFrame Blocks

#### `fastframe_enable`
- **Purpose:** Enable FastFrame acquisition mode
- **Fields:**
  - `DEVICE_CONTEXT`: Device to configure (scope)
  - `STATE`: ON/OFF dropdown
- **Python Output (tm_devices):**
  ```python
  scope.write(':HORIZONTAL:FASTFRAME:STATE ON')
  ```
- **Python Output (PyVISA):**
  ```python
  scope.write(':HORIZONTAL:FASTFRAME:STATE ON')
  ```

#### `fastframe_set_count`
- **Purpose:** Set number of FastFrame frames
- **Fields:**
  - `DEVICE_CONTEXT`: Device to configure
  - `COUNT`: Number input (1-10000)
- **Python Output:**
  ```python
  scope.write(f':HORIZONTAL:FASTFRAME:COUNT {count}')
  ```

#### `fastframe_select_frame`
- **Purpose:** Select specific frame for processing
- **Fields:**
  - `DEVICE_CONTEXT`: Device to configure
  - `CHANNEL`: Channel dropdown (CH1, CH2, etc.)
  - `FRAME`: Frame number input or variable
- **Python Output:**
  ```python
  scope.write(f':HORIZONTAL:FASTFRAME:SELECTED:{channel} {frame}')
  ```

### 2. Search Blocks

#### `search_configure_edge`
- **Purpose:** Configure edge search
- **Fields:**
  - `DEVICE_CONTEXT`: Device to configure
  - `SEARCH_NUM`: Search number (1, 2, etc.)
  - `SOURCE`: Channel dropdown
  - `SLOPE`: FALL/RISE dropdown
  - `LEVEL`: Level input (optional, auto if not set)
- **Python Output:**
  ```python
  scope.write(f':SEARCH:SEARCH{search_num}:EDGE:SOURCE {source}')
  scope.write(f':SEARCH:SEARCH{search_num}:EDGE:SLOPE {slope}')
  ```

#### `search_query_total`
- **Purpose:** Query total search results
- **Fields:**
  - `DEVICE_CONTEXT`: Device to query
  - `SEARCH_NUM`: Search number
  - `VARIABLE`: Variable name to store result
- **Python Output:**
  ```python
  {variable} = scope.query(f':SEARCH:SEARCH{search_num}:TOTAL?').strip()
  ```

### 3. Measurement Blocks

#### `measurement_immediate`
- **Purpose:** Perform immediate measurement
- **Fields:**
  - `DEVICE_CONTEXT`: Device to use
  - `TYPE`: Measurement type dropdown (PK2PK, RMS, FREQUENCY, etc.)
  - `SOURCE`: Channel dropdown
  - `VARIABLE`: Variable name to store result
- **Python Output:**
  ```python
  scope.write(f':MEASUREMENT:IMMED:TYPE {type}')
  scope.write(f':MEASUREMENT:IMMED:SOURCE {source}')
  {variable} = float(scope.query(':MEASUREMENT:IMMED:VALUE?').strip())
  ```

#### `measurement_query`
- **Purpose:** Query configured measurement
- **Fields:**
  - `DEVICE_CONTEXT`: Device to query
  - `MEAS_NUM`: Measurement number (1-4)
  - `VARIABLE`: Variable name to store result
- **Python Output:**
  ```python
  {variable} = float(scope.query(f':MEASUREMENT:MEAS{meas_num}:VALUE?').strip())
  ```

### 4. Screenshot Block (tm_devices)

#### `save_screenshot_tmdevices`
- **Purpose:** Save screenshot using tm_devices API
- **Fields:**
  - `DEVICE_CONTEXT`: Device to use
  - `FILENAME`: Filename template (supports variables like `{frame}`)
  - `FORMAT`: PNG/JPEG/BMP dropdown
  - `FOLDER`: Optional folder path
- **Python Output (tm_devices):**
  ```python
  scope.save_screenshot(f"{filename}.{format}", folder="{folder}")
  ```
- **Python Output (PyVISA):**
  ```python
  # Fallback to SCPI-based screenshot
  scope.write(f'SAVE:IMAGE:FILEFORMAT {format}')
  image_data = scope.query_binary_values('SAVE:IMAGE?', datatype='B', container=bytes)
  with open(f'{filename}.{format}', 'wb') as f:
      f.write(image_data)
  ```

### 5. Acquisition Lifecycle Blocks

#### `acquisition_reset`
- **Purpose:** Reset acquisition state (ACQuire:STATE OFF)
- **Fields:**
  - `DEVICE_CONTEXT`: Device to configure
- **Python Output:**
  ```python
  scope.write('ACQuire:STATE OFF')
  ```

#### `acquisition_single_with_opc`
- **Purpose:** Single acquisition with blocking OPC
- **Fields:**
  - `DEVICE_CONTEXT`: Device to use
- **Python Output:**
  ```python
  scope.write('ACQuire:STATE ON;*OPC?')
  scope.read()  # Block until complete
  ```

## Block Implementation Priority

### Phase 1 (Critical - Fixes Current Issues)
1. ✅ `save_screenshot_tmdevices` - Replaces python_code for screenshots
2. ✅ `acquisition_reset` - Ensures proper lifecycle
3. ✅ `acquisition_single_with_opc` - Proper OPC handling

### Phase 2 (FastFrame Support)
4. `fastframe_enable`
5. `fastframe_set_count`
6. `fastframe_select_frame`

### Phase 3 (Search & Measurement)
7. `search_configure_edge`
8. `search_query_total`
9. `measurement_immediate`
10. `measurement_query`

## Block Generator Implementation

Each block should:
1. Track device usage automatically
2. Support variable substitution in fields
3. Generate backend-appropriate code (tm_devices vs PyVISA)
4. Integrate with existing validation (device usage, variable usage)

## GPT Instruction Updates

Once blocks exist, update `CUSTOM_GPT_INSTRUCTIONS.txt`:
- Prefer tm_devices blocks over python_code
- Use `save_screenshot_tmdevices` instead of `scope.save_screenshot()` in python_code
- Use `fastframe_*` blocks instead of SCPI in python_code
- Use `search_*` blocks instead of SCPI in python_code

## Example: Before vs After

### Before (Current - python_code blocks)
```xml
<python_code>
  scope.write(':HORIZONTAL:FASTFRAME:STATE ON')
  scope.write(':HORIZONTAL:FASTFRAME:COUNT 50')
</python_code>
<python_code>
  scope.save_screenshot(f"frame_{frame}.png")
</python_code>
```

### After (With tm_devices blocks)
```xml
<fastframe_enable>
  <field name="DEVICE_CONTEXT">(scope)</field>
  <field name="STATE">ON</field>
</fastframe_enable>
<fastframe_set_count>
  <field name="DEVICE_CONTEXT">(scope)</field>
  <field name="COUNT">50</field>
</fastframe_set_count>
<save_screenshot_tmdevices>
  <field name="DEVICE_CONTEXT">(scope)</field>
  <field name="FILENAME">frame_{frame}</field>
  <field name="FORMAT">PNG</field>
</save_screenshot_tmdevices>
```

## Benefits

1. **Cleaner XML:** Semantic blocks instead of code dumps
2. **Better Validation:** Can validate block parameters
3. **Consistent Generation:** Same blocks → same Python
4. **GPT Clarity:** Clear vocabulary for GPT to use
5. **User Experience:** Visual blocks instead of code editing
