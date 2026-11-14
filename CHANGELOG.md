# Changelog

## [Unreleased]

- One column at the width of CNCjs's sidebars (340 px) instead of three, with
  the sketches redrawn 1:1 for that width so their text and number boxes stay
  readable. The plan's height follows the stock's shape.
- Served by CNCjs, the widget uses CNCjs's own stylesheet: Bootstrap buttons,
  toggles and alerts like the other widgets. A stand-in covers standalone use.

## [0.2.2] - 2026-11-10

- A reply that is not JSON from CNCjs (for example a proxy's sign-in page) now
  fails the load. Before, an HTML reply to the upload was reported as loaded.
- Malformed entries in CNCjs's controller list no longer surface a script error.
- Undoing an edit brings back the outcome of the program that was sent.

## [0.2.1] - 2026-11-10

- A load outcome that arrives after an edit is still shown, marked as being
  about the program before the edit, instead of disappearing.
- If CNCjs answers `/api/controllers` with something other than a list (for
  example a proxy's sign-in page), Load says so instead of showing a script error.

## [0.2.0] - 2026-11-10

- **Load in CNCjs** sends the program to the open port through CNCjs's
  `/api/gcode`, using the custom widget's session token. It replaces
  **Download .nc** inside CNCjs, whose widget sandbox blocks downloads.
- Loading is refused while CNCjs is running or paused, because loading stops
  CNCjs's workflow; CNCjs's own Upload button follows the same rule.
- A load result stays until the program changes, and a widget served from
  another origin says why it cannot load.

## [0.1.0] - 2026-11-10

- Conversational CNCjs widget with square up (two setups), face, side face,
  rectangular pocket, circular pocket and bolt circle operations.
- Parameters are edited on the dimension lines of a to-scale plan and section.
- Metric Grbl G-code with run-time estimate, copy and download.
