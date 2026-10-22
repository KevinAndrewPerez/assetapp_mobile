// Smoke test for hooks/use-paged-list.ts: render it with React and confirm a
// long list is cut down to the first page. `node .paged-list-check.mjs`.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PAGE_SIZE, usePagedList } from '../hooks/use-paged-list.ts';

const records = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));

function Harness({ items }) {
  const { visible, total, shown, hasMore } = usePagedList(items);
  return React.createElement(
    'ul',
    {
      'data-total': total,
      'data-shown': shown,
      'data-has-more': String(hasMore),
    },
    visible.map((item) => React.createElement('li', { key: item.id }, `record ${item.id}`)),
  );
}

const html = renderToStaticMarkup(React.createElement(Harness, { items: records }));
const cards = (html.match(/<li/g) || []).length;
const attr = (name) => (html.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

console.log(`page size: ${PAGE_SIZE}`);
console.log(`rendered cards: ${cards}`);
console.log(`total: ${attr('data-total')}  shown: ${attr('data-shown')}  hasMore: ${attr('data-has-more')}`);

const failures = [];
if (cards !== PAGE_SIZE) failures.push(`expected ${PAGE_SIZE} cards, got ${cards}`);
if (attr('data-total') !== String(records.length)) failures.push('total does not match the input length');
if (attr('data-shown') !== String(PAGE_SIZE)) failures.push('shown does not match the rendered page');
if (attr('data-has-more') !== 'true') failures.push('hasMore should be true for a 60-record list');

if (failures.length > 0) {
  console.error(`\nFAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nPaged list renders one page and reports the full total.');
