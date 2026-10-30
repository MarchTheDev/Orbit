/**
 * A failed native startup must explain itself instead of leaving a blank window.
 */
import { readFileSync } from 'node:fs';

const hook = readFileSync(new URL('../src/hooks/useLibrary.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const linuxWindow = readFileSync(new URL('../src-tauri/src/linux_window.rs', import.meta.url), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`);
  }
}

console.log('startup failures are visible and retryable');
check('native library/settings rejection is caught and kept for the screen',
  /catch \(error\) \{[\s\S]{0,180}setStartupError\(error instanceof Error \? error\.message : String\(error\)\)/.test(hook));
check('a retry repeats the initial load',
  hook.includes('setStartupAttempt((attempt) => attempt + 1)') && hook.includes('}, [startupAttempt]);'));
check('the app shows the original startup error and a retry action',
  app.includes('role="alert"') && app.includes('{startupError}') && app.includes('onClick={retryStartup}') &&
    app.includes('Orbit couldn’t finish starting'));
check('a static HTML message remains if the frontend bundle never runs',
  html.includes('Orbit is starting…') && html.includes('interface did not load') && html.includes('<div id="root">'));
check('the installed Linux build only avoids WebKit DMA-BUF on Wayland with NVIDIA and honors an explicit choice',
  linuxWindow.includes('wayland && nvidia && !user_setting') &&
    linuxWindow.includes('std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()') &&
    linuxWindow.includes('std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1")') &&
    linuxWindow.includes('needs_webkit_dmabuf_fallback(true, true, true)'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
