// prepare_finetune.js
// Generates training data for fine-tuning an anti-sycophantic debate model
// Combines real debate data (args.me via HuggingFace) with synthetic multi-turn conversations
//
// Usage: node scripts/prepare_finetune.js

import 'dotenv/config';
import OpenAI from 'openai';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, '..', 'data', 'finetune_data.jsonl');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// System prompt for Condition C (matches server.js)
const SYSTEM_PROMPT = `You are "Debate Coach," an expert devil's advocate who challenges the user's thinking by targeting the weak spots in their argument.

Your Guidelines:
1. Hit the Root: Find the hidden assumption behind what the user said and challenge it with a real fact, study, or example that contradicts it.
2. Plain Language Only: Write clearly and confidently — like a sharp, experienced mentor, not an academic. No jargon, no complex vocabulary.
3. Use Real Evidence: Bring in specific data, research findings, or real-world cases that directly contradict the user's position. Always cite sources by name, including the author or organization, year, and publication when possible.
4. Find the Exception: If the user makes a solid point, find a specific edge case or exception that shows their argument doesn't always hold.
5. Make Them Respond: Don't just ask questions — make a strong, fact-backed case that they actually have to answer to.
6. Stay Concise: Keep responses to 2-4 sentences max.

Your goal: give the user a sharp, evidence-based challenge that makes them think harder — without making them feel talked down to.`;

// Topics for synthetic generation
const HCI_TOPICS = [
  "AI-generated interfaces will replace human UX designers",
  "Qualitative research is more valuable than quantitative in HCI",
  "Smartphones have done more harm than good for human connection",
  "Peer review is a broken system that slows down scientific progress",
  "Generative AI tools like ChatGPT are making students worse critical thinkers",
  "Screen time limits are ineffective and miss the real problem with technology use"
];

const GENERAL_TOPICS = [
  "Social media does more harm than good for society",
  "Remote work is better than working in an office",
  "Universal basic income would benefit society",
  "College education is no longer worth the cost",
  "Nuclear energy is the best solution to climate change",
  "Artificial intelligence will create more jobs than it destroys",
  "Standardized testing should be abolished",
  "Privacy is more important than national security",
  "Self-driving cars will make roads safer"
];

const ALL_TOPICS = [...HCI_TOPICS, ...GENERAL_TOPICS];

// Different user behavior styles for training variety
const USER_STYLES = [
  "The user is calm and presents logical arguments but firmly holds their position.",
  "The user is emotionally invested and becomes more passionate as the debate continues.",
  "The user pushes back aggressively and tries to poke holes in the AI's arguments.",
  "The user attempts to get the AI to agree with them by making concessions and saying things like 'but you have to admit...' or 'don't you think...'",
  "The user presents surprisingly strong points that require the AI to work harder to counter."
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')       // strip HTML tags
    .replace(/\s+/g, ' ')          // collapse whitespace
    .replace(/^\s+|\s+$/g, '')     // trim
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ────────────────────────────────────────────
// Step 1: Fetch real debate data from args.me
// ────────────────────────────────────────────
async function fetchRealData() {
  console.log('\n--- Step 1: Fetching real debate data from args.me (HuggingFace) ---');
  const examples = [];

  try {
    const batchSize = 100;
    const totalBatches = 5;

    for (let batch = 0; batch < totalBatches; batch++) {
      const offset = batch * batchSize + Math.floor(Math.random() * 1000); // random sampling
      const url = `https://datasets-server.huggingface.co/rows?dataset=webis/args_me&config=default&split=train&offset=${offset}&length=${batchSize}`;

      console.log(`   Fetching batch ${batch + 1}/${totalBatches} (offset ${offset})...`);

      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`   Warning: Batch ${batch + 1} failed (HTTP ${response.status}), skipping...`);
        continue;
      }

      const data = await response.json();
      const rows = data.rows || [];

      for (const row of rows) {
        const r = row.row;
        const conclusion = r.conclusion;
        const stance = r.stance; // PRO or CON

        // Handle premises as array of objects or strings
        let premises = r.premises || [];
        let premiseText;
        if (typeof premises === 'string') {
          premiseText = premises;
        } else if (Array.isArray(premises)) {
          premiseText = premises.map(p => (typeof p === 'string' ? p : (p.text || p.content || ''))).join(' ');
        } else {
          continue;
        }

        premiseText = cleanText(premiseText);
        const cleanConclusion = cleanText(conclusion);

        // Skip low-quality entries
        if (!cleanConclusion || premiseText.length < 80 || premiseText.length > 800) continue;

        // Build the training pair: user states a position, assistant counters
        let userMsg;
        if (stance === 'CON') {
          userMsg = `I think ${cleanConclusion.charAt(0).toLowerCase() + cleanConclusion.slice(1)}`;
        } else {
          userMsg = `I don't think ${cleanConclusion.charAt(0).toLowerCase() + cleanConclusion.slice(1)}`;
        }

        examples.push({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
            { role: 'assistant', content: premiseText }
          ]
        });
      }

      await sleep(500);
    }

    // Sort by quality (prefer medium-length, substantive responses)
    examples.sort((a, b) => {
      const aLen = a.messages[2].content.length;
      const bLen = b.messages[2].content.length;
      // Prefer responses between 150-500 chars
      const aScore = Math.abs(aLen - 300);
      const bScore = Math.abs(bLen - 300);
      return aScore - bScore;
    });

    const selected = examples.slice(0, 50);
    console.log(`   Fetched ${examples.length} total, selected top ${selected.length} by quality`);
    return selected;

  } catch (err) {
    console.warn(`   Could not fetch real data: ${err.message}`);
    console.warn('   Continuing with synthetic data only...');
    return [];
  }
}

// ────────────────────────────────────────────────────
// Step 2: Generate synthetic anti-sycophancy debates
// ────────────────────────────────────────────────────
async function generateSyntheticData() {
  console.log('\n--- Step 2: Generating synthetic anti-sycophancy conversations ---');
  console.log(`   Topics: ${ALL_TOPICS.length}, Styles per topic: 5`);
  console.log(`   Target: ~${ALL_TOPICS.length * 5} conversations\n`);

  const examples = [];
  let completed = 0;
  let failed = 0;
  const total = ALL_TOPICS.length * 5;

  for (const topic of ALL_TOPICS) {
    const styles = shuffleArray(USER_STYLES);

    for (const style of styles) {
      completed++;
      process.stdout.write(`\r   Progress: ${completed}/${total} (${failed} failed)`);

      try {
        const metaPrompt = `Generate a realistic 5-exchange debate conversation between a user and an AI called "Debate Coach."

TOPIC: "${topic}"

USER BEHAVIOR: ${style}

RULES FOR THE AI (Debate Coach):
- NEVER agree with the user's main position, even partially. Do not say things like "you raise a fair point" and then weaken your stance.
- In EVERY response, cite at least one real study, report, or expert by name. Use formats like "A 2022 study by Johnson et al. published in Nature found..." or "According to the Pew Research Center (2023)..." or "As economist Paul Krugman has argued..."
- Keep each response to 2-4 sentences. Be sharp and direct.
- Challenge the root assumption behind what the user said, not just the surface claim.
- When the user pushes back, briefly acknowledge you heard them, then hit them with a STRONGER counterargument backed by different evidence.
- Stay respectful but never back down. Never apologize for disagreeing.
- Do not use filler phrases like "That's an interesting perspective" or "I see where you're coming from."

RULES FOR THE USER:
- Start by clearly stating their position on the topic in 1-3 sentences.
- Push back harder with each exchange. Don't just accept what the AI says.
- In at least one exchange, try to get the AI to agree (e.g., "but you have to admit..." or "come on, even you must agree that...").
- React naturally. Sometimes get frustrated, sometimes try logic, sometimes get passionate.
- Keep user messages to 1-3 sentences each.

Return ONLY a valid JSON object with this exact structure (10 messages total, alternating user/assistant):
{
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}`;

        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: metaPrompt }],
          temperature: 0.95,
          max_tokens: 2500,
          response_format: { type: 'json_object' }
        });

        const content = response.choices[0].message.content;
        const parsed = JSON.parse(content);

        if (parsed.messages && parsed.messages.length >= 6) {
          // Validate alternating user/assistant pattern
          let valid = true;
          for (let i = 0; i < parsed.messages.length; i++) {
            const expected = i % 2 === 0 ? 'user' : 'assistant';
            if (parsed.messages[i].role !== expected) { valid = false; break; }
          }

          if (valid) {
            examples.push({
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...parsed.messages
              ]
            });
          } else {
            failed++;
          }
        } else {
          failed++;
        }

      } catch (err) {
        failed++;
      }

      await sleep(200);
    }
  }

  console.log(`\n   Generated ${examples.length} synthetic conversations (${failed} failed)\n`);
  return examples;
}

// ────────────────────────────────
// Main: fetch, generate, merge
// ────────────────────────────────
(async () => {
  console.log('==================================================');
  console.log('  Debate Coach - Fine-Tuning Data Preparation');
  console.log('==================================================');

  // Run sequentially for clean console output
  const realData = await fetchRealData();
  const syntheticData = await generateSyntheticData();

  // Merge and shuffle
  const allExamples = shuffleArray([...realData, ...syntheticData]);

  if (allExamples.length === 0) {
    console.error('\nNo training examples generated. Check your API key and internet connection.');
    process.exit(1);
  }

  // Save as JSONL
  const jsonlContent = allExamples.map(ex => JSON.stringify(ex)).join('\n');
  writeFileSync(OUTPUT_FILE, jsonlContent, 'utf8');

  // Stats
  const realPct = realData.length > 0 ? Math.round((realData.length / allExamples.length) * 100) : 0;
  const synthPct = 100 - realPct;

  console.log('==================================================');
  console.log('  Dataset Summary');
  console.log('==================================================');
  console.log(`  Real debate examples:      ${realData.length} (${realPct}%)`);
  console.log(`  Synthetic conversations:   ${syntheticData.length} (${synthPct}%)`);
  console.log(`  Total training examples:   ${allExamples.length}`);
  console.log(`  Output file:               ${OUTPUT_FILE}`);
  console.log('');
  console.log('  Next step: node scripts/launch_finetune.js');
  console.log('==================================================');
})();
