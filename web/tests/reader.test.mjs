/**
 * What a note looks like once it is drawn.
 *
 * The reading is React elements rather than HTML, so this renders a note to
 * markup the same way the app does and checks what came out. It is the only way
 * to see a rendered note without a browser, and it is what caught the heading
 * that never grew and the link whose address was dropped.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/components/ui/Markdown.tsx';
import { markdownToHtml } from '../src/utils/markdownDom.ts';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const note = [
  '# Attempt 3',
  '',
  'Beat **the boss** on the *third* try. See [the wiki](https://example.com).',
  '',
  '- [x] found the key',
  '- [ ] opened the door',
  '- and a plain bullet',
  '',
  '1. go left',
  '2. jump',
  '',
  '> worth remembering',
  '',
  '---',
  '',
  'Press `F5` to reload.',
].join('\n');

const html = renderToStaticMarkup(createElement(Markdown, { text: note }));

console.log('the reading');
check('a heading, and a big one', html.includes('text-xl'), html.slice(0, 120));
check('bold', html.includes('<strong'));
check('italic', html.includes('<em>'));
check('an unordered list', html.includes('<ul'));
check('a numbered list', html.includes('<ol'));
check('a quote', html.includes('<blockquote'));
check('a rule', html.includes('<hr'));
check('inline code', html.includes('<code'));
check('a link, with its address kept', html.includes('title="https://example.com"'), html.match(/<button[^>]*the wiki/)?.[0] ?? 'no link');
check('a ticked box', html.includes('\u2713'));
check('plain body text is not bolded', !/text-sm leading-relaxed text-fg">\s*<p>\s*<strong/.test(html));

console.log('\nthe box the note is typed in');
const box = markdownToHtml(note);
check('a heading line', box.includes('data-md="h1"'), box.slice(0, 120));
check('a bullet line', box.includes('data-md="ul"'));
check('a ticked line', box.includes('data-md="task-done"'));
check('an unticked line', box.includes('data-md="task"'));
check('a numbered line', box.includes('data-n="1"'));
check('a quote line', box.includes('data-md="quote"'));
check('a rule line', box.includes('data-md="rule"'));
check('a blank line, so paragraphs stay apart', box.includes('<div><br></div>'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
