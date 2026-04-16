import { useState, useEffect } from 'react';

const TABLET_BREAKPOINT_PX = 1024;
const HEADER_COLLAPSE_PX = 900; // Collapse main header actions (Flow, AI Builder, etc.) into More below this
const BLOCKLY_TOOLBAR_FULL_PX = 1024; // Show full Blockly toolbar (Steps/Browse dropdowns, AI Builder, etc.) at or above this
const PHONE_BREAKPOINT_PX = 640;

/**
 * Returns viewport flags:
 * - isTabletOrNarrow: true when width < 1024px (tablet / phone); used for layout (e.g. Steps builder).
 * - isHeaderNarrow: true when width < 900px; collapse main header into More so we don't leave empty space at 900–1023.
 * - isBlocklyToolbarNarrow: true when width < 1024px; collapse Blockly toolbar into More (Undo, Redo, ⋯).
 * - isPhone: true when width < 640px (phone only).
 */
export function useViewport(): { isTabletOrNarrow: boolean; isHeaderNarrow: boolean; isBlocklyToolbarNarrow: boolean; isPhone: boolean } {
  const [isTabletOrNarrow, setIsTabletOrNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < TABLET_BREAKPOINT_PX;
  });
  const [isHeaderNarrow, setIsHeaderNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < HEADER_COLLAPSE_PX;
  });
  const [isBlocklyToolbarNarrow, setIsBlocklyToolbarNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < BLOCKLY_TOOLBAR_FULL_PX;
  });
  const [isPhone, setIsPhone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < PHONE_BREAKPOINT_PX;
  });

  useEffect(() => {
    const mqlTablet = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT_PX - 1}px)`);
    const mqlHeader = window.matchMedia(`(max-width: ${HEADER_COLLAPSE_PX - 1}px)`);
    const mqlBlockly = window.matchMedia(`(max-width: ${BLOCKLY_TOOLBAR_FULL_PX - 1}px)`);
    const mqlPhone = window.matchMedia(`(max-width: ${PHONE_BREAKPOINT_PX - 1}px)`);
    const handler = () => {
      setIsTabletOrNarrow(mqlTablet.matches);
      setIsHeaderNarrow(mqlHeader.matches);
      setIsBlocklyToolbarNarrow(mqlBlockly.matches);
      setIsPhone(mqlPhone.matches);
    };
    mqlTablet.addEventListener('change', handler);
    mqlHeader.addEventListener('change', handler);
    mqlBlockly.addEventListener('change', handler);
    mqlPhone.addEventListener('change', handler);
    handler();
    return () => {
      mqlTablet.removeEventListener('change', handler);
      mqlHeader.removeEventListener('change', handler);
      mqlBlockly.removeEventListener('change', handler);
      mqlPhone.removeEventListener('change', handler);
    };
  }, []);

  return { isTabletOrNarrow, isHeaderNarrow, isBlocklyToolbarNarrow, isPhone };
}
