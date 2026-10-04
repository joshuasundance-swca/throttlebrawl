// Original picture-only Keys art. Signs and all words are runtime text surfaces.
const palette = [
  ...['#ffffff', '#eeeeee', '#d8d8d8', '#c0c0c0', '#a4a4a4', '#858585', '#626262', '#414141', '#202020'].map(
    (hex, i) => ({ hex, role: `grey_${i}` }),
  ),
  ...Object.entries({
    ink: '#183b46',
    glass: '#427f91',
    glint: '#b7e0dc',
    coral: '#dc705e',
    pink: '#efaaa0',
    mint: '#94c6b1',
    yellow: '#edc66f',
    sand: '#eee0b6',
    sky: '#8ab8d0',
    sea: '#367e8b',
    deep: '#285d71',
    leaf: '#3b7860',
    orange: '#e7944c',
    lilac: '#a898bb',
    timber: '#b3986d',
    red: '#b75349',
  }).map(([role, hex]) => ({ role, hex })),
];
const definitions = [];
const add = (id, kind, draw) => definitions.push({ id, kind, draw });
const facade = (id, draw) => add(id, 'facade', draw);
const art = (id, draw) => add(id, 'art', draw);
function lap(r, spacing) {
  r.fill('grey_1');
  r.stripes(0, 0, 120, 120, spacing, 2, 'grey_4');
  r.stripes(0, 2, 120, 118, spacing, 1, 'grey_0');
}
for (const [name, spacing] of [
  ['fine', 6],
  ['medium', 10],
  ['wide', 15],
])
  facade(`lap-siding-${name}`, (r) => lap(r, spacing));
facade('board-batten', (r) => {
  r.fill('grey_2');
  r.stripes(0, 0, 120, 120, 15, 3, 'grey_0', true);
  r.stripes(3, 0, 117, 120, 15, 1, 'grey_5', true);
});
function window(r, x, y, w, h) {
  r.rect(x, y, w, h, 'grey_0');
  r.rect(x + 4, y + 4, w - 8, h - 8, 'grey_7');
  r.rect(x + 6, y + 6, w - 12, h - 12, 'grey_5');
  r.rect(x + 4, y + Math.floor(h / 2), w - 8, 3, 'grey_0');
}
for (const open of [true, false])
  facade(`bahama-${open ? 'open' : 'closed'}`, (r) => {
    lap(r, 10);
    for (const x of [12, 70])
      for (const y of [8, 66]) {
        window(r, x, y, 38, 44);
        const height = open ? 24 : 38;
        r.rect(x + 2, y + 2, 34, height, 'grey_3');
        r.stripes(x + 3, y + 3, 32, height - 3, 4, 2, 'grey_6');
        if (open) r.rect(x, y + 25, 38, 4, 'grey_8');
      }
  });
facade('balcony-spindles', (r) => {
  r.fill('grey_7');
  for (let x = 4; x < 120; x += 12) {
    r.rect(x, 8, 4, 104, 'grey_0');
    r.poly(
      [
        [x - 2, 36],
        [x + 6, 36],
        [x + 4, 48],
        [x + 4, 70],
        [x + 6, 82],
        [x - 2, 82],
        [x, 70],
        [x, 48],
      ],
      'grey_1',
    );
  }
  r.rect(0, 5, 120, 6, 'grey_0');
  r.rect(0, 108, 120, 6, 'grey_0');
});
facade('tin-5v', (r) => {
  r.fill('grey_2');
  for (let x = 4; x < 120; x += 24) {
    for (const dx of [0, 4, 18]) r.rect(x + dx, 0, 2, 120, 'grey_5');
    r.rect(x + 2, 0, 1, 120, 'grey_0');
  }
});
facade('conch-window', (r) => {
  lap(r, 10);
  for (const x of [14, 72]) for (const y of [7, 66]) window(r, x, y, 34, 46);
});
facade('motel-doors', (r) => {
  r.fill('grey_2');
  for (const x of [8, 68])
    for (const y of [2, 62]) {
      r.rect(x, y, 42, 55, 'grey_0');
      r.rect(x + 4, y + 4, 34, 51, 'grey_4');
      r.rect(x + 9, y + 9, 24, 19, 'grey_6');
      r.circle(x + 31, y + 36, 2, 'grey_0');
    }
});
facade('painted-block', (r) => {
  r.fill('grey_1');
  for (let y = 0; y < 120; y += 15) {
    r.rect(0, y, 120, 2, 'grey_3');
    for (let x = y % 30 ? 15 : 0; x < 120; x += 30) r.rect(x, y, 2, 15, 'grey_3');
  }
});
facade('louvred-vent', (r) => {
  lap(r, 10);
  for (const x of [12, 72])
    for (const y of [10, 70]) {
      r.rect(x, y, 36, 36, 'grey_0');
      r.rect(x + 4, y + 4, 28, 28, 'grey_6');
      r.stripes(x + 4, y + 4, 28, 28, 5, 3, 'grey_2');
    }
});
facade('porch-lattice', (r) => {
  r.fill('grey_7');
  for (let x = -120; x < 240; x += 16) {
    r.poly(
      [
        [x, 0],
        [x + 4, 0],
        [x + 124, 120],
        [x + 120, 120],
      ],
      'grey_0',
    );
    r.poly(
      [
        [x, 0],
        [x + 4, 0],
        [x - 116, 120],
        [x - 120, 120],
      ],
      'grey_0',
    );
  }
});
facade('transom-window', (r) => {
  lap(r, 10);
  for (const x of [7, 67])
    for (const y of [10, 70]) {
      window(r, x, y, 46, 35);
      r.rect(x + 21, y + 4, 3, 27, 'grey_0');
    }
});
facade('concrete-deck', (r) => {
  r.fill('grey_2');
  r.stripes(0, 0, 120, 120, 40, 2, 'grey_4');
  r.stripes(0, 0, 120, 120, 60, 2, 'grey_4', true);
});
facade('porch-panels', (r) => {
  r.fill('grey_1');
  for (const x of [5, 65])
    for (const y of [5, 65]) {
      r.rect(x, y, 50, 50, 'grey_4');
      r.rect(x + 3, y + 3, 44, 44, 'grey_0');
      r.rect(x + 7, y + 7, 36, 36, 'grey_2');
    }
});
const accents = ['coral', 'mint', 'yellow', 'lilac', 'sky', 'pink', 'orange', 'leaf'];
for (let i = 0; i < 8; i++)
  art(`storefront-${i + 1}`, (r) => {
    const paint = accents[i];
    r.fill(paint);
    r.rect(5, 20, 110, 89, 'ink');
    r.rect(9, 24, 62, 64, 'glass');
    r.rect(76, 24, 35, 81, 'sand');
    r.rect(80, 28, 27, 51, 'glass');
    r.rect(9, 91, 62, 14, 'timber');
    r.poly(
      [
        [12, 27],
        [42, 27],
        [12, 65],
      ],
      'glint',
    );
    r.rect(104, 61, 2, 8, 'ink');
    // Different glazing, kicks and transoms, as well as different pastel paint.
    if (i % 2) r.rect(38, 24, 3, 64, 'sand');
    if (i % 3 === 1) r.rect(9, 44, 62, 3, 'sand');
    if (i % 3 === 2) {
      r.rect(9, 24, 62, 13, 'sand');
      r.rect(12, 27, 56, 7, 'glass');
    }
    if (i > 3) r.rect(9, 95, 62, 3, paint);
    r.rect(3, 16, 114, 4, 'sand');
    for (const x of [8, 106])
      r.poly(
        [
          [x, 16],
          [x + 6, 16],
          [x + 6, 8],
        ],
        'ink',
      );
  });
for (let i = 0; i < 4; i++)
  art(`awning-${i + 1}`, (r) => {
    r.fill('sand');
    r.stripes(0, 0, 120, 120, 24, 12, accents[i], true);
    r.rect(0, 96, 120, 3, 'ink');
    for (let x = 0; x < 120; x += 24)
      r.poly(
        [
          [x, 103],
          [x + 24, 103],
          [x + 20, 118],
          [x + 4, 118],
        ],
        accents[i],
      );
  });
function ocean(r) {
  r.fill('sky');
  r.rect(0, 66, 120, 54, 'sea');
  for (let y = 76; y < 120; y += 12)
    for (let x = r.randInt(12); x < 120; x += 30) r.rect(x, y, 18, 2, 'glint');
}
art('mural-roosters', (r) => {
  r.fill('sand');
  for (const x of [32, 88]) {
    r.circle(x, 67, 19, 'orange');
    r.poly(
      [
        [x - 12, 73],
        [x - 27, 44],
        [x - 24, 85],
        [x - 8, 82],
      ],
      'leaf',
    );
    r.circle(x + 14, 43, 11, 'yellow');
    r.poly(
      [
        [x + 10, 33],
        [x + 12, 24],
        [x + 17, 29],
        [x + 21, 23],
        [x + 23, 36],
      ],
      'red',
    );
    r.poly(
      [
        [x + 23, 41],
        [x + 33, 46],
        [x + 23, 50],
      ],
      'coral',
    );
    r.circle(x + 17, 41, 2, 'ink');
    for (const dx of [-4, 6]) r.rect(x + dx, 84, 3, 17, 'ink');
  }
});
art('mural-sunset', (r) => {
  r.fill('pink');
  r.circle(60, 62, 28, 'orange');
  r.circle(60, 62, 20, 'yellow');
  r.rect(0, 73, 120, 47, 'deep');
  for (let y = 79; y < 118; y += 7) r.rect(42 + r.randInt(7), y, 28 - Math.floor((y - 79) / 3), 3, 'yellow');
});
art('mural-fish', (r) => {
  ocean(r);
  r.poly(
    [
      [17, 60],
      [40, 34],
      [78, 34],
      [101, 58],
      [79, 83],
      [39, 83],
    ],
    'yellow',
  );
  r.poly(
    [
      [20, 60],
      [4, 38],
      [4, 83],
    ],
    'orange',
  );
  r.poly(
    [
      [44, 38],
      [58, 22],
      [70, 36],
    ],
    'coral',
  );
  r.circle(83, 52, 4, 'ink');
  r.poly(
    [
      [46, 57],
      [62, 49],
      [64, 71],
    ],
    'orange',
  );
});
art('mural-manatee', (r) => {
  ocean(r);
  r.poly(
    [
      [31, 73],
      [9, 57],
      [7, 86],
    ],
    'lilac',
  );
  r.circle(60, 66, 29, 'lilac');
  r.circle(87, 60, 19, 'lilac');
  r.poly(
    [
      [58, 75],
      [42, 96],
      [67, 85],
    ],
    'deep',
  );
  r.circle(94, 56, 2, 'ink');
  r.circle(101, 64, 2, 'ink');
});
art('mural-conch', (r) => {
  r.fill('sea');
  r.poly(
    [
      [21, 83],
      [38, 48],
      [31, 30],
      [60, 41],
      [78, 28],
      [89, 49],
      [109, 63],
      [93, 90],
      [48, 104],
    ],
    'pink',
  );
  r.poly(
    [
      [29, 81],
      [43, 57],
      [63, 46],
      [87, 58],
      [97, 70],
      [85, 87],
      [49, 95],
    ],
    'sand',
  );
  r.ring(65, 70, 19, 14, 'coral');
  r.ring(65, 70, 10, 5, 'coral');
});
art('mural-hurricane-party', (r) => {
  r.fill('lilac');
  r.poly(
    [
      [0, 38],
      [30, 48],
      [60, 38],
      [90, 48],
      [120, 38],
      [120, 55],
      [0, 55],
    ],
    'deep',
  );
  r.poly(
    [
      [12, 62],
      [59, 28],
      [108, 62],
    ],
    'coral',
  );
  r.rect(25, 62, 70, 39, 'yellow');
  r.rect(54, 73, 15, 28, 'deep');
  r.rect(18, 102, 90, 5, 'timber');
  for (const x of [29, 86]) {
    r.poly(
      [
        [x, 91],
        [x + 11, 91],
        [x + 9, 100],
        [x + 2, 100],
      ],
      'mint',
    );
    r.rect(x + 7, 82, 2, 12, 'sand');
  }
  r.poly(
    [
      [98, 64],
      [110, 70],
      [113, 90],
      [107, 111],
      [102, 91],
    ],
    'leaf',
  );
});
art('tiki-thatch', (r) => {
  r.fill('timber');
  for (let y = 0; y < 120; y += 12)
    for (let x = -8; x < 120; x += 8)
      r.poly(
        [
          [x, y],
          [x + 7, y],
          [x + 10 + r.randInt(3), y + 17],
          [x + 5, y + 14],
        ],
        r.randInt(2) ? 'sand' : 'yellow',
      );
});
art('tiki-bamboo', (r) => {
  r.fill('timber');
  for (let x = 2; x < 120; x += 15) {
    r.rect(x, 0, 11, 120, 'yellow');
    r.rect(x + 2, 0, 2, 120, 'sand');
    for (let y = r.randInt(20); y < 120; y += 30) r.rect(x, y, 11, 3, 'leaf');
  }
});
for (let i = 0; i < 2; i++)
  art(`hull-stripe-${i + 1}`, (r) => {
    r.fill('grey_0');
    r.rect(0, 76, 120, 13, i ? 'coral' : 'deep');
    r.rect(0, 94, 120, 5, 'yellow');
  });
for (let i = 0; i < 2; i++)
  art(`pigeon-trim-${i + 1}`, (r) => {
    r.fill('yellow');
    r.stripes(0, 0, 120, 120, 10, 1, 'orange');
    r.rect(0, 0, 120, 8, 'grey_0');
    r.rect(0, 109, 120, 11, 'grey_0');
    if (i)
      for (let x = 9; x < 120; x += 20)
        r.poly(
          [
            [x, 8],
            [x + 14, 8],
            [x + 7, 25],
          ],
          'grey_0',
        );
    else r.stripes(0, 8, 120, 100, 60, 5, 'grey_0', true);
  });
art('pier-planks', (r) => {
  r.fill('timber');
  r.stripes(0, 0, 120, 120, 15, 2, 'ink', true);
  for (const y of [7, 111]) for (let x = 7; x < 120; x += 15) r.circle(x, y, 1, 'ink');
});
art('pier-edge', (r) => {
  r.fill('grey_3');
  r.rect(0, 0, 120, 22, 'sand');
  r.rect(0, 22, 120, 5, 'grey_6');
  r.stripes(0, 28, 120, 92, 30, 2, 'grey_5', true);
});
for (let i = 0; i < 2; i++)
  art(`tin-shed-${i + 1}`, (r) => {
    r.fill(i ? 'mint' : 'sky');
    r.stripes(0, 0, 120, 120, 12, 2, 'deep', true);
    r.stripes(3, 0, 117, 120, 12, 1, 'glint', true);
    r.rect(0, 109, 120, 6, 'sand');
  });
export default {
  region: 'florida-keys',
  pack: 'base',
  size: 1024,
  tile: 128,
  palette,
  tiles: definitions.map((tile, i) => ({ ...tile, x: (i + 1) % 8, y: Math.floor((i + 1) / 8) })),
};
