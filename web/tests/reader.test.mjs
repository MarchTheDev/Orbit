/** Check the rendered Markdown reader, including heading sizes and list text. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/components/ui/MarkdownPreview.tsx';

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
  '',
  '***bold and italic***, __underline__, ~~strike~~, ||spoiler||.',
  '',
  '```js',
  'const answer = 42;',
  '```',
].join('\n');

const html = renderToStaticMarkup(createElement(Markdown, { text: note }));

console.log('the rendered note');
check('a semantic, large heading', html.includes('<h1') && html.includes('text-2xl'), html.slice(0, 160));
check('bold and italic text', html.includes('<strong') && html.includes('<em'));
check('unordered and numbered lists', html.includes('<ul') && html.includes('<ol'));
check('plain bullet text is visible', html.includes('a plain bullet'), html);
check('task text and its checked mark are visible', html.includes('found the key') && html.includes('✓'), html);
check('a quote and a rule', html.includes('<blockquote') && html.includes('<hr'));
check('inline code', html.includes('<code') && html.includes('F5'));
check('combined emphasis, underline and strikethrough render semantically', html.includes('<strong') && html.includes('<u>underline</u>') && html.includes('<del>strike</del>'));
check('spoilers are initially concealed behind an accessible control', html.includes('aria-label="Reveal spoiler"') && html.includes('>Spoiler</button>'));
check('fenced code renders in a preformatted block', html.includes('<pre') && html.includes('const answer = 42;') && html.includes('>js</p>'));
check('a link keeps its address', html.includes('title="https://example.com"'), html.match(/<button[^>]*the wiki/)?.[0] ?? 'no link');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
