/**
 * Manual Data Fix Script
 * 
 * Fixes commands based on actual manual documentation provided by user
 */

const fs = require('fs');
const path = require('path');

const commandsDir = path.join(__dirname, '..', 'public', 'commands');
const msoFile = path.join(commandsDir, 'mso_2_4_5_6_7.json');
const dpoFile = path.join(commandsDir, 'MSO_DPO_5k_7k_70K.json');

console.log('Loading MSO 4/5/6 command file...');
const data = JSON.parse(fs.readFileSync(msoFile, 'utf8'));

console.log('Loading MSO/DPO 5k/7k command file...');
const dpoData = JSON.parse(fs.readFileSync(dpoFile, 'utf8'));

let fixCount = 0;

// Helper to find and update a command in both files
function findAndFixCommand(scpi, fixes) {
  let found = false;
  
  // Search in MSO 4/5/6 file
  for (const groupName of Object.keys(data.groups)) {
    const group = data.groups[groupName];
    if (!group.commands) continue;
    
    for (let i = 0; i < group.commands.length; i++) {
      const cmd = group.commands[i];
      if (cmd.scpi === scpi) {
        console.log(`  Fixing (MSO 4/5/6): ${scpi}`);
        Object.assign(cmd, fixes);
        if (fixes.params) {
          cmd.params = fixes.params;
        }
        fixCount++;
        found = true;
      }
    }
  }
  
  // Search in DPO 5k/7k file
  for (const groupName of Object.keys(dpoData.groups)) {
    const group = dpoData.groups[groupName];
    if (!group.commands) continue;
    
    for (let i = 0; i < group.commands.length; i++) {
      const cmd = group.commands[i];
      if (cmd.scpi === scpi) {
        console.log(`  Fixing (DPO 5k/7k): ${scpi}`);
        Object.assign(cmd, fixes);
        if (fixes.params) {
          cmd.params = fixes.params;
        }
        fixCount++;
        found = true;
      }
    }
  }
  
  if (!found) {
    console.log(`  NOT FOUND: ${scpi}`);
  }
  return found;
}

// Helper to delete a command from both files
function deleteCommand(scpi) {
  let found = false;
  
  for (const groupName of Object.keys(data.groups)) {
    const group = data.groups[groupName];
    if (!group.commands) continue;
    
    for (let i = 0; i < group.commands.length; i++) {
      if (group.commands[i].scpi === scpi) {
        console.log(`  Deleting (MSO 4/5/6): ${scpi}`);
        group.commands.splice(i, 1);
        fixCount++;
        found = true;
        break;
      }
    }
  }
  
  for (const groupName of Object.keys(dpoData.groups)) {
    const group = dpoData.groups[groupName];
    if (!group.commands) continue;
    
    for (let i = 0; i < group.commands.length; i++) {
      if (group.commands[i].scpi === scpi) {
        console.log(`  Deleting (DPO 5k/7k): ${scpi}`);
        group.commands.splice(i, 1);
        fixCount++;
        found = true;
        break;
      }
    }
  }
  
  return found;
}

console.log('\n=== Fixing Commands Based on Manual ===\n');

// 1. FPAnel:PRESS - Add button options
console.log('1. FPAnel:PRESS');
findAndFixCommand('FPAnel:PRESS', {
  params: [
    {
      name: 'button',
      type: 'enumeration',
      required: true,
      default: 'AUTOset',
      options: [
        'AUTOset', 'BUS', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'CH8',
        'CLEAR', 'CURsor', 'DEFaultsetup', 'FASTAcq', 'FORCetrig', 
        'GPKNOB1', 'GPKNOB2', 'HIGHRES', 'HORZPOS', 'HORZScale',
        'MATh', 'NEXt', 'PREv', 'REF', 'RUNSTop', 'SETTO50', 'SINGleseq',
        'TOUCHSCReen', 'TRIGMode', 'TRIGSlope', 'USER', 'VERTPOS', 'VERTSCALE', 'ZOOM'
      ],
      description: 'Button to emulate pressing'
    }
  ]
});

// 2. BUS:B<x>:ESPI:DATAONE:POLarity - Add polarity options
console.log('2. BUS:B<x>:ESPI:DATAONE:POLarity');
findAndFixCommand('BUS:B<x>:ESPI:DATAONE:POLarity', {
  params: [
    {
      name: 'bus',
      type: 'integer',
      required: true,
      default: 1,
      description: 'B<x> is the Bus number'
    },
    {
      name: 'polarity',
      type: 'enumeration',
      required: true,
      default: 'HIGH',
      options: ['HIGH', 'LOW'],
      description: 'HIGH = active high, LOW = active low'
    }
  ]
});

// 3. SAVe:WAVEform - Add source and filename params
console.log('3. SAVe:WAVEform');
findAndFixCommand('SAVe:WAVEform', {
  params: [
    {
      name: 'source',
      type: 'enumeration',
      required: true,
      default: 'CH1',
      options: [
        'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'CH8',
        'CH1_DALL', 'CH2_DALL', 'CH3_DALL', 'CH4_DALL',
        'CH1_SV_NORMal', 'CH1_SV_AVErage', 'CH1_SV_MAXHold', 'CH1_SV_MINHold',
        'CH1_MAG_VS_TIME', 'CH1_FREQ_VS_TIME', 'CH1_PHASE_VS_TIME', 'CH1_SV_BASEBAND_IQ',
        'MATH1', 'MATH2', 'MATH3', 'MATH4',
        'REF1', 'REF2', 'REF3', 'REF4',
        'ALL'
      ],
      description: 'Waveform source to save'
    },
    {
      name: 'filename',
      type: 'string',
      required: true,
      default: '"TEK0000.WFM"',
      description: 'Destination file path (quoted string). Use .wfm, .csv, or .mat extension'
    }
  ]
});

// 4-17. POWer OUTPUT SOURCE commands - Add source options
const powerOutputCommands = [
  'POWer:POWer<x>:TURNOFFtime:OUTPUT1SOUrce',
  'POWer:POWer<x>:TURNOFFtime:OUTPUT2SOUrce',
  'POWer:POWer<x>:TURNOFFtime:OUTPUT3SOUrce',
  'POWer:POWer<x>:TURNOFFtime:OUTPUT4SOUrce',
  'POWer:POWer<x>:TURNOFFtime:OUTPUT5SOUrce',
  'POWer:POWer<x>:TURNOFFtime:OUTPUT6SOUrce',
  'POWer:POWer<x>:TURNOFFtime:OUTPUT7SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT1SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT2SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT3SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT4SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT5SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT6SOUrce',
  'POWer:POWer<x>:TURNONtime:OUTPUT7SOUrce',
];

console.log('4-17. POWer OUTPUT SOURCE commands');
for (const scpi of powerOutputCommands) {
  findAndFixCommand(scpi, {
    params: [
      {
        name: 'power',
        type: 'integer',
        required: true,
        default: 1,
        description: 'POWer<x> is the power measurement number'
      },
      {
        name: 'source',
        type: 'enumeration',
        required: true,
        default: 'CH1',
        options: [
          'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'CH8',
          'MATH1', 'MATH2', 'MATH3', 'MATH4',
          'REF1', 'REF2', 'REF3', 'REF4'
        ],
        description: 'Source channel, math, or reference waveform'
      }
    ]
  });
}

// 18-20. ALIas commands - Add string params
console.log('18. ALIas:DEFine');
findAndFixCommand('ALIas:DEFine', {
  params: [
    {
      name: 'definition',
      type: 'string',
      required: true,
      default: '"ALIAS","COMMAND"',
      description: 'Alias definition: "label","command sequence". Label max 12 chars, sequence max 256 chars'
    }
  ]
});

console.log('19. ALIas:DELEte');
findAndFixCommand('ALIas:DELEte', {
  params: [
    {
      name: 'name',
      type: 'string',
      required: true,
      default: '"ALIAS"',
      description: 'Name of the alias to delete (quoted string)'
    }
  ]
});

console.log('20. ALIas:DELEte:NAMe');
findAndFixCommand('ALIas:DELEte:NAMe', {
  params: [
    {
      name: 'name',
      type: 'string',
      required: true,
      default: '"ALIAS"',
      description: 'Name of the alias to delete (quoted string)'
    }
  ]
});

// 21. Delete invalid command BUS:B1<x>:DISplay:HIERarchical (doesn't exist)
console.log('21. Deleting invalid BUS:B1<x>:DISplay:HIERarchical');
deleteCommand('BUS:B1<x>:DISplay:HIERarchical');

// 22. Fix BUS:B1<x>:DISplay:LAYout -> should be BUS:B<x>:DISplay:LAYout
console.log('22. Deleting invalid BUS:B1<x>:DISplay:LAYout');
deleteCommand('BUS:B1<x>:DISplay:LAYout');

// Make sure BUS:B<x>:DISplay:LAYout has correct params
console.log('22b. Fixing BUS:B<x>:DISplay:LAYout');
findAndFixCommand('BUS:B<x>:DISplay:LAYout', {
  params: [
    {
      name: 'bus',
      type: 'integer',
      required: true,
      default: 1,
      description: 'B<x> is the bus number'
    },
    {
      name: 'layout',
      type: 'enumeration',
      required: true,
      default: 'BUS',
      options: ['BUS', 'BUSANDWAVEFORM'],
      description: 'BUS = bus form only, BUSANDWAVEFORM = bus and source waveforms'
    }
  ]
});

// 23-34. TRIGger and SEARCH Ethernet/MIL1553B/RS232/SERIAL commands - Add QString value params
const triggerValueCommands = [
  { scpi: 'TRIGger:A:BUS:ETHERnet:DATa:VALue', desc: 'Binary data value for Ethernet trigger' },
  { scpi: 'TRIGger:A:BUS:ETHERnet:IPHeader:PROTOcol:VALue', desc: 'Binary protocol value (e.g., 1=ICMP, 6=TCP, 17=UDP)' },
  { scpi: 'TRIGger:A:BUS:ETHERnet:IPHeader:SOUrceaddr:VALue', desc: 'Source address value' },
  { scpi: 'TRIGger:A:BUS:ETHERnet:QTAG:VALue', desc: 'QTAG value' },
  { scpi: 'TRIGger:A:BUS:ETHERnet:TCPHeader:ACKnum:VALue', desc: 'TCP ACK number value' },
  { scpi: 'TRIGger:A:BUS:ETHERnet:TCPHeader:SEQnum:VALue', desc: 'TCP sequence number value' },
  { scpi: 'TRIGger:A:BUS:ETHERnet:TCPHeader:SOUrceport:VALue', desc: 'TCP source port value' },
  { scpi: 'TRIGger:A:BUS:MIL1553B:COMMAND:ADDRess:VALue', desc: 'MIL1553B command address value' },
  { scpi: 'TRIGger:A:BUS:MIL1553B:COMMAND:COUNt', desc: 'MIL1553B command count value' },
  { scpi: 'TRIGger:A:BUS:MIL1553B:COMMAND:SUBADdress', desc: 'MIL1553B subaddress value' },
  { scpi: 'TRIGger:A:BUS:MIL1553B:DATA:VALue', desc: 'MIL1553B data value' },
  { scpi: 'TRIGger:A:BUS:MIL1553B:STATUS:ADDRess:VALue', desc: 'MIL1553B status address value' },
  { scpi: 'TRIGger:A:RS232:DATa:VALue', desc: 'RS232 data value' },
  { scpi: 'TRIGger:A:SERIAL:DATa:PATtern', desc: 'Serial data pattern' },
  { scpi: 'TRIGger:A:SERIAL:DATa:PATtern:NRZ', desc: 'NRZ serial data pattern' },
  { scpi: 'TRIGger:A:SERIAL:DATa:PATtern:S8B10B', desc: '8B10B serial data pattern' },
];

console.log('23-38. TRIGger value commands');
for (const cmd of triggerValueCommands) {
  findAndFixCommand(cmd.scpi, {
    params: [
      {
        name: 'value',
        type: 'string',
        required: true,
        default: '"XXXXXXXX"',
        description: `${cmd.desc}. Binary string (0, 1, X for don't care)`
      }
    ]
  });
}

// SEARCH versions of the same commands
const searchValueCommands = [
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:DATa:VALue', desc: 'Binary data value for Ethernet search' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:IPHeader:DESTinationaddr:VALue', desc: 'Destination address value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:IPHeader:PROTOcol:VALue', desc: 'Binary protocol value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:IPHeader:SOUrceaddr:VALue', desc: 'Source address value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:QTAG:VALue', desc: 'QTAG value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:TCPHeader:ACKnum:VALue', desc: 'TCP ACK number value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:TCPHeader:DESTinationport:VALue', desc: 'TCP destination port value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:TCPHeader:SEQnum:VALue', desc: 'TCP sequence number value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:ETHERnet:TCPHeader:SOUrceport:VALue', desc: 'TCP source port value' },
  { scpi: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:MIL1553B:DATA:VALue', desc: 'MIL1553B data value' },
];

console.log('39-48. SEARCH value commands');
for (const cmd of searchValueCommands) {
  findAndFixCommand(cmd.scpi, {
    params: [
      {
        name: 'search',
        type: 'integer',
        required: true,
        default: 1,
        description: 'SEARCH<x> is the search number'
      },
      {
        name: 'value',
        type: 'string',
        required: true,
        default: '"XXXXXXXX"',
        description: `${cmd.desc}. Binary string (0, 1, X for don't care)`
      }
    ]
  });
}

// EMail commands
console.log('49-50. EMail commands');
findAndFixCommand('EMail:SMTPServer', {
  params: [
    {
      name: 'server',
      type: 'string',
      required: true,
      default: '""',
      description: 'SMTP server address (quoted string)'
    }
  ]
});

findAndFixCommand('EMail:TO', {
  params: [
    {
      name: 'address',
      type: 'string',
      required: true,
      default: '""',
      description: 'Email recipient address (quoted string)'
    }
  ]
});

// RECAll:MASK - Takes source file and destination mask
console.log('51. RECAll:MASK');
findAndFixCommand('RECAll:MASK', {
  params: [
    {
      name: 'source_file',
      type: 'string',
      required: true,
      default: '"MaskFile.xml"',
      description: 'Source mask file path (.xml or .msk)'
    },
    {
      name: 'mask',
      type: 'enumeration',
      required: true,
      default: 'MASK1',
      options: ['MASK1', 'MASK2', 'MASK3', 'MASK4', 'MASK5', 'MASK6', 'MASK7', 'MASK8'],
      description: 'Destination mask (MASK<x>)'
    }
  ]
});

// SAVe:MASK - Takes mask number and filename
console.log('52. SAVe:MASK');
findAndFixCommand('SAVe:MASK', {
  params: [
    {
      name: 'mask',
      type: 'enumeration',
      required: true,
      default: 'MASK1',
      options: ['MASK1', 'MASK2', 'MASK3', 'MASK4', 'MASK5', 'MASK6', 'MASK7', 'MASK8'],
      description: 'Mask to save (MASK<x>)'
    },
    {
      name: 'filename',
      type: 'string',
      required: true,
      default: '"MaskFile.xml"',
      description: 'Destination file path (.xml for segment masks, .tol for tolerance masks)'
    }
  ]
});

// Additional TRIGger commands for CAN, I2C, SPI buses
const additionalTriggerCommands = [
  { scpi: 'TRIGger:A:CAN:DATa:VALue', desc: 'CAN data value (binary string)' },
  { scpi: 'TRIGger:A:CAN:IDENTifier:VALue', desc: 'CAN identifier value (binary string)' },
  { scpi: 'TRIGger:A:I2C:ADDRess:VALue', desc: 'I2C address value (binary string)' },
  { scpi: 'TRIGger:A:I2C:DATa:VALue', desc: 'I2C data value (binary string)' },
  { scpi: 'TRIGger:A:SPI:DATa:MISO:VALue', desc: 'SPI MISO data value (binary string)' },
  { scpi: 'TRIGger:A:SPI:DATa:MOSI:VALue', desc: 'SPI MOSI data value (binary string)' },
];

console.log('53-58. Additional TRIGger bus commands');
for (const cmd of additionalTriggerCommands) {
  findAndFixCommand(cmd.scpi, {
    params: [
      {
        name: 'value',
        type: 'string',
        required: true,
        default: '"XXXXXXXX"',
        description: `${cmd.desc}. Use 0, 1, X (don't care)`
      }
    ]
  });
}

// SEARCH CAN trigger command
console.log('59. SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:DATa:VALue');
findAndFixCommand('SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:DATa:VALue', {
  params: [
    {
      name: 'search',
      type: 'integer',
      required: true,
      default: 1,
      description: 'SEARCH<x> is the search number'
    },
    {
      name: 'value',
      type: 'string',
      required: true,
      default: '"XXXXXXXX"',
      description: 'Binary data value for CAN search. Use 0, 1, X (don\'t care)'
    }
  ]
});

// Additional string parameter commands
const stringParamCommands = [
  { scpi: 'WFMInpre:WFId', name: 'waveform_id', desc: 'Waveform identifier string' },
  { scpi: 'WFMInpre:XUNit', name: 'unit', desc: 'X-axis unit string' },
  { scpi: 'WFMInpre:YUNit', name: 'unit', desc: 'Y-axis unit string' },
  { scpi: 'AUXIn:PRObe:SET', name: 'setting', desc: 'Probe setting string' },
  { scpi: 'AUXIn:PROBEFunc:EXTUnits', name: 'units', desc: 'External units string' },
  { scpi: 'DISplay:SCREENTExt:LABel<x>:FONTCOlor', name: 'color', desc: 'Font color string' },
  { scpi: 'DISplay:SCREENTExt:LABel<x>:FONTNAme', name: 'font_name', desc: 'Font name string' },
  { scpi: 'DISplay:SCREENTExt:LABel<x>:FONTSTyle', name: 'style', desc: 'Font style string' },
  { scpi: 'DISplay:SCREENTExt:LABel<x>:NAMe', name: 'name', desc: 'Label name string' },
  { scpi: 'HORizontal:MAIn:UNIts', name: 'units', desc: 'Horizontal units string' },
  { scpi: 'HORizontal:MAIn:UNIts:STRing', name: 'units', desc: 'Horizontal units string' },
  { scpi: 'LIMit:SAVEWFM:FILEName', name: 'filename', desc: 'File name for saving waveform' },
  { scpi: 'MARK:SELECTED:LABel', name: 'label', desc: 'Mark label string' },
  { scpi: 'MASK:TESt:SAVEWFM:FILEName', name: 'filename', desc: 'File name for saving test waveform' },
  { scpi: 'MASK:USER:LABel', name: 'label', desc: 'User mask label string' },
  { scpi: 'SEARCH:SEARCH<x>', name: 'label', desc: 'Search label string' },
  { scpi: 'ERRORDetector:ALIGNCHARacter:SYMBOL', name: 'symbol', desc: 'Alignment character symbol' },
  { scpi: 'ERRORDetector:ALIGNPRIMitive:SYMBOL<x>', name: 'symbol', desc: 'Alignment primitive symbol' },
  { scpi: 'ERRORDetector:BIT:SYNCPATtern:BITString', name: 'pattern', desc: 'Bit sync pattern string' },
  { scpi: 'ERRORDetector:BIT:SYNCPATtern:SYMBOLS', name: 'symbols', desc: 'Sync pattern symbols' },
  { scpi: 'ERRORDetector:BIT:SYNCPATtern:SYMBOL<x>', name: 'symbol', desc: 'Sync pattern symbol' },
  { scpi: 'ERRORDetector:FRAme:EOF', name: 'pattern', desc: 'End of frame pattern' },
  { scpi: 'ERRORDetector:FRAme:SOF', name: 'pattern', desc: 'Start of frame pattern' },
  { scpi: 'ERRORDetector:PATTERNNAME', name: 'name', desc: 'Pattern name string' },
  { scpi: 'ERRORDetector:SKIPSETPRIMitive:SYMBOLS', name: 'symbols', desc: 'Skip set primitive symbols' },
  { scpi: 'ERRORDetector:SKIPSETPRIMitive:SYMBOL<x>', name: 'symbol', desc: 'Skip set primitive symbol' },
];

console.log('60+. Additional string parameter commands');
for (const cmd of stringParamCommands) {
  findAndFixCommand(cmd.scpi, {
    params: [
      {
        name: cmd.name,
        type: 'string',
        required: true,
        default: '""',
        description: cmd.desc
      }
    ]
  });
}

// Save the fixed data
console.log('\n=== Saving Fixed Data ===');
fs.writeFileSync(msoFile, JSON.stringify(data, null, 2));
console.log('MSO 4/5/6 file saved');
fs.writeFileSync(dpoFile, JSON.stringify(dpoData, null, 2));
console.log('DPO 5k/7k file saved');
console.log(`\nFixed ${fixCount} commands total`);

console.log('\n=== Running Audit to Verify ===');
