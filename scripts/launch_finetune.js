// launch_finetune.js
// Usage: node scripts/launch_finetune.js
// Uploads the prepared JSONL to OpenAI and starts a fine-tuning job.
// Run prepare_finetune.js first to generate data/finetune_data.jsonl

import 'dotenv/config';
import OpenAI from 'openai';
import { createReadStream, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSONL_FILE = join(__dirname, '..', 'data', 'finetune_data.jsonl');

if (!existsSync(JSONL_FILE)) {
  console.error('❌ finetune_data.jsonl not found. Run prepare_finetune.js first.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  console.log('📤 Uploading training file…');
  const file = await openai.files.create({
    file: createReadStream(JSONL_FILE),
    purpose: 'fine-tune'
  });
  console.log('✅ File uploaded:', file.id);

  console.log('🚀 Starting fine-tuning job…');
  const job = await openai.fineTuning.jobs.create({
    training_file: file.id,
    model: 'gpt-4o-mini-2024-07-18',  // Most cost-effective fine-tuning base
    hyperparameters: { n_epochs: 3 }
  });

  console.log('\n✅ Fine-tuning job started!');
  console.log('   Job ID   :', job.id);
  console.log('   Status   :', job.status);
  console.log('\nAdd the resulting model ID to your .env file as:');
  console.log('   FINE_TUNED_MODEL_ID=<model-id-from-openai-dashboard>');
  console.log('\nCheck job status at: https://platform.openai.com/finetune');
})();
