# Color Palette Manager — Complete Feature List

## Sidebar & Activity Bar

- **Dedicated activity bar icon** — custom SVG icon appears in the VS Code activity bar for one-click access
- **Webview sidebar panel** — the entire UI lives in a VS Code sidebar webview, not a separate editor tab
- **Palette Menu landing page** — when no palette is loaded, displays a browsable list of saved palettes
- **Palette list auto-refresh** — a file system watcher monitors the swatches folder; the list updates automatically when files are added, removed, or changed
- **Open swatches folder button** — reveals the `~/.vscode/swatches` directory in the OS file explorer directly from the landing page

## File Format Support

### Import (Read)
- **ACO** — Adobe Color (Photoshop) with V1 and V2 block support; V2 names are merged onto V1 entries when both blocks are present
- **ASE** — Adobe Swatch Exchange (Illustrator / InDesign / web tools) with group support, UTF-16 color names, and spot/global/process color type detection
- **JSON** — array of objects or `{ colors: [...] }` wrapper; accepts `hex`, `rgb`, `rgba`, `hsl` as the color source field, plus optional `name` and `group`
- **CSS** — parses `--color-*` custom properties from `:root` or any selector
- **Tailwind** — extracts key/value color pairs from Tailwind config files (`.js`, `.cjs`, `.mjs`, `.ts`)

### Export (Write)
- **JSON** — `[{ name, hex, rgb, hsl, group?, rgba? }]` with alpha preserved when not fully opaque
- **CSS variables** — `:root { --color-slug: #hex; }` (uses RGBA for semi-transparent colors)
- **Tailwind config** — ready-to-paste `theme.extend.colors` snippet
- **ACO (binary)** — writes a valid V2 ACO file with UTF-16BE color names
- **ASE (binary)** — writes a valid ASE file with RGB model entries and UTF-16 names

## Color Space Parsing

- **RGB** (ACO & ASE)
- **HSB / HSV** (ACO)
- **CMYK** (ACO & ASE) — converted to RGB
- **CIE Lab** (ACO & ASE) — converted to RGB via D65 illuminant
- **Grayscale** (ACO & ASE) — mapped to equal R=G=B
- **Hex** — 3, 4, 6, and 8-digit hex (with alpha)
- **rgb() / rgba()** — percentage or integer channel notation
- **hsl() / hsla()** — degree + percentage notation

## Color Formats Displayed Per Swatch

- **HEX** — e.g. `#5EF6FF`
- **RGB** — e.g. `rgb(94, 246, 255)`
- **HSL** — e.g. `hsl(183, 100%, 68%)`
- **HEXA** — shown instead of HEX when alpha < 1, e.g. `#5EF6FF80`
- **RGBA** — shown instead of RGB when alpha < 1
- **HSLA** — shown instead of HSL when alpha < 1
- **CSS Filter** — a full `filter:` chain (`brightness → saturate → invert → sepia → saturate → hue-rotate → brightness → contrast`) to reproduce the color from black, useful for SVG icon tinting; includes `opacity()` when alpha < 1

## Palette Management

- **Palette selection screen** — lists all palettes in the swatches folder with name, format badge, and color count
- **Create new palette** — starts an empty palette from the landing page or the "Create New Palette" row
- **Save to Swatches** — persists the current in-memory palette as a JSON file in `~/.vscode/swatches`; auto-generates a unique filename (`palette1.json`, `palette2.json`, …) if no name is set
- **Palette switcher dropdown** — in the editor view, a `<select>` lets you jump to any other saved palette without going back to the landing page
- **Back button** — returns to the palette list from the editor view
- **Import button** — opens a native file picker scoped to supported formats (`aco`, `ase`, `json`, `css`, `js`, `cjs`, `mjs`, `ts`)
- **Export button + format selector** — export dropdown with JSON, CSS, Tailwind, ACO, and ASE options; binary formats use a save dialog, text formats open the file in the editor after saving
- **Configurable palette folder** — `acoViewer.paletteFolder` setting overrides the default `~/.vscode/swatches` path

## Color Editing

- **Inline color picker** — integrated [Pickr](https://github.com/Simonwep/pickr) (classic theme) with hue slider, saturation/brightness area, opacity slider, and hex/rgba/hsla text input
- **Add color** — click the "+" card at the end of the grid to open the color picker; newly added colors auto-focus their name field for immediate renaming
- **Delete color** — hover a card to reveal an "×" button in the top-right corner of the swatch
- **Rename color** — click a color's name to make it `contentEditable`; press Enter to confirm, Escape to cancel; changes are reflected in the palette immediately
- **Drag-and-drop reorder** — drag any card onto another to swap their positions

## Search & Filtering

- **Real-time search** — filters cards as you type by matching against name, hex, rgb, hsl, and group
- **No-results message** — displays "No colors match your search." when the filter has zero hits

## Copy to Clipboard

- **Click card** — copies the hex value (or RGBA if semi-transparent)
- **Click any format row** — copies that specific format string (HEX, RGB, HSL, HEXA, RGBA, HSLA)
- **Click CSS Filter row** — copies the full filter chain
- **VS Code clipboard integration** — uses `vscode.env.clipboard.writeText` on the extension host side
- **Toast notification** — a slide-up toast shows "Copied: …" for 1.8 seconds on every copy; long values are truncated with "…"
- **Copied border flash** — the card briefly changes its border to green (`gitDecoration-addedResourceForeground`) on copy

## Visual Indicators

- **Format badge** — small bordered badge showing the source format (ACO, ASE, JSON, CSS, TAILWIND) on both the palette list and the editor view
- **Unsaved changes indicator** — a yellow "UNSAVED CHANGES" label appears in the header meta strip, and a warning banner shows below the grid when edits have been made
- **Spot color dot** — a small white dot appears in the top-right of the swatch for ASE spot colors (`colorType === 1`)
- **Color count** — displayed in the header meta strip and on each palette list row
- **Filename display** — the loaded file's name (without extension) is shown in both the header meta strip and as the grid's group label
- **Checkerboard underlay** — swatches render on a CSS checkerboard pattern so alpha transparency is clearly visible
- **Drag-over highlight** — a dashed accent-colored outline appears on the drop target card during drag

## UI & Theming

- **Full VS Code theme integration** — all colors are derived from VS Code CSS custom properties (editor background, foreground, button styles, input styles, dropdown styles, etc.)
- **Accent color token** — uses `--vscode-activityBarBadge-background` as the primary accent with `--vscode-button-background` fallback
- **Divider color token** — borders use `--vscode-panel-border` with the accent color as fallback
- **Dark background header bar** — the top bar uses `color-mix()` to darken the editor background by 30%
- **Card info section** — the area below the swatch uses `color-mix()` to darken background by 40% for contrast
- **Custom font support** — `acoViewer.fontFamily` setting lets you override the UI font (e.g. `'Orbitron, Rajdhani, sans-serif'`); defaults to VS Code's font
- **Codicons** — uses `@vscode/codicons` for all icons (arrows, folders, save, refresh, add, import, export)
- **Hover effects** — cards, palette rows, format rows, and buttons all have subtle hover transitions (border color, background, opacity)
- **Uppercase labels** — section labels, badges, button text, and column headers use uppercase with letter-spacing for a clean design language

## Grid & Layout

- **Two-column responsive grid** — colors display in a `grid-template-columns: repeat(2, 1fr)` layout
- **Group labels** — when colors have group assignments (from ASE files or JSON), group headers span the full grid width
- **Inline add card** — always appears as the last item in the grid, styled with a dashed border and circular "+" button

## Color Picker Details

- **Pickr Classic theme** — styled to match VS Code's look (dark background, themed inputs, save/cancel/clear buttons)
- **Smart positioning** — the picker opens near the cursor; if it would overflow the viewport bottom, it flips above the cursor
- **Opacity support** — the picker includes an opacity slider; colors with alpha < 1 are stored with full RGBA/HEXA/HSLA data
- **Save / Cancel / Clear buttons** — Save adds the color, Cancel dismisses, Clear resets the picker
- **Fixed positioning** — picker uses `position: fixed` with a high z-index to float above all content

## Security

- **Content Security Policy** — all webview HTML includes a strict CSP: `default-src 'none'`, scripts and styles restricted to nonce-based or `cspSource` origins
- **Nonce generation** — a fresh 32-character random nonce is generated for every HTML render
- **HTML escaping** — all user-provided strings (palette names, file paths, color names) are escaped before insertion into HTML
- **Local resource roots** — webview resource access is restricted to the extension's own URI

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `acoViewer.paletteFolder` | string | `~/.vscode/swatches` | Path to the folder where palettes are stored |
| `acoViewer.fontFamily` | string | *(empty)* | Custom font family for the extension UI |

## Commands

| Command | Title |
|---|---|
| `acoViewer.openFile` | Swatch Viewer: Open palette file… |

## Error Handling

- **Parse error banner** — if a file fails to parse, a red error banner displays the error message at the top of the editor view
- **Graceful fallback** — unparseable files in the swatches folder are silently skipped during palette scanning
- **Init error display** — if the webview script fails during initialization, a red error message is prepended to the body
- **Unsupported format message** — attempting to load an unrecognized file extension shows a clear error
