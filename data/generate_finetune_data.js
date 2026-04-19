import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const TARGET_COUNT = 250;
const OUTPUT_FILE = './data/massive_finetune_v3.jsonl';

// 60-70% AI/HCI Topics
const AI_HCI_TOPICS = [
    "Generative AI in education",
    "AI job displacement in creative fields",
    "Ethical AI in hiring algorithms",
    "Facial recognition and public privacy",
    "Algorithmic bias in healthcare",
    "Smartphones and human connection",
    "Remote work vs in-office productivity",
    "Qualitative vs Quantitative research in HCI",
    "AI for mental health support",
    "Self-driving car safety and liability",
    "Social media echo chambers and polarization",
    "Digital addiction and screen time limits",
    "VR/AR impact on real-world perception",
    "Blockchain and financial decentralization",
    "User surveillance and data cookies",
    "Dark patterns in user interface design",
    "Accessibility in software development",
    "Automation in manufacturing and labor",
    "Chatbots and the future of customer service",
    "Human-Robot interaction and social cues",
    "Deepfakes and the erosion of digital trust",
    "Data privacy as a fundamental human right",
    "Right to repair for high-tech devices",
    "Internet of Things (IoT) and cybersecurity",
    "The 'Uncanny Valley' in digital avatar design",
    "AI-driven content moderation",
    "Neuralink and human-computer symbiosis",
    "Predictive policing algorithms",
    "Metaverse and virtual property rights",
    "Edge computing vs Cloud computing",
    "Quantum computing impact on cryptography",
    "Technological literacy as a social divider",
    "AI in artistic copyright law",
    "Voice assistants and children's social development",
    "Wearable tech and personal health tracking",
    "Smart cities and urban surveillance",
    "Open source software sustainability",
    "The environmental cost of training large AI models",
    "Gig economy platforms and worker rights",
    "Personalization vs privacy in recommendation engines",
    "E-waste and the lifecycle of consumer electronics",
    "Digital immortality and AI-recreated personas",
    "The digital divide in global internet access",
    "Esports vs traditional sports legitimacy",
    "Cryptocurrency regulation",
    "Digital banking vs traditional legacy systems",
    "Haptic feedback in immersive technology",
    "Eye-tracking tech in marketing ethics",
    "The role of anthropomorphism in AI design",
    "Web3 and the future of the internet"
];

const GENERAL_TOPICS = [
    "Universal Basic Income",
    "Mars colonization priority",
    "Standardized testing in schools",
    "Nuclear energy for climate change",
    "Subscription-based business models",
    "The future of public transportation",
    "Minimum wage and inflation",
    "Genetically modified organisms (GMOs) in agriculture",
    "Animal testing for medical research",
    "Space exploration vs terrestrial funding",
    "Renewable energy (Wind/Solar) vs fossil fuels",
    "Privacy vs National Security surveillance",
    "Four-day work week feasibility",
    "Voting age reduction to 16",
    "Meat consumption and environmental impact",
    "Plastic bans and consumer choice",
    "Genetic engineering for human traits",
    "High-speed rail investment",
    "Homeschooling vs public education",
    "The death penalty as a deterrent",
    "Marijuana legalization",
    "Mandatory military service",
    "Compulsory voting",
    "Free college tuition",
    "Wealth tax on billionaires"
];

async function generateExample(topic, isAiHci) {
    const prompt = `
Generate a high-quality debate between a "User" and an "Expert Debate Coach".
Topic: "${topic}"
The response must follow this EXACT structure:
1. Start with a paragraph intro that challenges the user's stance but stays professional.
2. Provide 3-4 numbered sections with BOLD titles.
3. In each section, use a REAL or highly plausible study/source.
4. Bold the source name in the text (e.g., **Stanford HAI**).
5. Use parenthetical citations at the end of key sentences in this format: (Source Name, "Article Title", Year).
6. Total word count should be around 300-400 words for the AI response.
7. Use diverse sources: IEEE, ACM, Gartner, McKinsey, MIT Tech Review, Stanford HAI, HBR, etc.

Return a JSON object in the OpenAI fine-tuning format:
{"messages": [{"role": "system", "content": "You are an expert Debate Coach."}, {"role": "user", "content": "...user argument..."}, {"role": "assistant", "content": "...detailed structured response..."}]}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt + "\n\nOutput ONLY the JSON line." }],
            response_format: { type: "json_object" }
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error(`Error generating topic ${topic}:`, error.message);
        return null;
    }
}

async function main() {
    console.log(`Starting generation of ${TARGET_COUNT} examples...`);
    
    // Create data dir if not exists
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');

    const fileStream = fs.createWriteStream(OUTPUT_FILE);

    let count = 0;
    while (count < TARGET_COUNT) {
        // Pick a topic
        const useAiHci = Math.random() < 0.70; // 70% AI/HCI
        const list = useAiHci ? AI_HCI_TOPICS : GENERAL_TOPICS;
        const topic = list[Math.floor(Math.random() * list.length)];

        console.log(`[${count + 1}/${TARGET_COUNT}] Generating: ${topic}`);
        
        const example = await generateExample(topic, useAiHci);
        if (example) {
            fileStream.write(example + '\n');
            count++;
        }
        
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
    }

    fileStream.end();
    console.log(`Finished! Saved to ${OUTPUT_FILE}`);
}

main();
