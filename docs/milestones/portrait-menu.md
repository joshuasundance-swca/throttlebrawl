# Portrait desktop menu welcome layout

`[default]` A served desktop check found the fresh-profile welcome card beside the menu at 390x844,
leaving the game title in three fragments and squeezing the primary buttons. Stack the welcome
card below the menu in portrait. Preserve the existing landscape layout, text-size scaling,
welcome dismissal and Quick Play navigation. Touch devices retain the existing landscape
orientation guard; this change does not make portrait play available on phones.

## Automated acceptance

1. In a 390x844 desktop window, a fresh profile's menu and welcome card use the available width, and the
   card follows the menu without overlap at Normal, Large and Largest text sizes.
2. The complete title paints at the chosen text size, wrapping naturally within its full-width
   column. No title, primary button or welcome text is horizontally clipped.
3. Start career, Quick Play, Settings and the welcome actions receive pointer input. Dismissing
   the welcome card retains the full-width menu; Quick Play still opens setup and returns to it.
4. At 915x412 the welcome card retains its existing layout beside the menu. A planted narrow
   title must make the painted-text measure detect wrapping, rather than passing a broken oracle.

CI runs the desktop browser regression. One coordinated served check examines the actual deployed
layout; desktop software rendering does not establish phone legibility or performance.

The original one-line assertion was a mistaken universal promise from a desktop screenshot:
CI painted two lines despite the column already having its full width. The regression preserves
full-width layout, painted-text containment, scaling and a squeezed-title negative control;
it does not freeze line count across platform fonts. The original narrow-column baseline fails
the width assertion independently of line count.
