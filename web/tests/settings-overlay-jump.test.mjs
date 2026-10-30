import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../src/utils/settingsNavigation.ts', import.meta.url), 'utf8');
const usesSharedJump = (source) => source.includes('scrollSettingsSectionToTop(');

if (!usesSharedJump(app) || !usesSharedJump(settings)) {
  console.error('  FAIL every Settings category route should use the same top-aligned scroll');
  process.exitCode = 1;
} else if (!navigation.includes("element.closest<HTMLElement>('.orbit-scroll')") ||
           !navigation.includes("scroller.querySelector<HTMLElement>('.orbit-sticky')") ||
           !navigation.includes('navTop + nav.offsetHeight + 12') ||
           !navigation.includes('scroller.scrollTo({ top, behavior })')) {
  console.error('  FAIL Settings cards should be measured against the app scroller and placed below its sticky category bar');
  process.exitCode = 1;
} else {
  console.log('  ok   every Settings category route places the card below the sticky category bar');
}
