/**
 * Error Recovery & Retry Logic
 * 
 * Handles common failure scenarios: element not found, navigation failures,
 * popups/overlays, viewport issues, and stale element references.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('recovery');

/**
 * Attempt to recover from a failed action.
 * @param {import('playwright').Page} page
 * @param {Object} action - The failed action
 * @param {string} errorMessage - Error description
 * @param {string} taskId
 * @returns {Promise<{recovered: boolean, message: string}>}
 */
export async function attemptRecovery(page, action, errorMessage, taskId) {
  logger.warn(`[${taskId}] Attempting recovery from: ${errorMessage}`);

  // Strategy 1: Element outside viewport — scroll to it
  if (errorMessage.includes('outside of the viewport') || errorMessage.includes('outside the viewport')) {
    logger.info(`[${taskId}] Viewport issue detected, scrolling to element`);
    
    if (action.params?.ref) {
      const selector = `[data-agent-ref="${action.params.ref}"]`;
      try {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          }
        }, selector);
        await page.waitForTimeout(500);
        return { recovered: true, message: 'Scrolled element into viewport center' };
      } catch {
        // Scroll page down as fallback
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(500);
        return { recovered: true, message: 'Scrolled page down to find element' };
      }
    }
    
    // Generic scroll down
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(500);
    return { recovered: true, message: 'Scrolled page down' };
  }

  // Strategy 2: Dismiss popups/dialogs/overlays
  const dismissed = await dismissOverlays(page);
  if (dismissed) {
    return { recovered: true, message: 'Dismissed popup/overlay, retrying' };
  }

  // Strategy 3: Wait for page to stabilize
  if (errorMessage.includes('timeout') || errorMessage.includes('not visible') || errorMessage.includes('Timeout')) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    
    // Also scroll to top and back to refresh the viewport
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    
    return { recovered: true, message: 'Waited for page to stabilize and reset scroll' };
  }

  // Strategy 4: Element not found — scroll to look for it
  if (errorMessage.includes('not found') || errorMessage.includes('No element')) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(600);
    return { recovered: true, message: 'Scrolled down to find element' };
  }

  // Strategy 5: Navigation error — go back
  if (errorMessage.includes('Navigation') || errorMessage.includes('ERR_')) {
    await page.goBack().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return { recovered: true, message: 'Navigated back after error' };
  }

  // Strategy 6: Generic — wait and scroll
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);
  return { recovered: true, message: 'Generic recovery: waited and scrolled' };
}

/**
 * Dismiss common overlays: cookie banners, modals, alerts.
 */
async function dismissOverlays(page) {
  // Handle browser-native dialogs
  try {
    page.once('dialog', async dialog => {
      await dialog.accept();
    });
  } catch { /* no dialog */ }

  // Dismiss cookie banners, close buttons, etc.
  const dismissSelectors = [
    // Cookie consent
    'button[id*="cookie" i]',
    'button[class*="cookie" i]',
    'button[id*="accept" i]',
    'button[class*="accept" i]',
    '[id*="consent" i] button',
    // Close buttons on modals
    'button[class*="close" i]',
    'button[aria-label*="close" i]',
    'button[aria-label*="dismiss" i]',
    '.modal button.close',
    '[role="dialog"] button[aria-label="Close"]',
    // Generic dismiss
    'button[class*="dismiss" i]',
    // Overlay close
    '[class*="overlay-close" i]',
    '[class*="modal-close" i]',
  ];

  for (const selector of dismissSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 2000, force: true });
        await page.waitForTimeout(500);
        return true;
      }
    } catch { /* selector not found, try next */ }
  }

  return false;
}

/**
 * Setup dialog auto-handler for the page (accept all alerts/confirms).
 */
export function setupDialogHandler(page) {
  page.on('dialog', async dialog => {
    logger.info(`Dialog detected (${dialog.type()}): ${dialog.message()}`);
    await dialog.accept();
  });
}
