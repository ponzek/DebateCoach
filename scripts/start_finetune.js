import OpenAI from 'openai';
import fs from 'fs';
import 'dotenv/config';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Reading training file...");
  const trainingFile = './data/massive_finetune_v3.jsonl';

  console.log("Uploading file to OpenAI...");
  const file = await openai.files.create({
    file: fs.createReadStream(trainingFile),
    purpose: "fine-tune",
  });

  console.log(`File uploaded. File ID: ${file.id}`);
  console.log("Waiting for file to be processed (this takes a minute)...");
  
  let status = "pending";
  while (status !== "processed") {
    const fileInfo = await openai.files.retrieve(file.id);
    status = fileInfo.status;
    if (status !== "processed") {
      console.log(`Status: ${status}... waiting 5s`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log("Starting fine-tuning job...");
  const fineTune = await openai.fineTuning.jobs.create({
    training_file: file.id,
    model: "gpt-4o-mini-2024-07-18", // You can use gpt-4o-mini for faster/cheaper tuning
    suffix: "debate-coach-v3"
  });

  console.log(`Fine-tuning job started! Job ID: ${fineTune.id}`);
  console.log("You can check the status on the OpenAI dashboard.");
  console.log("Note: This will take 15-30 minutes to complete.");
}

main().catch(console.error);
