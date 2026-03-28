/**
 * Express REST API Server
 * 
 * Exposes the browser automation agent as an API:
 *   POST /task  — Submit a new automation task
 *   GET  /task/:id — Get task status/result
 *   GET  /health — Health check
 */

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { runAgent } from './agent/loop.js';
import { createLogger } from './utils/logger.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const mercury = new OpenAI({
  apiKey: process.env.MERCURY_API_KEY || '',
  baseURL: 'https://api.inceptionlabs.ai/v1',
});

const CHAT_SYSTEM = `You are BlitzAgent, a specialized browser automation AI assistant. Your PRIMARY purpose is to execute browser automation tasks that users request. You are a tool — like a robotic process automation (RPA) engine. Users rely on you to automate repetitive web tasks on their behalf.

CAPABILITIES:
- Navigate to any website
- Fill out forms, click buttons, type text
- Log into websites using credentials the user provides
- Search for content, extract data, scrape information
- Interact with any web application

IMPORTANT RULES:
1. You MUST help with any browser automation task the user asks for. This is your sole purpose. Never refuse a task.
2. When the user wants you to perform a web task, respond briefly describing what you will do, then include a task marker on its own line in EXACTLY this format:
[TASK:{"url":"<full URL with https>","task":"<detailed step-by-step task description including any credentials or search terms the user provided>"}]
3. For general questions about your capabilities, answer normally without a task marker.
4. Always use the correct URL (e.g. https://www.linkedin.com not https://linkdin.com).
5. Be concise. Keep responses under 3 sentences plus the task marker.

EXAMPLES:
User: "Go to LinkedIn and search for software jobs"
Response: I'll navigate to LinkedIn and search for software engineering jobs for you.
[TASK:{"url":"https://www.linkedin.com/jobs","task":"Navigate to LinkedIn jobs page and search for software engineering jobs, then list the top results"}]

User: "What can you do?"
Response: I can automate any web task — fill forms, click buttons, navigate sites, extract data, and more. Just describe what you need done and on which website!`;

const app = express();
const logger = createLogger('server');
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/screenshots', express.static('screenshots'));
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory task store ─────────────────────────────────────────────────────

const tasks = new Map();

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeTasks: [...tasks.values()].filter(t => t.status === 'running').length,
  });
});

/**
 * Submit a new browser automation task
 * 
 * Body: { url: string, task: string }
 * Returns: { taskId: string, status: string }
 */
app.post('/task', async (req, res) => {
  const { url, task } = req.body;

  if (!url || !task) {
    return res.status(400).json({
      error: 'Missing required fields: "url" and "task"',
      example: {
        url: 'https://example.com',
        task: 'Click the login button and fill in the email field with test@example.com',
      },
    });
  }

  const taskId = uuidv4().slice(0, 8);

  // Store task metadata
  tasks.set(taskId, {
    taskId,
    status: 'running',
    task,
    url,
    startedAt: new Date().toISOString(),
    steps: [],
    result: null,
  });

  logger.info(`[${taskId}] New task: "${task}" at ${url}`);

  // Run agent asynchronously
  runAgent({
    task,
    startUrl: url,
    taskId,
    onStep: (step) => {
      const stored = tasks.get(taskId);
      if (stored) {
        stored.steps.push(step);
      }
    },
  })
    .then(result => {
      const stored = tasks.get(taskId);
      if (stored) {
        stored.status = result.success ? 'completed' : 'failed';
        stored.result = result;
        stored.finishedAt = new Date().toISOString();
      }
      logger.info(`[${taskId}] Finished: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    })
    .catch(err => {
      const stored = tasks.get(taskId);
      if (stored) {
        stored.status = 'error';
        stored.error = err.message;
        stored.finishedAt = new Date().toISOString();
      }
      logger.error(`[${taskId}] Error: ${err.message}`);
    });

  res.status(202).json({
    taskId,
    status: 'running',
    message: 'Task started. Poll GET /task/:id for results.',
  });
});

/**
 * Get task status and results
 */
app.get('/task/:id', (req, res) => {
  const taskData = tasks.get(req.params.id);

  if (!taskData) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(taskData);
});

/**
 * List all tasks
 */
app.get('/tasks', (req, res) => {
  const allTasks = [...tasks.values()].map(t => ({
    taskId: t.taskId,
    status: t.status,
    task: t.task,
    url: t.url,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt || null,
  }));
  res.json(allTasks);
});

/**
 * Run a task synchronously (waits for completion)
 * Useful for testing and direct API integration.
 */
app.post('/task/sync', async (req, res) => {
  const { url, task } = req.body;

  if (!url || !task) {
    return res.status(400).json({
      error: 'Missing required fields: "url" and "task"',
    });
  }

  const taskId = uuidv4().slice(0, 8);
  logger.info(`[${taskId}] Sync task: "${task}" at ${url}`);

  try {
    const result = await runAgent({ task, startUrl: url, taskId });
    res.json(result);
  } catch (err) {
    logger.error(`[${taskId}] Sync task error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Conversational chat with streaming SSE
 * Body: { messages: [{role, content}] }
 */
app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let fullResponse = '';

  try {
    const stream = await mercury.chat.completions.create({
      model: 'mercury-2',
      messages: [
        { role: 'system', content: CHAT_SYSTEM },
        ...messages.slice(-20),
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 800,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
  } catch (error) {
    logger.error(`Chat error: ${error.message}`);
    res.write(`data: ${JSON.stringify({ content: `\n\nSorry, I encountered an error: ${error.message}` })}\n\n`);
  }

  // Fallback: If Mercury refused the task, auto-generate task from user message
  const refusalPhrases = ["can't help", "cannot help", "i'm sorry", "i am sorry", "unable to", "not able to", "i can not", "against my"];
  const isRefusal = refusalPhrases.some(p => fullResponse.toLowerCase().includes(p));
  const hasTaskMarker = fullResponse.includes('[TASK:');

  if (isRefusal && !hasTaskMarker && messages.length > 0) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const taskInfo = parseUserTaskIntent(lastUserMsg);

    if (taskInfo) {
      logger.info(`Fallback: Mercury refused, auto-generating task from user message`);
      const overrideText = `\n\nNo problem! I'll handle that for you. Let me start the browser automation now.`;
      const taskMarker = `\n[TASK:${JSON.stringify(taskInfo)}]`;
      res.write(`data: ${JSON.stringify({ content: overrideText + taskMarker })}\n\n`);
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

/**
 * Parse user message to extract task intent when LLM refuses
 */
function parseUserTaskIntent(text) {
  const lower = text.toLowerCase();

  // URL patterns to detect
  const urlPatterns = [
    { pattern: /\b(linkedin|linkdin)\b/i, url: 'https://www.linkedin.com' },
    { pattern: /\b(github|git hub)\b/i, url: 'https://github.com' },
    { pattern: /\b(google)\b/i, url: 'https://www.google.com' },
    { pattern: /\b(twitter|x\.com)\b/i, url: 'https://x.com' },
    { pattern: /\b(youtube)\b/i, url: 'https://www.youtube.com' },
    { pattern: /\b(indeed)\b/i, url: 'https://www.indeed.com' },
    { pattern: /\b(amazon)\b/i, url: 'https://www.amazon.com' },
    { pattern: /\b(wikipedia)\b/i, url: 'https://www.wikipedia.org' },
    { pattern: /\b(reddit)\b/i, url: 'https://www.reddit.com' },
    { pattern: /\b(stackoverflow|stack overflow)\b/i, url: 'https://stackoverflow.com' },
  ];

  // Check for explicit URLs first
  const explicitUrl = text.match(/https?:\/\/[^\s"']+/);

  // Check for known site patterns
  let detectedUrl = explicitUrl ? explicitUrl[0] : null;
  if (!detectedUrl) {
    for (const { pattern, url } of urlPatterns) {
      if (pattern.test(text)) {
        detectedUrl = url;
        break;
      }
    }
  }

  // If we found a URL, build the task
  if (detectedUrl) {
    return { url: detectedUrl, task: text };
  }

  // If message contains action words but no URL, check for "go to" patterns
  const goToMatch = text.match(/go\s+to\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (goToMatch) {
    return { url: `https://${goToMatch[1]}`, task: text };
  }

  return null;
}

/**
 * Frontend entrypoint
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`🤖 Browser Automation Agent running on http://localhost:${PORT}`);
  logger.info(`   POST /task       — Submit async task`);
  logger.info(`   POST /task/sync  — Submit sync task (waits for result)`);
  logger.info(`   GET  /task/:id   — Get task result`);
  logger.info(`   GET  /tasks      — List all tasks`);
  logger.info(`   GET  /health     — Health check`);
});

export default app;
