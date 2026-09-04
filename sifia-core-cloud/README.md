# Sifia Core Cloud

Persistent 24/7 orchestration layer for the Sifia ecosystem.

## Principle
The cloud service is the always-on brain. The Windows PC agent is an optional execution arm when the computer is online.

## Initial safety boundary
- Separate Render service from the production Sifia App.
- No arbitrary remote shell.
- No credentials committed to Git.
- `/health` is read-only.
- External writes will require explicit capability design and audit logging.

## Render
Root directory: `sifia-core-cloud`
Build command: `npm install`
Start command: `npm start`
