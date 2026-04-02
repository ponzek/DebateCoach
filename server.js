import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = join(__dirname, 'data', 'sessions.json');
const COUNTER_FILE = join(__dirname, 'data', 'participant_counter.json');

// Ensure data directory and files exist
import { mkdirSync } from 'fs';
try {
  mkdirSync(join(__dirname, 'data'), { recursive: true });
  if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, '[]', 'utf8');
  if (!existsSync(COUNTER_FILE)) writeFileSync(COUNTER_FILE, '{"count":0}', 'utf8');
} catch (e) { /* already exists */ }

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.BLACKBOX_BASE_URL ? { baseURL: process.env.BLACKBOX_BASE_URL } : {})
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));

// System Prompts
const SYSTEM_PROMPTS = {
  A: `You are a conversational AI assistant. Engage with the user's debate topic naturally.`,

  B: `You are "Debate Coach," a rigorous devil's advocate. Your role is NOT to win the argument - it is to strengthen the user's critical thinking by presenting the strongest possible counterarguments to whatever position they defend.

Rules:
1. Always argue the opposite of the user's stated position, even if you personally agree with them.
2. Never straw-man. Engage directly with the user's actual stated claims.
3. Use Socratic questions to expose unstated assumptions.
4. Present ONE clear, well-reasoned counterargument per turn - do not pepper the user with multiple points.
5. Acknowledge strong points the user makes before pivoting to your counterpoint.
6. Remain calm, respectful, and intellectually fair at all times.
7. Do not moralize or lecture. Stay argument-focused.
8. Keep responses concise (2-4 sentences max) so the debate stays dynamic.

Your goal: help the user refine their thinking, not defeat them.`,

  C: `You are "Debate Coach," a highly trained devil's advocate developed on high-quality debate transcripts. Your mission is to constructively challenge the user's beliefs with precision, nuance, and intellectual honesty.

Approach:
- Identify the core inferential structure of the user's argument before countering it.
- Counter at the level of principle, evidence, or logical implication - not surface rhetoric.
- Practice steelmanning: acknowledge the strongest version of their view, then target its weakest point.
- Use one crisp counterargument per turn; follow up with a probing question.
- Mirror the user's vocabulary and frame to keep arguments grounded in their own terms.
- Calibrate intensity: if the user seems frustrated, soften tone; if engaged, deepen the challenge.
- Never repeat an argument you've already made in this session.

Goal: foster genuine reconsideration, not defensiveness.`
};

function parseJSON(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// Atomically get and increment participant counter - never resets
function getNextParticipantId() {
  const data = JSON.parse(readFileSync(COUNTER_FILE, 'utf8'));
  data.count += 1;
  writeFileSync(COUNTER_FILE, JSON.stringify(data), 'utf8');
  return `P${data.count}`;
}

// GET /api/next-participant-id - auto-assigns next ID
app.get('/api/next-participant-id', (req, res) => {
  try {
    const participantId = getNextParticipantId();
    res.json({ participantId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat (streaming)
app.post('/api/chat', async (req, res) => {
  const { messages, topic, condition } = req.body;
  if (!messages || !condition) return res.status(400).json({ error: 'Missing fields' });

  const systemPrompt = SYSTEM_PROMPTS[condition] || SYSTEM_PROMPTS.B;
  const model = condition === 'C' && process.env.FINE_TUNED_MODEL_ID
    ? process.env.FINE_TUNED_MODEL_ID
    : 'claude-sonnet-4-5-20250514';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: 'system', content: `${systemPrompt}\n\nDebate topic: "${topic}"` },
        ...messages
      ],
      max_tokens: 300,
      temperature: 0.8
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// POST /api/reflect
app.post('/api/reflect', async (req, res) => {
  const { messages, topic } = req.body;
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'PARTICIPANT' : 'DEBATE COACH'}: ${m.content}`)
    .join('\n');

  try {
    const resp = await openai.chat.completions.create({
      model: 'claude-sonnet-4-5-20250514',
      messages: [{
        role: 'system',
        content: `You are a debate analyst. Given this debate transcript on the topic "${topic}", extract exactly 3 of the strongest counterarguments that the AI raised. Return JSON: { "counterarguments": ["arg1", "arg2", "arg3"] }. Each should be 1-2 sentences, precise, and directly challenging the participant's position.`
      }, {
        role: 'user',
        content: transcript
      }],
      response_format: { type: 'json_object' },
      max_tokens: 400
    });
    const data = parseJSON(resp.choices[0].message.content);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/judge
app.post('/api/judge', async (req, res) => {
  const { messages, topic, condition } = req.body;
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'PARTICIPANT' : 'AI'}: ${m.content}`)
    .join('\n');

  try {
    const resp = await openai.chat.completions.create({
      model: 'claude-sonnet-4-5-20250514',
      messages: [{
        role: 'system',
        content: `You are an expert debate evaluator. Rate this AI debate transcript on each property from 1 (very poor) to 5 (excellent). Return JSON with this exact shape:
{
  "counterargumentStrength": <1-5>,
  "engagementWithArguments": <1-5>,
  "fairness": <1-5>,
  "persuasiveAppeal": <1-5>,
  "constructiveAppeal": <1-5>,
  "justification": "<2-3 sentence overall justification>"
}

Definitions:
- counterargumentStrength: How strong and well-reasoned were the AI's counterarguments?
- engagementWithArguments: Did the AI engage with the participant's actual claims (not straw-men)?
- fairness: Was the AI fair, balanced, and free from fallacies?
- persuasiveAppeal: How persuasive was the AI's overall argumentation?
- constructiveAppeal: Did the AI's challenges help, rather than alienate, the participant?`
      }, {
        role: 'user',
        content: `Topic: ${topic}\nCondition: ${condition}\n\n${transcript}`
      }],
      response_format: { type: 'json_object' },
      max_tokens: 400
    });
    res.json(parseJSON(resp.choices[0].message.content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metrics
app.post('/api/metrics', async (req, res) => {
  const { messages } = req.body;
  const aiTurns = messages.filter(m => m.role === 'assistant').map(m => m.content);

  if (aiTurns.length < 2) {
    return res.json({ argumentDiversity: null, topicalRelevance: null, repetitionRate: null });
  }

  function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  }

  function cosineSim(a, b) {
    const setA = tokenize(a), setB = tokenize(b);
    const freqA = {}, freqB = {};
    setA.forEach(w => freqA[w] = (freqA[w] || 0) + 1);
    setB.forEach(w => freqB[w] = (freqB[w] || 0) + 1);
    const vocab = new Set([...Object.keys(freqA), ...Object.keys(freqB)]);
    let dot = 0, magA = 0, magB = 0;
    vocab.forEach(w => {
      const a = freqA[w] || 0, b = freqB[w] || 0;
      dot += a * b; magA += a * a; magB += b * b;
    });
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  function ngramOverlap(turns) {
    function ngrams(text, n) {
      const tokens = tokenize(text);
      const grams = new Set();
      for (let i = 0; i <= tokens.length - n; i++) {
        grams.add(tokens.slice(i, i + n).join(' '));
      }
      return grams;
    }
    let total = 0, count = 0;
    for (let i = 0; i < turns.length; i++) {
      for (let j = i + 1; j < turns.length; j++) {
        const gi = ngrams(turns[i], 2), gj = ngrams(turns[j], 2);
        const intersection = new Set([...gi].filter(x => gj.has(x)));
        const union = new Set([...gi, ...gj]);
        total += union.size > 0 ? intersection.size / union.size : 0;
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }

  let divSum = 0;
  for (let i = 0; i < aiTurns.length - 1; i++) {
    divSum += (1 - cosineSim(aiTurns[i], aiTurns[i + 1]));
  }
  const argumentDiversity = divSum / (aiTurns.length - 1);

  const pairs = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === 'user' && messages[i + 1]?.role === 'assistant') {
      pairs.push(cosineSim(messages[i].content, messages[i + 1].content));
    }
  }
  const topicalRelevance = pairs.length > 0 ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null;
  const repetitionRate = ngramOverlap(aiTurns);

  res.json({
    argumentDiversity: Math.round(argumentDiversity * 1000) / 1000,
    topicalRelevance: topicalRelevance != null ? Math.round(topicalRelevance * 1000) / 1000 : null,
    repetitionRate: Math.round(repetitionRate * 1000) / 1000
  });
});

// POST /api/sessions
app.post('/api/sessions', (req, res) => {
  const session = { sessionId: randomUUID(), ...req.body, savedAt: new Date().toISOString() };
  const sessions = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  sessions.push(session);
  writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  res.json({ sessionId: session.sessionId });
});

app.get('/api/sessions', (req, res) => {
  const sessions = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  res.json(sessions);
});

// GET /api/export - properly formatted CSV
app.get('/api/export', (req, res) => {
  const sessions = JSON.parse(readFileSync(DATA_FILE, 'utf8'));

  function csvCell(val) {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch { return iso; }
  }

  const headers = [
    'Session ID', 'Participant ID', 'Topic', 'Condition', 'Condition Name',
    'Started At', 'Ended At', 'Message Count',
    'Stance Reconsideration (1-5)', 'Perceived Fairness (1-5)', 'Helpfulness (1-5)', 'Frustration (1-5)',
    'Open Response',
    'Judge: Counterargument Strength', 'Judge: Engagement w/ Arguments', 'Judge: Fairness',
    'Judge: Persuasive Appeal', 'Judge: Constructive Appeal', 'Judge: Justification',
    'Arg Diversity (0-1)', 'Topical Relevance (0-1)', 'Repetition Rate (0-1)'
  ];

  const condNames = { A: 'Vanilla', B: 'Prompted Devils Advocate', C: 'Fine-tuned' };

  const rows = sessions.map(s => [
    s.sessionId,
    s.participantId,
    s.topic,
    s.condition,
    condNames[s.condition] || s.condition,
    fmtDate(s.startedAt),
    fmtDate(s.endedAt),
    (s.messages || []).length,
    s.survey?.stanceReconsideration,
    s.survey?.perceivedFairness,
    s.survey?.helpfulness,
    s.survey?.frustration,
    s.survey?.openResponse,
    s.judgeScores?.counterargumentStrength,
    s.judgeScores?.engagementWithArguments,
    s.judgeScores?.fairness,
    s.judgeScores?.persuasiveAppeal,
    s.judgeScores?.constructiveAppeal,
    s.judgeScores?.justification,
    s.argQualityMetrics?.argumentDiversity,
    s.argQualityMetrics?.topicalRelevance,
    s.argQualityMetrics?.repetitionRate
  ].map(csvCell));

  const csv = [headers.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="debate_coach_export_${new Date().toISOString().split('T')[0]}.csv"`);
  // BOM for Excel compatibility
  res.send('\uFEFF' + csv);
});

app.listen(PORT, () => console.log(`Debate Coach running at http://localhost:${PORT}`));
