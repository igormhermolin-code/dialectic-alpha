# Deploying Dialectic Alpha

The application is stateful. Accounts, password hashes, sessions, ELO, rankings, and
debate history live in Turso (remote SQLite/libSQL). Local development falls back to
`data/dialectic.db`.

## Render

1. Create a free Turso database and database token.
2. Push this repository to GitHub.
3. In Render, create a Blueprint from the repository.
4. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when prompted.
5. Add `OPENAI_API_KEY` for live AI, or leave it empty for Alpha fallback mode.
6. Deploy on the free Render web-service plan.

The `render.yaml` file configures HTTPS, the health check, Turso credentials, and the
free native Node.js web service. Render may spin down an inactive free service, but Turso keeps
the user data independently.

## Any Docker host

```bash
docker build -t dialectic-alpha .
docker run \
  -p 3000:3000 \
  -e OPENAI_API_KEY=your_key \
  -e TURSO_DATABASE_URL=libsql://your-database.turso.io \
  -e TURSO_AUTH_TOKEN=your_token \
  dialectic-alpha
```

For a larger public launch, migrate SQLite to managed Postgres, add email verification,
password recovery, rate limiting backed by Redis, abuse reporting, backups, and an
administration console.
