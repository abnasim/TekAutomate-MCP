declare module '@mit-app-inventor/blockly-plugin-workspace-multiselect' {
  import { WorkspaceSvg } from 'blockly';
  
  export class Multiselect {
    constructor(workspace: WorkspaceSvg);
    init(): void;
  }
  
  export const dragSelectionWeakMap: WeakMap<any, any>;
  export const inMultipleSelectionModeWeakMap: WeakMap<any, any>;
}
