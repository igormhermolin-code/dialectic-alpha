# Dialectic Alpha

AI debate arena where users practice live arguments against an AI opponent or another user, receive rubric-based scores, and build an ELO ranking over time.

Live site: [https://dialectic-alpha.onrender.com](https://dialectic-alpha.onrender.com)

## What it does

- Debate against AI in 3-round or 5-round formats.
- Choose your stance, then the AI always argues the opposite side.
- Pick the difficulty: Baby, Adult, or Harvey Specter.
- Get judged on logic, evidence, clarity, and relevance.
- Gain or lose ELO depending on your score and difficulty.
- Create an account, log in, and keep your ELO saved.
- See debate history with green results for wins and red results for losses.
- View a leaderboard ranked by account ELO.
- Change the app language between English, Portuguese, Chinese, and Hebrew.
- Use microphone input and AI voice when the required API keys are configured.
- Match against another user online through ELO-based matchmaking.

## AI setup

The app supports Gemini for free-tier text generation and judging.

Recommended Render environment variables:

```env
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_API_KEY=your_google_gemini_api_key
TURSO_DATABASE_URL=your_turso_database_url
TURSO_AUTH_TOKEN=your_turso_auth_token
NODE_ENV=production
```

OpenAI is optional and mainly used for microphone transcription and higher-quality text-to-speech:

```env
OPENAI_API_KEY=your_openai_api_key
```

If no AI key is configured, the app still runs in Alpha fallback mode so the interface can be tested.

## ELO rules

- Baby: scores below 50/100 lose ELO.
- Adult: scores below 40/100 lose ELO.
- Harvey Specter: scores below 30/100 lose ELO.
- Higher scores gain more ELO.
- Maximum ELO gain per debate is +30.

## Tech stack

- Node.js HTTP server
- Static HTML/CSS/JavaScript frontend
- Turso database in production
- Local SQLite fallback for development
- Gemini API for AI opponent and judging
- Optional OpenAI API for speech features
- Render for hosting

## Run locally

Requires Node.js 20 or newer.

```bash
cp .env.example .env
npm install
npm start
```

Then open:

[http://localhost:3000](http://localhost:3000)

## Deploy

This project is configured for Render using `render.yaml`.

1. Push the repository to GitHub.
2. Create a new Render web service or Blueprint from the repository.
3. Add the environment variables listed above.
4. Deploy.

Render free services may sleep after inactivity, so the first load can be slow.

## Important note

AI judging should be treated as debate practice feedback, not absolute truth. The score is meant to help users improve their arguments, not decide who is objectively right.
