# Debate Coach 🎤⚖️

> *"Devil's Advocate" AI Research Prototype — Group 44, Spring 2026*

This is a research topic for practice debating controversial topics. We can text our AI if it will do the common thing to agree quickly, or pushback. With an extra step of seeing if prompt engineering would suffice or we need to finetune.

A human/AI interaction research tool that challenges users' beliefs constructively. Compares three AI conditions in a within-subjects pilot study.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Add your OpenAI API key
```bash
cp .env.example .env
# Edit .env and add your key
```

### 3. Run the server
```bash
npm start          # Production
npm run dev        # Development (auto-reload)
```

Open [http://localhost:3000](http://localhost:3000)

---

## Study Design

| Condition | Description |
|-----------|-------------|
| **A** | Vanilla GPT-4o (no special prompting) |
| **B** | Prompted devil's advocate (engineered system prompt) |
| **C** | Fine-tuned model (trained on debate data) |

**Design**: Within-subjects — each participant completes all 3 conditions in counterbalanced order.

**Survey**: 1–5 Likert scale for:
1. Stance Reconsideration
2. Perceived Fairness
3. Helpfulness
4. Frustration

---

## File Structure

```
DebateAI/
├── server.js                   # Express API server
├── package.json
├── .env.example                # Copy to .env and fill in keys
├── public/
│   ├── style.css               # Global design system
│   ├── index.html              # Landing / topic selection
│   ├── debate.html             # Chat interface
│   ├── reflect.html            # Post-debate survey
│   ├── complete.html           # Completion screen
│   └── admin.html              # Researcher dashboard
├── data/
│   ├── sessions.json           # Persistent session storage (auto-created)
│   └── sample_transcripts/     # Put transcript JSONs here for fine-tuning
└── scripts/
    ├── prepare_finetune.js     # Converts transcripts → JSONL
    └── launch_finetune.js      # Uploads & starts fine-tuning job
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/chat` | Streaming AI response (SSE) |
| POST | `/api/reflect` | Generate counterargument summary |
| POST | `/api/judge` | LLM-as-Judge scoring (5 properties) |
| POST | `/api/metrics` | Argument quality metrics |
| POST | `/api/sessions` | Save session to disk |
| GET  | `/api/sessions` | List all sessions |
| GET  | `/api/export` | Download sessions as CSV |

---

## Fine-Tuning (Condition C)

1. Place debate transcripts in `data/sample_transcripts/` as JSON files:
```json
{
  "topic": "Universal Basic Income",
  "exchanges": [
    { "user": "I think UBI is great because…", "assistant": "I understand, but consider…" }
  ]
}
```

2. Prepare training data:
```bash
node scripts/prepare_finetune.js
```

3. Launch fine-tuning job:
```bash
node scripts/launch_finetune.js
```

4. Copy the resulting model ID into `.env`:
```
FINE_TUNED_MODEL_ID=ft:gpt-4o-mini:your-org:debate-coach:xxxxx
```

---

## Researcher Dashboard

Visit [http://localhost:3000/admin.html](http://localhost:3000/admin.html) for:
- Session table filtered by condition
- Bar charts: survey scores, LLM-as-Judge scores, argument quality metrics
- CSV export of all session data

---

## References

1. Hu et al. (2025). Multi-agent debate for LLM judges. arXiv:2510.12697
2. Rambow et al. (2025). Debate-to-write. ACL 2025.
3. Zheng et al. (2023). Judging LLM-as-a-judge. arXiv:2306.05685
