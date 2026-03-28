/**
 * Mercury LLM Integration — Reasoning Layer
 * 
 * Handles communication with Mercury LLM via OpenAI-compatible API.
 * Supports function calling for structured browser actions.
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// ── Mercury Client ───────────────────────────────────────────────────────────

const mercury = new OpenAI({
  apiKey: process.env.MERCURY_API_KEY || 'not-set',
  baseURL: 'https://api.inceptionlabs.ai/v1',
});

// ── System Prompt (compact to save tokens) ──────────────────────────────────

const SYSTEM_PROMPT = `You are a browser automation agent. You control a web browser to complete user tasks.

RULES:
- Call exactly ONE tool per turn
- Use element refs like "ref-0" to target elements
- For forms: fill fields THEN click submit
- For navigation: use "navigate" with full URLs
- For popups/modals: dismiss or interact FIRST before continuing
- When the task is done, call "done" with a summary of what was accomplished
- If stuck after 3 attempts, call "done" with error description
- NEVER make up data — only use what's visible on the page`;

// ── Tool Definitions (Mercury supports OpenAI function calling format) ──────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click on an element identified by its ref',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref like "ref-0"' },
        },
        required: ['ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill',
      description: 'Type text into an input field',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref for the input field' },
          value: { type: 'string', description: 'Text to type into the field' },
        },
        required: ['ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select',
      description: 'Select an option from a dropdown',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref for the select dropdown' },
          value: { type: 'string', description: 'Option value or visible text to select' },
        },
        required: ['ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page up or down to see more content',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a specified time (use when page is loading)',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', description: 'Milliseconds to wait (max 5000)' },
        },
        required: ['ms'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract',
      description: 'Extract specific text content from the current page',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref to extract text from (optional, extracts page body if omitted)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Signal that the task is complete or cannot be completed',
      parameters: {
        type: 'object',
        properties: {
          result: { type: 'string', description: 'Summary of what was accomplished or error if failed' },
          success: { type: 'boolean', description: 'Whether the task was completed successfully' },
          extracted_data: { type: 'string', description: 'Any data extracted from the page (optional)' },
        },
        required: ['result', 'success'],
      },
    },
  },
];

// ── Reasoning Function ──────────────────────────────────────────────────────

/**
 * Send the current page state to Mercury and get the next action.
 * Maintains conversation history for multi-step reasoning.
 * 
 * @param {string} task - User's goal/task description
 * @param {string} pageState - Formatted page snapshot from perceive.js
 * @param {Array} history - Conversation history (messages array)
 * @param {string} [screenshotBase64] - Base64 encoded JPEG screenshot of the page
 * @returns {Promise<{action: Object, history: Array, tokenUsage: Object}>}
 */
export async function getNextAction(task, pageState, history = [], screenshotBase64 = null) {
  // Build messages — keep history compact
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add history (but cap it to avoid token explosion)
  // IMPORTANT: We must trim at safe boundaries — never start with a 'tool' or
  // 'assistant' message, as that breaks the OpenAI message format.
  // Tool messages MUST follow an assistant message with tool_calls.
  let recentHistory = history.slice(-12); // Take a few extra then trim safely
  // Find the first 'user' role message to start at a clean boundary
  while (recentHistory.length > 0 && recentHistory[0].role !== 'user') {
    recentHistory.shift();
  }
  messages.push(...recentHistory);

  // Mercury-2 does NOT support multimodal content arrays.
  // Always send user content as a plain string.
  const userText = `Task: ${task}\n\n${pageState}`;

  messages.push({
    role: 'user',
    content: userText,
  });

  try {
    const response = await mercury.chat.completions.create({
      model: 'mercury-2',
      messages,
      tools: TOOLS,
      tool_choice: 'required', // Force tool call — Mercury sometimes returns plain text otherwise
      temperature: 0.1, // Low temp for deterministic actions
      max_tokens: 1500,  // Needs to be high enough for 'done' responses with extracted text
    });

    const message = response.choices[0].message;
    const tokenUsage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Parse the tool call
    let action = null;
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      try {
        // Attempt to parse the JSON arguments
        const params = JSON.parse(toolCall.function.arguments);
        action = {
          name: toolCall.function.name,
          params: params,
          id: toolCall.id,
        };
      } catch (parseError) {
        console.warn('Failed to parse LLM JSON tool arguments:', parseError.message);
        console.warn('Raw arguments:', toolCall.function.arguments);

        // Recovery: if it's a 'done' call with truncated JSON, salvage what we can
        if (toolCall.function.name === 'done') {
          const raw = toolCall.function.arguments;
          const successMatch = raw.match(/"success"\s*:\s*(true|false)/);
          const resultMatch = raw.match(/"result"\s*:\s*"([^"]*)/);
          const dataMatch = raw.match(/"extracted_data"\s*:\s*"([^"]*)/);
          action = {
            name: 'done',
            params: {
              result: resultMatch ? resultMatch[1] : 'Task completed (response truncated)',
              success: successMatch ? successMatch[1] === 'true' : true,
              extracted_data: dataMatch ? dataMatch[1] : null,
            },
            id: toolCall.id,
          };
          console.log('Recovered truncated done response');
        }
        // Otherwise let action remain null so the loop retries
      }
    } else if (message.content) {
      // Fallback: try to parse action from text response
      action = parseActionFromText(message.content);
    }

    // Update history: avoid keeping full pageState in history to save tokens
    const updatedHistory = [
      ...recentHistory,
      { role: 'user', content: `Task: ${task}\n\n[Previous page state omitted to save tokens]` },
      message,
    ];

    return { action, history: updatedHistory, tokenUsage };
  } catch (error) {
    console.error('Mercury LLM error:', error.message);
    throw error;
  }
}

/**
 * Fallback parser: extract action from plain text when function calling fails.
 */
function parseActionFromText(text) {
  const lower = text.toLowerCase();
  if (lower.includes('done') || lower.includes('complete') || lower.includes('finished')) {
    return { name: 'done', params: { result: text, success: true } };
  }
  if (lower.includes('click')) {
    const refMatch = text.match(/ref-\d+/);
    if (refMatch) return { name: 'click', params: { ref: refMatch[0] } };
  }
  if (lower.includes('navigate') || lower.includes('go to')) {
    const urlMatch = text.match(/https?:\/\/[^\s"']+/);
    if (urlMatch) return { name: 'navigate', params: { url: urlMatch[0] } };
  }
  // Default: report as done with the text
  return { name: 'done', params: { result: text, success: false } };
}

export { TOOLS, SYSTEM_PROMPT };
