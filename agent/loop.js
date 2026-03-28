/**
 * Main Agent Loop — Perceive → Reason → Act
 * 
 * Orchestrates the full browser automation cycle.
 * Manages conversation history, token tracking, and step limits.
 */

import { chromium } from 'playwright';
import { getSemanticSnapshot, getPageContext, formatForLLM } from './perceive.js';
import { getNextAction } from './reason.js';
import { executeAction, captureScreenshot } from './execute.js';
import { attemptRecovery, setupDialogHandler } from './recovery.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent');

const MAX_STEPS = 25;        // Safety limit for agent loops
const MAX_RETRIES = 3;       // Retries per failed action
const SCREENSHOT_EVERY = 3;  // Capture screenshot every N steps

/**
 * Run the browser automation agent for a given task.
 * 
 * @param {Object} options
 * @param {string} options.task - Natural language task description
 * @param {string} options.startUrl - URL to begin at
 * @param {string} options.taskId - Unique task ID
 * @param {function} [options.onStep] - Callback for each step (for live updates)
 * @returns {Promise<Object>} - Final result with logs, screenshots, token usage
 */
export async function runAgent({ task, startUrl, taskId, onStep }) {
  const result = {
    taskId,
    task,
    startUrl,
    success: false,
    result: '',
    extractedData: null,
    steps: [],
    screenshots: [],
    totalTokens: 0,
    error: null,
  };

  let browser, context, page;

  try {
    // ── Launch Browser ────────────────────────────────────────────────────
    logger.info(`[${taskId}] Starting agent for task: "${task}"`);
    logger.info(`[${taskId}] Start URL: ${startUrl}`);

    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });

    page = await context.newPage();
    setupDialogHandler(page);

    // Navigate to start URL
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000); // Let dynamic content load

    // ── Agent Loop ──────────────────────────────────────────────────────
    let history = [];
    let step = 0;
    let consecutiveFailures = 0;

    while (step < MAX_STEPS) {
      step++;
      logger.info(`[${taskId}] ── Step ${step}/${MAX_STEPS} ──`);

      // 1. PERCEIVE — Get page state
      const context = await getPageContext(page);
      const snapshot = await getSemanticSnapshot(page);
      const pageState = formatForLLM(context, snapshot);

      logger.debug(`[${taskId}] Page: ${context.title} | Elements: ${snapshot.length}`);

      // 2. REASON — Ask Mercury for next action
      let actionResult;
      try {
        actionResult = await getNextAction(task, pageState, history);
      } catch (error) {
        logger.error(`[${taskId}] LLM error: ${error.message}`);
        result.error = `LLM error: ${error.message}`;
        break;
      }

      const { action, history: updatedHistory, tokenUsage } = actionResult;
      history = updatedHistory;
      result.totalTokens += (tokenUsage.total_tokens || 0);

      if (!action) {
        logger.warn(`[${taskId}] No action returned by LLM`);
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_RETRIES) {
          result.error = 'LLM stopped returning actions';
          break;
        }
        continue;
      }

      // 3. ACT — Execute the action
      const stepLog = {
        step,
        action: action.name,
        params: action.params,
        tokensUsed: tokenUsage.total_tokens || 0,
      };

      const execResult = await executeAction(page, action, taskId);
      stepLog.result = execResult.message;
      stepLog.success = execResult.success;

      // Handle action failure → attempt recovery
      if (!execResult.success) {
        logger.warn(`[${taskId}] Action failed: ${execResult.message}`);
        consecutiveFailures++;

        if (consecutiveFailures <= MAX_RETRIES) {
          const recovery = await attemptRecovery(page, action, execResult.message, taskId);
          stepLog.recovery = recovery.message;

          if (!recovery.recovered) {
            logger.error(`[${taskId}] Recovery failed`);
          }
        }

        if (consecutiveFailures >= MAX_RETRIES) {
          result.error = `Failed after ${MAX_RETRIES} consecutive failures`;
          break;
        }
      } else {
        consecutiveFailures = 0; // Reset on success
      }

      // Add tool result to history so the LLM gets feedback
      if (action.id) {
        history.push({
          role: 'tool',
          tool_call_id: action.id,
          name: action.name,
          content: JSON.stringify({
            success: execResult.success,
            message: execResult.message,
            data: execResult.data || null
          })
        });
      }

      // Record step
      result.steps.push(stepLog);

      // Capture screenshot periodically
      if (step % SCREENSHOT_EVERY === 0 || execResult.done) {
        try {
          const screenshotPath = await captureScreenshot(page, taskId, step);
          result.screenshots.push(screenshotPath);
          stepLog.screenshot = screenshotPath;
        } catch { /* screenshots dir might not exist */ }
      }

      // Callback for live updates
      if (onStep) {
        onStep(stepLog);
      }

      // Check if task is done
      if (execResult.done) {
        result.success = execResult.taskSuccess;
        result.result = execResult.message;
        result.extractedData = execResult.data;
        logger.info(`[${taskId}] Task completed: ${execResult.message}`);
        break;
      }
    }

    if (step >= MAX_STEPS) {
      result.error = `Reached maximum step limit (${MAX_STEPS})`;
    }

    // Final screenshot
    try {
      const finalScreenshot = await captureScreenshot(page, taskId, 'final');
      result.screenshots.push(finalScreenshot);
    } catch { /* ok */ }

  } catch (error) {
    logger.error(`[${taskId}] Fatal error: ${error.message}`);
    result.error = error.message;
  } finally {
    // Cleanup
    if (browser) {
      await browser.close();
    }
  }

  logger.info(`[${taskId}] Agent finished. Success: ${result.success} | Steps: ${result.steps.length} | Tokens: ${result.totalTokens}`);
  return result;
}
