# Portrait menu welcome layout

`[default]` A served check found the fresh-profile welcome card beside the menu at 390x844,
leaving the game title in three fragments and squeezing the primary buttons. Stack the welcome
card below the menu in portrait. Preserve the existing landscape layout, text-size scaling,
welcome dismissal and Quick Play navigation.

## Automated acceptance

1. At 390x844, a fresh profile's menu and welcome card use the available screen width, and the
   card follows the menu without overlap at Normal, Large and Largest text sizes.
2. The Normal title paints on one line. At larger sizes its text grows with the root font and
   remains inside the viewport. No title, primary button or welcome text is horizontally clipped.
3. Start career, Quick Play, Settings and the welcome actions are reachable by touch. Dismissing
   the welcome card retains the full-width menu; Quick Play still opens setup and returns to it.
4. At 915x412 the welcome card retains its existing layout beside the menu. A planted narrow
   title must make the painted-text measure detect wrapping, rather than passing a broken oracle.

CI runs the browser regression. One coordinated served check examines the actual deployed
layout; desktop software rendering does not establish phone legibility or performance.
