# Dialectic

An AI debate arena where a user argues a motion against an AI opponent and receives
scores for logic, evidence, clarity, and relevance.

## Run it

Requires Node.js 20 or newer.

```bash
cp .env.example .env
# Add your OpenAI API key to .env for live mode.
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Without an API key, the app runs in demo mode with deterministic opponent replies and
heuristic scores, so the complete three-round flow remains testable.

## MVP architecture

- Dependency-free Node HTTP server
- Static responsive frontend
- OpenAI Responses API for the opponent and judge
- Structured Outputs for reliable rubric scores
- Separate opponent and judge prompts to reduce self-scoring bias
- Moderation before generated debate responses
- Microphone recording with `gpt-4o-mini-transcribe`
- Spoken AI replies with `gpt-4o-mini-tts` and an explicit AI-voice disclosure
- Browser-local accounts with persistent ELO and debate totals
- Per-user debate history with win, loss, draw, score, rubric, and ELO changes
- Salted PBKDF2 password hashes with remembered or session-only sign-in
- Persistent English, Portuguese, Chinese, and Hebrew localization with RTL support
- Local-account ELO leaderboard with ranking and tie-breaks
- AI opponent and judge feedback locked to the selected language
- Three-round or five-round debate formats
- Round-aware opponent responses that cannot reuse earlier rebuttals
- Difficulty-specific ELO floors with score-scaled gains capped at +30
- Synthesized boxing-bell round transitions and animated gavel verdicts

## ELO rules

- Baby: scores below 50 lose ELO.
- Adult: scores below 40 lose ELO.
- Harvey Specter: scores below 30 lose ELO.
- The threshold itself is neutral.
- Above the threshold, higher scores gain progressively more ELO, capped at +30.

Accounts, password hashes, sessions, ELO, rankings, and history are persisted in
server-side SQLite. See `DEPLOYMENT.md` for the included Docker and Render deployment.

## Next production layer

For human-vs-human debates, add:

1. Postgres for users, debates, turns, ratings, and reports
2. Authentication and age-aware safety controls
3. WebSockets for rooms, presence, timers, and reconnects
4. A matchmaking queue using topic tags and ELO bands
5. Server-authoritative turns and immutable transcripts
6. A second-pass judge or judge panel for disputed/high-stakes matches

AI scores should be presented as rubric-based feedback, not objective truth. Before
ranking users, calibrate the judge against a diverse human-scored evaluation set and
measure viewpoint, dialect, verbosity, and citation-style bias.
