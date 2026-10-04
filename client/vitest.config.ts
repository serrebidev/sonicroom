// Tests must run against React's DEVELOPMENT build, which is what supplies
// `act` (React 19.2 dropped it from the production bundle). Without this an
// ambient NODE_ENV=production — e.g. a shell that inherited it from the
// systemd unit — silently breaks useMediasoup.test.ts.
//
// It also decides whether vite keeps `node:*` imports working: under
// production React resolves to the CJS build and vite's dependency
// externalization stubs out node:fs / node:path, so `import { join } from
// "node:path"` yields undefined and backgrounds.test.ts fails. Pin it here,
// before vite reads the env, so the suite is reproducible whatever shell it is
// launched from.
process.env.NODE_ENV = "test";

import { defineConfig } from "vitest/config";

// Standalone test config (kept separate from vite.config.ts so the paraglide /
// tailwind build plugins don't run under the test runner — the generated
// paraglide messages are read from disk as plain files). jsdom gives us a DOM;
// setup.ts installs the Web Audio / WebRTC / getUserMedia fakes jsdom lacks.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
