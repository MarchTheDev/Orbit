import { hltbExtraEstimate, hltbExtraWeeks } from '../src/utils/hltb.ts';
import { readFileSync } from 'node:fs';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
}

check('84 HLTB extra-content hours become about eight weeks', hltbExtraWeeks(84) === 8);
check('the estimate states its daily-play assumption and focus', hltbExtraEstimate(84) === 'About 8 weeks at 1.5 hours/day, focusing on extra content.');
check('short HLTB extra times are shown in days and missing values stay hidden', hltbExtraEstimate(1.5) === 'About 1 day at 1.5 hours/day, focusing on extra content.' && hltbExtraWeeks(0) === null && hltbExtraWeeks(Number.NaN) === null);
const details = readFileSync(new URL('../src/components/detail/HltbCard.tsx', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../src/components/BacklogView.tsx', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../src/components/detail/PlanPage.tsx', import.meta.url), 'utf8');
check('the estimate appears in details, backlog, and the planning sheet', details.includes('<HltbExtraEstimate hours={h.mainExtra}') && backlog.includes('<HltbExtraEstimate hours={g.hltb?.mainExtra') && plan.includes('<HltbExtraEstimate hours={hltb?.mainExtra'));
if (failures) process.exitCode = 1;
