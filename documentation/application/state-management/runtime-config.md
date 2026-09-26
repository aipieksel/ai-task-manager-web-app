# Runtime configuration and identity

`projects.json` version 1 owns connected project records. `config/ui.json` owns safe interface settings and route preferences. Repository seeds contain empty state only.

Electron uses `com.aipieksel.agenticaiprojectstaskmanager`; the PWA identifier is `com.aipieksel.agenticaiprojectstaskmanager.pwa`. Default desktop/Python resolution writes to `~/Library/Application Support/Agentic AI Projects Task Manager/data/runtime/projects.json` and never reads, merges, or migrates a legacy product registry. Explicit file/runtime environment overrides remain available for tests and deliberate development use.
