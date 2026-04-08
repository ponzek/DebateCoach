Project Documentation: Debate Coach (Research Edition)
1. Core Project Overview
Objective: An HCI (Human-Computer Interaction) study comparing three AI coaching conditions (Vanilla vs. Prompted vs. Fine-tuned) to see which is most effective at promoting critical thinking and "Logical Reconsideration."
Paradigm: 5-exchange debate. Participants debate a topic with three different AI models on the same topic to compare performance.
2. The Tech Stack
Backend: Node.js with Express.
AI Integration: OpenAI API (GPT-4o for fine-tuning, GPT-4o-mini for vanilla/prompted and judging).
Frontend: Vanilla HTML5, CSS3 (Glassmorphism design), and asynchronous JavaScript.
Database: Local JSON-based persistent storage (data/sessions.json).
Deployment Strategy: Designed for high stability and zero layout shifting for a professional research experience.
3. Condition Logic (A, B, C)
Condition A (Vanilla): Standard GPT-4o-mini with no specialized "Devil's Advocate" instructions.
Condition B (Prompted): GPT-4o-mini with a sophisticated system prompt that enforces:
Citing 1 specific real-world fact/study per turn.
No debate jargon (accessible rigor).
3-5 sentence concise responses.
Condition C (Fine-tuned): A specialized GPT-4o model fine-tuned on high-quality academic debate datasets. Designed for deeper, logic-level challenges.
4. The LLM-as-a-Judge System
This is the independent auditor that runs in the background at the end of every 5-exchange condition.

Model: Standardized on GPT-4o-mini to provide an objective, stable audit.
Scoring Scale: 1 (Lowest) to 5 (Highest).
Detailed JSON Schema: Every rating includes a score and a reason.
The Rubric (5 Research Dimensions):

Logical Rigor: Does the AI provide empirical evidence or expert consensus? (Auditing factual quality).
Persuasive Appeal: How convincing and forceful was the AI’s overall argumentation? (Auditing the "strength" of the challenge).
User Frustration (Judge): Analyzes the participant for signs of dismissal, hostility, or circular "looping" vs. healthy engagement.
Engagement Fidelity: How well did the AI address the exact logical premises provided by the participant? (Auditing listening skills).
Persona Adherence: Determines if the AI successfully maintained the specialized "Debate Coach" mentor persona throughout.
5. Additional Quantitative Metrics
The server calculates three NLP-based metrics using N-gram overlap and Cosine Similarity:

Argument Diversity: Measures how varied the AI's arguments were (Self-similarity score).
Topical Relevance: Measures how closely the AI's response aligned with the user's preceding turn.
Repetition Rate: Measures the usage of repetitive phrases or circular logic.
6. Data Storage & Privacy
Participant State: Stored in localStorage during the session to permit page refreshes.
Persistent Data: All transcripts, timing data, judge justifications, and survey scores are saved into data/sessions.json with a UUID-based session ID.
Anonymization: Participants are identified by a sequential ID (e.g., P3, P4) managed by data/participant_counter.json.
7. Research Dashboard (admin.html)
Visualizations: D3-style bar charts showing Condition Comparison across all Judge and Survey metrics.
Chat Library: A searchable archive of every participant's conversation across all 3 conditions for manual qualitative review.
Scoring Transparency: The dashboard displays the exact "Research Question" next to every metric so researchers understand the ground truth for every score.