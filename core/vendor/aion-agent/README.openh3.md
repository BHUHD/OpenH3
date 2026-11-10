# OpenH3 runtime patch

Vendored from [iOfficeAI/aionrs](https://github.com/iOfficeAI/aionrs) v0.2.11, commit
8e61a90329fa9f67c4fdf7e97fe02c24dba33f75 (Apache-2.0; see LICENSE).
The standalone Cargo manifest retains the pinned upstream dependency graph.

OpenH3 adds opt-in AgentBootstrap::structured_children(bool), default false.
When enabled, AgentSpawner::spawn_parallel polls child futures with join_all,
so dropping the parent turn drops all children and their provider receivers.
Results retain input order and children run concurrently. The original spawned
task path remains the default for BYOK. No engine/tool execution logic changes.

The opt-in is selected only by the managed OpenH3 manager, including resume.
This stops local model work; it cannot undo supplier work already accepted or
arbitrary tool side effects already started. Tests use local synthetic servers.
Upstream e2e/acceptance targets require the explicit, default-off
`live-provider-tests` feature, so default workspace checks cannot run them just
because credentials are present. They are not run here.
