# Build and deployment

`npm run build:web` copies the production allowlist from `src/taskmanager/` to `dist/` and regenerates `DEPLOY_MANIFEST.json` with hashes. `npm run electron:pack` builds the web output, generates the icon, and packages an unsigned macOS application under `build/release/`.

`tooling/actions/build_and_run.sh --test --verify` tests, packages, installs, and opens only **Agentic AI Projects Task Manager**. Its app name, process path, install path, bundle identifier, and Application Support data are distinct from private or legacy applications.
