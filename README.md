# 🤖 Browser Automation Agent

> A fully autonomous browser automation agent powered by **Mercury LLM** (Inception AI) and **Playwright**. Built for the **Byte Blitz Hackathon**.

The agent can navigate to URLs, fill out forms, click buttons, handle popups, extract information, and operate reliably across different websites — all driven by natural language instructions.

---

## 🏗️ Architecture

```
User Task (natural language)
        ↓
┌───────────────────────────┐
│   PERCEIVE                │  ← Semantic DOM snapshot (90% token reduction)
│   Extract page elements   │
├───────────────────────────┤
│   REASON                  │  ← Mercury LLM with function calling
│   Decide next action      │
├───────────────────────────┤
│   ACT                     │  ← Playwright browser commands
│   Execute & verify        │
├───────────────────────────┤
│   RECOVER                 │  ← Auto-dismiss popups, retry, scroll
│   Handle failures         │
└───────────────────────────┘
        ↓
    Result + Screenshots
```

**Key Design Decisions:**
- **Semantic DOM Snapshots** — Instead of sending raw HTML (50K–200K tokens), we extract only interactive elements into a compact format (~500–2K tokens). **90% token savings**.
- **Function Calling** — Mercury returns structured tool calls (`click`, `fill`, `navigate`, etc.) instead of free-text, ensuring precise and parseable actions.
- **Error Recovery** — Auto-dismisses cookie banners/modals, retries with scrolling, handles navigation errors.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+**
- **Mercury API key** — Get free 10M tokens at [inceptionlabs.ai](https://inceptionlabs.ai)

### Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd browser-automation-agent

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env and add your MERCURY_API_KEY
```

### Run Tests

```bash
# Run all test cases
npm test

# Run a specific test (by index 0-3)
node test.js 0
```

### Start API Server

```bash
# Development
npm run dev

# Production
npm start
```

---

## 📡 API Reference

### Submit an Async Task
```bash
curl -X POST http://localhost:3000/task \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "task": "Click the More Information link"}'
```

**Response:**
```json
{ "taskId": "abc123", "status": "running" }
```

### Get Task Result
```bash
curl http://localhost:3000/task/abc123
```

### Submit a Sync Task (waits for completion)
```bash
curl -X POST http://localhost:3000/task/sync \
  -H "Content-Type: application/json" \
  -d '{"url": "https://quotes.toscrape.com", "task": "Extract the first 3 quotes"}'
```

### List All Tasks
```bash
curl http://localhost:3000/tasks
```

### Health Check
```bash
curl http://localhost:3000/health
```

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t browser-agent .

# Run container
docker run -p 3000:3000 -e MERCURY_API_KEY=your_key_here browser-agent
```

### Deploy to Cloud (Railway, Render, Fly.io)

1. Push code to GitHub
2. Connect repo on Railway/Render
3. Set `MERCURY_API_KEY` env var
4. Deploy — the Dockerfile handles everything

---

## 📁 Project Structure

```
browser-automation-agent/
├── server.js              # Express REST API
├── agent/
│   ├── loop.js            # Main perceive→reason→act loop
│   ├── perceive.js        # Semantic DOM snapshot extractor
│   ├── reason.js          # Mercury LLM function calling
│   ├── execute.js         # Playwright action executor
│   └── recovery.js        # Error recovery & retry logic
├── utils/
│   └── logger.js          # Structured logging (Winston)
├── test.js                # Test suite with sample websites
├── Dockerfile             # Production container
├── .env.example           # Environment variable template
└── README.md
```

---

## 🧠 Supported Actions

| Action | Description | Example |
|--------|-------------|---------|
| `click` | Click an element | `click(ref="ref-5")` |
| `fill` | Type into input field | `fill(ref="ref-2", value="hello")` |
| `select` | Choose dropdown option | `select(ref="ref-7", value="Large")` |
| `navigate` | Go to URL | `navigate(url="https://...")` |
| `scroll` | Scroll page | `scroll(direction="down")` |
| `wait` | Pause execution | `wait(ms=2000)` |
| `extract` | Get text content | `extract(ref="ref-1")` |
| `done` | Signal completion | `done(result="...", success=true)` |

---

## ⚡ Token Efficiency

| Technique | Savings |
|-----------|:------:|
| Semantic DOM snapshots vs raw HTML | ~90% |
| Truncated text (80 char limit) | ~30% |
| Visible elements only | ~50% |
| Compact LLM format | ~20% |
| Capped conversation history (10 msgs) | ~60% |
| Low max_tokens (300) for actions | ~40% |

**Typical task: 3K–8K total tokens** (vs 50K–200K with naive approaches)

---

## 🔧 Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `MERCURY_API_KEY` | required | Mercury LLM API key |
| `PORT` | `3000` | Server port |
| `HEADLESS` | `true` | Run browser headless |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## 📝 Assumptions

- Target websites use standard HTML elements (links, buttons, inputs, selects)
- JavaScript-rendered content is handled via Playwright's auto-wait capabilities
- The agent works best with task descriptions that are specific and actionable
- Cookie banners and basic popups are auto-dismissed

---

## 📜 License

MIT
