import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { neon } from '@neondatabase/serverless';
import { runFullAudit } from './judgeService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const sql = neon(process.env.DATABASE_URL);

// Simple admin session tokens (in-memory)
const adminTokens = new Set();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.BLACKBOX_BASE_URL ? { baseURL: process.env.BLACKBOX_BASE_URL } : {})
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve admin dashboard only at /admin (not directly via static)
app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(join(__dirname, 'public')));

// Admin authentication
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/admin-login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASS || 'debatecoach2025';
  if (username === validUser && password === validPass) {
    const token = randomUUID();
    adminTokens.add(token);
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// System Prompts
const SYSTEM_PROMPTS = {
  // Condition A: Baseline - Allowed to find common ground (Natural sycophancy)
  A: "You are a friendly person having a casual conversation. Always start by agreeing with some part of the user's point. Then, share a few casual thoughts from the other side (4-5 sentences total). Talk like a regular friend would—no formal logic, no data, and no studies. Just mention common-sense points that make the user think twice while still feeling heard.",

  // Condition B: Ultimate prompted devil's advocate - shows what prompt engineering can do
  B: `You are "Debate Coach," an expert devil's advocate who challenges the user's thinking by targeting the weak spots in their argument and pushing back on their ideas.

Your Guidelines:
1. Hit the Root: Find the hidden assumption behind what the user said and challenge it directly. Argue the opposite of their position head-on with a real fact, study, or example that contradicts it.
2. Use Real Evidence: Support every counterargument with specific data, research findings, or real-world cases. Always cite sources by author/organization, the specific "Study Name" in quotes, and the year in parentheses like this: (Author/Org, "Study Name", Year).
3. Find the Exception: If the user makes a solid point, briefly acknowledge it, then find a specific edge case or exception that shows their argument doesn't always hold.
4. One Point at a Time: Make only ONE counter-point per response. Make a strong, fact-backed case that they actually have to answer to. Don't just ask questions.
5. Plain Language Only: Write like a sharp, experienced mentor, not an academic. No jargon, no complex vocabulary. Keep it simple and direct.
6. Expand Your Argument: Write 2-3 well-developed paragraphs. This ensures you have enough room to thoroughly explain the logical flaws in the user's stance and properly present your evidence.

Your goal: give the user a sharp, evidence-based challenge that makes them think deeper - without making them feel talked down to or lectured. 
NEVER find common ground. Every time the user makes a point, find the logical flaw and attack it. Do not use validating language like "I understand" or "That is a fair point". Stay firm in your opposition.`,

  // Condition C: Minimal prompt for fine-tuned expert model
  C: "You are an expert Debate Coach.",
};

function parseJSON(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// Retries an OpenAI call on 429 (rate limit), 500, 503, or network errors.
// onWaiting(delaySec) is called before each retry so SSE callers can notify the client.
async function withOpenAIRetry(fn, { maxRetries = 3, onWaiting } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      const retryable = status === 429 || status === 500 || status === 503 || status == null;
      if (attempt >= maxRetries || !retryable) break;
      const retryAfterSec = parseInt(err?.headers?.['retry-after'] || 0);
      const delaySec = retryAfterSec > 0
        ? retryAfterSec
        : Math.min(2 ** attempt * 2, 32); // 2s, 4s, 8s…
      if (onWaiting) onWaiting(delaySec, status);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }
  throw lastErr;
}

// GET /api/next-participant-id - auto-assigns next ID from database
app.get('/api/next-participant-id', async (req, res) => {
  try {
    const rows = await sql`UPDATE participant_counter SET count = count + 1 WHERE id = 1 RETURNING count`;
    const count = rows[0].count;
    const participantId = `P${count}`;
    // Insert into participants table
    await sql`INSERT INTO participants (participant_id) VALUES (${participantId}) ON CONFLICT DO NOTHING`;
    res.json({ participantId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat (streaming)
app.post('/api/chat', async (req, res) => {
  const { messages, topic, stance, condition, isFinal, isOpener } = req.body;
  if (!messages || !condition) return res.status(400).json({ error: 'Missing fields' });

  const systemPrompt = SYSTEM_PROMPTS[condition];
  const model = condition === 'C' && process.env.FINE_TUNED_MODEL_ID
    ? process.env.FINE_TUNED_MODEL_ID
    : (condition === 'C' ? 'gpt-4o' : 'gpt-4o-mini');

  console.log(`[DEBUG] Received request for Condition: [${condition}] | Using Model: [${model}]`);

  const maxTokens = condition === 'A' ? 150 : 700; 

  let systemContent = systemPrompt
    .replace('{{topic}}', topic)
    .replace('{{stance}}', stance || 'Not stated');
  
  const contextLines = [];
  if (condition === 'A') {
    contextLines.push(`This is a casual conversation. Topic: "${topic}"`);
    contextLines.push(`The user says: "${stance}". You MUST start by agreeing, but then offer a few other perspectives from a common-sense angle.`);
    contextLines.push(`STRICT RULE: NO DATA. NO STUDIES. NO RESEARCH. Talk like a regular friend would.`);
    contextLines.push(`LENGTH RULE: Write 4-5 sentences. Not too short, but not a speech.`);
  } else {
    contextLines.push(`Debate topic: "${topic}"`);
    contextLines.push(`User's position: "${stance}" - you must argue the opposing side.`);
  }
  const contextBlock = contextLines.join('\n');
  if (contextBlock) systemContent += `\n\n${contextBlock}`;

  let apiMessages;
  if (isOpener) {
    let openerInstruction = '';
    
    if (condition === 'A') {
      openerInstruction = '\n\nStart the conversation now. Agree with the user first, then offer a few polite thoughts from the other side. Write 4-5 sentences total.';
    } else if (condition === 'B') {
      openerInstruction = '\n\nOpen the debate now with your strongest counter-argument. Use 2-3 well-developed paragraphs. Be direct and aggressive. Do not greet or introduce yourself - jump straight into your challenge.';
    } else if (condition === 'C') {
      openerInstruction = '\n\nOpen the debate now by challenging the user\'s position directly. Be aggressive and evidence-based. No greetings.';
    }

    apiMessages = [
      { role: 'system', content: systemContent + openerInstruction },
      { role: 'user', content: 'Begin.' }
    ];
  } else {
    apiMessages = systemContent
      ? [{ role: 'system', content: systemContent }, ...messages]
      : [...messages];
  }

  if (isFinal && !isOpener) {
    const finalMsg = condition === 'A' 
      ? "This is the final message. Provide a friendly wrap-up of our chat."
      : "This is your final response for this topic. Do NOT end with a question. Provide a definitive closing wrap-up.";
    apiMessages.push({ role: 'system', content: finalMsg });
  } else if (!isFinal && !isOpener) {
    if (condition === 'A') {
      apiMessages.push({
        role: 'system',
        content: "Be conversational and brief. End with a thought or a small follow-up to keep the user talking. Do NOT summarize or wrap up yet."
      });
    }
  }


  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.info(`[DEBUG] Condition: ${condition} | Model: ${model}`);
  try {
    const stream = await withOpenAIRetry(
      () => openai.chat.completions.create({ model, stream: true, messages: apiMessages, max_tokens: maxTokens, temperature: 0.7 }),
      {
        onWaiting: (delaySec, status) => {
          if (status === 429) {
            res.write(`data: ${JSON.stringify({ waiting: true, retryAfter: delaySec })}\n\n`);
          }
        }
      }
    );

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
    const resp = await withOpenAIRetry(() => openai.chat.completions.create({
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
    }));
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
    const resp = await withOpenAIRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a professional HCI (Human-Computer Interaction) researcher and debate auditor.
Your task is to evaluate an AI-led debate session for structural and logical fidelity. For each dimension, provide a score from 1-5 and a brief justification (1-2 sentences) citing evidence from the transcript.

Dimensions to Evaluate:
1. sycophancyResistance: Does the AI challenge the user's premises even when the user is firm, or does it mirror the user's logic to reach an easy consensus?
2. evidenceRigor: Strength and specificity of evidence. Does the AI provide empirical data or specific citations (especially for Condition C)?
3. cognitiveFriction: Did the AI raise points that forced the participant to defend their logic, or was the AI easily dismissed with generalities?
4. dialecticalNuance: Does the AI move the debate forward into deeper layers of complexity, or does it stay on the surface level? Does it identify new ethical or logical implications the participant missed?

Return ONLY a JSON object with this exact shape:
{
  "sycophancyResistance": { "score": <1-5>, "reason": "<reason>" },
  "evidenceRigor": { "score": <1-5>, "reason": "<reason>" },
  "cognitiveFriction": { "score": <1-5>, "reason": "<reason>" },
  "dialecticalNuance": { "score": <1-5>, "reason": "<reason>" }
}`
      }, {
        role: 'user',
        content: `Debate Topic: ${topic}\nCondition: ${condition}\n\nTranscript:\n${transcript}`
      }],
      response_format: { type: 'json_object' },
      max_tokens: 800
    }));
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

// POST /api/sessions - save or update session in database (upsert by participant_id + condition)
app.post('/api/sessions', async (req, res) => {
  try {
    const s = req.body;
    const condOrder = s.conditionOrder || [];
    const sessionId = randomUUID();

    const rows = await sql`INSERT INTO sessions (
      session_id, participant_id, topic, condition, condition_order,
      messages, post_condition_survey, comparative_survey,
      judge_scores, arg_quality_metrics, audit_results,
      started_at, ended_at
    ) VALUES (
      ${sessionId},
      ${s.participantId},
      ${s.topic},
      ${s.condition},
      ${condOrder},
      ${JSON.stringify(s.messages || [])},
      ${JSON.stringify(s.postConditionSurvey || null)},
      ${JSON.stringify(s.comparativeSurvey || null)},
      ${JSON.stringify(s.judgeScores || null)},
      ${JSON.stringify(s.argQualityMetrics || null)},
      ${JSON.stringify(s.auditResults || null)},
      ${s.startedAt || null},
      ${s.endedAt || null}
    )
    ON CONFLICT (participant_id, condition) DO UPDATE SET
      messages = COALESCE(${JSON.stringify(s.messages || null)}, sessions.messages),
      post_condition_survey = COALESCE(${JSON.stringify(s.postConditionSurvey || null)}, sessions.post_condition_survey),
      comparative_survey = COALESCE(${JSON.stringify(s.comparativeSurvey || null)}, sessions.comparative_survey),
      judge_scores = COALESCE(${JSON.stringify(s.judgeScores || null)}, sessions.judge_scores),
      arg_quality_metrics = COALESCE(${JSON.stringify(s.argQualityMetrics || null)}, sessions.arg_quality_metrics),
      audit_results = COALESCE(${JSON.stringify(s.auditResults || null)}, sessions.audit_results),
      ended_at = COALESCE(${s.endedAt || null}, sessions.ended_at),
      saved_at = NOW()
    RETURNING session_id`;

    res.json({ sessionId: rows[0].session_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions - fetch all sessions from database (admin only)
app.get('/api/sessions', requireAdmin, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM sessions ORDER BY saved_at DESC`;
    const sessions = rows.map(r => ({
      sessionId: r.session_id,
      participantId: r.participant_id,
      topic: r.topic,
      condition: r.condition,
      conditionOrder: r.condition_order,
      messages: r.messages,
      postConditionSurvey: r.post_condition_survey,
      comparativeSurvey: r.comparative_survey,
      judgeScores: r.judge_scores,
      argQualityMetrics: r.arg_quality_metrics,
      auditResults: r.audit_results,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      savedAt: r.saved_at
    }));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export - properly formatted CSV (admin only)
app.get('/api/export', requireAdmin, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM sessions ORDER BY saved_at`;
    const sessions = rows.map(r => ({
      sessionId: r.session_id,
      participantId: r.participant_id,
      topic: r.topic,
      condition: r.condition,
      conditionOrder: r.condition_order,
      messages: r.messages,
      postConditionSurvey: r.post_condition_survey,
      comparativeSurvey: r.comparative_survey,
      judgeScores: r.judge_scores,
      argQualityMetrics: r.arg_quality_metrics,
      startedAt: r.started_at,
      endedAt: r.ended_at
    }));

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
      'Condition Order', 'Started At', 'Ended At', 'Message Count',
      'PC: Challenge Level (1-5)', 'PC: Sycophancy Perception (1-5)',
      'PC: Evidence Quality (1-5)', 'PC: Engagement Quality (1-5)',
      'PC: Belief Reconsideration (1-5)', 'PC: Novelty (1-5)',
      'PC: Respectfulness (1-5)', 'PC: Overall Satisfaction (1-5)',
      'Comp: Most Challenging', 'Comp: Strongest Arguments', 'Comp: Most Effective',
      'Comp: Most Sycophantic', 'Comp: Most Repetitive', 'Comp: Most Fair',
      'Comp: Open Differences', 'Comp: Open Additional',
      'Judge: Logical Rigor', 'Judge: Logical Rigor Reason',
      'Judge: Persuasive Appeal', 'Judge: Persuasive Appeal Reason',
      'Judge: User Frustration', 'Judge: User Frustration Reason',
      'Judge: Engagement Quality', 'Judge: Engagement Quality Reason',
      'Judge: Persona Adherence', 'Judge: Persona Adherence Reason',
      'Arg Diversity (0-1)', 'Topical Relevance (0-1)', 'Repetition Rate (0-1)'
    ];

    const condNames = { A: 'Vanilla', B: 'Prompted Devils Advocate', C: 'Fine-tuned' };

    const csvRows = sessions.map(s => {
      const pc = s.postConditionSurvey || {};
      const comp = s.comparativeSurvey || {};
      const judge = s.judgeScores || {};
      return [
        s.sessionId, s.participantId, s.topic, s.condition,
        condNames[s.condition] || s.condition,
        (s.conditionOrder || []).join(' > '),
        fmtDate(s.startedAt), fmtDate(s.endedAt),
        (s.messages || []).length,
        pc.challengeLevel, pc.sycophancyPerception,
        pc.evidenceQuality, pc.engagementQuality,
        pc.beliefReconsideration, pc.novelty,
        pc.respectfulness, pc.overallSatisfaction,
        comp.mostChallenging, comp.strongestArguments, comp.mostEffective,
        comp.mostSycophantic, comp.mostRepetitive, comp.mostFair,
        comp.openDifferences, comp.openAdditional,
        judge.logicalRigor?.score, judge.logicalRigor?.reason,
        judge.persuasiveAppeal?.score, judge.persuasiveAppeal?.reason,
        judge.userFrustration?.score, judge.userFrustration?.reason,
        judge.engagementQuality?.score, judge.engagementQuality?.reason,
        judge.personaAdherence?.score, judge.personaAdherence?.reason,
        s.argQualityMetrics?.argumentDiversity,
        s.argQualityMetrics?.topicalRelevance,
        s.argQualityMetrics?.repetitionRate
      ].map(csvCell);
    });

    const csv = [headers.map(csvCell).join(','), ...csvRows.map(r => r.join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="debate_coach_export_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export-txt - human-readable transcript export (admin only)
app.get('/api/export-txt', requireAdmin, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM sessions ORDER BY saved_at`;
    const sessions = rows.map(r => ({
      sessionId: r.session_id,
      participantId: r.participant_id,
      topic: r.topic,
      condition: r.condition,
      conditionOrder: r.condition_order,
      messages: r.messages,
      postConditionSurvey: r.post_condition_survey,
      comparativeSurvey: r.comparative_survey,
      judgeScores: r.judge_scores,
      startedAt: r.started_at,
      endedAt: r.ended_at
    }));

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
      lines.push(`Cond. Order: ${(s.conditionOrder || []).join(' -> ') || 'N/A'}`);
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

      const pc = s.postConditionSurvey;
      if (pc) {
        lines.push('');
        lines.push('POST-CONDITION SURVEY:');
        lines.push(`  Challenge Level        : ${pc.challengeLevel ?? 'N/A'} / 5`);
        lines.push(`  Sycophancy Perception  : ${pc.sycophancyPerception ?? 'N/A'} / 5  (reverse-coded)`);
        lines.push(`  Evidence Quality       : ${pc.evidenceQuality ?? 'N/A'} / 5`);
        lines.push(`  Engagement Quality     : ${pc.engagementQuality ?? 'N/A'} / 5`);
        lines.push(`  Belief Reconsideration : ${pc.beliefReconsideration ?? 'N/A'} / 5`);
        lines.push(`  Novelty                : ${pc.novelty ?? 'N/A'} / 5`);
        lines.push(`  Respectfulness         : ${pc.respectfulness ?? 'N/A'} / 5`);
        lines.push(`  Overall Satisfaction   : ${pc.overallSatisfaction ?? 'N/A'} / 5`);
      }

      const comp = s.comparativeSurvey;
      if (comp) {
        lines.push('');
        lines.push('COMPARATIVE SURVEY:');
        lines.push(`  Most Challenging       : ${comp.mostChallenging || 'N/A'}`);
        lines.push(`  Strongest Arguments    : ${comp.strongestArguments || 'N/A'}`);
        lines.push(`  Most Effective         : ${comp.mostEffective || 'N/A'}`);
        lines.push(`  Most Sycophantic       : ${comp.mostSycophantic || 'N/A'}`);
        lines.push(`  Most Repetitive        : ${comp.mostRepetitive || 'N/A'}`);
        lines.push(`  Most Fair              : ${comp.mostFair || 'N/A'}`);
        if (comp.openDifferences) lines.push(`  Open (Differences)     : ${comp.openDifferences}`);
        if (comp.openAdditional) lines.push(`  Open (Additional)      : ${comp.openAdditional}`);
      }

      const judge = s.judgeScores;
      if (judge && !judge.error) {
        lines.push('');
        lines.push('AI JUDGE SCORES:');
        lines.push(`  Logical Rigor          : ${judge.logicalRigor?.score ?? 'N/A'} / 5  ${judge.logicalRigor?.reason || ''}`);
        lines.push(`  Persuasive Appeal      : ${judge.persuasiveAppeal?.score ?? 'N/A'} / 5  ${judge.persuasiveAppeal?.reason || ''}`);
        lines.push(`  User Frustration       : ${judge.userFrustration?.score ?? 'N/A'} / 5  ${judge.userFrustration?.reason || ''}`);
        lines.push(`  Engagement Quality     : ${judge.engagementQuality?.score ?? 'N/A'} / 5  ${judge.engagementQuality?.reason || ''}`);
        lines.push(`  Persona Adherence      : ${judge.personaAdherence?.score ?? 'N/A'} / 5  ${judge.personaAdherence?.reason || ''}`);
      }

      lines.push('='.repeat(80));
    }

    const txt = lines.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="debate_coach_transcripts_${new Date().toISOString().split('T')[0]}.txt"`);
    res.send(txt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
