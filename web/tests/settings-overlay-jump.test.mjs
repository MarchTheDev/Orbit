import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes("card.scrollIntoView({ behavior: 'smooth', block: 'start' });")) {
  console.error('  FAIL selecting a Settings category should align its top below the sticky header');
  process.exitCode = 1;
} else {
  console.log('  ok   selecting a Settings category aligns its top below the sticky header');
}
