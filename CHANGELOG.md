# Changelog

## [0.2.0] - 2026-11-10

- **Load in CNCjs** sends the program to the open port through CNCjs's
  `/api/gcode`, using the custom widget's session token. It replaces
  **Download .nc** inside CNCjs, whose widget sandbox blocks downloads.
- The widget asks CNCjs for the current port and reports its height so the
  custom widget sizes to fit.

## [0.1.0] - 2026-11-10

- Conversational CNCjs widget with square up (two setups), face, side face,
  rectangular pocket, circular pocket and bolt circle operations.
- Parameters are edited on the dimension lines of a to-scale plan and section.
- Metric Grbl G-code with run-time estimate, copy and download.
