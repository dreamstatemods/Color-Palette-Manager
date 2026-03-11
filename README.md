# ACO Swatch Viewer

View Adobe Color (`.aco`) palette files directly in VS Code.

## Features

- **Visual swatch grid** — every color displayed at a glance
- **Color names** — reads embedded names from V2 `.aco` files, auto-names unnamed colors
- **All formats per swatch** — click any row to copy:
  - `HEX` — `#5EF6FF`
  - `RGB` — `rgb(94, 246, 255)`
  - `HSL` — `hsl(183, 100%, 68%)`
  - `CSS filter` — the full `filter:` chain to reproduce the color from black, useful for SVG icon tinting
- **Search** — filter by name or any color value
- **Export** — save your whole palette as:
  - **JSON** — `[{ name, hex, rgb, hsl }]`
  - **CSS variables** — `:root { --color-name: #hex; }`
  - **Tailwind config** — drop into `theme.extend.colors`

## Usage

1. Open any `.aco` file in VS Code — the viewer opens automatically
2. Click a swatch to copy its hex value
3. Click any individual format row (HEX / RGB / HSL / FILTER) to copy that specific format
4. Use the export buttons in the top-right to save the full palette

## Export via Command Palette

You can also trigger exports from the command palette (`Ctrl+Shift+P`):
- `ACO Viewer: Export palette as JSON`
- `ACO Viewer: Export palette as CSS variables`
- `ACO Viewer: Export palette as Tailwind config`

## Supported Color Spaces

The parser handles all common `.aco` color spaces:
- RGB
- HSB / HSV
- CMYK
- Lab
- Grayscale

## Installing Locally (Before Publishing)

```bash
# Install vsce
npm install

# Package the extension
npm run package

# Install the .vsix in VS Code
# Extensions panel → ··· menu → Install from VSIX
```

## Publishing to the Marketplace

1. Create a publisher at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/manage)
2. Update `"publisher"` in `package.json` with your publisher ID
3. Get a Personal Access Token from Azure DevOps
4. Run:
   ```bash
   npx @vscode/vsce login your-publisher-id
   npx @vscode/vsce publish
   ```

## File Format Notes

`.aco` files come in two versions:
- **V1** — colors only (no names). Colors are auto-named `Color 1`, `Color 2`, etc.
- **V2** — colors + UTF-16BE names. The viewer uses V2 names when available.

Most modern Adobe apps (Photoshop, Illustrator, etc.) write V2.
