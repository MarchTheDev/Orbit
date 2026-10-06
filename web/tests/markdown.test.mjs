/** The Markdown subset Orbit can parse for game notes. */
import { parseBlocks, parseInline } from '../src/utils/markdown.ts';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('block Markdown');
const parsed = parseBlocks([
  '# Attempt 3',
  '',
  'Beat **the boss** on the *third* try.',
  '',
  '- [x] found the key',
  '- [ ] opened the door',
  '- a plain bullet',
  '',
  '1. go left',
  '2. jump',
  '',
  '> worth remembering',
  '',
  '>>> a quoted block',
  'with a second line',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
  '---',
].join('\n'));
const blocks = parsed.filter((block) => block.kind !== 'blank');
check('headings are parsed with their level', blocks[0].kind === 'h' && blocks[0].level === 1);
check('paragraphs keep bold and italic runs', blocks[1].kind === 'p' && blocks[1].inlines.some((i) => i.kind === 'strong') && blocks[1].inlines.some((i) => i.kind === 'em'));
check('task lists keep their checked state', blocks[2].kind === 'ul' && blocks[2].items[0].done && blocks[2].items[1].box);
check('ordinary bullets keep their text', blocks[2].kind === 'ul' && blocks[2].items[2].inlines[0].text === 'a plain bullet');
check('ordered lists keep their written numbers', blocks[3].kind === 'ol' && blocks[3].items[1].number === 2);
check('quotes are recognized', blocks[4].kind === 'quote');
check('Discord-style multi-line quotes are grouped', blocks[5].kind === 'quote' && blocks[5].inlines.some((piece) => piece.kind === 'br'));
check('fenced code blocks keep code and language', blocks[6].kind === 'code' && blocks[6].language === 'ts' && blocks[6].text === 'const answer = 42;');
check('horizontal rules are recognized', blocks[7].kind === 'rule');
check('blank lines remain available to separate paragraphs', parsed.some((block) => block.kind === 'blank'));

console.log('\ninline Markdown');
const inline = parseInline('**bold**, *italic*, ***both***, __underlined__, ~~struck~~, ||spoiler||, `code`, [the wiki](https://example.com), <https://example.org>, and https://example.net.');
check('bold', inline.some((piece) => piece.kind === 'strong' && piece.text === 'bold'));
check('italic', inline.some((piece) => piece.kind === 'em' && piece.text === 'italic'));
check('combined bold and italic', inline.some((piece) => piece.kind === 'strongEm' && piece.text === 'both'));
check('underline and strikethrough', inline.some((piece) => piece.kind === 'underline') && inline.some((piece) => piece.kind === 'strike'));
check('spoilers are recognized', inline.some((piece) => piece.kind === 'spoiler' && piece.text === 'spoiler'));
check('inline code keeps its literal text', inline.some((piece) => piece.kind === 'code' && piece.text === 'code'));
check('links keep both label and URL', inline.some((piece) => piece.kind === 'link' && piece.text === 'the wiki' && piece.href === 'https://example.com'));
check('angle-bracket URLs become clickable links', inline.some((piece) => piece.kind === 'link' && piece.href === 'https://example.org'));
check('plain URLs become links without their trailing punctuation', inline.some((piece) => piece.kind === 'link' && piece.href === 'https://example.net') && inline.some((piece) => piece.kind === 'text' && piece.text === '.'));
check('incomplete markers remain ordinary text', parseInline('**unclosed').every((piece) => piece.kind === 'text'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
