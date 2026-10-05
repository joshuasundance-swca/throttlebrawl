// Original PNW picture art. Every name and menu stays on a runtime text surface.
const palette = [
  ...['#ffffff', '#eeeeee', '#d8d8d8', '#c0c0c0', '#a4a4a4', '#858585', '#626262', '#414141', '#202020'].map(
    (hex, i) => ({ hex, role: `grey_${i}` }),
  ),
  ...Object.entries({
    ink: '#233239',
    slate: '#50636c',
    glass: '#426675',
    glint: '#91afb7',
    cream: '#e2d9c2',
    moss: '#647863',
    leaf: '#344e44',
    rain: '#8eaaa8',
    salmon: '#c87b6b',
    brick: '#955b52',
    copper: '#ac8757',
    plum: '#786174',
    ochre: '#c1a65e',
    teal: '#558b86',
    timber: '#8c7662',
    steel: '#7f9290',
  }).map(([role, hex]) => ({ role, hex })),
];
const definitions = [];
const facade = (id, draw) => definitions.push({ id, kind: 'facade', draw });
const art = (id, draw) => definitions.push({ id, kind: 'art', draw });
function bricks(r, flemish = false) {
  r.fill('grey_3');
  for (let y = 0; y < 120; y += 10) {
    r.rect(0, y, 120, 2, 'grey_1');
    for (let x = (y / 10) % 2 ? -15 : 0; x < 120; x += 30) {
      r.rect(x, y, 2, 10, 'grey_1');
      if (flemish) r.rect(x + 10, y, 2, 10, 'grey_1');
      r.rect(x + 3, y + 3, flemish ? 5 : 22, 1, 'grey_2');
    }
  }
}
facade('brick-running', (r) => bricks(r));
facade('brick-flemish', (r) => bricks(r, true));
facade('brick-corbelled-cornice', (r) => {
  bricks(r);
  for (const y of [10, 25, 40]) r.rect(0, y, 120, 6, 'grey_1');
  for (let x = 5; x < 120; x += 15) r.rect(x, 31, 7, 13, 'grey_5');
});
facade('cast-iron-round-arches', (r) => {
  r.fill('grey_2');
  for (const x of [20, 60, 100]) {
    r.circle(x, 42, 17, 'grey_0');
    r.rect(x - 17, 42, 34, 68, 'grey_0');
    r.circle(x, 42, 12, 'grey_7');
    r.rect(x - 12, 42, 24, 63, 'grey_7');
    r.rect(x - 1, 30, 2, 75, 'grey_3');
    r.rect(x - 12, 60, 24, 3, 'grey_3');
  }
  r.rect(0, 110, 120, 7, 'grey_4');
});
facade('cast-iron-pilasters', (r) => {
  r.fill('grey_6');
  for (const x of [0, 37, 75, 112]) {
    r.rect(x, 0, 8, 120, 'grey_2');
    r.rect(x + 2, 9, 2, 99, 'grey_0');
    r.rect(x - 3, 6, 14, 6, 'grey_1');
    r.rect(x - 3, 106, 14, 8, 'grey_1');
  }
  for (const y of [0, 54, 115]) r.rect(0, y, 120, 5, 'grey_1');
});
for (let i = 1; i <= 2; i++)
  facade(`ribbon-windows-${i}`, (r) => {
    r.fill('grey_2');
    for (let y = 7; y < 120; y += 30) {
      r.rect(0, y, 120, 18, 'grey_7');
      r.rect(0, y + 2, 120, 3, 'grey_5');
      r.stripes(0, y, 120, 18, i === 1 ? 20 : 30, 2, 'grey_1', true);
      r.rect(0, y + 19, 120, 3, 'grey_4');
    }
  });
facade('granite-bands', (r) => {
  r.fill('grey_2');
  for (let y = 0; y < 120; y += 30) {
    r.rect(0, y + 5, 120, 20, 'grey_6');
    r.stripes(0, y + 5, 120, 20, 30, 5, 'grey_2', true);
    r.rect(0, y + 28, 120, 2, 'grey_4');
  }
});
// The brief's named categories sum to 19; a second granite spacing supplies tile 20.
facade('granite-bands-wide', (r) => {
  r.fill('grey_2');
  for (let y = 0; y < 120; y += 30) {
    r.rect(0, y + 6, 120, 18, 'grey_6');
    r.stripes(0, y + 6, 120, 18, 40, 6, 'grey_2', true);
    r.rect(0, y + 27, 120, 3, 'grey_4');
  }
});
for (let i = 1; i <= 2; i++)
  facade(`warehouse-steel-sash-${i}`, (r) => {
    bricks(r);
    for (const x of [5, 65]) {
      r.rect(x, 10, 50, 98, 'grey_1');
      r.rect(x + 3, 13, 44, 92, 'grey_7');
      r.stripes(x + 3, 13, 44, 92, 23, 2, 'grey_3');
      r.stripes(x + 3, 13, 44, 92, i === 1 ? 11 : 22, 2, 'grey_3', true);
    }
  });
facade('timber-shiplap', (r) => {
  r.fill('grey_2');
  r.stripes(0, 0, 120, 120, 12, 2, 'grey_5');
  r.stripes(0, 2, 120, 118, 12, 1, 'grey_0');
});
facade('timber-board-batten', (r) => {
  r.fill('grey_3');
  r.stripes(0, 0, 120, 120, 20, 4, 'grey_1', true);
  r.stripes(4, 0, 116, 120, 20, 1, 'grey_6', true);
});
function shingles(r, spacing, width) {
  r.fill('grey_3');
  for (let y = 0; y < 120; y += spacing) {
    r.rect(0, y, 120, 2, 'grey_7');
    for (let x = (y / spacing) % 2 ? -width / 2 : 0; x < 120; x += width) {
      r.rect(x, y + 2, width - 1, spacing - 2, (x / width + y / spacing) % 2 ? 'grey_2' : 'grey_4');
      r.rect(x + 3, y + 4, 1, spacing - 5, 'grey_5');
    }
  }
}
facade('timber-shakes', (r) => shingles(r, 24, 20));
facade('cedar-shingles', (r) => shingles(r, 15, 12));
for (let i = 1; i <= 2; i++)
  facade(`corrugated-metal-${i}`, (r) => {
    r.fill('grey_3');
    r.stripes(0, 0, 120, 120, i === 1 ? 8 : 12, 2, 'grey_0', true);
    r.stripes(3, 0, 117, 120, i === 1 ? 8 : 12, 2, 'grey_6', true);
    for (const y of [6, 114]) for (let x = 4; x < 120; x += 12) r.circle(x, y, 1, 'grey_8');
  });
facade('stucco', (r) => {
  r.fill('grey_1');
  for (let n = 0; n < 450; n++) r.rect(r.randInt(120), r.randInt(120), 2, 2, n % 2 ? 'grey_2' : 'grey_0');
});
for (let i = 1; i <= 2; i++)
  facade(`storefront-transoms-${i}`, (r) => {
    r.fill('grey_6');
    r.rect(0, 0, 120, 7, 'grey_1');
    r.rect(0, 29, 120, 5, 'grey_1');
    r.rect(0, 111, 120, 9, 'grey_2');
    r.stripes(0, 7, 120, 22, i === 1 ? 20 : 30, 3, 'grey_1', true);
    r.stripes(0, 34, 120, 77, 40, 4, 'grey_1', true);
    for (const x of [7, 47, 87])
      r.poly(
        [
          [x, 38],
          [x + 21, 38],
          [x, 85],
        ],
        'grey_5',
      );
  });
const accents = ['moss', 'salmon', 'ochre', 'teal', 'plum', 'brick', 'copper', 'slate'];
for (let i = 0; i < 8; i++)
  art(`food-cart-front-${i + 1}`, (r) => {
    r.fill(accents[i]);
    r.rect(5, 30, 76, 58, 'cream');
    r.rect(9, 34, 68, 47, 'ink');
    r.rect(12, 38, 60, 36, 'glass');
    r.rect(3, 84, 80, 7, 'steel');
    // Menu colours are broad blank panels, never simulated handwriting.
    r.rect(88, 34, 25, 54, 'ink');
    r.rect(92, 39, 17, 18, 'cream');
    r.rect(92, 64, 17, 18, accents[(i + 3) % 8]);
    r.rect(0, 15, 120, 14, 'cream');
    r.stripes(0, 15, 120, 14, 24, 12, accents[i], true);
    r.rect(0, 7, 120, 2, 'ink');
    for (let x = 9; x < 120; x += 20) {
      r.rect(x, 9, 1, 3, 'ink');
      r.circle(x, 13, 2, 'ochre');
    }
    r.rect(0, 101, 120, 5, 'steel');
  });
for (let i = 0; i < 8; i++)
  art(`storefront-${i + 1}`, (r) => {
    r.fill(accents[i]);
    r.rect(5, 26, 110, 89, 'ink');
    r.rect(10, 31, 65, 68, 'glass');
    r.rect(81, 31, 28, 77, 'timber');
    r.rect(85, 35, 20, 52, 'glass');
    r.poly(
      [
        [13, 34],
        [44, 34],
        [13, 80],
      ],
      'glint',
    );
    r.rect(103, 89, 2, 7, 'cream');
    r.rect(0, 8, 120, 14, 'cream');
    r.rect(0, 22, 120, 4, 'steel');
    if (i % 2) r.rect(40, 31, 3, 68, 'cream');
    else r.rect(10, 51, 65, 3, 'cream');
    r.rect(10, 103, 65, 6, 'timber');
    if (i > 3) {
      r.rect(13, 88, 17, 15, 'copper');
      r.circle(21, 85, 10, 'leaf');
      r.circle(27, 79, 6, 'moss');
    }
  });
art('mural-leaping-salmon', (r) => {
  r.fill('slate');
  r.rect(0, 96, 120, 24, 'teal');
  r.poly(
    [
      [18, 72],
      [39, 32],
      [68, 22],
      [94, 35],
      [104, 48],
      [91, 52],
      [68, 37],
      [44, 44],
      [29, 76],
    ],
    'salmon',
  );
  r.poly(
    [
      [26, 72],
      [6, 64],
      [13, 82],
      [8, 96],
      [32, 81],
    ],
    'copper',
  );
  r.poly(
    [
      [50, 34],
      [61, 11],
      [71, 24],
    ],
    'brick',
  );
  r.poly(
    [
      [69, 38],
      [56, 58],
      [85, 49],
    ],
    'cream',
  );
  r.circle(94, 41, 2, 'ink');
  for (const x of [18, 39, 75])
    r.poly(
      [
        [x, 106],
        [x + 3, 98],
        [x + 6, 106],
      ],
      'rain',
    );
});
art('mural-heron', (r) => {
  r.fill('moss');
  r.rect(0, 98, 120, 22, 'glass');
  r.poly(
    [
      [27, 77],
      [50, 45],
      [76, 62],
      [64, 90],
    ],
    'slate',
  );
  r.poly(
    [
      [50, 48],
      [58, 17],
      [75, 14],
      [83, 22],
      [67, 25],
      [65, 52],
    ],
    'cream',
  );
  r.poly(
    [
      [80, 20],
      [109, 25],
      [79, 27],
    ],
    'copper',
  );
  r.poly(
    [
      [35, 76],
      [52, 49],
      [62, 81],
    ],
    'rain',
  );
  r.rect(52, 85, 3, 29, 'ink');
  r.rect(66, 84, 3, 30, 'ink');
  r.circle(75, 20, 2, 'ink');
});
art('mural-rain-over-bridge', (r) => {
  r.fill('rain');
  r.rect(0, 96, 120, 24, 'glass');
  for (const x of [19, 87]) r.rect(x, 44, 12, 62, 'slate');
  r.rect(0, 77, 120, 7, 'ink');
  r.poly(
    [
      [0, 74],
      [23, 48],
      [93, 48],
      [120, 74],
      [120, 77],
      [91, 53],
      [26, 53],
      [0, 77],
    ],
    'leaf',
  );
  for (const x of [39, 55, 71]) r.rect(x, 52, 2, 25, 'leaf');
  for (let x = 8; x < 120; x += 20)
    for (const y of [7, 27])
      r.poly(
        [
          [x, y],
          [x + 2, y],
          [x - 5, y + 12],
          [x - 7, y + 12],
        ],
        'cream',
      );
});
art('mural-owl', (r) => {
  r.fill('leaf');
  r.rect(0, 103, 120, 9, 'timber');
  r.poly(
    [
      [29, 36],
      [25, 13],
      [47, 29],
      [75, 29],
      [96, 14],
      [91, 40],
      [89, 87],
      [61, 106],
      [31, 87],
    ],
    'slate',
  );
  r.circle(45, 49, 17, 'cream');
  r.circle(77, 49, 17, 'cream');
  r.circle(45, 49, 7, 'ink');
  r.circle(77, 49, 7, 'ink');
  r.poly(
    [
      [55, 62],
      [67, 62],
      [61, 76],
    ],
    'ochre',
  );
  r.poly(
    [
      [32, 71],
      [52, 85],
      [44, 95],
    ],
    'rain',
  );
  r.poly(
    [
      [88, 71],
      [69, 85],
      [77, 95],
    ],
    'rain',
  );
});
art('bridge-truss-lattice', (r) => {
  r.fill('leaf');
  for (const y of [4, 106]) r.rect(0, y, 120, 10, 'steel');
  for (const x of [0, 60]) {
    r.poly(
      [
        [x, 14],
        [x + 7, 14],
        [x + 60, 106],
        [x + 53, 106],
      ],
      'rain',
    );
    r.poly(
      [
        [x + 53, 14],
        [x + 60, 14],
        [x + 7, 106],
        [x, 106],
      ],
      'steel',
    );
  }
});
art('bridge-rivet-plates', (r) => {
  r.fill('slate');
  for (const x of [5, 65]) {
    r.rect(x, 5, 50, 110, 'steel');
    r.rect(x + 4, 9, 42, 102, 'leaf');
    for (const dx of [8, 42]) for (let y = 16; y < 110; y += 16) r.circle(x + dx, y, 2, 'rain');
  }
});
art('bridge-gothic-tracery', (r) => {
  r.fill('leaf');
  for (const x of [30, 90]) {
    r.poly(
      [
        [x - 24, 120],
        [x - 24, 45],
        [x, 6],
        [x + 24, 45],
        [x + 24, 120],
      ],
      'steel',
    );
    r.poly(
      [
        [x - 18, 120],
        [x - 18, 47],
        [x, 18],
        [x + 18, 47],
        [x + 18, 120],
      ],
      'leaf',
    );
    r.poly(
      [
        [x - 3, 39],
        [x, 34],
        [x + 3, 39],
        [x + 3, 120],
        [x - 3, 120],
      ],
      'rain',
    );
    r.poly(
      [
        [x - 18, 53],
        [x - 15, 49],
        [x + 18, 82],
        [x + 15, 86],
      ],
      'steel',
    );
    r.poly(
      [
        [x + 18, 53],
        [x + 15, 49],
        [x - 18, 82],
        [x - 15, 86],
      ],
      'steel',
    );
  }
});
export default {
  region: 'pacific-northwest',
  pack: 'region-pnw',
  size: 1024,
  tile: 128,
  palette,
  tiles: definitions.map((tile, i) => ({ ...tile, x: (i + 1) % 8, y: Math.floor((i + 1) / 8) })),
};
