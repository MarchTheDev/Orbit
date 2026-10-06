/** The note editor keeps normal textarea editing and offers a rendered preview. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownEditor } from '../src/components/ui/MarkdownEditor.tsx';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const html = renderToStaticMarkup(
  createElement(MarkdownEditor, {
    value: '# Run\nPress `F5` to reload.',
    onChange: () => {},
    rows: 6,
    placeholder: 'Write a note…',
  }),
);

console.log('the note editor');
check('uses a native multiline textarea', html.includes('<textarea') && html.includes('rows="6"'), html.slice(0, 250));
check('keeps the Markdown source in the writing field', html.includes('# Run') && html.includes('`F5`'), html);
check('offers Write and Preview views', html.includes('>Write</button>') && html.includes('>Preview</button>'), html);
check('does not use contenteditable', !html.includes('contenteditable'));
check('labels the writing field for assistive technology', html.includes('aria-label="Game note in Markdown"'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
