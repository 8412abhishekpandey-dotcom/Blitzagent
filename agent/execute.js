/**
 * Playwright Action Executor
 * 
 * Translates LLM action decisions into reliable Playwright browser commands.
 * Includes smart waiting, scrolling into view, error handling, and screenshot capture.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('executor');

/**
 * Scroll an element into the center of the viewport before interacting with it.
 * This fixes "element is outside of the viewport" errors.
 */
async function scrollIntoView(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    }
  }, selector);
  // Brief wait for scroll to settle
  await page.waitForTimeout(300);
}

/**
 * Execute a single action on the page.
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {Object} action - Action object { name, params }
 * @param {string} taskId - Task ID for logging
 * @returns {Promise<{success: boolean, message: string, data?: any}>}
 */
export async function executeAction(page, action, taskId) {
  if (!action) {
    return { success: false, message: 'No action provided' };
  }

  logger.info(`[${taskId}] Executing: ${action.name}(${JSON.stringify(action.params)})`);

  try {
    switch (action.name) {
      case 'click':
        return await handleClick(page, action.params, taskId);

      case 'fill':
        return await handleFill(page, action.params, taskId);

      case 'select':
        return await handleSelect(page, action.params, taskId);

      case 'navigate':
        return await handleNavigate(page, action.params, taskId);

      case 'scroll':
        return await handleScroll(page, action.params);

      case 'wait':
        return await handleWait(action.params);

      case 'extract':
        return await handleExtract(page, action.params);

      case 'done':
        return {
          success: true,
          done: true,
          message: action.params.result,
          data: action.params.extracted_data || null,
          taskSuccess: action.params.success,
        };

      default:
        return { success: false, message: `Unknown action: ${action.name}` };
    }
  } catch (error) {
    logger.error(`[${taskId}] Action failed: ${error.message}`);
    return { success: false, message: `Action "${action.name}" failed: ${error.message}` };
  }
}

// ── Action Handlers ─────────────────────────────────────────────────────────

async function handleClick(page, params, taskId) {
  const { ref } = params;
  const selector = `[data-agent-ref="${ref}"]`;

  // Wait for element to exist in DOM
  await page.waitForSelector(selector, { timeout: 8000 });

  // Scroll element into the viewport center FIRST
  await scrollIntoView(page, selector);

  const element = page.locator(selector);

  // Try normal click first
  try {
    const [response] = await Promise.all([
      page.waitForNavigation({ timeout: 5000 }).catch(() => null),
      element.click({ timeout: 5000 }),
    ]);

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500);

    const navigated = response !== null;
    return {
      success: true,
      message: `Clicked ${ref}${navigated ? ' (page navigated)' : ''}`,
    };
  } catch (err) {
    logger.warn(`[${taskId}] Normal click failed, trying force click: ${err.message}`);
  }

  // Fallback 1: Force click (ignores visibility/overlay checks)
  try {
    const [response] = await Promise.all([
      page.waitForNavigation({ timeout: 5000 }).catch(() => null),
      element.click({ force: true, timeout: 5000 }),
    ]);

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500);

    const navigated = response !== null;
    return {
      success: true,
      message: `Force-clicked ${ref}${navigated ? ' (page navigated)' : ''}`,
    };
  } catch (err) {
    logger.warn(`[${taskId}] Force click failed, trying JS click: ${err.message}`);
  }

  // Fallback 2: JavaScript click (bypasses all Playwright checks)
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        // Also try dispatching a click event
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    }, selector);

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(800);

    return {
      success: true,
      message: `JS-clicked ${ref}`,
    };
  } catch (err) {
    logger.error(`[${taskId}] All click strategies failed for ${ref}`);
    throw err;
  }
}

async function handleFill(page, params, taskId) {
  const { ref, value } = params;
  const selector = `[data-agent-ref="${ref}"]`;

  // Wait for element to exist
  await page.waitForSelector(selector, { timeout: 8000 });

  // Scroll into view first
  await scrollIntoView(page, selector);

  const element = page.locator(selector);

  // Try normal fill
  try {
    await element.click({ timeout: 3000 });
    await element.fill('');
    await element.fill(value);
    await page.waitForTimeout(300);

    return {
      success: true,
      message: `Filled ${ref} with "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`,
    };
  } catch (err) {
    logger.warn(`[${taskId}] Normal fill failed, trying force focus + type: ${err.message}`);
  }

  // Fallback 1: Force focus + type character by character
  try {
    await element.click({ force: true, timeout: 3000 });
    await element.fill('');
    await element.fill(value);
    await page.waitForTimeout(300);

    return {
      success: true,
      message: `Force-filled ${ref} with "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`,
    };
  } catch (err) {
    logger.warn(`[${taskId}] Force fill failed, trying JS fill: ${err.message}`);
  }

  // Fallback 2: JavaScript focus + set value + dispatch events
  try {
    await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (el) {
        el.focus();
        el.value = '';
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    }, selector, value);

    await page.waitForTimeout(300);

    return {
      success: true,
      message: `JS-filled ${ref} with "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`,
    };
  } catch (err) {
    logger.error(`[${taskId}] All fill strategies failed for ${ref}`);
  }

  // Fallback 3: Type with keyboard
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) { el.focus(); el.value = ''; }
    }, selector);
    await page.keyboard.type(value, { delay: 30 });
    await page.waitForTimeout(300);

    return {
      success: true,
      message: `Keyboard-typed into ${ref}: "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`,
    };
  } catch (err) {
    logger.error(`[${taskId}] All fill strategies failed for ${ref}`);
    throw err;
  }
}

async function handleSelect(page, params) {
  const { ref, value } = params;
  const selector = `[data-agent-ref="${ref}"]`;

  await page.waitForSelector(selector, { timeout: 8000 });
  await scrollIntoView(page, selector);

  // Try selecting by value first, then by label
  try {
    await page.selectOption(selector, { value });
  } catch {
    try {
      await page.selectOption(selector, { label: value });
    } catch {
      // JS fallback for custom dropdowns
      await page.evaluate((sel, val) => {
        const el = document.querySelector(sel);
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, selector, value);
    }
  }

  return {
    success: true,
    message: `Selected "${value}" in ${ref}`,
  };
}

async function handleNavigate(page, params, taskId) {
  const { url } = params;

  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });

  // Wait extra for dynamic content
  await page.waitForTimeout(1000);

  const status = response ? response.status() : 'unknown';

  return {
    success: true,
    message: `Navigated to ${url} (status: ${status})`,
  };
}

async function handleScroll(page, params) {
  const { direction } = params;
  const delta = direction === 'down' ? 600 : -600;

  await page.evaluate((d) => window.scrollBy(0, d), delta);
  await page.waitForTimeout(400);

  return {
    success: true,
    message: `Scrolled ${direction}`,
  };
}

async function handleWait(params) {
  const ms = Math.min(params.ms || 1000, 5000); // Cap at 5 seconds
  await new Promise(resolve => setTimeout(resolve, ms));

  return {
    success: true,
    message: `Waited ${ms}ms`,
  };
}

async function handleExtract(page, params) {
  let text;

  if (params.ref) {
    const selector = `[data-agent-ref="${params.ref}"]`;
    await scrollIntoView(page, selector);
    text = await page.locator(selector).textContent();
  } else {
    text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  }

  return {
    success: true,
    message: 'Extracted text content',
    data: text?.trim() || '',
  };
}

/**
 * Take a screenshot of the current page state.
 * @param {import('playwright').Page} page
 * @param {string} taskId
 * @param {number} stepNum
 * @returns {Promise<string>} - Path to saved screenshot
 */
export async function captureScreenshot(page, taskId, stepNum) {
  const path = `screenshots/${taskId}_step${stepNum}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}
