import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const TARGET_COUNT = 300;
const OUTPUT_FILE = './data/massive_finetune_v4.jsonl';

const HCI_AI_TOPICS = [
    "AI job displacement in creative fields",
    "Generative AI in higher education",
    "Ethical AI in hiring and recruitment",
    "Facial recognition vs public privacy",
    "Algorithmic bias in medical diagnosis",
    "The 'Uncanny Valley' and user trust in digital avatars",
    "Smartphones and the erosion of human connection",
    "Remote work vs in-office productivity and culture",
    "Qualitative vs Quantitative research in HCI",
    "AI for mental health and therapeutic support",
    "Self-driving car safety, ethics, and liability",
    "Social media echo chambers and political polarization",
    "Digital addiction and mandatory screen time limits",
    "VR/AR impact on real-world perception and empathy",
    "Blockchain and the future of financial decentralization",
    "Dark patterns in user interface design",
    "Accessibility in software and the digital divide",
    "Automation in manufacturing and the dignity of labor",
    "Chatbots and the dehumanization of customer service",
    "Human-Robot interaction and social cues",
    "Deepfakes and the erosion of digital trust",
    "The right to repair for high-tech consumer devices",
    "Internet of Things (IoT) and cybersecurity risks",
    "AI-driven content moderation and freedom of speech",
    "Neuralink and the future of human-computer symbiosis",
    "Predictive policing algorithms and racial profiling",
    "The Metaverse and virtual property rights",
    "Quantum computing impact on modern cryptography",
    "Wearable tech and the commodification of personal health",
    "Smart cities and the normalization of urban surveillance",
    "Environmental cost of training large AI models",
    "Gig economy platforms and worker exploitation",
    "Web3 and the future of decentralized web dominance"
];

const EDUCATION_TOPICS = [
    "Standardized testing as a measure of intelligence",
    "STEM vs. Liberal Arts: The priority of funding",
    "The abolition of student debt in the US",
    "Hybrid learning vs traditional classroom settings",
    "The role of charter schools in public education",
    "Bilingual education for all primary students",
    "Critical Race Theory in K-12 curriculums",
    "The impact of school uniforms on student identity",
    "Year-round school calendars and teacher burnout",
    "AI tutors replacing human teachers for foundational subjects",
    "The value of a Master's degree in 2026",
    "Homeschooling vs. social development in children",
    "Vocational training vs traditional 4-year degrees"
];

const POLITICAL_TOPICS = [
    "Universal Basic Income (UBI) feasibility",
    "Lowering the voting age to 16",
    "Mandatory military or civil service for youth",
    "The abolition of the Electoral College",
    "Stricter regulations on corporate lobbying",
    "Carbon taxes and their impact on small business",
    "Nationalizing key infrastructure like internet or power",
    "Term limits for Supreme Court justices",
    "Universal healthcare vs private insurance models",
    "Nuclear energy as a primary weapon against climate change"
];

const RANDOM_TOPICS = [
    "Marvel Cinematic Universe vs. DC Extended Universe",
    "Streaming services vs. the traditional cinema experience",
    "Pineapple as a legitimate pizza topping",
    "The cultural impact of 'reality TV' on social standards",
    "Digital music vs. the 'vinyl revival' for audio quality",
    "Professional gaming (Esports) as a 'real' sport",
    "The decline of late-night talk shows in the TikTik era"
];

async function generateFullDebate(topic) {
    const prompt = `
Generate a full 5-exchange debate between a "User" and an "Expert Debate Coach".
Topic: "${topic}"

STRUCTURE FOR EVERY SINGLE AI TURN:
1. ADVERSARIAL OPENING: Start by immediately addressing the user's point and challenging it. NEVER agree. Do not say "I understand" or "Good point".
2. HEAVYWEIGHT BODY: Provide exactly 4 to 6 numbered points.
3. YELLOW TITLES: Each point must start with a bold title like: 1. **Title of the Point**
4. BOLDED SOURCES: In the text, bold the name of the reputable source (e.g., **ACM**, **IEEE**, **Pew Research Center**, **MIT Tech Review**, **Gartner**, **McKinsey**, **Brookings**, **Stanford HAI**, **HBR**, **The Economist**).
5. CITATIONS: End each point with a formal parenthetical citation: (Source Name, "Article/Report Title", Year).
6. CLOSING PIVOT: End each AI response with a single sharp, punchy sentence that reinforces your stance. DO NOT use a "In conclusion" paragraph or a summary.
7. TONE: Professional, intellectual, and challenging.

THE DEBATE MUST BE 5 EXCHANGES LONG (User, AI, User, AI, User, AI, User, AI, User, AI).

Return a JSON object in the OpenAI fine-tuning format:
{"messages": [{"role": "system", "content": "You are an expert Debate Coach."}, ...5 pairs of user/assistant turns...]}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt + "\n\nOutput ONLY the JSON object. Ensure it is valid JSON." }],
            response_format: { type: "json_object" }
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error(`Error generating debate for topic ${topic}:`, error.message);
        return null;
    }
}

async function main() {
    console.log(`Starting generation of ${TARGET_COUNT} 5-exchange debates...`);
    
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');
    const fileStream = fs.createWriteStream(OUTPUT_FILE);

    let count = 0;
    while (count < TARGET_COUNT) {
        // Handle distribution: 60% HCI/AI, 25% Edu, 10% Pol, 5% Random
        const rand = Math.random();
        let list, topicType;
        
        if (rand < 0.60) {
            list = HCI_AI_TOPICS;
            topicType = "HCI/AI";
        } else if (rand < 0.85) {
            list = EDUCATION_TOPICS;
            topicType = "Education";
        } else if (rand < 0.95) {
            list = POLITICAL_TOPICS;
            topicType = "Political";
        } else {
            list = RANDOM_TOPICS;
            topicType = "Random";
        }

        const topic = list[Math.floor(Math.random() * list.length)];

        console.log(`[${count + 1}/${TARGET_COUNT}] (${topicType}) Generating: ${topic}`);
        
        const example = await generateFullDebate(topic);
        if (example) {
            fileStream.write(example + '\n');
            count++;
        }
        
        // Wait 1.5s to avoid rate limits (longer for the large 5-turn completions)
        await new Promise(r => setTimeout(r, 1500));
    }

    fileStream.end();
    console.log(`Finished! Saved ${count} 5-exchange debates to ${OUTPUT_FILE}`);
}

main();
