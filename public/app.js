/* ================================================================
   BlitzAgent — Frontend Application
   Landing page interactions + ChatGPT-style chat interface
================================================================ */

'use strict';

/* ── Elements ────────────────────────────────────────────────────── */
const landing    = document.getElementById('landing');
const chatApp    = document.getElementById('chatApp');
const sidebar    = document.getElementById('sidebar');
const messages   = document.getElementById('messages');
const msgInput   = document.getElementById('msgInput');
const sendBtn    = document.getElementById('sendBtn');
const sidebarChats = document.getElementById('sidebarChats');
const apiStatus  = document.getElementById('apiStatus');

/* ── State ───────────────────────────────────────────────────────── */
let conversations = [];
let currentChatId = null;
let isStreaming   = false;

/* ================================================================
   BOOT
================================================================ */
(function init() {
  loadConversations();
  renderSidebar();

  // Landing CTA bindings
  ['navGetStarted', 'heroGetStarted', 'ctaGetStarted'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', openChat);
  });

  // Chat UI bindings
  document.getElementById('backBtn').addEventListener('click', closeChat);
  document.getElementById('newChatBtn').addEventListener('click', startNewChat);
  document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);

  // Input
  msgInput.addEventListener('input',   onInputChange);
  msgInput.addEventListener('keydown', onKeyDown);
  sendBtn.addEventListener('click',    handleSend);
})();

/* ================================================================
   LANDING ↔ CHAT TRANSITIONS
================================================================ */
function openChat() {
  chatApp.classList.add('open');
  chatApp.setAttribute('aria-hidden', 'false');
  checkApiHealth();

  // If no active chat, show welcome
  if (!currentChatId) {
    showWelcome();
  } else {
    loadChatUI(currentChatId);
  }

  setTimeout(() => msgInput.focus(), 500);
}

function closeChat() {
  chatApp.classList.remove('open');
  chatApp.setAttribute('aria-hidden', 'true');
  if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
}

function toggleSidebar() {
  sidebar.classList.toggle('open');
}

/* ================================================================
   API HEALTH
================================================================ */
async function checkApiHealth() {
  try {
    const r = await fetch('/health');
    if (r.ok) {
      apiStatus.textContent = '● API Online';
      apiStatus.className = 'api-badge';
    } else throw new Error();
  } catch {
    apiStatus.textContent = '● API Offline';
    apiStatus.className = 'api-badge offline';
  }
}

/* ================================================================
   CONVERSATION MANAGEMENT
================================================================ */
function loadConversations() {
  try {
    conversations = JSON.parse(localStorage.getItem('blitz_conversations') || '[]');
  } catch {
    conversations = [];
  }
}

function saveConversations() {
  localStorage.setItem('blitz_conversations', JSON.stringify(conversations.slice(0, 30)));
}

function startNewChat() {
  const id = String(Date.now());
  conversations.unshift({ id, title: 'New Chat', messages: [], createdAt: Date.now() });
  currentChatId = id;
  saveConversations();
  renderSidebar();
  showWelcome();
  msgInput.focus();
}

function loadChatUI(chatId) {
  const chat = conversations.find(c => c.id === chatId);
  if (!chat) { startNewChat(); return; }

  currentChatId = chatId;
  renderSidebar();
  messages.innerHTML = '';

  if (chat.messages.length === 0) {
    showWelcome();
  } else {
    chat.messages.forEach(m => appendMessage(m.role, m.content, false));
    scrollBottom();
  }
}

function getChat() {
  if (!currentChatId) { startNewChat(); }
  return conversations.find(c => c.id === currentChatId);
}

/* ================================================================
   SIDEBAR
================================================================ */
function renderSidebar() {
  if (conversations.length === 0) {
    sidebarChats.innerHTML = '<div class="sidebar-empty">Your conversations will appear here</div>';
    return;
  }
  sidebarChats.innerHTML = conversations.map(c => `
    <div class="sidebar-chat-item ${c.id === currentChatId ? 'active' : ''}"
         onclick="loadChatUI('${esc(c.id)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           style="flex-shrink:0;opacity:0.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      ${esc(c.title.slice(0, 32))}${c.title.length > 32 ? '…' : ''}
    </div>
  `).join('');
}

/* ================================================================
   WELCOME SCREEN
================================================================ */
function showWelcome() {
  messages.innerHTML = `
    <div class="welcome">
      <div style="font-size:3.5rem;line-height:1">⚡</div>
      <h2>How can I help you today?</h2>
      <p>I'm BlitzAgent — your autonomous browser AI. Ask me anything or describe a web task you'd like me to run.</p>
      <div class="suggestions">
        <button class="suggestion" onclick="fillAndSend('Go to GitHub trending and list the top 3 repositories today')">
          <span class="s-icon">📊</span>
          Top GitHub repos today
        </button>
        <button class="suggestion" onclick="fillAndSend('What can you help me automate on the web?')">
          <span class="s-icon">🤖</span>
          What can you automate?
        </button>
        <button class="suggestion" onclick="fillAndSend('Go to news.ycombinator.com and extract the top 5 post titles')">
          <span class="s-icon">📰</span>
          Top Hacker News posts
        </button>
        <button class="suggestion" onclick="fillAndSend('Go to Wikipedia and get the summary of Artificial Intelligence')">
          <span class="s-icon">🌐</span>
          Wikipedia AI summary
        </button>
      </div>
    </div>
  `;
}

function fillAndSend(text) {
  msgInput.value = text;
  onInputChange();
  handleSend();
}

/* ================================================================
   INPUT HANDLING
================================================================ */
function onInputChange() {
  // Auto-resize textarea
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
  // Enable / disable send button
  sendBtn.disabled = !msgInput.value.trim() || isStreaming;
}

function onKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
}

async function handleSend() {
  const text = msgInput.value.trim();
  if (!text || isStreaming) return;

  // Reset input
  msgInput.value = '';
  msgInput.style.height = 'auto';
  sendBtn.disabled = true;

  const chat = getChat();

  // Remove welcome screen if present
  const welcome = messages.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Append user message
  chat.messages.push({ role: 'user', content: text });
  appendMessage('user', text, true);

  // Update chat title
  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    chat.title = text.slice(0, 50) + (text.length > 50 ? '…' : '');
    renderSidebar();
  }
  saveConversations();

  // Show typing
  const typingRow = showTyping();
  isStreaming = true;

  try {
    const apiMsgs = chat.messages
      .filter(m => m.role !== 'system')
      .slice(-24)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : m.role, content: m.content }));

    const aiText = await streamResponse(apiMsgs, typingRow);

    chat.messages.push({ role: 'assistant', content: aiText });
    saveConversations();
  } catch (err) {
    typingRow.remove();
    appendMessage('agent', `Sorry, something went wrong: ${err.message}`, true);
  }

  isStreaming = false;
  sendBtn.disabled = !msgInput.value.trim();
}

/* ================================================================
   STREAMING CHAT RESPONSE
================================================================ */
async function streamResponse(messages, typingRow) {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Server error ${response.status}`);
  }

  // Remove typing indicator and create streaming bubble
  typingRow.remove();
  const { contentEl, msgRow } = createAgentBubble();

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let fullText  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.startsWith('data: ')) continue;
      const raw = part.slice(6).trim();
      if (raw === '[DONE]') continue;

      try {
        const { content } = JSON.parse(raw);
        if (content) {
          fullText += content;
          // Show cleaned text (strip task markers while streaming)
          contentEl.textContent = fullText.replace(/\[TASK:\{[^}]*\}.*?\]/g, '').trim();
          scrollBottom();
        }
      } catch { /* ignore partial JSON */ }
    }
  }

  // Parse for [TASK:{...}] markers
  const taskMatch = fullText.match(/\[TASK:(\{[^}]+\})\]/);
  if (taskMatch) {
    try {
      const taskData = JSON.parse(taskMatch[1]);
      // Show clean text
      contentEl.textContent = fullText.replace(/\[TASK:\{[^}]+\}\]/, '').trim();
      // Append task card
      appendTaskCard(msgRow, taskData);
    } catch { /* bad JSON in marker */ }
  }

  scrollBottom();
  return fullText;
}

/* ================================================================
   MESSAGE RENDERING
================================================================ */
function appendMessage(role, content, animate = true) {
  const isUser = role === 'user';

  const row = document.createElement('div');
  row.className = `msg-row ${isUser ? 'user' : 'agent'}`;
  if (!animate) row.style.animation = 'none';

  row.innerHTML = `
    <div class="msg-avatar ${isUser ? 'user-av' : 'agent-av'}">
      ${isUser ? '👤' : '⚡'}
    </div>
    <div class="msg-content">
      <div class="msg-name">${isUser ? 'You' : 'BlitzAgent'}</div>
      <div class="msg-bubble">${esc(content)}</div>
    </div>
  `;
  messages.appendChild(row);
  if (animate) scrollBottom();
  return row;
}

function createAgentBubble() {
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  row.innerHTML = `
    <div class="msg-avatar agent-av">⚡</div>
    <div class="msg-content">
      <div class="msg-name">BlitzAgent</div>
      <div class="msg-bubble"></div>
    </div>
  `;
  messages.appendChild(row);
  scrollBottom();
  return { contentEl: row.querySelector('.msg-bubble'), msgRow: row };
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  row.innerHTML = `
    <div class="msg-avatar agent-av">⚡</div>
    <div class="msg-content">
      <div class="msg-name">BlitzAgent</div>
      <div class="msg-bubble">
        <div class="typing-dots">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  messages.appendChild(row);
  scrollBottom();
  return row;
}

/* ================================================================
   TASK CARD (browser automation trigger)
================================================================ */
function appendTaskCard(msgRow, taskData) {
  const url  = taskData.url  || '';
  const task = taskData.task || '';

  const card = document.createElement('div');
  card.className = 'task-card';
  card.innerHTML = `
    <div class="task-card-header">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      Browser Task Ready
    </div>
    <div class="task-card-row"><strong>URL:</strong> ${esc(url)}</div>
    <div class="task-card-row"><strong>Task:</strong> ${esc(task)}</div>
    <button class="task-run-btn" id="runBtn_${Date.now()}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      Run Task
    </button>
  `;

  const runBtn = card.querySelector('button');
  runBtn.addEventListener('click', () => runBrowserTask(runBtn, url, task));

  msgRow.querySelector('.msg-content').appendChild(card);
}

/* ================================================================
   BROWSER TASK RUNNER
================================================================ */
async function runBrowserTask(btn, url, task) {
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    Starting…
  `;

  // Add a progress message row
  const progressRow = document.createElement('div');
  progressRow.className = 'msg-row agent';
  const progId = 'prog_' + Date.now();
  progressRow.innerHTML = `
    <div class="msg-avatar agent-av">⚡</div>
    <div class="msg-content">
      <div class="msg-name">BlitzAgent</div>
      <div class="task-progress" id="${progId}">
        <div class="task-progress-header">
          <span>Running browser task…</span>
          <span class="task-status-badge running">Running</span>
        </div>
        <div class="task-steps" id="${progId}_steps"></div>
      </div>
    </div>
  `;
  messages.appendChild(progressRow);
  scrollBottom();

  const progressEl  = document.getElementById(progId);
  const stepsEl     = document.getElementById(`${progId}_steps`);
  const statusBadge = progressEl.querySelector('.task-status-badge');

  try {
    const r = await fetch('/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, task }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to start task');

    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      Running…
    `;

    await pollTask(data.taskId, stepsEl, statusBadge, progressEl);

    const chat = getChat();
    chat.messages.push({ role: 'assistant', content: `[Ran browser task: "${task}" at ${url}]` });
    saveConversations();
  } catch (err) {
    stepsEl.innerHTML = `<div class="task-step" style="color:var(--red)">${esc(err.message)}</div>`;
    statusBadge.textContent = 'Failed';
    statusBadge.className = 'task-status-badge failed';
  }

  btn.disabled = false;
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    Run Again
  `;
}

async function pollTask(taskId, stepsEl, statusBadge, progressEl) {
  let knownSteps   = 0;
  let knownShots   = 0;
  const DONE_STATES = ['completed', 'failed', 'error'];

  return new Promise(resolve => {
    const interval = setInterval(async () => {
      try {
        const r    = await fetch(`/task/${taskId}`);
        const data = await r.json();

        // Render new steps
        if (Array.isArray(data.steps) && data.steps.length > knownSteps) {
          data.steps.slice(knownSteps).forEach(s => {
            const div = document.createElement('div');
            div.className = 'task-step';
            const ok = s.success ? '✓' : '✗';
            div.innerHTML = `
              <span class="sn">Step ${esc(String(s.step))}</span>
              <span>${esc(s.action || '')} ${esc(formatParams(s.params))} — <span style="opacity:.7">${esc(s.result || '')}</span></span>
            `;
            stepsEl.appendChild(div);
            knownSteps++;
          });
          scrollBottom();
        }

        // Render new screenshots
        const shots = data.screenshots || [];
        if (shots.length > knownShots) {
          let shotsEl = progressEl.querySelector('.task-shots');
          if (!shotsEl) {
            shotsEl = document.createElement('div');
            shotsEl.className = 'task-shots';
            progressEl.appendChild(shotsEl);
          }
          shots.slice(knownShots).forEach(path => {
            const img = document.createElement('img');
            img.src = `/${path}`;
            img.className = 'task-shot-thumb';
            img.title = path.split('/').pop();
            img.addEventListener('click', () => window.open(`/${path}`, '_blank'));
            shotsEl.appendChild(img);
          });
          knownShots = shots.length;
        }

        // Check done
        if (DONE_STATES.includes(data.status)) {
          clearInterval(interval);
          const success = data.status === 'completed';
          statusBadge.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
          statusBadge.className = `task-status-badge ${success ? 'completed' : 'failed'}`;

          const summary = data.result?.result || data.error;
          if (summary) {
            const div = document.createElement('div');
            div.className = 'task-summary';
            div.textContent = summary;
            progressEl.appendChild(div);
          }
          scrollBottom();
          resolve();
        }
      } catch {
        clearInterval(interval);
        resolve();
      }
    }, 1500);

    // Absolute 5-minute timeout
    setTimeout(() => { clearInterval(interval); resolve(); }, 300_000);
  });
}

/* ================================================================
   UTILITIES
================================================================ */
function scrollBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatParams(params) {
  if (!params || typeof params !== 'object') return '';
  const pairs = Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return pairs.length ? `(${pairs.join(', ')})` : '';
}

// Expose loadChatUI globally for sidebar onclick
window.loadChatUI = loadChatUI;
window.fillAndSend = fillAndSend;

/* ================================================================
   CSS KEYFRAME: spin (for loading icons)
================================================================ */
const styleTag = document.createElement('style');
styleTag.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(styleTag);
