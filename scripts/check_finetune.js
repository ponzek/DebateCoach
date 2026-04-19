// check_finetune.js
// Checks the status of your most recent fine-tuning job
// and prints the model ID when complete.
//
// Usage: node scripts/check_finetune.js

import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  try {
    const jobs = await openai.fineTuning.jobs.list({ limit: 5 });

    if (!jobs.data || jobs.data.length === 0) {
      console.log('No fine-tuning jobs found.');
      return;
    }

    console.log('Recent fine-tuning jobs:\n');

    for (const job of jobs.data) {
      const status = job.status.toUpperCase();
      console.log(`  Job: ${job.id}`);
      console.log(`  Status: ${status}`);
      console.log(`  Model: ${job.model}`);
      console.log(`  Created: ${new Date(job.created_at * 1000).toLocaleString()}`);

      if (job.fine_tuned_model) {
        console.log(`  Fine-tuned model ID: ${job.fine_tuned_model}`);
        console.log('');
        console.log('  Add this to your .env file:');
        console.log(`  FINE_TUNED_MODEL_ID=${job.fine_tuned_model}`);
      }

      if (job.error && job.error.message) {
        console.log(`  Error: ${job.error.message}`);
      }

      console.log('  ---');
    }

  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
