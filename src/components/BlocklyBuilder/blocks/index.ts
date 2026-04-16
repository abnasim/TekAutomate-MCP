/* ===================== Block Definitions Index ===================== */

// Import all block definitions to register them with Blockly
import './connectionBlocks';
import './scpiBlocks';
import './enhancedScpiBlocks';  // Enhanced SCPI blocks with parameter dropdowns
import './channelBlocks';
import './acquisitionBlocks';
import './dataBlocks';
import './timingBlocks';
import './utilityBlocks';
import './tmDevicesBlocks';
import './tekexpressBlocks';  // TekExpress compliance testing blocks
import './logicBlockOverrides';  // Override standard logic blocks for flexible type connections

// Export helper functions
export { updateDeviceDropdowns } from './connectionBlocks';
export { updateSCPIDeviceDropdowns } from './scpiBlocks';
export { setActiveDeviceDriver, getActiveDeviceDriver } from './channelBlocks';
