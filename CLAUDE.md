# Claude Code session onboarding

Read AGENTS.md, then .agents_context/HANDOFF.md and .agents_context/BOOTSTRAP.md if present. Run python3 .agents_context/relay.py status and pending --recipient claude before acting.

This is the new CareerTwin1 project, not old CareerTwin/Profile V2. M1 is accepted. The human has now authorized M2.1 only and assigned you implementation, with Codex coordinating and independently reviewing. Read docs/m2-1-scope-and-acceptance.md, the broader cloud plan and the current numbered handoff. ACK its exact file ownership before product edits. Do not enter M2.2/M2.3 or deploy. Preserve local Profile records; login is not authorization to upload them.

Relay v1.1 accepts explicit --scope M2.1 (default remains M1 for historical replies). All replies must use the same scope as the message addressed. The old pending M1 request 0012 is superseded by the new human task: first close it with a short M1 response, then ACK the current M2.1 handoff using --scope M2.1. No need to repeat a real-Profile-trial readiness assessment. Use sender-prefixed append-only messages and actual baseline evidence.

If your actual runtime supports harness-tracked background Bash, start/re-arm the whole command Bash(command: "bash .agents_context/watch_claude_trigger.sh --once", run_in_background: true) after reconciling messages. Do not detach a nested process. Do not assume a trigger alone means delivery. Report actual watcher support and limitations in your ACK.
