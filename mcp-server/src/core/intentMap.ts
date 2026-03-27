import type { CommandRecord } from './commandIndex';
import type { MicroTool } from './toolRegistry';
import { suggestCommandGroups } from './commandGroups';

export interface IntentResult {
  groups: string[];        // Canonical group names from commandGroups.json
  intent: string;          // Primary intent category
  subject: string;         // Specific subject (e.g., "jitter", "i2c", "voltage")
  action: string;          // User action: "add" | "configure" | "query" | "remove" | "find"
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================
// PHASE 1: Extract action verb
// ============================================================
const ACTION_PATTERNS: Array<{ pattern: RegExp; action: string }> = [
  { pattern: /\b(add|create|insert|new|enable|turn\s*on)\b/i, action: 'add' },
  { pattern: /\b(remove|delete|clear|erase|disable|turn\s*off)\b/i, action: 'remove' },
  { pattern: /\b(setup|configure|set|adjust|change|apply)\b/i, action: 'configure' },
  { pattern: /\b(query|get|read|what\s*is|show|display|check)\b/i, action: 'query' },
  { pattern: /\b(measure|meas)\b/i, action: 'add' },  // "measure X" means "add measurement for X"
  { pattern: /\b(save|store|export|capture|screenshot)\b/i, action: 'save' },
  { pattern: /\b(trigger|trig)\b/i, action: 'configure' },
];

function extractAction(query: string): string {
  for (const { pattern, action } of ACTION_PATTERNS) {
    if (pattern.test(query)) return action;
  }
  return 'find';
}

// ============================================================
// PHASE 2: Subject-to-group mapping (THE CORE FIX)
// Each entry maps a user-facing keyword/phrase → canonical group names
// Order matters: more specific patterns checked first
// ============================================================
const SUBJECT_GROUP_MAP: Array<{
  pattern: RegExp;
  groups: string[];
  intent: string;
  subject: string;
}> = [
  // ── Bus protocols (most specific first) ──
  { pattern: /\bi2c\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'i2c' },
  { pattern: /\bspi\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'spi' },
  { pattern: /\b(can\s*fd|canfd)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'can_fd' },
  { pattern: /\b(can\s*bus|can\s*decode|can\s*trigger|can\s*2\.0|can\s*protocol)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'can' },
  { pattern: /\blin\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'lin' },
  { pattern: /\b(uart|rs232|rs422|rs485|serial)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'serial' },
  { pattern: /\b(flexray|flex\s*ray)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'flexray' },
  { pattern: /\b(ethernet|eth|100base|1000base)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'ethernet' },
  { pattern: /\b(arinc|arinc429)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'arinc429' },
  { pattern: /\b(mil.?std|1553)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'milstd1553' },
  { pattern: /\b(spacewire|spw)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'spacewire' },
  { pattern: /\b(i3c)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'i3c' },
  { pattern: /\b(bus|decode|protocol)\b/i, groups: ['Bus'], intent: 'bus', subject: 'bus' },

  // ── Measurement types (specific before generic) ──
  { pattern: /\b(eye\s*diagram|eye\s*pattern|eye)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'eye' },
  { pattern: /\b(jitter|tj|rj|dj|pj)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'jitter' },
  { pattern: /\b(rise\s*time|risetime)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'rise_time' },
  { pattern: /\b(fall\s*time|falltime)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'fall_time' },
  { pattern: /\b(duty\s*cycle|duty)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'duty_cycle' },
  { pattern: /\b(overshoot|preshoot|undershoot)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'overshoot' },
  { pattern: /\b(skew|delay)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'skew' },
  { pattern: /\b(pk2pk|peak.to.peak|pkpk|vpp|peak\s*to\s*peak)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'pk2pk' },
  { pattern: /\b(frequency|freq)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'frequency' },
  { pattern: /\b(period)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'period' },
  { pattern: /\b(amplitude|amp)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'amplitude' },
  { pattern: /\b(rms|vrms)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'rms' },
  { pattern: /\b(mean|average|avg)\b/i, groups: ['Measurement', 'Acquisition'], intent: 'measurement', subject: 'mean' },
  { pattern: /\b(burst)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'burst' },
  { pattern: /\b(area|cycle\s*area)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'area' },
  { pattern: /\b(phase)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'phase' },
  { pattern: /\b(result|results\s*table|detailed\s*results|statistics)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'results' },
  { pattern: /\b(measurement|measure|meas)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'measurement' },
  { pattern: /\b(clear\s*measurements|clear\s*meas|reset\s*measurements|delete\s*measurements)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'clear_measurements' },
  { pattern: /\b(clear|delete|remove)\b(?!.*\bmath\b)/i, groups: ['Measurement'], intent: 'measurement', subject: 'clear' },

  // ── Specific Measurement Table Commands ──
  { pattern: /\b(add\s*measurement\s*table|measurement\s*table|results\s*table|meas\s*table)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'measurement_table' },
  { pattern: /\b(custom\s*table|add\s*table|new\s*table)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'custom_table' },
  { pattern: /\b(delete\s*table|remove\s*table|clear\s*table)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'delete_table' },
  { pattern: /\b(list\s*tables|show\s*tables)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'list_tables' },

  // ── Specific Measurement Types (nested commands) ──
  { pattern: /\b(add\s*measurement|new\s*measurement|create\s*measurement)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'add_measurement' },
  { pattern: /\b(thd|total\s*harmonic\s*distortion|harmonics|distortion)\b/i, groups: ['Measurement', 'Power'], intent: 'measurement', subject: 'thd' },
  { pattern: /\b(acpr|adjacent\s*channel\s*power\s*ratio)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'acpr' },
  { pattern: /\b(snr|signal\s*to\s*noise\s*ratio|noise)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'snr' },
  { pattern: /\b(sinad|signal\s*to\s*noise\s*and\s*distortion)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'sinad' },
  { pattern: /\b(enob|effective\s*number\s*of\s*bits)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'enob' },
  { pattern: /\b(sfdr|spurious\s*free\s*dynamic\s*range)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'sfdr' },

  // ── Math / FFT ── (must come before general channel to catch "math channel")
  { pattern: /\b(fft|spectrum)\b/i, groups: ['Math'], intent: 'math', subject: 'fft' },
  { pattern: /\b(math\s*channel|math\s*trace|math\s*waveform)\b/i, groups: ['Math'], intent: 'math', subject: 'math_channel' },
  { pattern: /\b(add\s*math\s*channel|new\s*math)\b/i, groups: ['Math'], intent: 'math', subject: 'math_channel' },
  { pattern: /\b(math|expression|equation)\b/i, groups: ['Math'], intent: 'math', subject: 'math' },

  // ── Specific Math Commands (nested) ──
  { pattern: /\b(delete\s*math\s*channel|remove\s*math\s*channel|clear\s*math\s*channel)\b/i, groups: ['Math'], intent: 'math', subject: 'delete_math_channel' },
  { pattern: /\b(add\s*math|create\s*math|new\s*math\s*expression|math\s*add)\b/i, groups: ['Math'], intent: 'math', subject: 'add_math' },
  { pattern: /\b(delete\s*math|remove\s*math|clear\s*math|math\s*delete)\b/i, groups: ['Math'], intent: 'math', subject: 'delete_math' },
  { pattern: /\b(math\s*source|math\s*input|math\s*sourcing)\b/i, groups: ['Math'], intent: 'math', subject: 'math_source' },
  { pattern: /\b(math\s*expression|math\s*formula|math\s*definition)\b/i, groups: ['Math'], intent: 'math', subject: 'math_expression' },
  { pattern: /\b(spectrum\s*view|fft\s*view|frequency\s*analysis|spectral)\b/i, groups: ['Math', 'Spectrum view'], intent: 'math', subject: 'spectrum_view' },

  // ── Fallback Math Patterns ──
  { pattern: /\b(math1|math2|math3|math4)\b/i, groups: ['Math'], intent: 'math', subject: 'math_channel' },
  { pattern: /\b(select\s*math|math\s*select)\b/i, groups: ['Math'], intent: 'math', subject: 'math_select' },

  // ── Voltage / Channel (Vertical) ──
  { pattern: /\b(vertical\s*scale|channel\s*scale|v\s*\/\s*div|volts?\s*per\s*div)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'channel_scale' },
  { pattern: /\b(channel\s*offset|vertical\s*offset)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'channel_offset' },
  { pattern: /\b(channel\s*bandwidth|bandwidth\s*limit|bw\s*limit)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'channel_bandwidth' },
  { pattern: /\b(channel\s*position|vertical\s*position)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'channel_position' },
  { pattern: /\b(coupling|ac\s*coupling|dc\s*coupling)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'coupling' },
  { pattern: /\b(termination|50\s*ohm|1\s*meg)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'termination' },
  { pattern: /\b(voltage|volt)\b/i, groups: ['Vertical', 'Measurement', 'Cursor'], intent: 'vertical', subject: 'voltage' },
  { pattern: /\b(ch\s*\d|channel\s*\d)\s*(bandwidth|bw)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'channel_bandwidth' },
  { pattern: /\b(ch\d|channel\s*\d)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'channel' },
  { pattern: /\b(probe|attenuation|atten)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'probe' },
  { pattern: /\b(bandwidth|bw)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'bandwidth' },
  { pattern: /\b(scale)\b(?!.*\b(time|horiz))/i, groups: ['Vertical', 'Horizontal'], intent: 'vertical', subject: 'scale' },
  { pattern: /\b(label|name\s*channel)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'label' },
  { pattern: /\b(deskew)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'deskew' },
  { pattern: /\b(invert)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'invert' },

  // ── Specific Vertical/Channel Commands (nested) ──
  { pattern: /\b(channel\s*on|turn\s*on\s*channel|enable\s*channel|show\s*channel)\b/i, groups: ['Vertical', 'Display'], intent: 'vertical', subject: 'channel_on' },
  { pattern: /\b(channel\s*off|turn\s*off\s*channel|disable\s*channel|hide\s*channel)\b/i, groups: ['Vertical', 'Display'], intent: 'vertical', subject: 'channel_off' },
  { pattern: /\b(select\s*channel|channel\s*select)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'select_channel' },
  { pattern: /\b(invert\s*channel|channel\s*invert)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'invert_channel' },
  { pattern: /\b(probe\s*compensation|probe\s*comp)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'probe_comp' },
  { pattern: /\b(probe\s*attenuation|probe\s*atten)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'probe_atten' },
  { pattern: /\b(vernier|fine\s*scale)\b/i, groups: ['Vertical'], intent: 'vertical', subject: 'vernier' },

  // ── Trigger types ──
  { pattern: /\b(edge\s*trigger|trigger\s*edge|set\s*trigger\s*to\s*edge)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'edge' },
  { pattern: /\btrigger\b.*\b(rising|falling)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'edge' },
  { pattern: /\b(rising|falling)\b.*\btrigger\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'edge' },
  { pattern: /\b(pulse\s*trigger|trigger\s*pulse|pulse\s*width|glitch)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'pulse' },
  { pattern: /\b(runt\s*trigger|trigger\s*runt|runt)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'runt' },
  { pattern: /\b(timeout\s*trigger|trigger\s*timeout)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'timeout' },
  { pattern: /\b(logic\s*trigger|trigger\s*logic|pattern\s*trigger)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'logic' },
  { pattern: /\b(video\s*trigger|trigger\s*video)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'video' },
  { pattern: /\b(window\s*trigger|trigger\s*window)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'window' },
  { pattern: /\b(bus\s*trigger|trigger\s*bus|trigger.*protocol)\b/i, groups: ['Trigger', 'Bus'], intent: 'trigger', subject: 'bus_trigger' },
  { pattern: /\b(trigger\s*level)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'trigger_level' },
  { pattern: /\b(trigger\s*slope)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'trigger_slope' },
  { pattern: /\b(trigger\s*holdoff)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'trigger_holdoff' },
  { pattern: /\b(trigger\s*mode)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'trigger_mode' },
  { pattern: /\b(trigger|trig|holdoff|level)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'trigger' },
  { pattern: /\b(slope|edge)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'edge' },

  // ── Acquisition ──
  { pattern: /\b(sample\s*rate|sampling|samplerate)\b/i, groups: ['Acquisition', 'Horizontal'], intent: 'acquisition', subject: 'sample_rate' },
  { pattern: /\b(record\s*length|record|rlength)\b/i, groups: ['Horizontal'], intent: 'acquisition', subject: 'record_length' },
  { pattern: /\b(single\s*seq|single\s*shot|single)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'single' },
  { pattern: /\b(run|stop|acquire|acquisition)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'acquisition' },
  { pattern: /\b(fastframe|fast\s*frame|fast.frame|enable\s*fastframe|fastframe\s*mode)\b/i, groups: ['Horizontal'], intent: 'acquisition', subject: 'fastframe' },
  { pattern: /\b(numavg|num\s*avg|averaging)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'averaging' },

  // ── Horizontal / Timebase ──
  // Compound patterns MUST come before general "horizontal" pattern
  { pattern: /\b(horizontal\s*scale|time\s*scale|timebase\s*scale|set\s*timebase)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_scale' },
  { pattern: /\b(horizontal\s*position|time\s*position|delay|time\s*delay)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_position' },
  { pattern: /\b(horizontal\s*offset)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_offset' },
  { pattern: /\b(horizontal\s*delay)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_delay' },
  { pattern: /\b(horizontal\s*mode|timebase\s*mode)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_mode' },
  
  // General patterns (after specific ones)
  { pattern: /\b(timebase|time\s*base|time\s*per\s*div|horizontal)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'timebase' },
  { pattern: /\b(zoom|magnify)\b/i, groups: ['Zoom'], intent: 'horizontal', subject: 'zoom' },

  // ── Specific Horizontal Commands (nested) ──
  { pattern: /\b(record\s*length|memory\s*depth|acquisition\s*depth|recordlength)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'record_length' },
  { pattern: /\b(acquisition\s*duration|acq\s*duration|waveform\s*duration|acqduration)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'acquisition_duration' },
  { pattern: /\b(divisions|div|grid|horizontal\s*divisions)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'divisions' },

  // ── Fallback Horizontal Patterns ──
  { pattern: /\b(display\s*scale)\b/i, groups: ['Display'], intent: 'display', subject: 'display_scale' },
  { pattern: /\b(scale|timebase|delay|position)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_general' },
  { pattern: /\b(duration|acqduration|recordlength)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_general' },

  // ── Power ──
  { pattern: /\b(harmonics|thd|distortion|power\s*quality)\b/i, groups: ['Power', 'Measurement'], intent: 'power', subject: 'harmonics' },
  { pattern: /\b(switching\s*loss|sloss)\b/i, groups: ['Power'], intent: 'power', subject: 'switching_loss' },
  { pattern: /\b(power|watt|efficiency|control\s*loop)\b/i, groups: ['Power'], intent: 'power', subject: 'power' },

  // ── DPM / IMDA ──
  { pattern: /\b(dpm|power\s*management|power\s*rail)\b/i, groups: ['Digital Power Management'], intent: 'dpm', subject: 'dpm' },
  { pattern: /\b(imda|motor\s*drive|torque|ripple)\b/i, groups: ['Inverter Motors and Drive Analysis'], intent: 'imda', subject: 'imda' },

  // ── WBG ──
  { pattern: /\b(wbg|wide\s*band\s*gap|double\s*pulse)\b/i, groups: ['Wide Band Gap Analysis (WBG)'], intent: 'wbg', subject: 'wbg' },

  // ── Display ──
  { pattern: /\b(cursor|bar|crosshair|readout)\b/i, groups: ['Cursor'], intent: 'display', subject: 'cursor' },
  { pattern: /\b(graticule|grid|persistence|intensity|brightness)\b/i, groups: ['Display'], intent: 'display', subject: 'display' },
  { pattern: /\b(waveview|display|screen)\b/i, groups: ['Display'], intent: 'display', subject: 'display' },
  { pattern: /\b(histogram)\b/i, groups: ['Histogram'], intent: 'display', subject: 'histogram' },
  { pattern: /\b(plot|trend)\b/i, groups: ['Plot'], intent: 'display', subject: 'plot' },

  // ── Simple Display Patterns (fallback) ──
  { pattern: /\b(display|screen|graticule|intensity|persistence)\b/i, groups: ['Display'], intent: 'display', subject: 'display_simple' },
  { pattern: /\b(cursor|readout|crosshair)\b/i, groups: ['Cursor'], intent: 'display', subject: 'cursor_simple' },

  // ── Specific Display Commands (nested) ──
  { pattern: /\b(display\s*on|screen\s*on|turn\s*on\s*display|display\s*enable)\b/i, groups: ['Display'], intent: 'display', subject: 'display_on' },
  { pattern: /\b(display\s*off|screen\s*off|turn\s*off\s*display|display\s*disable)\b/i, groups: ['Display'], intent: 'display', subject: 'display_off' },
  { pattern: /\b(graticule\s*on|grid\s*on|show\s*grid|graticule\s*enable)\b/i, groups: ['Display'], intent: 'display', subject: 'graticule_on' },
  { pattern: /\b(graticule\s*off|grid\s*off|hide\s*grid|graticule\s*disable)\b/i, groups: ['Display'], intent: 'display', subject: 'graticule_off' },
  { pattern: /\b(persistence|infinite\s*persistence|variable\s*persistence|display\s*persistence)\b/i, groups: ['Display'], intent: 'display', subject: 'persistence' },
  { pattern: /\b(intensity|brightness|waveform\s*intensity|display\s*intensity)\b/i, groups: ['Display'], intent: 'display', subject: 'intensity' },
  { pattern: /\b(cursor\s*on|show\s*cursor|enable\s*cursor|cursor\s*enable)\b/i, groups: ['Cursor'], intent: 'display', subject: 'cursor_on' },
  { pattern: /\b(cursor\s*off|hide\s*cursor|disable\s*cursor|cursor\s*disable)\b/i, groups: ['Cursor'], intent: 'display', subject: 'cursor_off' },
  { pattern: /\b(cursor\s*type|cursor\s*mode|cursor\s*function)\b/i, groups: ['Cursor'], intent: 'display', subject: 'cursor_type' },

  // ── Fallback Display Patterns ──
  { pattern: /\b(on|off|enable|disable|show|hide)\b/i, groups: ['Display'], intent: 'display', subject: 'display_general' },
  { pattern: /\b(grid|graticule|intensity|brightness)\b/i, groups: ['Display'], intent: 'display', subject: 'display_general' },

  // ── Save / Recall ──
  { pattern: /\b(recall\s*setup|load\s*setup|setup\s*recall|load\s*.*\.tss|recall\s*.*\.tss|load\s*.*\.set)\b/i, groups: ['Save and Recall', 'File System'], intent: 'save', subject: 'recall_setup' },
  { pattern: /\b(save\s*setup|store\s*setup|setup\s*save)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'save_setup' },
  { pattern: /\b(screenshot|screen\s*capture|save\s*image|print)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'screenshot' },
  { pattern: /\b(save|recall|session|store|export|load)\b/i, groups: ['Save and Recall', 'File System'], intent: 'save', subject: 'save' },

  // ── Simple Save Patterns (fallback) ──
  { pattern: /\b(save|recall|store|export|screenshot|image)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'save_simple' },

  // ── Specific Save/Recall Commands (nested) ──
  { pattern: /\b(save\s*waveform|export\s*waveform|waveform\s*save)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'save_waveform' },
  { pattern: /\b(save\s*setup|export\s*setup|setup\s*save)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'save_setup' },
  { pattern: /\b(recall\s*setup|load\s*setup|setup\s*recall)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'recall_setup' },
  { pattern: /\b(save\s*image|save\s*screenshot|capture\s*screen)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'save_image' },
  { pattern: /\b(csv|export\s*csv|save\s*csv|data\s*export)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'export_csv' },
  { pattern: /\b(file\s*format|image\s*format|waveform\s*format)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'file_format' },
  { pattern: /\b(filename|file\s*name|save\s*as)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'filename' },

  // ── Search and Mark ──
  { pattern: /\b(search|mark|find\s*packet|error\s*frame)\b/i, groups: ['Search and Mark'], intent: 'search', subject: 'search' },

  // ── Mask ──
  { pattern: /\b(mask\s*test|mask)\b/i, groups: ['Mask'], intent: 'mask', subject: 'mask' },

  // ── Digital ──
  { pattern: /\b(digital|logic\s*probe|dall|d\d+)\b/i, groups: ['Digital'], intent: 'digital', subject: 'digital' },

  // ── DVM ──
  { pattern: /\b(dvm|voltmeter|digital\s*voltmeter)\b/i, groups: ['DVM'], intent: 'dvm', subject: 'dvm' },

  // ── AFG ──
  { pattern: /\b(afg|function\s*generator|arbitrary)\b/i, groups: ['AFG'], intent: 'afg', subject: 'afg' },

  // ── Status / Misc ──
  // ── IEEE 488.2 common commands — always search Status and Error group ──
  { pattern: /\b(opc|\*opc|operation\s*complete)\b/i, groups: ['Status and Error', 'Miscellaneous'], intent: 'status', subject: 'opc' },
  { pattern: /\b(cls|\*cls|clear\s*status)\b/i, groups: ['Status and Error'], intent: 'status', subject: 'cls' },
  { pattern: /\b(ese|\*ese|event\s*status\s*enable)\b/i, groups: ['Status and Error'], intent: 'status', subject: 'ese' },
  { pattern: /\b(sre|\*sre|service\s*request)\b/i, groups: ['Status and Error'], intent: 'status', subject: 'sre' },
  { pattern: /\b(wai|\*wai|wait)\b/i, groups: ['Status and Error'], intent: 'status', subject: 'wai' },
  { pattern: /\b(status|esr|stb|allev|error\s*queue|event\s*queue)\b/i, groups: ['Status and Error'], intent: 'status', subject: 'status' },
  { pattern: /\b(autoset|preset)\b/i, groups: ['Miscellaneous'], intent: 'misc', subject: 'autoset' },
  { pattern: /\b(factory\s*reset|reset|\*rst)\b/i, groups: ['Miscellaneous', 'Status and Error'], intent: 'misc', subject: 'reset' },
  { pattern: /\b(idn|\*idn|identify|id)\b/i, groups: ['Miscellaneous', 'Status and Error'], intent: 'misc', subject: 'identify' },

  // ── Calibration ──
  { pattern: /\b(calibrat|spc|signal\s*path)\b/i, groups: ['Calibration'], intent: 'calibration', subject: 'calibration' },

  // ── Ethernet/Network ──
  { pattern: /\b(lxi|dhcp|dns|gateway|ip\s*address|remote\s*interface)\b/i, groups: ['Ethernet'], intent: 'network', subject: 'network' },

  // ── File system ──
  { pattern: /\b(directory|readfile|file\s*system|mkdir|rmdir)\b/i, groups: ['File System'], intent: 'filesystem', subject: 'filesystem' },

  // ── Waveform transfer ──
  { pattern: /\b(curve|waveform\s*data|wfm|wfmoutpre|data\s*source|waveform\s*transfer)\b/i, groups: ['Waveform Transfer'], intent: 'waveform', subject: 'waveform_transfer' },

  // ── Act on event ──
  { pattern: /\b(act\s*on\s*event|save\s*on|acton|saveon)\b/i, groups: ['Act On Event', 'Save on'], intent: 'event', subject: 'act_on_event' },
];

// ============================================================
// PHASE 3: The main classifier
// ============================================================
export function classifyIntent(query: string): IntentResult {
  const q = query.trim();
  if (!q) {
    return { groups: [], intent: 'general', subject: '', action: 'find', confidence: 'low' };
  }

  const action = extractAction(q);

  // Try subject-to-group map (specific patterns)
  for (const entry of SUBJECT_GROUP_MAP) {
    if (entry.pattern.test(q)) {
      return {
        groups: entry.groups,
        intent: entry.intent,
        subject: entry.subject,
        action,
        confidence: 'high',
      };
    }
  }

  // Fallback: use existing suggestCommandGroups from commandGroups.ts
  const suggested = suggestCommandGroups(q, 3);
  if (suggested.length > 0) {
    return {
      groups: suggested,
      intent: 'general',
      subject: q.toLowerCase(),
      action,
      confidence: 'medium',
    };
  }

  // No match — return empty groups (search everything, same as today)
  return {
    groups: [],
    intent: 'general',
    subject: q.toLowerCase(),
    action,
    confidence: 'low',
  };
}

// ============================================================
// Utility: filter CommandRecords to matching groups
// ============================================================
export function filterCommandsByGroups(
  commands: CommandRecord[],
  groups: string[]
): CommandRecord[] {
  if (!groups.length) return commands; // no filter = search all
  const groupSet = new Set(groups.map(g => g.toLowerCase()));
  return commands.filter(cmd =>
    groupSet.has(cmd.group.toLowerCase())
  );
}

// ============================================================
// Utility: filter MicroTools by group tags
// (MicroTool tags include the group name from hydration)
// ============================================================
export function filterToolsByGroups(
  tools: MicroTool[],
  groups: string[]
): MicroTool[] {
  if (!groups.length) return tools;
  const groupSet = new Set(groups.map(g => g.toLowerCase()));
  return tools.filter(tool =>
    tool.tags.some(tag => groupSet.has(tag.toLowerCase()))
  );
}
