# Debate Coach

Debate Coach is a research platform designed to study human-AI interaction in controversial debates. The tool allows researchers to test how different AI configurations (Baseline, Prompted, and Fine-tuned) affect user beliefs, the quality of arguments, and the presence of AI sycophancy.

This project is part of a Group 44 HCI Research Study for Spring 2026.

## Interaction Flow
Every participant session follows a structured research path to ensure consistent data collection:
1. **Topic Selection**: The user chooses a topic and states their initial stance.
2. **Phase 1 to 3**: The user engages in three debate rounds, each with a different AI model (the order is randomized).
3. **Turn Limit**: Every round consists of 1 opener from the AI followed by exactly 5 back-and-forth exchanges.
4. **Surveys**: After each round, users fill out a quick survey. A final comparison survey is completed at the end.
5. **AI Audit**: Our "LLM Judge" automatically analyzes every transcript to check for logical rigor and bias.

## Setup Instructions

### Prerequisites
You must have Node.js installed on your computer.
*   **Windows / Mac**: Download and install the latest "LTS" version from [nodejs.org](https://nodejs.org/).

### 1. Download the Project
Download the repository as a ZIP file and extract it to a folder on your computer.

### 2. Configure Environment Variables
You need to create a file named `.env` in the root folder of the project. You will need to obtain keys from the following services:

*   **OPENAI_API_KEY**: Create an account at [platform.openai.com](https://platform.openai.com/) and generate an API key. This powers the AI debate partners and the AI Judge.
*   **DATABASE_URL**: Sign up for a free Postgres database at [neon.tech](https://neon.tech/). Copy the "Connection String" and paste it here.
*   **FINE_TUNED_MODEL_ID**: If you have trained a specific model for Condition C, enter its ID here. If not, the system will default to a standard model.
*   **ADMIN_USER and ADMIN_PASS**: Create your own username and password for the research dashboard.

### 3. Installation

#### **On Windows**
1.  Open the project folder.
2.  Press `Shift + Right Click` in the folder and select "Open PowerShell window here."
3.  Type `npm install` and press Enter.
4.  Once finished, type `npm start` to launch the app.

#### **On Mac**
1.  Open the project folder.
2.  Right-click the folder and select "New Terminal at Folder."
3.  Type `npm install` and press Enter.
4.  Once finished, type `npm start` to launch the app.

## Research Dashboard
Once the server is running, researchers can access the dashboard to view results in real-time.

*   **URL**: `http://localhost:3000/admin`
*   **Login**: Use the `ADMIN_USER` and `ADMIN_PASS` you set in your `.env` file.
*   **Features**:
    *   **Dashboard**: View high-level stats like recruitment progress and belief shift rates.
    *   **Chat Library**: Read every transcript from every condition.
    *   **Survey Results**: View all participant feedback and rankings.
    *   **LLM Audit**: Read the AI Judge's detailed reasoning for its quality scores.

## Key Research Metrics
The system automatically tracks the following data points:
*   **Sycophancy Resistance**: Does the AI just agree with the user?
*   **Logical Neutrality**: Are the arguments grounded in formal logic?
*   **Rebuttal Precision**: Did the AI attack the weakest parts of the user's logic?
*   **Cognitive Friction**: Did the AI force the user to think harder and defend their view?
