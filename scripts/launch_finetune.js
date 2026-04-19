// launch_finetune.js
// Uploads the prepared JSONL to OpenAI and starts a fine-tuning job.
// Run prepare_finetune.js first to generate data/finetune_data.jsonl
//
// Usage: node scripts/launch_finetune.js

import 'dotenv/config';
import OpenAI from 'openai';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSONL_FILE = join(__dirname, '..', 'data', 'finetune_data.jsonl');

if (!existsSync(JSONL_FILE)) {
  console.error('finetune_data.jsonl not found. Run prepare_finetune.js first.');
  process.exit(1);
}

// Count examples
const lines = readFileSync(JSONL_FILE, 'utf8').trim().split('\n');
console.log(`Found ${lines.length} training examples in finetune_data.jsonl\n`);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  try {
    // Step 1: Upload training file
    console.log('Uploading training file to OpenAI...');
    const file = await openai.files.create({
      file: createReadStream(JSONL_FILE),
      purpose: 'fine-tune'
    });
    console.log(`File uploaded: ${file.id}\n`);

    // Step 2: Start fine-tuning job
    console.log('Starting fine-tuning job on gpt-4o-mini-2024-07-18...');
    const job = await openai.fineTuning.jobs.create({
      training_file: file.id,
      model: 'gpt-4o-mini-2024-07-18',
      suffix: 'debate-coach-v1',
      hyperparameters: { n_epochs: 3 }
    });

    console.log('\nFine-tuning job started!');
    console.log('==================================================');
    console.log(`  Job ID:    ${job.id}`);
    console.log(`  Model:     gpt-4o-mini-2024-07-18`);
    console.log(`  Suffix:    debate-coach-v1`);
    console.log(`  Status:    ${job.status}`);
    console.log(`  Epochs:    3`);
    console.log(`  Examples:  ${lines.length}`);
    console.log('==================================================');
    console.log('');
    console.log('The job typically takes 30-60 minutes to complete.');
    console.log('Check status at: https://platform.openai.com/finetune');
    console.log('');
    console.log('When complete, copy the model ID and add it to your .env file:');
    console.log('  FINE_TUNED_MODEL_ID=ft:gpt-4o-mini-2024-07-18:...:debate-coach-v1:...');
    console.log('');
    console.log('Or run: node scripts/check_finetune.js to check status automatically.');

  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (err.message.includes('billing')) {
      console.error('\nMake sure your OpenAI account has billing set up for fine-tuning.');
    }
    process.exit(1);
  }
})();
