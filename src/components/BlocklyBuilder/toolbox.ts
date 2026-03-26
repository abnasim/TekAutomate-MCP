/* ===================== Blockly Toolbox Configuration ===================== */

export const createToolboxConfig = () => {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'search',
        name: 'Search',
        contents: []
      },
      {
        kind: 'category',
        name: 'Connection',
        colour: '#059669', // Green
        contents: [
          {
            kind: 'block',
            type: 'connect_scope'
          },
          {
            kind: 'block',
            type: 'disconnect'
          },
          {
            kind: 'block',
            type: 'set_device_context'
          }
        ]
      },
      {
        kind: 'category',
        name: 'SCPI Commands',
        colour: '#1598b8', // Tek Blue
        contents: [
          {
            kind: 'block',
            type: 'scpi_write'
          },
          {
            kind: 'block',
            type: 'scpi_query'
          },
          {
            kind: 'block',
            type: 'custom_command'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Channel',
        colour: '#0891b2', // Cyan
        contents: [
          {
            kind: 'block',
            type: 'configure_channel'
          },
          {
            kind: 'block',
            type: 'enable_channel'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Acquisition',
        colour: '#059669', // Emerald
        contents: [
          {
            kind: 'block',
            type: 'start_acquisition'
          },
          {
            kind: 'block',
            type: 'stop_acquisition'
          },
          {
            kind: 'block',
            type: 'single_acquisition'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Save/Recall',
        colour: '#f97316', // Orange for file operations
        contents: [
          {
            kind: 'label',
            text: '── Smart Blocks (Recommended) ──'
          },
          {
            kind: 'block',
            type: 'recall'
          },
          {
            kind: 'block',
            type: 'save'
          },
          {
            kind: 'label',
            text: '── Legacy Blocks ──'
          },
          {
            kind: 'block',
            type: 'save_waveform'
          },
          {
            kind: 'block',
            type: 'save_screenshot'
          }
        ]
      },
      {
        kind: 'category',
        name: 'tm_devices',
        colour: '210', // Blue-purple (matches block color)
        contents: [
          {
            kind: 'label',
            text: '── Generic Commands ──'
          },
          {
            kind: 'block',
            type: 'tm_devices_write'
          },
          {
            kind: 'block',
            type: 'tm_devices_query'
          },
          {
            kind: 'block',
            type: 'tm_devices_set_and_check'
          },
          {
            kind: 'label',
            text: '── Save/Recall ──'
          },
          {
            kind: 'block',
            type: 'tm_devices_save_screenshot'
          },
          {
            kind: 'block',
            type: 'tm_devices_save_session'
          },
          {
            kind: 'block',
            type: 'tm_devices_recall_session'
          },
          {
            kind: 'block',
            type: 'tm_devices_save_waveform'
          },
          {
            kind: 'block',
            type: 'tm_devices_recall_reference'
          },
          {
            kind: 'label',
            text: '── Channel/Setup ──'
          },
          {
            kind: 'block',
            type: 'tm_devices_channel_on_off'
          },
          {
            kind: 'block',
            type: 'tm_devices_add_math'
          },
          {
            kind: 'block',
            type: 'tm_devices_reset'
          }
        ]
      },
      {
        kind: 'category',
        name: 'TekExpress',
        colour: '290', // Purple (matches block color)
        contents: [
          {
            kind: 'block',
            type: 'connect_tekexpress'
          },
          {
            kind: 'label',
            text: '--- Setup ---'
          },
          {
            kind: 'block',
            type: 'tekexp_select_device'
          },
          {
            kind: 'block',
            type: 'tekexp_select_suite'
          },
          {
            kind: 'block',
            type: 'tekexp_select_version'
          },
          {
            kind: 'block',
            type: 'tekexp_select_test'
          },
          {
            kind: 'block',
            type: 'tekexp_set_value'
          },
          {
            kind: 'block',
            type: 'tekexp_set_mode'
          },
          {
            kind: 'block',
            type: 'tekexp_set_acquire_mode'
          },
          {
            kind: 'label',
            text: '--- Execution ---'
          },
          {
            kind: 'block',
            type: 'tekexp_run'
          },
          {
            kind: 'block',
            type: 'tekexp_wait_state'
          },
          {
            kind: 'block',
            type: 'tekexp_popup'
          },
          {
            kind: 'label',
            text: '--- Results ---'
          },
          {
            kind: 'block',
            type: 'tekexp_export_report'
          },
          {
            kind: 'block',
            type: 'tekexp_query_result'
          },
          {
            kind: 'block',
            type: 'tekexp_last_error'
          },
          {
            kind: 'label',
            text: '--- Session ---'
          },
          {
            kind: 'block',
            type: 'tekexp_save_session'
          },
          {
            kind: 'block',
            type: 'tekexp_load_session'
          },
          {
            kind: 'label',
            text: '--- Advanced ---'
          },
          {
            kind: 'block',
            type: 'tekexp_write'
          },
          {
            kind: 'block',
            type: 'tekexp_query'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Timing',
        colour: '#475569', // Slate
        contents: [
          {
            kind: 'block',
            type: 'wait_seconds'
          },
          {
            kind: 'block',
            type: 'wait_for_opc'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Logic',
        colour: '210', // Modern theme HSV
        contents: [
          {
            kind: 'block',
            type: 'controls_if'
          },
          {
            kind: 'block',
            type: 'controls_ifelse'
          },
          {
            kind: 'block',
            type: 'logic_compare'
          },
          {
            kind: 'block',
            type: 'logic_operation'
          },
          {
            kind: 'block',
            type: 'logic_negate'
          },
          {
            kind: 'block',
            type: 'logic_boolean'
          },
          {
            kind: 'block',
            type: 'logic_null'
          },
          {
            kind: 'block',
            type: 'logic_ternary'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Loops',
        colour: '120', // Modern theme HSV
        contents: [
          {
            kind: 'block',
            type: 'controls_repeat_ext',
            inputs: {
              TIMES: {
                shadow: {
                  type: 'math_number',
                  fields: {
                    NUM: 10
                  }
                }
              }
            }
          },
          {
            kind: 'block',
            type: 'controls_for',
            inputs: {
              FROM: {
                shadow: {
                  type: 'math_number',
                  fields: {
                    NUM: 0
                  }
                }
              },
              TO: {
                shadow: {
                  type: 'math_number',
                  fields: {
                    NUM: 10
                  }
                }
              },
              BY: {
                shadow: {
                  type: 'math_number',
                  fields: {
                    NUM: 1
                  }
                }
              }
            }
          },
          {
            kind: 'block',
            type: 'controls_forEach'
          },
          {
            kind: 'block',
            type: 'controls_whileUntil'
          },
          {
            kind: 'block',
            type: 'controls_flow_statements'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Math',
        colour: '230', // Modern theme HSV
        contents: [
          {
            kind: 'block',
            type: 'math_number'
          },
          {
            kind: 'block',
            type: 'math_arithmetic'
          },
          {
            kind: 'block',
            type: 'math_single'
          },
          {
            kind: 'block',
            type: 'math_trig'
          },
          {
            kind: 'block',
            type: 'math_constant'
          },
          {
            kind: 'block',
            type: 'math_number_property'
          },
          {
            kind: 'block',
            type: 'math_round'
          },
          {
            kind: 'block',
            type: 'math_on_list'
          },
          {
            kind: 'block',
            type: 'math_modulo'
          },
          {
            kind: 'block',
            type: 'math_constrain'
          },
          {
            kind: 'block',
            type: 'math_random_int'
          },
          {
            kind: 'block',
            type: 'math_random_float'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Text',
        colour: '160', // Modern theme HSV
        contents: [
          {
            kind: 'block',
            type: 'text'
          },
          {
            kind: 'block',
            type: 'text_join'
          },
          {
            kind: 'block',
            type: 'text_append'
          },
          {
            kind: 'block',
            type: 'text_length'
          },
          {
            kind: 'block',
            type: 'text_isEmpty'
          },
          {
            kind: 'block',
            type: 'text_indexOf'
          },
          {
            kind: 'block',
            type: 'text_charAt'
          },
          {
            kind: 'block',
            type: 'text_getSubstring'
          },
          {
            kind: 'block',
            type: 'text_changeCase'
          },
          {
            kind: 'block',
            type: 'text_trim'
          },
          {
            kind: 'block',
            type: 'text_print'
          },
          {
            kind: 'block',
            type: 'text_prompt_ext'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Lists',
        colour: '260', // Modern theme HSV
        contents: [
          {
            kind: 'block',
            type: 'lists_create_empty'
          },
          {
            kind: 'block',
            type: 'lists_create_with'
          },
          {
            kind: 'block',
            type: 'lists_repeat'
          },
          {
            kind: 'block',
            type: 'lists_length'
          },
          {
            kind: 'block',
            type: 'lists_isEmpty'
          },
          {
            kind: 'block',
            type: 'lists_indexOf'
          },
          {
            kind: 'block',
            type: 'lists_getIndex'
          },
          {
            kind: 'block',
            type: 'lists_setIndex'
          },
          {
            kind: 'block',
            type: 'lists_getSublist'
          },
          {
            kind: 'block',
            type: 'lists_split'
          },
          {
            kind: 'block',
            type: 'lists_sort'
          }
        ]
      },
      {
        kind: 'category',
        name: 'Variables',
        colour: '330', // Modern theme HSV
        custom: 'VARIABLE',
        contents: [] // Dynamically populated by Blockly
      },
      {
        kind: 'category',
        name: 'Functions',
        colour: '290', // Modern theme HSV
        custom: 'PROCEDURE',
        contents: [] // Dynamically populated by Blockly
      },
      {
        kind: 'category',
        name: 'Utility',
        colour: '#6b7280', // Gray
        contents: [
          {
            kind: 'block',
            type: 'comment_block'
          },
          {
            kind: 'block',
            type: 'python_code'
          }
        ]
      }
    ]
  };
};
