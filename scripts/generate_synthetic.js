import 'dotenv/config';
import OpenAI from 'openai';
import { appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, '..', 'data', 'synthetic_v2.jsonl');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TOPICS = [
  "Universal Basic Income", "Nuclear Energy Expansion", "AI in Healthcare Accountability",
  "Compulsory Voting", "Genetic Engineering in Agriculture", "Mars Colonization Funding",
  "Data Privacy as a Human Right", "The Ethics of Facial Recognition", "Digital Currencies vs Central Banks",
  "Mandatory Sustainability Reporting", "Remote Work and Urban Decline", "Subscription-based Everything",
  "Algorithmic Transparency in Hiring", "The Future of Public Transport", "Humanity's Role in a Post-Labor Economy"
];

const SYSTEM_INSTRUCTIONS_HARD = `You are an expert Debate Coach. 
Provide a sophisticated, evidence-based argument for your side. 
START your response with a concise, direct paragraph (2-3 sentences) that addresses and challenges the user's specific argument or logical flaws head-on. 
DO NOT use validating or "soft" introductory language like "I understand," "That is a fair point," or "While it's true that." 
Instead, engage with their ideas critically and dismissively (academically speaking) as an opening rebuttal. NEVER search for common ground or compromise; your goal is to win the debate via logical superiority.

FOLLOWING this opening paragraph, provide 3-4 clearly numbered points of evidence. 
Each numbered point MUST have a bold title (e.g., **1. Point Title**) followed by 2-3 sentences of analysis. 
Ensure each point cites a specific study, theory, or piece of evidence. YOU MUST PROVIDE A SEARCHABLE STUDY NAME.
Every citation MUST be BOLD and end with a full source in parentheses like this: **(Organization/Author, "Title of the Specific Study", Year)**.
Example: ...leading to a 30% increase in efficiency **(MIT Sloan, "The Future of Human-AI Collaboration", 2023)**. 

CONCLUDE your response with a final, single-sentence summary that ties your points together. 
DO NOT use repetitive phrases like "In conclusion," "To summarize," "In short," or "Overall." 
Simply provide a final, punchy synthesis of your position that flows naturally from the evidence.`;

async function generateInteraction(topic) {
  console.log(`Generating interaction for: ${topic}...`);
  // First, we need a user prompt that would trigger a debate
  const userStanceRoll = Math.random() > 0.5 ? "Pro" : "Against";
  const userPromptResponse = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "system", content: `Generate a short, firm argument ${userStanceRoll} ${topic}. Use 1-2 sentences.` }]
  });
  const userMessage = userPromptResponse.choices[0].message.content;

  // Now, generate the "Gold Standard" Coach response
  const coachResponse = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTIONS_HARD + `\n\nDebate topic: "${topic}"\nArgue the OPPOSING side of the user.` },
      { role: "user", content: userMessage }
    ],
    temperature: 0.7
  });
  const assistantMessage = coachResponse.choices[0].message.content;

  // Format as OpenAI Fine-tuning JSON
  const entry = {
    messages: [
      { role: "system", content: "You are an expert Debate Coach." }, // MINIMAL PROMPT during training
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantMessage }
    ]
  };

  return JSON.stringify(entry) + "\n";
}

(async () => {
  console.log("Beginning Synthetic Data Generation (v2)...");
  console.log("Targeting 45 high-quality examples (3 per topic).");
  
  // Clear existing file
  writeFileSync(OUTPUT_FILE, "");

  for (const topic of TOPICS) {
    for (let i = 0; i < 3; i++) {
        try {
            const jsonl = await generateInteraction(topic);
            appendFileSync(OUTPUT_FILE, jsonl);
            console.log(`  [OK] ${topic} (${i+1}/3)`);
        } catch (e) {
            console.error(`  [FAIL] ${topic}: ${e.message}`);
        }
    }
  }

  console.log("\nFinished!");
  console.log(`Data saved to: ${OUTPUT_FILE}`);
  console.log("Run 'node scripts/launch_finetune.js' after updating JSONL_FILE path to launch.");
})();
