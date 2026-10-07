/** Enter in the Markdown editor should behave like a reliable chat composer. */
import { insertMarkdownNewline } from '../src/utils/markdownInput.ts';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('\nMarkdown editor Enter behaviour');
let edit = insertMarkdownNewline('firstsecond', 5, 5);
check('Enter inserts a newline at the caret', edit.value === 'first\nsecond' && edit.caret === 6, JSON.stringify(edit));

edit = insertMarkdownNewline('replace this', 0, 7);
check('Enter replaces a selected range', edit.value === '\n this' && edit.caret === 1, JSON.stringify(edit));

edit = insertMarkdownNewline('- collect', 9, 9);
check('unordered lists continue', edit.value === '- collect\n- ' && edit.caret === 12, JSON.stringify(edit));

edit = insertMarkdownNewline('4. explore', 10, 10);
check('ordered lists increment', edit.value === '4. explore\n5. ' && edit.caret === 14, JSON.stringify(edit));

edit = insertMarkdownNewline('- [x] hidden switch', 19, 19);
check('task lists continue as unchecked tasks', edit.value === '- [x] hidden switch\n- [ ] ' && edit.caret === 26, JSON.stringify(edit));

edit = insertMarkdownNewline('> remember this', 15, 15);
check('block quotes continue', edit.value === '> remember this\n> ' && edit.caret === 18, JSON.stringify(edit));

edit = insertMarkdownNewline('- ', 2, 2);
check('Enter on an empty bullet exits the list', edit.value === '\n' && edit.caret === 1, JSON.stringify(edit));

edit = insertMarkdownNewline('- keep plain line break', 23, 23, false);
check('Shift+Enter inserts a plain line break without continuing a list', edit.value === '- keep plain line break\n' && edit.caret === 24, JSON.stringify(edit));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
