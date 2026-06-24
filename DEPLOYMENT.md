# Deploying Dialectic Alpha

The application is now a stateful server application. Accounts, password hashes,
sessions, ELO, rankings, and debate history live in SQLite on the server.

## Render

1. Push this repository to GitHub.
2. In Render, create a Blueprint from the repository.
3. Add `OPENAI_API_KEY` when prompted.
4. Deploy. The included persistent disk keeps `dialectic.db` across releases.
5. Add a custom domain in the Render dashboard and update its DNS records.

The `render.yaml` file configures HTTPS, a persistent disk, the health check, and the
Docker runtime. Do not deploy the database on an ephemeral filesystem.

## Any Docker host

```bash
docker build -t dialectic-alpha .
docker run \
  -p 3000:3000 \
  -e OPENAI_API_KEY=your_key \
  -v dialectic-data:/var/data \
  dialectic-alpha
```

For a larger public launch, migrate SQLite to managed Postgres, add email verification,
password recovery, rate limiting backed by Redis, abuse reporting, backups, and an
administration console.
