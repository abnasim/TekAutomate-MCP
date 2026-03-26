# SCPI Syntax Reference

This document provides a reference for SCPI command syntax conventions used by Tektronix oscilloscopes.

## Backus-Naur Form Notation

| Symbol | Meaning |
|--------|---------|
| `< >` | Defined element |
| `=` | Is defined as |
| `\|` | Exclusive OR |
| `{ }` | Group; one element is required |
| `[ ]` | Optional; can be omitted |
| `...` | Previous element(s) may be repeated |

## Command and Query Structure

Commands consist of:
- **Set commands**: Modify instrument settings or perform actions
- **Query commands**: Return data and status information (end with `?`)

Example:
- Set: `ACQuire:MODe SAMple`
- Query: `ACQuire:MODe?`

## Message Elements

| Symbol | Meaning |
|--------|---------|
| `<Header>` | Basic command name. If it ends with `?`, it's a query |
| `<Mnemonic>` | Header subfunction. Multiple mnemonics separated by `:` |
| `<Argument>` | Quantity, quality, restriction, or limit. Separated from header by `<space>` |
| `<Comma>` | Used between arguments (`,`) |
| `<Space>` | White space between command header and argument |

## Constructed Mnemonics

### Bus Mnemonics
| Symbol | Meaning |
|--------|---------|
| `B<x>` | A bus specifier; `<x>` is ≥1 |

### Channel Mnemonics
| Symbol | Meaning |
|--------|---------|
| `CH<x>` | A channel specifier; `<x>` is ≥1 and limited by number of channels |
| `CH<x>_D<x>` | A digital channel specifier |

### Cursor Mnemonics
| Symbol | Meaning |
|--------|---------|
| `CURSOR<x>` | A cursor selector; `<x>` must be 1 or 2 |

### Math Specifier Mnemonics
| Symbol | Meaning |
|--------|---------|
| `MATH<x>` | A math waveform specifier; `<x>` is ≥1 |

### Measurement Specifier Mnemonics
| Symbol | Meaning |
|--------|---------|
| `MEAS<x>` | A measurement specifier; `<x>` is ≥1 |

### Reference Waveform Mnemonics
| Symbol | Meaning |
|--------|---------|
| `REF<x>` | A reference waveform specifier; `<x>` is ≥1 |
| `REF<x>_D<x>` | A digital reference waveform specifier |

### View Mnemonics
| Symbol | Meaning |
|--------|---------|
| `WAVEView<x>` | A waveview specifier; `<x>` must be equal to 1 |
| `PLOTView<x>` | A plotview specifier; `<x>` must be equal to 1 |
| `MATHFFTView<x>` | A mathfftview specifier; `<x>` must be equal to 1 |

### Search Mnemonics
| Symbol | Meaning |
|--------|---------|
| `SEARCH<x>` | A search specifier; `<x>` is ≥1 |

### Zoom Mnemonics
| Symbol | Meaning |
|--------|---------|
| `ZOOM<x>` | A zoom specifier; `<x>` must be equal to 1 |

## Argument Types

### Enumeration Arguments
- Entered as unquoted text words
- Uppercase portion is required, lowercase is optional
- Example: `ACQuire:MODe SAMple`

### Numeric Arguments

| Symbol | Meaning | Description |
|--------|---------|-------------|
| `<NR1>` | Signed integer value | Integer numbers (e.g., `8`, `-5`, `100`) |
| `<NR2>` | Floating point value without exponent | Decimal numbers (e.g., `3.14`, `-0.5`) |
| `<NR3>` | Floating point value with exponent | Scientific notation (e.g., `1.5E-6`, `2.5E+3`) |
| `<bin>` | Signed or unsigned integer in binary format | Binary representation |

**Important**: Numeric arguments are automatically forced to valid settings by rounding or truncating when invalid numbers are input.

### Quoted String Arguments

| Symbol | Meaning |
|--------|---------|
| `<QString>` | Quoted string of ASCII text |

Rules for quoted strings:
1. Use same quote type to open and close: `"valid string"`
2. Can mix quotes: `"this is an 'acceptable' string"`
3. Include quote by repeating: `"here is a "" mark"`
4. Case-insensitive
5. Carriage return/line feed embedded doesn't terminate string
6. Maximum length: 1000 characters

### Block Arguments

| Symbol | Meaning |
|--------|---------|
| `<NZDig>` | A nonzero digit character (1–9) |
| `<Dig>` | A digit character (0–9) |
| `<DChar>` | A character with hex equivalent 00-FF (0-255 decimal) |
| `<Block>` | Block of data bytes |

## Command Entry Rules

1. Commands can be entered in upper or lower case
2. Commands can be preceded by white space characters
3. Instrument ignores commands with only white space and line feeds

## Abbreviation

- Commands can be abbreviated to minimum acceptable form (shown in capitals)
- Example: `ACQuire:NUMAvg` can be entered as `ACQ:NUMA` or `acq:numa`
- **Recommendation**: Use full spelling for most robust code

## Concatenation

Concatenate commands using semicolon (`;`). Rules:

1. Separate different headers by `;` and `:` (except first):
   ```
   TRIGger:A:MODe NORMal;:ACQuire:NUMAVg 8
   ```

2. Similar headers can omit beginning colon:
   ```
   ACQuire:MODe ENVelope;NUMAVg 8
   ```

3. Never precede `*` commands with colon:
   ```
   ACQuire:STATE 1;*OPC
   ```

4. Concatenated queries return concatenated responses:
   ```
   Query: DISplay:GRAticule?;STYle?
   Response (header off): FULL;DOTSONLY
   ```

## Message Termination

| Symbol | Meaning |
|--------|---------|
| `<EOM>` | End of Message terminator |

- Must be END message (EOI asserted with last data byte)
- Last data byte may be ASCII line feed (LF)
- Instrument always terminates outgoing messages with LF and EOI

## Common Command Patterns

### Set Command with Numeric Argument
```
BUS:B1:AUDIO:DATA:SIZE 8
```
- Header: `BUS:B1:AUDIO:DATA:SIZE`
- Argument: `8` (type: `<NR1>`)

### Set Command with Enumeration
```
ACQuire:MODe SAMple
```
- Header: `ACQuire:MODe`
- Argument: `SAMple` (enumeration)

### Query Command
```
BUS:B1:AUDIO:DATA:SIZE?
```
- Returns the current size value

### Set Command with CUSTom Value
```
BUS:B1:ARINC429A:BITRATE:CUSTOM 12500
```
- Uses `:CUSTom` suffix in header
- Followed by numeric argument

## Error Handling

- Invalid numeric values are automatically rounded or truncated
- Query returning `9.91E+37` indicates NaN (Not a number) error
- Use Device Clear (DCL) to clear output queue and reset

## Source

This reference is derived from the Tektronix 4/5/6 Series MSO Programmer Manual (MSO4XB, MSO5XB, MSO58LP, MSO6XB, LPD64).
