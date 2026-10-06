// The UI's screens (GameUi.show). Its own module, so transient-cards.ts (which the browser spec imports
// in Node) can name them without importing the whole UI.
export type Screen =
  | 'start'
  | 'menu'
  | 'settings'
  | 'race'
  | 'results'
  | 'changelog'
  // The credits and data licences (roadmap M5, credits-1).
  | 'credits'
  // The menu race's options (playtest 4, P4-12 and P4-13).
  | 'raceOptions'
  // The career (run W-R): its map and garage, its results, the next region's teaser.
  | 'career'
  | 'careerResults'
  | 'teaser';
