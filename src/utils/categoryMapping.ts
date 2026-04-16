/**
 * Manual Category Name Mapping
 * 
 * Maps long section names from the manual to short, user-friendly display names.
 * This file allows manual overrides for category names that can't be auto-shortened.
 */

export const CATEGORY_NAME_MAP: Record<string, string> = {
  // Long section descriptions from manual
  'Use the commands in the Measurement Command Group to control the automated measurement system.': 'Measurement',
  'Use the commands in the Save and Recall Command Group to store and retrieve internal waveforms and settings. When you save a': 'Save/Recall',
  'Use the commands in the Search and Mark Command Group to search for specific events in waveforms and mark them.': 'Search and Mark',
  'Use the commands in the Trigger Command Group to control all aspects of triggering for the instrument.': 'Trigger',
  'Use the commands in the Bus Command Group to configure and control bus decoding.': 'Bus',
  'Use the commands in the Display Control Command Group to control the display appearance and behavior.': 'Display',
  'Use the commands in the Horizontal Command Group to control horizontal timebase settings.': 'Horizontal',
  'Use the commands in the Vertical Command Group to control vertical channel settings.': 'Vertical',
  'Use the commands in the Math Command Group to create and configure math waveforms.': 'Math',
  'Use the commands in the Cursor Commands to control cursor measurements and display.': 'Cursor',
  'Use the commands in the Waveform Transfer Command Group to transfer waveform data.': 'Waveform Transfer',
  'Use the commands in the Acquisition Command Group to control acquisition settings.': 'Acquisition',
  'Use the commands in the Power Command Group to configure power measurements.': 'Power',
  'Use the commands in the Plot Command Group to configure plot displays.': 'Plot',
  'Use the commands in the Mask Command Group to configure mask testing.': 'Mask',
  'Use the commands in the Histogram Group to configure histogram displays.': 'Histogram',
  'Use the commands in the Spectrum View Command Group to configure spectrum analysis.': 'Spectrum View',
  'Use the commands in the Zoom Command Group to control zoom functionality.': 'Zoom',
  'Use the commands in the File System Command Group to manage files.': 'File System',
  'Use the commands in the Miscellaneous Command Group for various utility functions.': 'Miscellaneous',
  
  // Additional patterns
  'Measurement Command Group': 'Measurement',
  'Save and Recall Command Group': 'Save/Recall',
  'Search and Mark Command Group': 'Search and Mark',
  'Trigger Command Group': 'Trigger',
  'Bus Command Group': 'Bus',
  'Display Control Command Group': 'Display',
  'Horizontal Command Group': 'Horizontal',
  'Vertical Command Group': 'Vertical',
  'Math Command Group': 'Math',
  'Acquisition Command Group': 'Acquisition',
  'Power Command Group': 'Power',
  'Plot Command Group': 'Plot',
  'Mask Command Group': 'Mask',
  'Histogram Group': 'Histogram',
  'Spectrum View Command Group': 'Spectrum View',
  'Zoom Command Group': 'Zoom',
  'File System Command Group': 'File System',
  'Miscellaneous Command Group': 'Miscellaneous',
  
  // Shorten other long names
  'Digital Power Management (DPM) command group': 'DPM',
  'Inverter Motors and Drive Analysis (IMDA) Group': 'IMDA',
  'Wide Band Gap Analysis (WBG) command group': 'WBG',
  'Act on event command group': 'Act on Event',
  'AFG Command Group': 'AFG',
  'Alias command group': 'Alias',
  'Calibration command group': 'Calibration',
  'Callout command group': 'Callout',
  'Digital command group': 'Digital',
  'DVM command group': 'DVM',
  'Ethernet command group': 'Ethernet',
  'History group': 'History',
  'Self Test command group': 'Self Test',
  'Status and Error command group': 'Status and Error',
  'Save on command group': 'Save on Event',
};

/**
 * Get display name for a section/category
 * First checks manual mapping, then applies auto-shortening
 */
export function getCategoryDisplayName(sectionName: string): string {
  // Check manual mapping first
  if (CATEGORY_NAME_MAP[sectionName]) {
    return CATEGORY_NAME_MAP[sectionName];
  }
  
  // Auto-shorten long names
  if (sectionName.length > 50) {
    // Pattern: "Use the commands in the X Command Group..." -> "X"
    const match = sectionName.match(/Use the commands in the (.+?)(?: Command Group| to)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Pattern: "Use the commands in the X to..." -> "X"
    const match2 = sectionName.match(/Use the commands in the (.+?) to/i);
    if (match2 && match2[1]) {
      return match2[1].trim();
    }
    
    // Extract key words
    if (sectionName.includes('Measurement')) return 'Measurement';
    if (sectionName.includes('Save') && sectionName.includes('Recall')) return 'Save/Recall';
    if (sectionName.includes('Search') && sectionName.includes('Mark')) return 'Search and Mark';
    if (sectionName.includes('Trigger')) return 'Trigger';
    if (sectionName.includes('Bus')) return 'Bus';
    if (sectionName.includes('Display')) return 'Display';
    if (sectionName.includes('Horizontal')) return 'Horizontal';
    if (sectionName.includes('Vertical')) return 'Vertical';
    if (sectionName.includes('Math')) return 'Math';
    if (sectionName.includes('Cursor')) return 'Cursor';
    if (sectionName.includes('Waveform')) return 'Waveform Transfer';
    if (sectionName.includes('Acquisition')) return 'Acquisition';
    if (sectionName.includes('Power')) return 'Power';
    if (sectionName.includes('Plot')) return 'Plot';
    if (sectionName.includes('Mask')) return 'Mask';
    if (sectionName.includes('Histogram')) return 'Histogram';
    if (sectionName.includes('Spectrum')) return 'Spectrum View';
    if (sectionName.includes('Zoom')) return 'Zoom';
    if (sectionName.includes('File System')) return 'File System';
    
    // Fallback: truncate
    return sectionName.substring(0, 50) + '...';
  }
  
  return sectionName;
}

/**
 * Normalize category name to consolidate duplicates
 * Handles comma-separated categories like "DPM, Measurement" -> "Measurement" (if Measurement is primary)
 * or "DPM" (if DPM is primary)
 */
export function normalizeCategoryName(categoryName: string): string {
  if (!categoryName) return 'miscellaneous';
  
  // Remove extra whitespace
  categoryName = categoryName.trim();
  
  // Handle comma-separated categories - extract the primary category
  if (categoryName.includes(',')) {
    const parts = categoryName.split(',').map(p => p.trim());
    
    // Priority order: main categories first, then analysis categories
    const priorityCategories = [
      'Measurement', 'Acquisition', 'Trigger', 'Display', 'Horizontal', 'Vertical',
      'Math', 'Cursor', 'Bus', 'Waveform Transfer', 'Data', 'Channels',
      'Power', 'Plot', 'Mask', 'Histogram', 'Spectrum View', 'File System',
      'Save/Recall', 'Search and Mark', 'System', 'Miscellaneous'
    ];
    
    // Find first priority category
    for (const priority of priorityCategories) {
      if (parts.some(p => p === priority || p.includes(priority))) {
        return priority;
      }
    }
    
    // If no priority category, check for analysis categories
    if (parts.some(p => p.includes('DPM') || p === 'DPM')) return 'DPM';
    if (parts.some(p => p.includes('IMDA') || p === 'IMDA')) return 'IMDA';
    if (parts.some(p => p.includes('WBG') || p === 'WBG')) return 'WBG';
    
    // Return first part if no match
    return parts[0];
  }
  
  // Normalize common variations
  const normalized = categoryName
    .replace(/Command Group$/i, '')
    .replace(/command group$/i, '')
    .replace(/Group$/i, '')
    .replace(/group$/i, '')
    .trim();
  
  // Map common variations
  if (normalized.includes('Digital Power Management') || normalized.includes('DPM')) return 'DPM';
  if (normalized.includes('Inverter Motors') || normalized.includes('IMDA')) return 'IMDA';
  if (normalized.includes('Wide Band Gap') || normalized.includes('WBG')) return 'WBG';
  if (normalized.includes('Display Control')) return 'Display Control';
  if (normalized.includes('Save and Recall') || normalized.includes('Save/Recall')) return 'Save/Recall';
  if (normalized.includes('Search and Mark')) return 'Search and Mark';
  if (normalized.includes('Status and Error')) return 'Status and Error';
  if (normalized.includes('Waveform Transfer')) return 'Waveform Transfer';
  if (normalized === 'Waveform') return 'Waveform';
  
  return normalized || 'miscellaneous';
}


