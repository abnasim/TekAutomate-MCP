/* ===================== Logic Block Overrides ===================== */
/* 
 * Override standard Blockly logic blocks to allow flexible type connections
 * This mimics Python's behavior where any truthy value can be used in conditions
 */

import * as Blockly from 'blockly';

/**
 * Override controls_if to accept any value type for conditions
 * In Python, any truthy value (non-zero number, non-empty string, etc.) works in if conditions
 */
const originalControlsIfInit = Blockly.Blocks['controls_if']?.init;

if (originalControlsIfInit) {
  Blockly.Blocks['controls_if'].init = function(this: Blockly.Block) {
    // Call original init
    originalControlsIfInit.call(this);
    
    // Store reference to this block for the closure
    const block = this;
    
    // After initialization, modify the IF inputs to accept any type
    // This allows Number, String, etc. to connect (Python-like truthy behavior)
    const originalUpdateShape = (this as any).updateShape_;
    (this as any).updateShape_ = function() {
      if (originalUpdateShape) {
        originalUpdateShape.call(block);
      }
      // Remove type restrictions from all IF inputs
      for (let i = 0; block.getInput('IF' + i); i++) {
        const input = block.getInput('IF' + i);
        if (input && input.connection) {
          input.setCheck(null); // Accept any type
        }
      }
    };
    
    // Also fix the initial IF0 input
    const if0Input = this.getInput('IF0');
    if (if0Input && if0Input.connection) {
      if0Input.setCheck(null); // Accept any type
    }
  };
}

/**
 * Override controls_ifelse similarly
 */
const originalControlsIfElseInit = Blockly.Blocks['controls_ifelse']?.init;

if (originalControlsIfElseInit) {
  Blockly.Blocks['controls_ifelse'].init = function(this: Blockly.Block) {
    originalControlsIfElseInit.call(this);
    
    // Remove type restrictions from IF input
    const ifInput = this.getInput('IF0');
    if (ifInput && ifInput.connection) {
      ifInput.setCheck(null);
    }
  };
}

/**
 * Override controls_whileUntil to accept any value type for conditions
 */
const originalWhileUntilInit = Blockly.Blocks['controls_whileUntil']?.init;

if (originalWhileUntilInit) {
  Blockly.Blocks['controls_whileUntil'].init = function(this: Blockly.Block) {
    originalWhileUntilInit.call(this);
    
    const boolInput = this.getInput('BOOL');
    if (boolInput && boolInput.connection) {
      boolInput.setCheck(null);
    }
  };
}

/**
 * Override logic_negate (not block) to accept any value type
 */
const originalLogicNegateInit = Blockly.Blocks['logic_negate']?.init;

if (originalLogicNegateInit) {
  Blockly.Blocks['logic_negate'].init = function(this: Blockly.Block) {
    originalLogicNegateInit.call(this);
    
    const boolInput = this.getInput('BOOL');
    if (boolInput && boolInput.connection) {
      boolInput.setCheck(null);
    }
  };
}

/**
 * Override logic_operation (and/or blocks) to accept any value type
 */
const originalLogicOperationInit = Blockly.Blocks['logic_operation']?.init;

if (originalLogicOperationInit) {
  Blockly.Blocks['logic_operation'].init = function(this: Blockly.Block) {
    originalLogicOperationInit.call(this);
    
    const inputA = this.getInput('A');
    const inputB = this.getInput('B');
    if (inputA && inputA.connection) {
      inputA.setCheck(null);
    }
    if (inputB && inputB.connection) {
      inputB.setCheck(null);
    }
  };
}

/**
 * Override logic_ternary (ternary operator) to accept any value type for condition
 */
const originalLogicTernaryInit = Blockly.Blocks['logic_ternary']?.init;

if (originalLogicTernaryInit) {
  Blockly.Blocks['logic_ternary'].init = function(this: Blockly.Block) {
    originalLogicTernaryInit.call(this);
    
    const ifInput = this.getInput('IF');
    if (ifInput && ifInput.connection) {
      ifInput.setCheck(null);
    }
  };
}

console.log('Logic block overrides applied - flexible type connections enabled');
