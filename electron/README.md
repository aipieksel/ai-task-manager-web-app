# Electron desktop runtime

The desktop wrapper packages the same generated `dist/` application and serves it through a local confined runtime.

- Product: **Agentic AI Projects Task Manager**
- Bundle ID: `com.aipieksel.agenticaiprojectstaskmanager`
- Default data: the product’s own Application Support directory
- Migration: none; another application’s registry is never read or merged

Build an unsigned local application with `npm run electron:pack`. Use `tooling/actions/build_and_run.sh --test --verify` to build, install, launch, and verify only this public product. The script’s process and install-path matching must remain specific enough that it cannot close or replace another app.
