// Original picture-only San Francisco art. All signs remain runtime text surfaces.
const palette = [
  ...['#ffffff', '#eeeeee', '#d8d8d8', '#c0c0c0', '#a4a4a4', '#858585', '#626262', '#414141', '#202020'].map(
    (hex, i) => ({ hex, role: `grey_${i}` }),
  ),
  ...Object.entries({
    ink: '#213044',
    glass: '#386579',
    glint: '#91c4d4',
    cream: '#f0dfb5',
    coral: '#e16e52',
    rose: '#e5a8b7',
    yellow: '#f3c54c',
    orange: '#e89440',
    teal: '#268b8c',
    mint: '#8fc4a6',
    leaf: '#325747',
    blue: '#5379ba',
    purple: '#82549b',
    lilac: '#b3a0da',
    brick: '#a74a39',
    mortar: '#dfb5a0',
    soil: '#513c35',
    timber: '#967047',
  }).map(([role, hex]) => ({ role, hex })),
];
const definitions = [];
const facade = (id, draw) => definitions.push({ id, kind: 'facade', draw });
const art = (id, draw) => definitions.push({ id, kind: 'art', draw });
function lap(r, spacing) {
  r.fill('grey_1');
  r.stripes(0, 0, 120, 120, spacing, 2, 'grey_5');
  r.stripes(0, 2, 120, 118, spacing, 1, 'grey_0');
  for (const x of [0, 112]) {
    r.rect(x, 0, 8, 120, 'grey_0');
    r.rect(x + 6, 0, 2, 120, 'grey_4');
  }
}
for (const [i, spacing] of [
  [1, 8],
  [2, 12],
])
  facade(`victorian-lap-${i}`, (r) => lap(r, spacing));
for (let i = 1; i <= 2; i++)
  facade(`bay-window-sash-${i}`, (r) => {
    r.fill('grey_2');
    for (const x of [4, 43, 82]) {
      r.rect(x, 5, 34, 109, 'grey_0');
      r.rect(x + 4, 9, 26, 99, 'grey_7');
      r.rect(x + 6, 11, 8, 43, 'grey_5');
      r.rect(x + 4, 57, 26, 4, 'grey_0');
      if (i === 2) r.rect(x + 15, 9, 3, 99, 'grey_0');
    }
    r.rect(0, 113, 120, 7, 'grey_3');
  });
for (let i = 1; i <= 2; i++)
  facade(`cornice-${i}`, (r) => {
    r.fill('grey_2');
    for (const y of [4, 16, 34, 103]) r.rect(0, y, 120, 5, 'grey_0');
    for (let x = 5; x < 120; x += 15) r.rect(x, 21, 7, 9, 'grey_5');
    for (let x = 9; x < 120; x += 30) {
      r.rect(x, 43, 12, 57, 'grey_0');
      r.poly(
        [
          [x + 2, 43],
          [x + 18, 43],
          [x + 11, 83],
          [x + 2, 97],
        ],
        'grey_4',
      );
      if (i === 2) r.rect(x + 4, 50, 3, 37, 'grey_1');
    }
  });
facade('edwardian-plaster', (r) => {
  r.fill('grey_1');
  for (const x of [9, 71]) {
    r.rect(x, 13, 40, 89, 'grey_3');
    r.rect(x + 3, 16, 34, 83, 'grey_0');
    r.rect(x + 7, 20, 26, 75, 'grey_6');
    r.rect(x + 7, 57, 26, 3, 'grey_0');
    r.rect(x - 3, 9, 46, 5, 'grey_0');
  }
});
// Exactly four floor bands: one tile covers one unscaled 14 m module face.
for (let i = 1; i <= 3; i++)
  facade(`curtain-wall-${i}`, (r) => {
    r.fill('grey_6');
    for (let floor = 0; floor < 4; floor++) {
      const y = floor * 30;
      r.rect(0, y, 120, 3, 'grey_2');
      r.rect(0, y + 25, 120, 5, 'grey_4');
      for (let x = 0; x < 120; x += [20, 30, 40][i - 1]) {
        r.rect(x, y, 2, 30, 'grey_1');
        r.rect(x + 3, y + 4, 5, 19, 'grey_5');
      }
    }
  });
for (let i = 1; i <= 2; i++)
  facade(`stone-pilasters-${i}`, (r) => {
    r.fill('grey_2');
    for (let floor = 0; floor < 4; floor++) {
      const y = floor * 30;
      r.rect(0, y + 27, 120, 3, 'grey_4');
      for (let x = 4; x < 120; x += i === 1 ? 30 : 40) {
        r.rect(x, y + 4, i === 1 ? 21 : 29, 20, 'grey_7');
        r.rect(x + 2, y + 5, 4, 17, 'grey_5');
        r.rect(x - 3, y, 3, 30, 'grey_0');
      }
    }
  });
facade('lobby-glass', (r) => {
  r.fill('grey_6');
  r.stripes(0, 0, 120, 120, 30, 3, 'grey_1', true);
  r.rect(0, 18, 120, 3, 'grey_1');
  r.rect(0, 103, 120, 6, 'grey_3');
  for (const x of [7, 37, 67, 97])
    r.poly(
      [
        [x, 24],
        [x + 16, 24],
        [x, 82],
      ],
      'grey_5',
    );
});
facade('garage-doors', (r) => {
  r.fill('grey_2');
  for (const x of [5, 65]) {
    r.rect(x, 10, 50, 102, 'grey_7');
    r.rect(x + 3, 13, 44, 99, 'grey_3');
    r.stripes(x + 3, 16, 44, 96, 12, 2, 'grey_5');
    for (const dx of [6, 22, 38]) r.rect(x + dx, 27, 10, 8, 'grey_7');
  }
});
for (let i = 1; i <= 2; i++)
  facade(`fire-escape-${i}`, (r) => {
    r.fill('grey_2');
    for (const y of [14, 52, 90]) {
      r.rect(6, y, 108, 4, 'grey_8');
      r.rect(6, y - 13, 108, 2, 'grey_7');
      r.stripes(9, y - 13, 105, 13, 12, 2, 'grey_7', true);
      const x = i === 1 ? 25 : 77;
      r.poly(
        [
          [x, y + 4],
          [x + 5, y + 4],
          [x + 23, y + 37],
          [x + 18, y + 37],
        ],
        'grey_7',
      );
      for (let n = 0; n < 5; n++) r.rect(x + n * 4, y + 7 + n * 6, 12, 2, 'grey_8');
    }
  });
function bricks(r, base, joint, width, height) {
  r.fill(base);
  for (let y = 0; y < 120; y += height) {
    r.rect(0, y, 120, 2, joint);
    for (let x = (y / height) % 2 ? -width / 2 : 0; x < 120; x += width) r.rect(x, y, 2, height, joint);
  }
}
for (let i = 1; i <= 2; i++)
  facade(`brick-${i}`, (r) => bricks(r, 'grey_3', 'grey_1', i === 1 ? 24 : 40, 10));
facade('stucco', (r) => {
  r.fill('grey_1');
  for (let n = 0; n < 450; n++) r.rect(r.randInt(120), r.randInt(120), 2, 2, n % 2 ? 'grey_2' : 'grey_0');
});
facade('roof-parapets', (r) => {
  r.fill('grey_3');
  r.rect(0, 0, 120, 13, 'grey_0');
  r.rect(0, 13, 120, 4, 'grey_5');
  r.stripes(0, 17, 120, 103, 30, 2, 'grey_4', true);
  r.rect(0, 103, 120, 5, 'grey_1');
});
facade('golden-gate-tower-panels', (r) => {
  r.fill('grey_1');
  for (const x of [8, 47, 86]) {
    r.rect(x, 0, 25, 120, 'grey_5');
    r.rect(x + 3, 0, 19, 120, 'grey_3');
    r.rect(x + 4, 0, 2, 120, 'grey_6');
    for (const y of [27, 87]) r.rect(x, y, 25, 4, 'grey_1');
  }
});
facade('golden-gate-truss', (r) => {
  r.fill('grey_5');
  for (const y of [3, 108]) r.rect(0, y, 120, 9, 'grey_1');
  for (const x of [0, 60]) {
    r.poly(
      [
        [x, 12],
        [x + 7, 12],
        [x + 60, 108],
        [x + 53, 108],
      ],
      'grey_1',
    );
    r.poly(
      [
        [x + 53, 12],
        [x + 60, 12],
        [x + 7, 108],
        [x, 108],
      ],
      'grey_2',
    );
  }
  for (let x = 6; x < 120; x += 12) for (const y of [7, 112]) r.circle(x, y, 1, 'grey_7');
});
const accents = [
  'coral',
  'teal',
  'yellow',
  'rose',
  'mint',
  'purple',
  'orange',
  'blue',
  'lilac',
  'brick',
  'timber',
];
for (let i = 0; i < 11; i++)
  art(`storefront-${i + 1}`, (r) => {
    const paint = accents[i];
    r.fill(paint);
    r.rect(4, 22, 112, 92, 'ink');
    r.rect(9, 27, 67, 63, 'glass');
    r.rect(81, 27, 29, 81, 'cream');
    r.rect(85, 31, 21, 55, 'glass');
    r.rect(9, 94, 67, 14, 'timber');
    r.poly(
      [
        [12, 30],
        [44, 30],
        [12, 74],
      ],
      'glint',
    );
    r.rect(102, 70, 2, 7, 'ink');
    r.rect(0, 13, 120, 7, 'cream');
    if (i % 3 === 0) r.rect(40, 27, 3, 63, 'cream');
    if (i % 3 === 1) r.rect(9, 46, 67, 3, 'cream');
    if (i % 3 === 2) r.stripes(0, 0, 120, 13, 24, 12, 'cream', true);
    if (i > 5)
      for (const x of [15, 57]) {
        r.circle(x, 86, 7, 'leaf');
        r.rect(x - 8, 90, 16, 8, 'orange');
      }
  });
art('mural-hills', (r) => {
  r.fill('rose');
  r.circle(90, 28, 18, 'yellow');
  r.poly(
    [
      [0, 81],
      [36, 26],
      [84, 89],
      [120, 46],
      [120, 120],
      [0, 120],
    ],
    'teal',
  );
  r.poly(
    [
      [0, 100],
      [53, 61],
      [120, 107],
      [120, 120],
      [0, 120],
    ],
    'blue',
  );
  r.poly(
    [
      [28, 120],
      [57, 73],
      [64, 73],
      [47, 120],
    ],
    'cream',
  );
});
art('mural-poppies', (r) => {
  r.fill('blue');
  for (const [x, y] of [
    [24, 40],
    [61, 70],
    [96, 31],
  ]) {
    r.rect(x - 2, y, 4, 120 - y, 'leaf');
    for (const [dx, dy] of [
      [-10, 0],
      [10, 0],
      [0, -10],
      [0, 10],
    ])
      r.circle(x + dx, y + dy, 13, 'orange');
    r.circle(x, y, 9, 'yellow');
    r.poly(
      [
        [x, y + 35],
        [x + 23, y + 17],
        [x + 12, y + 38],
      ],
      'mint',
    );
  }
});
art('mural-heron', (r) => {
  r.fill('yellow');
  r.circle(27, 25, 18, 'coral');
  r.rect(0, 88, 120, 32, 'teal');
  r.poly(
    [
      [32, 75],
      [55, 40],
      [86, 66],
      [63, 93],
    ],
    'blue',
  );
  r.poly(
    [
      [54, 43],
      [61, 14],
      [79, 18],
      [67, 26],
      [66, 50],
    ],
    'cream',
  );
  r.poly(
    [
      [76, 18],
      [107, 25],
      [75, 27],
    ],
    'orange',
  );
  r.poly(
    [
      [36, 76],
      [55, 47],
      [60, 79],
    ],
    'purple',
  );
  r.rect(57, 89, 3, 24, 'ink');
  r.rect(67, 86, 3, 27, 'ink');
  r.circle(72, 20, 2, 'ink');
});
art('mural-tides', (r) => {
  r.fill('cream');
  for (let i = 0; i < 4; i++) {
    r.ring(20 + i * 30, 80 - i * 10, 42, 25, accents[i]);
    r.circle(15 + i * 30, 20 + i * 7, 8, accents[i + 4]);
  }
});
art('mural-gardens', (r) => {
  r.fill('purple');
  for (const [x, y, colour] of [
    [23, 24, 'rose'],
    [87, 32, 'yellow'],
    [59, 77, 'orange'],
  ]) {
    r.circle(x, y, 21, colour);
    r.circle(x, y, 8, 'teal');
    r.poly(
      [
        [x, y + 19],
        [x + 26, y + 34],
        [x + 8, y + 42],
      ],
      'mint',
    );
    r.poly(
      [
        [x, y + 19],
        [x - 23, y + 28],
        [x - 11, y + 40],
      ],
      'leaf',
    );
  }
});
art('mural-kites', (r) => {
  r.fill('teal');
  for (const [x, y, colour] of [
    [27, 29, 'coral'],
    [88, 37, 'yellow'],
    [60, 77, 'lilac'],
  ]) {
    r.poly(
      [
        [x, y - 18],
        [x + 18, y],
        [x, y + 26],
        [x - 18, y],
      ],
      colour,
    );
    r.poly(
      [
        [x, y - 18],
        [x + 18, y],
        [x, y + 26],
      ],
      'cream',
    );
    r.poly(
      [
        [x, y + 26],
        [x + 3, y + 26],
        [x + 10, y + 44],
        [x + 7, y + 44],
      ],
      'ink',
    );
  }
});
art('lombard-brick', (r) => bricks(r, 'brick', 'mortar', 30, 12));
art('lombard-hydrangea', (r) => {
  r.fill('soil');
  for (let n = 0; n < 38; n++) {
    const x = r.randInt(120),
      y = r.randInt(120);
    r.circle(x, y, 12, 'leaf');
    const colour = ['rose', 'lilac', 'blue'][n % 3];
    for (const [dx, dy] of [
      [0, 0],
      [-5, -3],
      [5, -3],
      [0, 5],
    ])
      r.circle(x + dx, y + dy, 5, colour);
    r.circle(x, y, 2, 'cream');
  }
});
for (let i = 1; i <= 2; i++)
  art(`cable-car-trim-${i}`, (r) => {
    r.fill(i === 1 ? 'brick' : 'blue');
    r.rect(0, 0, 120, 10, 'cream');
    r.rect(0, 105, 120, 15, 'cream');
    r.stripes(0, 15, 120, 80, 30, 3, 'timber', true);
    r.rect(0, 24, 120, 4, 'yellow');
    r.rect(0, 82, 120, 4, 'yellow');
    for (const x of [8, 38, 68, 98]) {
      r.rect(x, 36, 17, 35, 'timber');
      r.rect(x + 3, 39, 11, 29, 'cream');
    }
  });
export default {
  region: 'san-francisco',
  pack: 'region-sf',
  size: 1024,
  tile: 128,
  palette,
  tiles: definitions.map((tile, i) => ({ ...tile, x: (i + 1) % 8, y: Math.floor((i + 1) / 8) })),
};
