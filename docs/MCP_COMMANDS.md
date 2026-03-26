# 🚀 MCP-Only Mode Commands

## 📋 Available Commands in MCP Mode

### **🔧 Instrument Control**
- **Load files:** `load "C:\tests\baseline.tss"` → **Need more context!**
- **Save files:** `save "C:\tests\new_setup.tss"`
- **Measurements:** `measure voltage on channel 1`
- **Triggers:** `trigger on rising edge channel 1`

### **🎯 Better Load Command Examples:**
```
# GOOD - Specific context
load "C:\tests\baseline.tss" for oscilloscope channel 1
load "C:\tests\baseline.tss" with voltage measurement setup
load "C:\tests\baseline.tss" for power analysis

# BAD - Too generic
load C:\tests\baseline.tss
```

### **🔍 Smart SCPI Assistant (16,894+ commands)**
```
# Bus protocols
"I2C bus trigger commands"
"SPI communication setup"
"CAN bus configuration"

# Measurements  
"power measurement with harmonics"
"voltage RMS measurement"
"frequency analysis"

# Triggers
"edge trigger setup"
"video trigger commands"
"bus trigger I2C"
```

### **⚡ Quick Test Commands:**
```
# Test specific query
"I2C bus trigger commands"

# Test measurement
"power measurement harmonics"

# Test trigger
"rising edge trigger"
```

### **🎮 How to Use:**

1. **Be Specific:** Include channel, source, value, or protocol
2. **Use Context:** "for channel 1", "with voltage measurement"
3. **Ask Questions:** "What are the I2C commands?"

### **🚨 Why "load C:\tests\baseline.tss" Failed:**
- ❌ No instrument type specified
- ❌ No channel mentioned
- ❌ No measurement context
- ❌ Too generic for planner

### **✅ Fixed Version:**
```
load "C:\tests\baseline.tss" for oscilloscope channel 1 voltage measurement
```

**Ready to test! Try "I2C bus trigger commands" first!** 🎯
