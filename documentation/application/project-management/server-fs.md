# Runtime filesystem contract

The local runtime exposes structured project scanning plus confined project bootstrap creation. `POST /api/projects/scan` returns `setup.state`, missing/conflicting relative markers, a content revision, and files when a compatible task root is healthy. A missing task system is a successful classified response rather than a 404.

`POST /api/projects/bootstrap` writes only the Agent Workflow Kits bootstrap manifest and copyable instruction described in [`project-onboarding.md`](project-onboarding.md). Python and Electron enforce the same allowlist, revision, idempotency, conflict, atomic-write, and symlink-confinement rules.

The browser adapter in `src/taskmanager/js/services/server-fs.js` calls a local runtime. Python and Electron implementations expose the same retained endpoints:

- project scan;
- file read/write;
- file and folder copy-verify-delete;
- automation summary/action;
- native directory selection where available;
- projects/UI runtime JSON read/write.

Paths are resolved under user-selected project roots, traversal is rejected, writes are verified, and unexpected methods/routes fail closed. The public runtime exposes no extension-manager, credential, provider, audio, shortcut, permission, or transcription API.
