import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BossPortrait } from './src/components/common/BossPortrait';
import { BossSigil } from './src/components/common/BossSigil';

const bosses = [
  'dune_tyrant', 'siltstalker', 'heap_guard', 'ashgut',
  'mirage_duster', 'rust_prophet', 'scrap_bishop', 'unknown_boss',
];

for (const b of bosses) {
  const p = renderToStaticMarkup(React.createElement(BossPortrait, { bossId: b, animate: true }));
  const s = renderToStaticMarkup(React.createElement(BossSigil, { bossId: b, size: 20, showFrame: false }));
  const sf = renderToStaticMarkup(React.createElement(BossSigil, { bossId: b, size: 44 }));
  const circles = (p.match(/<circle/g) || []).length;
  const texts = (p.match(/<text/g) || []).length;
  const paths = (p.match(/<path/g) || []).length;
  const visibleTotal = circles + texts + paths;
  console.log(
    `${b.padEnd(16)} portrait visible=${String(visibleTotal).padStart(2)} (${circles}c/${texts}t/${paths}p) ` +
    `animKeyframes=${p.includes('@keyframes')} ` +
    `sigilFrameOK=${sf.includes('<svg')} sigilBareOK=${s.includes('<svg')}`,
  );
}
console.log('SMOKE OK');
