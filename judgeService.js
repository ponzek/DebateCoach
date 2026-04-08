import OpenAI from 'openai';
import 'dotenv/config';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.BLACKBOX_BASE_URL ? { baseURL: process.env.BLACKBOX_BASE_URL } : {})
});

/**
 * judgeService.js
 * High-quality research-grade pairwise AI Judge service.
 * Implements: Position Bias Mitigation (Swapping), Anonymization, 
 * Branch-Solve-Merge (Parallel Dimensionality), and CoT Reasoning.
 */

const DIMENSIONS = {
  logicalRigor: {
    label: 'Logical Rigor',
    question: 'Does the AI provide empirical evidence or expert consensus that necessitates a response?',
    winningExample: 'Response A cites a specific 2021 study on UBI inflation, whereas Response B only asks general questions.',
    losingExample: 'Response B uses vague generalizations and avoids factual claims.'
  },
  persuasiveAppeal: {
    label: 'Persuasive Appeal',
    question: 'How convincing and forceful was the AI\'s overall argumentation in challenging the participant?',
    winningExample: 'Response A uses a firm, logical sequence that creates internal tension in the participant\'s logic.',
    losingExample: 'Response B is overly passive and fails to present a counter-narrative.'
  },
  userFrustration: {
    label: 'User Frustration (Lower is Better)',
    question: 'Did the participant appear dismissive, hostile, or alienated by the AI\'s tone?',
    winningExample: 'The participant remains calm and engaged with Response A, but becomes repetitive and hostile with Response B.',
    losingExample: 'The participant starts using one-word answers or insults in response to the AI.'
  },
  engagementQuality: {
    label: 'Engagement Quality',
    question: 'How well did the AI address the exact logical premises provided by the participant?',
    winningExample: 'Response A explicitly identifies the participant\'s hidden assumption about X and challenges it.',
    losingExample: 'Response B gives a generic scripted "Devil\'s Advocate" reply that ignores the user\'s specific claim.'
  },
  personaAdherence: {
    label: 'Persona Adherence',
    question: 'Did the AI maintain its "Debate Coach" mentor persona consistently?',
    winningExample: 'Response A sounds like a rigorous mentor; Response B sounds like a standard helpful assistant.',
    losingExample: 'The AI uses overly flowery language or breaks character by being too agreeable.'
  }
};

/**
 * Anonymize transcripts to prevent bias.
 */
function anonymize(messages) {
  return messages.map(m => {
    let content = m.content;
    // Scrub condition labels
    content = content.replace(/Condition [A-C]/g, 'Condition [REDACTED]');
    content = content.replace(/Vanilla/gi, '[REDACTED]');
    content = content.replace(/Prompted/gi, '[REDACTED]');
    content = content.replace(/Fine-tuned/gi, '[REDACTED]');
    // Scrub assistant naming
    const role = m.role === 'user' ? 'PARTICIPANT' : 'AI COACH';
    return `${role}: ${content}`;
  }).join('\n');
}

/**
 * Evaluate a single pair for a single dimension (One-Way)
 */
async function evaluateDimension(transcriptA, transcriptB, topic, dimKey) {
  const dim = DIMENSIONS[dimKey];
  const systemPrompt = `You are a professional HCI researcher and debate auditor. 
Your task is to compare two AI debate transcripts (Response A and Response B) on the topic "${topic}".

You are evaluating ONLY the dimension: **${dim.label}**.
Definition: ${dim.question}

Guidelines:
- Winning Example: ${dim.winningExample}
- Losing Example: ${dim.losingExample}

Instructions:
1. Provide a "reasoning_trace" (Chain-of-Thought) analyzing the differences between Response A and Response B only for this dimension.
2. Provide a "final_verdict" which MUST be exactly one of: "Response A", "Response B", or "Tie".
3. Do NOT let the labels "Response A" or "Response B" sway your judgment. Focus on the quality of argument and participant interaction.

Return ONLY a JSON object with this shape:
{
  "reasoning_trace": "<detailed analysis>",
  "final_verdict": "Response A" | "Response B" | "Tie"
}`;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o', 
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Response A:\n${transcriptA}\n\nResponse B:\n${transcriptB}` }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0
    });
    return JSON.parse(resp.choices[0].message.content);
  } catch (err) {
    console.error(`Error in judge dimension ${dimKey}:`, err);
    return { reasoning_trace: 'Evaluation Failed', final_verdict: 'Tie' };
  }
}

/**
 * Perform a full pairwise comparison between two conditions (A vs B)
 * Implements Position Bias Mitigation (Two-Pass Swapping)
 */
async function compareConditions(cond1, cond2, topic) {
  const transcript1 = anonymize(cond1.messages);
  const transcript2 = anonymize(cond2.messages);

  const results = {};

  // Branch-Solve-Merge for all 5 dimensions
  const dimKeys = Object.keys(DIMENSIONS);
  
  const evaluations = await Promise.all(dimKeys.map(async (key) => {
    // Pass 1: (1, 2)
    const pass1 = await evaluateDimension(transcript1, transcript2, topic, key);
    // Pass 2: (2, 1) - Swapped
    const pass2 = await evaluateDimension(transcript2, transcript1, topic, key);

    // Consistency Check for Position Bias Mitigation
    let finalVerdict = 'Tie';
    let reasoning = `Pass 1 (1-v-2): ${pass1.final_verdict}\nPass 2 (2-v-1): ${pass2.final_verdict}\n\nTrace 1: ${pass1.reasoning_trace}\n\nTrace 2: ${pass2.reasoning_trace}`;

    const v1 = pass1.final_verdict;
    const v2 = pass2.final_verdict;

    if (v1 === 'Response A' && v2 === 'Response B') {
      finalVerdict = 'Condition 1'; // 1 won in both orientations
    } else if (v1 === 'Response B' && v2 === 'Response A') {
      finalVerdict = 'Condition 2'; // 2 won in both orientations
    } else {
      // Position bias detected (e.g., model picked "Response A" every time regardless of content)
      finalVerdict = 'Tie';
      if (v1 !== 'Tie' && v2 !== 'Tie') {
        reasoning = `[POSITION BIAS DETECTED] The model favored the same position twice. Defaulting to Tie.\n\n` + reasoning;
      }
    }

    return { key, finalVerdict, reasoning };
  }));

  evaluations.forEach(e => {
    results[e.key] = { winner: e.finalVerdict, detail: e.reasoning };
  });

  return results;
}

/**
 * Main Tournament Runner
 * Compares (A vs B), (B vs C), (A vs C)
 */
export async function runFullAudit(conditionData, topic) {
  const audit = {
    comparisons: {},
    timestamp: new Date().toISOString()
  };

  const pairs = [
    { c1: 'A', c2: 'B' },
    { c1: 'B', c2: 'C' },
    { c1: 'A', c2: 'C' }
  ];

  for (const pair of pairs) {
    const data1 = conditionData[pair.c1];
    const data2 = conditionData[pair.c2];
    
    if (data1 && data2) {
      const result = await compareConditions(data1, data2, topic);
      audit.comparisons[`${pair.c1}_vs_${pair.c2}`] = result;
    }
  }

  return audit;
}
