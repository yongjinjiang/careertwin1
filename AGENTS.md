# CareerTwin1 working instructions

- The human has now authorized only M2.1 from docs/profile-cloud-stage-plan.md: login, private development cloud database and user isolation. Codex coordinates and independently reviews; Claude implements after a numbered ownership ACK. M2.2, M2.3 and formal deployment remain unauthorized.
- Preserve user changes and keep old CareerTwin read-only. Use this repository and its independent careertwin1-profile database.
- The human requested no Docker. Use the dedicated cloud development project for real Auth/database checks; do not start or require Docker/local Supabase. Keep real SMTP delivery separate from generated-code or stub tests.
- User original text is the source. Manual Profile operations do not call an LLM. Reuse the existing counting/data contracts.
- Before collaborating, read .agents_context/HANDOFF.md when present and run python3 .agents_context/relay.py status. The project-local relay is Git-ignored and independent of old CareerTwin.
- Follow explicit single-writer ownership in the current numbered request/ACK. The original M1 review is complete. Product edits remain frozen until the current M2.1 handoff is ACKed; then only Claude writes its agreed implementation files. Codex owns coordination, resource configuration and independent acceptance docs.
- Verify actual source/diffs and report checks actually run. Never overwrite numbered messages. Triggers are hints; reconcile durable messages at session recovery.
- Routine authorized M2.1 implementation/fixes need no repeated human confirmation. Agent agreement does not authorize later stages, push, merge or deployment. Keep original local Profile data separate from the new login flow; no implicit upload or cloud migration.
