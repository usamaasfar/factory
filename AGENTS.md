# Agent instructions

`.memory/` is durable context for agents across sessions. At the start of a session, read its index and only the relevant linked files. Update it when work establishes a lasting decision, preference, verified state, or limitation. Keep it concise and current; do not store transcripts, speculation, temporary details, or secrets.
