# Using Blockly with TekAutomate Script Generator GPT

This guide explains how to use the Blockly Builder with the TekAutomate Script Generator GPT for enhanced workflow creation and validation.

## Workflow Options

### 1. Create in Blockly → Verify/Enhance with GPT

**Steps:**
1. Build your automation workflow in the Blockly Builder
2. Click the **"Copy XML"** button in the toolbar
   - The button will show "Copied!" with a green checkmark when successful
   - XML is formatted with proper indentation for readability
3. Open the TekAutomate Script Generator GPT
4. Paste the XML and ask the GPT to:
   - Verify the workflow structure
   - Suggest improvements
   - Add error handling
   - Optimize the sequence
   - Convert to Steps UI JSON if needed

**Example Prompts:**
```
Here's my Blockly workflow XML. Can you verify it's correct and suggest any improvements?

[paste XML]
```

```
I have this Blockly automation. Can you add better error handling and explain what it does?

[paste XML]
```

### 2. Start with GPT → Import to Blockly

**Steps:**
1. Describe your workflow to the TekAutomate Script Generator GPT
2. Ask it to generate Blockly XML format
3. Copy the XML from the GPT's response
4. In Blockly Builder:
   - Click **"Load File"** → Select/paste XML, OR
   - Save the XML to a file and use **"Load File"**

**Example Prompt:**
```
Generate Blockly XML for a workflow that connects to an MSO6B at 192.168.1.10, 
loops 10 times setting CH1 scale from 1V to 10V, and saves each waveform.
```

### 3. Convert Between Formats

**Steps:**
1. Have an existing Steps UI JSON workflow
2. Ask the GPT to convert it to Blockly XML
3. Copy the XML and import into Blockly Builder
4. Enhance with loops, conditions, and variables visually
5. Export back to Steps UI if needed

## What the "Copy XML" Button Does

The **"Copy XML"** button in Blockly Builder:
- ✅ Exports the current workspace as properly formatted XML
- ✅ Uses pretty-printing with indentation (not a single line)
- ✅ Copies directly to your clipboard
- ✅ Includes all blocks, connections, variables, and settings
- ✅ Ready to paste into ChatGPT/GPT without modification

## Benefits of This Workflow

### Visual + AI Collaboration
- **Blockly**: Visual block programming makes structure clear
- **GPT**: AI can suggest optimizations, add error handling, explain logic

### Format Flexibility
- Create in format that suits the task
- Convert between Blockly XML and Steps UI JSON
- Generate Python code from either format

### Quality Assurance
- GPT can validate your Blockly XML structure
- Catch common mistakes before running
- Get suggestions for best practices

### Learning Tool
- Ask GPT to explain what your Blockly workflow does
- Get suggestions for improvements
- Learn instrument automation patterns

## Common Use Cases

### 1. Complex Loop Optimization
**You**: Build basic loop in Blockly  
**GPT**: Suggest ways to optimize (parallel operations, better timing)  
**You**: Apply improvements in Blockly visually  

### 2. Error Handling
**You**: Create main workflow in Blockly  
**GPT**: Add comprehensive error checking and recovery  
**You**: Import enhanced version back to Blockly  

### 3. Multi-Instrument Coordination
**You**: Describe complex multi-instrument test  
**GPT**: Generate optimized Blockly XML with proper sequencing  
**You**: Visualize and fine-tune in Blockly Builder  

### 4. Documentation
**You**: Copy XML of completed workflow  
**GPT**: Generate detailed documentation and test plan  

## Tips

1. **Always verify GPT output**: Import generated XML into Blockly to visually confirm structure
2. **Use descriptive names**: Name your devices and variables clearly for GPT to understand context
3. **Iterative refinement**: Start simple, use GPT to enhance, visualize in Blockly, repeat
4. **Save versions**: Use "Save File" to keep snapshots before major changes

## Example Session

```
User: [Pastes Blockly XML of scope automation]
Can you review this and suggest improvements?

GPT: Your workflow looks good! Here are a few suggestions:
1. Add error checking after each SCPI command
2. Add a wait for OPC after starting acquisition
3. Use a variable for the filename with iteration number
4. Here's the enhanced XML: [provides improved version]

User: Great! Can you also convert this to Steps UI JSON?

GPT: Here's the equivalent Steps UI JSON: [provides JSON]

User: Perfect! Now explain what this automation does in plain English.

GPT: This automation connects to an oscilloscope, configures it for...
```

## Troubleshooting

### XML Won't Import
- Check that XML starts with `<xml xmlns="https://developers.google.com/blockly/xml">`
- Ensure all blocks have unique IDs
- Verify field names match exactly (case-sensitive)

### GPT Says XML is Invalid
- Copy fresh XML from Blockly (don't edit manually)
- Ensure you copied the complete XML (check closing `</xml>` tag)
- Try saving as file and uploading to GPT instead

### Formatting Issues
- Always use the "Copy XML" button (not "Save File" → copy from file)
- Don't paste XML into text editors that might modify it
- Use the GPT's suggested XML by copying directly from chat

## Advanced: Custom Blocks

If you create custom blocks in Blockly:
1. Copy the XML normally
2. Tell the GPT about your custom block's purpose and fields
3. GPT can work with custom blocks as long as structure is valid

---

**Need Help?** The GPT has full knowledge of TekAutomate's block types, SCPI commands, and best practices. Just ask!
