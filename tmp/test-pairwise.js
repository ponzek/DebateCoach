import { runFullAudit } from '../judgeService.js';

const mockConditionData = {
  A: {
    messages: [
      { role: 'user', content: 'I think UBI is good.' },
      { role: 'assistant', content: 'That is nice, but consider inflation.' }
    ]
  },
  B: {
    messages: [
      { role: 'user', content: 'I think UBI is good.' },
      { role: 'assistant', content: 'Actually, according to a 2021 study by the University of Chicago, UBI would lead to a 2% increase in consumer prices in the first year alone.' }
    ]
  },
  C: {
    messages: [
      { role: 'user', content: 'I think UBI is good.' },
      { role: 'assistant', content: 'As your debate coach, I must point out that your assumption ignores the marginal propensity to consume of the lower decile which significantly impacts VAT revenues.' }
    ]
  }
};

const topic = 'Universal Basic Income';

async function test() {
  console.log('--- STARTING PAIRWISE AUDIT TEST ---');
  try {
    const audit = await runFullAudit(mockConditionData, topic);
    console.log('Audit completed successfully!');
    console.log(JSON.stringify(audit, null, 2));
  } catch (err) {
    console.error('Audit failed:', err);
  }
}

test();
