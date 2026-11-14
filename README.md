# cncjs-conversational

Conversational programming for [CNCjs](https://github.com/cncjs/cncjs) as a
custom widget. Each operation is a dimensioned sketch: the number boxes sit on
the dimension lines they control, and the drawing redraws to scale as you type.
The toolpath and the G-code come from the same calculation.

Operations: square up stock (two setups), face, side face, rectangular pocket,
circular pocket and bolt circle. Output is metric Grbl G-code (G21, G54); peck
drilling is expanded because Grbl has no canned cycles.

## Use with CNCjs

```sh
npm install cncjs-conversational
cncjs --mount /conversational:node_modules/cncjs-conversational/web
```

In CNCjs, turn on **Custom Widget** under **Manage Widgets** and set its URL to
`/conversational/`. [cncjs-whb04b6-el400-integration](https://github.com/pedropaulovc/cncjs-whb04b6-el400-integration)
mounts it for you.

Open a port in CNCjs, then click **Load in CNCjs**: the program replaces the one
loaded in CNCjs's workspace, ready for the Visualizer and **Run**. Loading is
refused while a program is running or paused, since it would stop the job.
Inside CNCjs the widget uses CNCjs's session token and `/api/gcode`, so it must
be served by CNCjs (`--mount`) rather than from another address. CNCjs's widget
sandbox blocks file downloads, so **Download .nc** only appears when the page is
opened on its own (for example `web/index.html` in a browser).

The widget is one column as wide as CNCjs's sidebars, and served by CNCjs it
uses CNCjs's own stylesheet (Bootstrap 3), so its buttons and messages match the
other widgets. Opened on its own, a small stand-in stylesheet gives the same look.

## Checks

Inputs are validated as you type. Errors (a pocket smaller than the tool, a cut
deeper than the stock, a side cut reaching the vise jaws) outline the boxes
involved and disable output. Warnings, such as a corner radius close to the tool
radius, leave output enabled. Check every program in a simulator and with an air
cut before cutting material.

## Development

```sh
npm ci
npx playwright install chromium
npm test
```

## Release

Bump `version` in `package.json`, add a `## [x.y.z]` section to `CHANGELOG.md`,
merge, then push the tag `vx.y.z`. The release workflow tests the package,
publishes it to npm through trusted publishing, and creates the GitHub release
from the changelog section.

## License

MIT
