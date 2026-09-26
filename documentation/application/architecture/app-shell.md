# App shell and routes

`router.js` recognizes `/`, `/task`, `/questions`, `/verification`, `/activity`, `/agents`, `/lessons`, `/observations`, `/projects`, and `/settings`. Unknown hashes fall back to the queue.

`main.js` owns boot, state refresh, lifecycle actions, project selection, and transient UI binding. `render-route.js` composes route views, while `ui/components.js` renders the product shell and project-scope navigation. `sw.js` caches only retained production assets for offline PWA use.
