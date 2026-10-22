import { test } from '@playwright/test';
import { transientCardCase } from './ui-transient-cards-cases';
import { installTransientCards, TEXT_SIZES } from './ui-transient-cards-helpers';

installTransientCards();

// Keep declarations here: the slice inventory uses Playwright's reported file locations.
for (const textSize of TEXT_SIZES.filter((size) => size !== 'normal')) {
  test(
    `no transient card covers anything on any screen it can appear on, at Text size ${textSize}`,
    transientCardCase(textSize),
  );
}
