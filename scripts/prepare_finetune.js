// prepare_finetune.js
// Usage: node scripts/prepare_finetune.js
// Reads sessions from data/sessions.json and converts them to OpenAI fine-tuning JSONL format.
// Output: data/finetune_data.jsonl

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(__dirname, '..', 'data', 'sessions.json');
const OUTPUT_FILE = join(__dirname, '..', 'data', 'finetune_data.jsonl');

const SYSTEM_PROMPT = `You are "Debate Coach," a rigorous devil's advocate trained on high-quality debate data. Your role is to constructively challenge the user's beliefs with precision, nuance, and intellectual honesty.

Approach:
- Identify the core inferential structure of the user's argument before countering it.
- Counter at the level of principle, evidence, or logical implication — not surface rhetoric.
- Practice steelmanning: acknowledge the strongest version of their view, then target its weakest point.
- Use one crisp counterargument per turn; follow up with a probing question.
- Mirror the user's vocabulary and frame to keep arguments grounded in their own terms.
- Never repeat an argument you've already made in this session.

Goal: foster genuine reconsideration, not defensiveness.`;

const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
const jsonlLines = [];
let exampleCount = 0;

for (const session of sessions) {
  const { topic, messages } = session;
  if (!messages || messages.length < 2) continue;

  // Build sliding-window training examples (one per AI turn)
  const baseMessages = [{ role: 'system', content: `${SYSTEM_PROMPT}\n\nDebate topic: "${topic}"` }];
  const history = [...baseMessages];

  for (const msg of messages) {
    if (msg.role === 'user') {
      history.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      // Training example: everything up to this point → this response
      jsonlLines.push(JSON.stringify({
        messages: [...history, { role: 'assistant', content: msg.content }]
      }));
      history.push({ role: 'assistant', content: msg.content });
      exampleCount++;
    }
  }
}

writeFileSync(OUTPUT_FILE, jsonlLines.join('\n'), 'utf8');
console.log(`✅ Exported ${exampleCount} training examples from ${sessions.length} sessions`);
console.log(`   Output: ${OUTPUT_FILE}`);
console.log(`\nNote: Blackbox does not support fine-tuning.`);
console.log(`To actually fine-tune, upload this JSONL to OpenAI platform.openai.com/finetune`);
console.log(`Then set FINE_TUNED_MODEL_ID=<your-ft-model-id> in .env`);
