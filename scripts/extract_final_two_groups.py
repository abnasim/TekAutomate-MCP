# Wide Band Gap Analysis (WBG) commands
wbg = [
    "MEASUrement:AUTOset",
    "MEASUrement:MEAS<x>:BVOLTage",
    "MEASUrement:MEAS<x>:DMEThod",
    "MEASUrement:MEAS<x>:DVDS",
    "MEASUrement:MEAS<x>:EEQUal",
    "MEASUrement:MEAS<x>:EINDuctance",
    "MEASUrement:MEAS<x>:FORDer",
    "MEASUrement:MEAS<x>:LTYPe",
    "MEASUrement:MEAS<x>:LUNITs",
    "MEASUrement:MEAS<x>:MAXTime",
    "MEASUrement:MEAS<x>:MAXCUrrent",
    "MEASUrement:MEAS<x>:MAXG<x>Voltage",
    "MEASUrement:MEAS<x>:MAXGVoltage",
    "MEASUrement:MEAS<x>:MAXVoltage",
    "MEASUrement:MEAS<x>:PCOUNt",
    "MEASUrement:MEAS<x>:PREGion",
    "MEASUrement:MEAS<x>:PRESistance",
    "MEASUrement:MEAS<x>:REDGe",
    "MEASUrement:MEAS<x>:SLABs",
    "MEASUrement:MEAS<x>:SLPCt",
    "MEASUrement:MEAS<x>:SLTYpe",
    "MEASUrement:MEAS<x>:SPECification",
    "MEASUrement:MEAS<x>:SSDirection",
    "MEASUrement:MEAS<x>:STLABs",
    "MEASUrement:MEAS<x>:STLPct",
    "MEASUrement:MEAS<x>:STLTYpe",
    "MEASUrement:MEAS<x>:STSDirection",
    "MEASUrement:MEAS<x>:SUBGROUP:RESUlts:CURRentacq:MEAN?",
    "MEASUrement:MEAS<x>:SUBGROUP:RESUlts:CURRentacq:MINimum?",
    "MEASUrement:MEAS<x>:WBG:BCOunt",
    "MEASUrement:MEAS<x>:WBG:BDELay",
    "MEASUrement:MEAS<x>:WBG:CSTatus?",
    "MEASUrement:MEAS<x>:WBG:DELay",
    "MEASUrement:MEAS<x>:WBG:ESONe",
    "MEASUrement:MEAS<x>:WBG:ESTWo",
    "MEASUrement:MEAS<x>:WBG:GENAddress",
    "MEASUrement:MEAS<x>:WBG:GENSetup",
    "MEASUrement:MEAS<x>:WBG:GSOurce<x>:HIGH",
    "MEASUrement:MEAS<x>:WBG:GSOurce<x>:LOAD",
    "MEASUrement:MEAS<x>:WBG:GSOurce<x>:LOW",
    "MEASUrement:MEAS<x>:WBG:GSOurce<x>:PG<x>Val",
    "MEASUrement:MEAS<x>:WBG:GSOurce<x>:PW<x>Val",
    "MEASUrement:MEAS<x>:WBG:GTYPe",
    "MEASUrement:MEAS<x>:WBG:NPULs",
    "MEASUrement:MEAS<x>:WBG:TIMer",
    "MEASUrement:WBG:PDEVice",
    "PLOT:PLOT<x>:PREGion"
]

# Zoom commands
zoom = [
    "DISplay:MATHFFTView<x>:ZOOM:XAXIS:FROM",
    "DISplay:MATHFFTView<x>:ZOOM:XAXIS:TO",
    "DISplay:MATHFFTView<x>:ZOOM:YAXIS:FROM",
    "DISplay:MATHFFTView<x>:ZOOM:YAXIS:TO",
    "DISplay:PLOTView<x>:ZOOM:XAXIS:FROM",
    "DISplay:PLOTView<x>:ZOOM:XAXIS:TO",
    "DISplay:PLOTView<x>:ZOOM:YAXIS:FROM",
    "DISplay:PLOTView<x>:ZOOM:YAXIS:TO",
    "DISplay:REFFFTView<x>:ZOOM:XAXIS:FROM",
    "DISplay:REFFFTView<x>:ZOOM:XAXIS:TO",
    "DISplay:REFFFTView<x>:ZOOM:YAXIS:FROM",
    "DISplay:REFFFTView<x>:ZOOM:YAXIS:TO",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:HORizontal:POSition",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:HORizontal:SCALe",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:HORizontal:WINSCALe",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:STATe",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:VERTical:POSition",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>:VERTical:SCALe",
    "DISplay:WAVEView<x>:ZOOM?",
    "DISplay:WAVEView<x>:ZOOM:ZOOM<x>?"
]

print("Wide Band Gap Analysis (WBG):", len(wbg))
print("Zoom:", len(zoom))
print("\nTotal:", len(wbg) + len(zoom))










