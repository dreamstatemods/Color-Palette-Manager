# Color Palette Manager

View, edit, and manage color palettes directly in VS Code. Supports **ACO**, **ASE**, **JSON**, **CSS**, and **Tailwind** formats with full import/export, an inline color picker, drag-and-drop reordering, and real-time search.

## Features

- **Multi-format support** — import and export ACO, ASE, JSON, CSS variables, and Tailwind config files
- **Sidebar palette manager** — dedicated activity bar icon with a browsable palette menu and auto-refreshing file list
- **Visual swatch grid** — two-column card layout showing every color with its name, hex, and all format values
- **Click to copy** — click any format row (HEX, RGB, HSL, HEXA, RGBA, HSLA, CSS Filter) to copy it to the clipboard
- **Inline color picker** — add new colors with a full-featured picker (hue, saturation, brightness, opacity)
- **Edit in place** — rename colors inline, delete with one click, drag-and-drop to reorder
- **Search** — real-time filtering by name, hex, RGB, HSL, or group
- **Alpha support** — full transparency handling with HEXA, RGBA, and HSLA displayed when alpha < 1
- **CSS Filter output** — a complete `filter:` chain to reproduce any color from black, useful for SVG icon tinting
- **Group labels** — ASE groups and JSON group fields are preserved and displayed as section headers
- **Spot color indicator** — ASE spot colors are marked with a dot on the swatch
- **Save to Swatches** — persist palettes to `~/.vscode/swatches` with automatic filename incrementing
- **Palette switcher** — jump between saved palettes without leaving the editor view
- **Full theme integration** — all UI colors follow your VS Code theme

## Supported Formats

| Format | Import | Export |
|--------|:------:|:------:|
| ACO (Adobe Color / Photoshop) | ✓ | ✓ |
| ASE (Adobe Swatch Exchange) | ✓ | ✓ |
| JSON | ✓ | ✓ |
| CSS custom properties | ✓ | ✓ |
| Tailwind config (.js/.ts) | ✓ | ✓ |

### Color Spaces Parsed

ACO/ASE files support RGB, HSB/HSV, CMYK, CIE Lab, and Grayscale — all automatically converted to RGB. Text formats accept hex (3/4/6/8-digit), `rgb()`/`rgba()`, and `hsl()`/`hsla()` notation.

## Usage

1. Click the **Color Palette Manager** icon in the activity bar
2. Select a palette from the list, create a new one, or click **Import** to open any supported file
3. Click any format row on a swatch card to copy that value
4. Use the **Export as** dropdown to save in any format
5. Click **Save to Swatches** to persist your work

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `acoViewer.paletteFolder` | string | `~/.vscode/swatches` | Folder where palettes are stored |
| `acoViewer.fontFamily` | string | *(empty)* | Custom font family for the UI (e.g. `Orbitron, Rajdhani, sans-serif`) |

## Commands

| Command | Title |
|---------|-------|
| `acoViewer.openFile` | Swatch Viewer: Open palette file… |

## Security

- Strict Content Security Policy (`default-src 'none'` with nonce-gated scripts/styles)
- All user content HTML-escaped before rendering
- Path traversal prevention on palette load/save
- Message and export format validation with allowlists
- Untrusted workspace support — workspace-level settings for palette folder and font are restricted
- No stored secrets, no outbound network requests, zero dependency CVEs

For the full security breakdown, see [FEATURES.md](FEATURES.md#security).

## Acknowledgements

- [Pickr](https://github.com/Simonwep/pickr) by Simon Reinisch — MIT License
- [VS Code Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft — [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)

## Installing Locally

```bash
npm install
npm run package
# Extensions panel → ··· → Install from VSIX
```

## Publishing

1. Create a publisher at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/manage)
2. Update `"publisher"` in `package.json`
3. Get a Personal Access Token from Azure DevOps
4. Run:
   ```bash
   npx @vscode/vsce login your-publisher-id
   npx @vscode/vsce publish
   ```
