import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { runFullAudit } from './judgeService.js';

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

  B: `You are "Debate Coach," a devil's advocate who helps the user think more critically by pushing back on their ideas.

Your Guidelines:
1. Back It Up: Support every counterargument with one real-world example, fact, or study — but explain it simply.
2. Keep It Simple: Write like you're talking to a smart friend, not a professor. No jargon, no fancy terms.
3. One Point at a Time: Make only ONE counter-point per response.
4. Be Fair: Briefly admit if the user made a good point before you push back.
5. Stay Direct: Argue the opposite of what the user said and challenge their reasoning head-on.
6. Stay Short: Keep responses to 2-4 sentences max.

Your goal: get the user to think deeper, not feel lectured.`,

  C: `You are "Debate Coach," an expert devil's advocate who challenges the user's thinking by targeting the weak spots in their argument.

Your Guidelines:
1. Hit the Root: Find the hidden assumption behind what the user said and challenge it with a real fact, study, or example that contradicts it.
2. Plain Language Only: Write clearly and confidently — like a sharp, experienced mentor, not an academic. No jargon, no complex vocabulary.
3. Use Real Evidence: Bring in specific data, research findings, or real-world cases that directly contradict the user's position.
4. Find the Exception: If the user makes a solid point, find a specific edge case or exception that shows their argument doesn't always hold.
5. Make Them Respond: Don't just ask questions — make a strong, fact-backed case that they actually have to answer to.
6. Stay Concise: Keep responses to 2-4 sentences max.

Your goal: give the user a sharp, evidence-based challenge that makes them think harder — without making them feel talked down to.`,
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
    const { messages, topic, condition, isFinal } = req.body;
    if (!messages || !condition) return res.status(400).json({ error: 'Missing fields' });
  
    const systemPrompt = SYSTEM_PROMPTS[condition] || SYSTEM_PROMPTS.B;
    const model = condition === 'C' && process.env.FINE_TUNED_MODEL_ID
      ? process.env.FINE_TUNED_MODEL_ID
      : (condition === 'C' ? 'gpt-4o' : 'gpt-4o-mini');
  
    const apiMessages = [
      { role: 'system', content: `${systemPrompt}\n\nDebate topic: "${topic}"` },
      ...messages
    ];
  
    if (isFinal) {
      apiMessages.push({ 
        role: 'system', 
        content: "This is your final response for this topic. Do NOT end with a question. Instead, acknowledge their last point and provide a definitive closing wrap-up that leaves them with a final thought." 
      });
    }
  
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  
    try {
      const stream = await openai.chat.completions.create({
        model,
        stream: true,
        messages: apiMessages,
        max_tokens: 175,
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
      model: 'gpt-4o-mini',
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
    .map(m => `${m.role === 'user' ? 'PARTICIPANT' : 'AI COACH'}: ${m.content}`)
    .join('\n');

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a professional HCI (Human-Computer Interaction) researcher and debate auditor. 
Your task is to evaluate an AI-led debate session. For each dimension, provide a score from 1-5 and a brief justification (1-2 sentences) citing evidence from the transcript.

Dimensions to Evaluate:
1. logicalRigor: Strength of evidence/facts. Does the AI provide empirical data or expert consensus that necessitates a response?
2. persuasiveAppeal: Force and conviction. How convincing and forceful was the AI's overall argumentation in challenging the participant?
3. userFrustration: Friction/Alienation. Did the participant appear dismissive, hostile, or alienated by the AI's tone? (1 = Perfectly Calm; 5 = Highly Frustrated).
4. engagementQuality: Addressing Premises. How well did the AI address the *exact* logical premises provided by the participant?
5. personaAdherence: Mentor Integrity. Did the AI maintain its "Debate Coach" mentor persona consistently without sounding like a generic assistant?

Return ONLY a JSON object with this exact shape:
{
  "logicalRigor": { "score": <1-5>, "reason": "<reason>" },
  "persuasiveAppeal": { "score": <1-5>, "reason": "<reason>" },
  "userFrustration": { "score": <1-5>, "reason": "<reason>" },
  "engagementQuality": { "score": <1-5>, "reason": "<reason>" },
  "personaAdherence": { "score": <1-5>, "reason": "<reason>" }
}`
      }, {
        role: 'user',
        content: `Debate Topic: ${topic}\nCondition: ${condition}\n\nTranscript:\n${transcript}`
      }],
      response_format: { type: 'json_object' },
      max_tokens: 800
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

// GET /api/export-txt - human-readable transcript export
app.get('/api/export-txt', (req, res) => {
  const sessions = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const condNames = { A: 'Vanilla', B: 'Prompted Devil\'s Advocate', C: 'Fine-tuned' };

  function fmtDate(iso) {
    if (!iso) return 'N/A';
    try { return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return iso; }
  }

  const lines = [];
  lines.push('DEBATE COACH - SESSION TRANSCRIPTS');
  lines.push(`Exported: ${fmtDate(new Date().toISOString())}`);
  lines.push('='.repeat(80));

  for (const s of sessions) {
    lines.push('');
    lines.push(`Session ID : ${s.sessionId}`);
    lines.push(`Participant: ${s.participantId || 'N/A'}`);
    lines.push(`Condition  : ${s.condition} - ${condNames[s.condition] || s.condition}`);
    lines.push(`Topic      : ${s.topic}`);
    lines.push(`Started    : ${fmtDate(s.startedAt)}`);
    lines.push(`Ended      : ${fmtDate(s.endedAt)}`);
    lines.push('-'.repeat(80));

    if (s.messages && s.messages.length > 0) {
      lines.push('TRANSCRIPT:');
      for (const m of s.messages) {
        const speaker = m.role === 'user' ? 'PARTICIPANT   ' : 'DEBATE COACH  ';
        const wrapped = m.content.replace(/(.{70})/g, '$1\n               ');
        lines.push(`  ${speaker}: ${wrapped}`);
      }
    }

    if (s.survey) {
      lines.push('');
      lines.push('SURVEY RESPONSES:');
      lines.push(`  Stance Reconsideration : ${s.survey.stanceReconsideration ?? 'N/A'} / 5`);
      lines.push(`  Perceived Fairness     : ${s.survey.perceivedFairness ?? 'N/A'} / 5`);
      lines.push(`  Helpfulness            : ${s.survey.helpfulness ?? 'N/A'} / 5`);
      lines.push(`  Frustration            : ${s.survey.frustration ?? 'N/A'} / 5`);
      if (s.survey.openResponse) lines.push(`  Open Response          : ${s.survey.openResponse}`);
    }

    if (s.judgeScores) {
      lines.push('');
      lines.push('AI JUDGE SCORES:');
      lines.push(`  Counterargument Strength : ${s.judgeScores.counterargumentStrength ?? 'N/A'} / 5`);
      lines.push(`  Engagement w/ Arguments  : ${s.judgeScores.engagementWithArguments ?? 'N/A'} / 5`);
      lines.push(`  Fairness                 : ${s.judgeScores.fairness ?? 'N/A'} / 5`);
      lines.push(`  Persuasive Appeal        : ${s.judgeScores.persuasiveAppeal ?? 'N/A'} / 5`);
      lines.push(`  Constructive Appeal      : ${s.judgeScores.constructiveAppeal ?? 'N/A'} / 5`);
      if (s.judgeScores.justification) lines.push(`  Justification            : ${s.judgeScores.justification}`);
    }

    lines.push('='.repeat(80));
  }

  const txt = lines.join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="debate_coach_transcripts_${new Date().toISOString().split('T')[0]}.txt"`);
  res.send(txt);
});

// POST /api/audit-pairwise
app.post('/api/audit-pairwise', async (req, res) => {
  const { conditionData, topic } = req.body;
  if (!conditionData || !topic) return res.status(400).json({ error: 'Missing data' });

  try {
    const auditResults = await runFullAudit(conditionData, topic);
    res.json(auditResults);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Debate Coach running at http://localhost:${PORT}`));
