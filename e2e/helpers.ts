/**
 * Shared E2E helpers. Ensures wizard + tour never block tests.
 * Call gotoApp() at the start of every test that needs the builder.
 */
import type { Page } from '@playwright/test';

/** Set localStorage before app loads so Welcome Wizard and Interactive Tour never show. */
export async function gotoApp(page: Page): Promise<void> {
  // Strings must be inlined — addInitScript runs in browser context, not Node
  await page.addInitScript(() => {
    localStorage.setItem('tekautomate_wizard_shown', 'true');
    localStorage.setItem('tekautomate_tour_completed', 'true');
    localStorage.setItem('tek_automator_auth', 'granted');
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Per-page dismiss-override registry.
 * Call nextDialogDismiss(page) BEFORE triggering an action that shows a dialog
 * when you need it dismissed instead of accepted.
 */
const _dismissNextMap = new WeakMap<Page, boolean>();

export function nextDialogDismiss(page: Page): void {
  _dismissNextMap.set(page, true);
}

/** Accept or dismiss dialogs so they never block (e.g. "Take a tour?"). Call before gotoApp.
 *  Checks nextDialogDismiss() override so individual tests can request a dismiss. */
export function handleDialogs(page: Page): void {
  page.on('dialog', async (d) => {
    const msg = d.message().toLowerCase();
    try {
      if (msg.includes('tour') || msg.includes('quick tour')) {
        await d.dismiss();
      } else if (_dismissNextMap.get(page)) {
        _dismissNextMap.delete(page);
        await d.dismiss();
      } else {
        await d.accept();
      }
    } catch {
      // Another handler already handled this dialog.
    }
  });
}

/** Go to app with wizard/tour skipped and dialogs handled. Waits for steps panel (builder ready). */
export async function gotoBuilder(page: Page): Promise<void> {
  handleDialogs(page);
  await gotoApp(page);
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
}
