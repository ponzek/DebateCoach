import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OLD_FILE = join(__dirname, '..', 'data', 'finetune_data.jsonl');
const NEW_FILE = join(__dirname, '..', 'data', 'synthetic_v2.jsonl');
const FINAL_FILE = join(__dirname, '..', 'data', 'final_finetune.jsonl');

let allLines = [];

const MINIMAL_PROMPT = "You are an expert Debate Coach.";

function normalizePrompt(line) {
    try {
        const entry = JSON.parse(line);
        if (entry.messages && entry.messages[0].role === 'system') {
            entry.messages[0].content = MINIMAL_PROMPT;
        }
        return JSON.stringify(entry);
    } catch (e) {
        return line;
    }
}

if (existsSync(OLD_FILE)) {
    const oldLines = readFileSync(OLD_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const normalized = oldLines.map(normalizePrompt);
    allLines = allLines.concat(normalized);
    console.log(`Loaded and normalized ${oldLines.length} old examples.`);
}

if (existsSync(NEW_FILE)) {
    const newLines = readFileSync(NEW_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const normalized = newLines.map(normalizePrompt);
    allLines = allLines.concat(normalized);
    console.log(`Loaded and normalized ${newLines.length} new synthetic examples.`);
}

// Shuffle to mix them well
allLines.sort(() => Math.random() - 0.5);

writeFileSync(FINAL_FILE, allLines.join('\n') + '\n');
console.log(`Successfully merged ${allLines.length} examples into ${FINAL_FILE}`);
