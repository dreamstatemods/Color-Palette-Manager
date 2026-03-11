"use strict";

const vscode  = require("vscode");
const path    = require("path");
const fs      = require("fs");
const os      = require("os");
const crypto  = require("crypto");
const { parseACO, parseASE, enrichColor, slugify, writeACO, writeASE } = require("./acoParser");

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar WebviewView Provider
// ─────────────────────────────────────────────────────────────────────────────

class SwatchSidebarProvider {
  static viewType = "acoViewer.sidebarView";

  constructor(context) {
    this._context      = context;
    this._view         = null;
    this._colors       = [];
    this._format       = "";
    this._uri          = null;
    this._error        = null;
    this._watchFolder  = "";
    this._paletteList  = [];
  }

  _getFontFamily() {
    const custom = vscode.workspace.getConfiguration('acoViewer').get('fontFamily', '');
    if (!custom) return 'var(--vscode-font-family, sans-serif)';
    // Sanitize: allow only font names, commas, quotes, spaces — strip CSS-breaking chars
    const sanitized = custom.replace(/[{}<>;]/g, '');
    return sanitized || 'var(--vscode-font-family, sans-serif)';
  }

  _isUntrusted() {
    return vscode.workspace.isTrusted === false;
  }

  _scanPalettes() {
    if (!this._watchFolder || !fs.existsSync(this._watchFolder)) return [];
    const palettes = [];
    for (const file of fs.readdirSync(this._watchFolder)) {
      const ext = path.extname(file).toLowerCase();
      if (ext !== ".aco" && ext !== ".ase" && ext !== ".json" && ext !== ".css" && ext !== ".js") continue;
      const filePath = path.join(this._watchFolder, file);
      let colorCount = 0;
      let format = ext.slice(1).toUpperCase();
      try {
        if (ext === ".aco") {
          colorCount = parseACO(fs.readFileSync(filePath)).length;
        } else if (ext === ".ase") {
          colorCount = parseASE(fs.readFileSync(filePath)).length;
        } else if (ext === ".json") {
          colorCount = parseJsonPalette(fs.readFileSync(filePath, "utf8")).length;
        } else if (ext === ".css") {
          colorCount = parseCssPalette(fs.readFileSync(filePath, "utf8")).length;
        } else if (ext === ".js") {
          colorCount = parseTailwindPalette(fs.readFileSync(filePath, "utf8")).length;
          format = "TAILWIND";
        }
      } catch { /* skip unparseable files */ }
      palettes.push({
        name: path.basename(file, ext),
        filePath,
        format,
        colorCount,
      });
    }
    return palettes;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };
    this._codiconUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
    );
    this._cspSource = webviewView.webview.cspSource;

    // Wire message handler ONCE — persists across HTML replacements
    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case "copy":
          if (typeof msg.value === 'string' && msg.value.length < 500) {
            vscode.env.clipboard.writeText(msg.value);
            vscode.window.showInformationMessage(`Copied: ${msg.value.slice(0, 80)}`);
          }
          break;
        case "export":
          if (typeof msg.format === 'string' && Array.isArray(msg.colors)) {
            _doExport(msg.format, msg.colors, this._uri, this._watchFolder, (u) => { this._uri = u; });
          }
          break;
        case "openFile":
          vscode.commands.executeCommand("acoViewer.openFile");
          break;
        case "newPalette":
          this._colors = [];
          this._uri = null;
          this._format = "NEW";
          this._error = null;
          webviewView.webview.html = getWebviewContent(getNonce(), [], "NEW", null, this._paletteList, this._codiconUri, this._cspSource, '', this._getFontFamily(), this._isUntrusted());
          break;
        case "loadPalette": {
          if (typeof msg.filePath !== 'string') break;
          const resolved = path.resolve(msg.filePath);
          const watchResolved = path.resolve(this._watchFolder || path.join(os.homedir(), '.vscode', 'swatches'));
          if (!resolved.startsWith(watchResolved + path.sep) && resolved !== watchResolved) {
            vscode.window.showWarningMessage('Cannot load palette from outside the swatches folder.');
            break;
          }
          this.loadFile(vscode.Uri.file(resolved));
          break;
        }
        case "showPaletteList":
          if (!this._watchFolder) {
            this._watchFolder = path.join(os.homedir(), '.vscode', 'swatches');
          }
          this._paletteList = this._scanPalettes();
          webviewView.webview.html = getPaletteSelectionHtml(getNonce(), this._paletteList, this._codiconUri, this._cspSource, this._getFontFamily(), this._isUntrusted());
          break;
        case "saveToPalettes":
          if (Array.isArray(msg.colors)) {
            const safePaletteName = (typeof msg.paletteName === 'string' && msg.paletteName)
              ? path.basename(msg.paletteName).replace(/[<>:"/\\|?*]/g, '_')
              : null;
            this._saveToPalettes(msg.colors, safePaletteName);
          }
          break;
        case "openWatchFolder": {
          const folder = this._watchFolder || path.join(os.homedir(), '.vscode', 'swatches');
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
          break;
        }
      }
    });

    // If a file was already loaded before the panel became visible, show it now
    if (this._colors.length) {
      webviewView.webview.html = getWebviewContent(getNonce(), this._colors, this._format, this._error, this._paletteList, this._codiconUri, this._cspSource, this._uri ? path.basename(this._uri.fsPath, path.extname(this._uri.fsPath)) : '', this._getFontFamily(), this._isUntrusted());
    } else {
      if (!this._watchFolder) {
        this._watchFolder = path.join(os.homedir(), '.vscode', 'swatches');
      }
      this._paletteList = this._scanPalettes();
      webviewView.webview.html = getPaletteSelectionHtml(getNonce(), this._paletteList, this._codiconUri, this._cspSource, this._getFontFamily(), this._isUntrusted());
    }
  }

  _saveToPalettes(colors, paletteName) {
    if (!colors.length) return;
    const folder = this._watchFolder || path.join(os.homedir(), '.vscode', 'swatches');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    let name = paletteName;
    if (!name && this._uri) {
      name = path.basename(this._uri.fsPath, path.extname(this._uri.fsPath));
    }
    if (!name) {
      let i = 1;
      while (fs.existsSync(path.join(folder, `palette${i}.json`))) i++;
      name = `palette${i}`;
    }
    // Sanitize name to prevent path traversal
    name = path.basename(name).replace(/[<>:"/\\|?*]/g, '_');

    // Strip any trailing digits so repeated saves increment from the base name
    // e.g. "mytheme3" → base "mytheme", then find next available number
    const baseName = name.replace(/\d+$/, '');
    let filePath = path.join(folder, `${name}.json`);
    if (fs.existsSync(filePath)) {
      let i = 1;
      while (fs.existsSync(path.join(folder, `${baseName}${i}.json`))) i++;
      name = `${baseName}${i}`;
      filePath = path.join(folder, `${name}.json`);
    }
    const content = JSON.stringify(
      colors.map(({ name: n, hex, rgb, rgba, hsl, group }) => {
        const entry = { name: n, hex, rgb, hsl, ...(group ? { group } : {}) };
        if (rgba && !rgba.endsWith(', 1)') && !rgba.endsWith(',1)')) entry.rgba = rgba;
        return entry;
      }),
      null, 2
    );
    fs.writeFileSync(filePath, content, 'utf8');
    this._uri = vscode.Uri.file(filePath);
    vscode.window.showInformationMessage(`Saved to ${name}.json`);
  }

  loadFile(uri) {
    try {
      const ext  = path.extname(uri.fsPath).toLowerCase();
      let raw = [];
      if (ext === ".ase" || ext === ".aco") {
        const buf = fs.readFileSync(uri.fsPath);
        raw = ext === ".ase" ? parseASE(buf) : parseACO(buf);
      } else if (ext === ".json") {
        raw = parseJsonPalette(fs.readFileSync(uri.fsPath, "utf8"));
      } else if (ext === ".css") {
        raw = parseCssPalette(fs.readFileSync(uri.fsPath, "utf8"));
      } else if (ext === ".js" || ext === ".cjs" || ext === ".mjs" || ext === ".ts") {
        raw = parseTailwindPalette(fs.readFileSync(uri.fsPath, "utf8"));
      } else {
        throw new Error(`Unsupported palette format: ${ext || "unknown"}`);
      }
      this._colors = raw.map((c, i) => enrichColor(c, i));
      this._format = ext === ".ase" ? "ASE" :
        ext === ".aco" ? "ACO" :
        ext === ".json" ? "JSON" :
        ext === ".css" ? "CSS" : "TAILWIND";
      this._uri    = uri;
      this._error  = null;
    } catch (e) {
      console.error(`[SwatchViewer] parse error:`, e);
      this._colors = [];
      this._format = "ERR";
      this._error  = e.message;
    }

    // Only replace HTML if the panel is already visible/resolved.
    // If not yet visible, resolveWebviewView will pick up this._colors when it fires.
    if (this._view) {
      this._paletteList = this._scanPalettes();
      this._view.webview.html = getWebviewContent(getNonce(), this._colors, this._format, this._error || null, this._paletteList, this._codiconUri, this._cspSource, this._uri ? path.basename(this._uri.fsPath, path.extname(this._uri.fsPath)) : '', this._getFontFamily(), this._isUntrusted());
    }
  }

}

function getPaletteSelectionHtml(nonce, palettes, codiconUri, cspSource, fontFamily = '', untrusted = false) {
  const paletteRows = palettes.map(p => {
    const safeName = p.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const safePath = p.filePath.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return `<div class="palette-row" data-path="${safePath}">
      <div class="palette-row-info">
        <div class="palette-row-name">${safeName} <span class="fmt-badge">${p.format}</span></div>
        <div class="palette-row-meta">${p.colorCount} color${p.colorCount !== 1 ? 's' : ''}</div>
      </div>
      <span class="palette-arrow codicon codicon-arrow-circle-right"></span>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; style-src 'nonce-${nonce}' ${cspSource || ''}; font-src ${cspSource || 'none'}; script-src 'nonce-${nonce}';">
${codiconUri ? `<link rel="stylesheet" href="${codiconUri}" nonce="${nonce}">` : ''}
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html {
    font-family: ${fontFamily || 'var(--vscode-font-family, sans-serif)'};
    font-size: var(--vscode-font-size, 13px);
    font-weight: var(--vscode-font-weight, normal);
  }
  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    padding: 10px;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px; padding-bottom: 10px;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
  }
  .title { font-size: 14px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .toolbar { display: flex; gap: 6px; align-items: center; }
  .btn {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    padding: 4px 10px;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .section-label {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600;
    color: var(--vscode-descriptionForeground); margin-bottom: 8px;
  }
  .fmt-badge {
    display: inline-block; padding: 1px 6px;
    border: 1px solid var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); border-radius: 2px;
    font-size: 10px; margin-left: 6px; vertical-align: middle;
    color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); font-weight: 400; letter-spacing: 0; text-transform: uppercase;
  }
  .palette-list { flex: 1; }
  .palette-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px;
    border: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    border-radius: 3px;
    cursor: pointer;
    margin-bottom: 6px;
    transition: border-color 0.15s, background 0.15s;
  }
  .palette-row:hover { border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); background: var(--vscode-list-hoverBackground); }
  .palette-row.create { border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 13px; }
  .palette-row-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .palette-row-name { font-size: 13px; font-weight: 600; }
  .palette-row-meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .palette-arrow {
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
    color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4));
    flex-shrink: 0;
  }
  .warning-notice {
    margin-top: 12px; padding: 8px 10px;
    background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,0.1));
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,200,0,0.4));
    border-radius: 2px; font-size: 12px;
    color: var(--vscode-editor-foreground); line-height: 1.5;
  }
  /* ── Landing page header ── */
  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 10px;
    margin: -10px -10px 0 -10px;
    background: color-mix(in srgb, var(--vscode-editor-background) 70%, black 30%);
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    min-height: 34px;
  }
  .page-header-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .sub-toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 0 4px;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    margin-bottom: 8px;
  }
  /* Shared button style — matches palette viewer import/export buttons */
  .btn-action {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    padding: 4px 10px; border-radius: 2px; cursor: pointer;
    font-family: inherit; font-size: 14px;
    letter-spacing: 0.08em; text-transform: uppercase;
    transition: opacity 0.15s;
  }
  .btn-action:hover { opacity: 0.85; }
</style></head><body>

<div class="page-header">
  <span class="page-header-title">Palette Menu</span>
  <button class="btn-action" id="btnOpenFolder" title="Open .vscode/swatches folder"><span class="codicon codicon-folder-opened"></span></button>
</div>

<div class="sub-toolbar">
  <button class="btn-action" id="btnNew"><span class="codicon codicon-add"></span> New</button>
  <button class="btn-action" id="btnImport"><span class="codicon codicon-arrow-down"></span> Import</button>
  <button class="btn-action" id="btnRefresh"><span class="codicon codicon-refresh"></span> Refresh</button>
</div>

<div class="section-label">Palette Selection:</div>

<div class="palette-list">
  <div class="palette-row create" id="createRow">
    <span>Create New Palette</span>
    <span class="palette-arrow codicon codicon-arrow-circle-right"></span>
  </div>
  ${paletteRows}
</div>

${untrusted ? `<div class="warning-notice">Untrusted workspace — custom palette folder and font settings are disabled.</div>` : ''}
<div class="warning-notice">
  Remember to export your palettes before closing VS Code or your changes will be lost.
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('btnNew').addEventListener('click', () => vscode.postMessage({ type: 'newPalette' }));
document.getElementById('btnImport').addEventListener('click', () => vscode.postMessage({ type: 'openFile' }));
document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ type: 'showPaletteList' }));
document.getElementById('btnOpenFolder').addEventListener('click', () => vscode.postMessage({ type: 'openWatchFolder' }));
document.getElementById('createRow').addEventListener('click', () => vscode.postMessage({ type: 'newPalette' }));
document.querySelectorAll('.palette-row[data-path]').forEach(row => {
  row.addEventListener('click', () => vscode.postMessage({ type: 'loadPalette', filePath: row.dataset.path }));
});
</script>
</body></html>`;
}

function parseJsonPalette(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON palette file");
  }

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.colors) ? parsed.colors : null;
  if (!list) throw new Error("JSON palette must be an array or include a colors array");

  return list.map((item, i) => normalizeImportedColor(item, i));
}

function parseCssPalette(text) {
  const colors = [];
  const varRe = /--color-([A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varRe.exec(text)) !== null) {
    const slug = match[1];
    const value = match[2].trim();
    const parsed = parseColorValue(value);
    if (!parsed) continue;
    colors.push({
      name: slug.replace(/[-_]+/g, " "),
      rgb: { r: parsed.r, g: parsed.g, b: parsed.b },
      alpha: parsed.a,
    });
  }

  if (!colors.length) throw new Error("No CSS variables matching --color-* were found");
  return colors;
}

function parseTailwindPalette(text) {
  const colors = [];
  const entryRe = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
  let match;
  while ((match = entryRe.exec(text)) !== null) {
    const key = match[1];
    const value = match[2].trim();
    const parsed = parseColorValue(value);
    if (!parsed) continue;
    colors.push({
      name: key.replace(/[-_]+/g, " "),
      rgb: { r: parsed.r, g: parsed.g, b: parsed.b },
      alpha: parsed.a,
    });
  }

  if (!colors.length) throw new Error("No Tailwind color entries were found");
  return colors;
}

function normalizeImportedColor(item, index) {
  if (!item || typeof item !== "object") {
    throw new Error(`JSON entry ${index + 1} must be an object`);
  }

  const name = (typeof item.name === "string" && item.name.trim()) ? item.name.trim() : `Color ${index + 1}`;
  const group = (typeof item.group === "string" && item.group.trim()) ? item.group.trim() : null;
  const source =
    (typeof item.rgba === "string" && item.rgba.trim()) ? item.rgba.trim() :
    (typeof item.hex === "string" && item.hex.trim()) ? item.hex.trim() :
    (typeof item.rgb === "string" && item.rgb.trim()) ? item.rgb.trim() :
    (typeof item.hsl === "string" && item.hsl.trim()) ? item.hsl.trim() : null;

  if (!source) {
    throw new Error(`JSON entry ${index + 1} is missing a color value (rgba/hex/rgb/hsl)`);
  }

  const parsed = parseColorValue(source);
  if (!parsed) {
    throw new Error(`JSON entry ${index + 1} has unsupported color value: ${source}`);
  }

  return {
    name,
    group,
    rgb: { r: parsed.r, g: parsed.g, b: parsed.b },
    alpha: parsed.a,
  };
}

function parseColorValue(value) {
  const v = String(value).trim();

  const hex = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: 1,
      };
    }
    if (h.length === 4) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: parseInt(h[3] + h[3], 16) / 255,
      };
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }

  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map(p => p.trim());
    if (parts.length < 3) return null;
    const r = toChannel(parts[0]);
    const g = toChannel(parts[1]);
    const b = toChannel(parts[2]);
    if (r === null || g === null || b === null) return null;
    const a = parts.length >= 4 ? toAlpha(parts[3]) : 1;
    if (a === null) return null;
    return { r, g, b, a };
  }

  const hsl = v.match(/^hsla?\(([^)]+)\)$/i);
  if (hsl) {
    const parts = hsl[1].split(",").map(p => p.trim());
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]);
    const s = parsePercent(parts[1]);
    const l = parsePercent(parts[2]);
    if (Number.isNaN(h) || s === null || l === null) return null;
    const rgbFromHsl = hslToRgb(h, s, l);
    const a = parts.length >= 4 ? toAlpha(parts[3]) : 1;
    if (a === null) return null;
    return { ...rgbFromHsl, a };
  }

  return null;
}

function toChannel(input) {
  if (/%$/.test(input)) {
    const pct = parseFloat(input);
    if (Number.isNaN(pct)) return null;
    return clamp(Math.round((pct / 100) * 255), 0, 255);
  }
  const n = parseFloat(input);
  if (Number.isNaN(n)) return null;
  return clamp(Math.round(n), 0, 255);
}

function parsePercent(input) {
  const m = String(input).match(/^(-?\d*\.?\d+)%$/);
  if (!m) return null;
  return clamp(parseFloat(m[1]), 0, 100);
}

function toAlpha(input) {
  const n = parseFloat(input);
  if (Number.isNaN(n)) return null;
  return Math.round(clamp(n, 0, 1) * 1000) / 1000;
}

function hslToRgb(h, sPct, lPct) {
  const hNorm = ((h % 360) + 360) % 360;
  const s = sPct / 100;
  const l = lPct / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hNorm / 60) % 2 - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;

  if (hNorm < 60) { rp = c; gp = x; }
  else if (hNorm < 120) { rp = x; gp = c; }
  else if (hNorm < 180) { gp = c; bp = x; }
  else if (hNorm < 240) { gp = x; bp = c; }
  else if (hNorm < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }

  return {
    r: clamp(Math.round((rp + m) * 255), 0, 255),
    g: clamp(Math.round((gp + m) * 255), 0, 255),
    b: clamp(Math.round((bp + m) * 255), 0, 255),
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// activate / deactivate
// ─────────────────────────────────────────────────────────────────────────────

function activate(context) {
  // Sidebar panel
  const sidebar = new SwatchSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SwatchSidebarProvider.viewType, sidebar)
  );

  // Watch folder setup
  const config = vscode.workspace.getConfiguration('acoViewer');
  let watchFolder = config.get('paletteFolder', '');
  if (!watchFolder) {
    watchFolder = path.join(os.homedir(), '.vscode', 'swatches');
  }
  if (!fs.existsSync(watchFolder)) fs.mkdirSync(watchFolder, { recursive: true });
  sidebar._watchFolder = watchFolder;

  // File system watcher — refresh palette list when files change
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(watchFolder, '**/*')
  );
  const refreshList = () => {
    sidebar._paletteList = sidebar._scanPalettes();
    if (sidebar._view && !sidebar._colors.length) {
      sidebar._view.webview.html = getPaletteSelectionHtml(getNonce(), sidebar._paletteList, sidebar._codiconUri, sidebar._cspSource, sidebar._getFontFamily(), sidebar._isUntrusted());
    }
  };
  watcher.onDidCreate(refreshList);
  watcher.onDidDelete(refreshList);
  watcher.onDidChange(refreshList);
  context.subscriptions.push(watcher);

  // "Open file" command — shown as folder icon in sidebar toolbar
  context.subscriptions.push(
    vscode.commands.registerCommand("acoViewer.openFile", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "Palette files": ["aco", "ase", "json", "css", "js", "cjs", "mjs", "ts"] },
        title: "Open palette file"
      });
      if (uris && uris[0]) {
        sidebar.loadFile(uris[0]);
        // Reveal the sidebar view to ensure it's visible and focused
        await vscode.commands.executeCommand('acoViewer.sidebarView.focus');
      }
    })
  );
}

function deactivate() {}

// ─────────────────────────────────────────────────────────────────────────────
// Shared export logic
// ─────────────────────────────────────────────────────────────────────────────

async function _doExport(format, colors, uri, watchFolder, setUri) {
  const ALLOWED_FORMATS = ['json', 'css', 'tailwind', 'aco', 'ase'];
  if (!ALLOWED_FORMATS.includes(format)) return;
  if (!colors.length) return;
  const baseDir = uri ? path.dirname(uri.fsPath) : (watchFolder || os.homedir());
  let content = "", defaultName = "";
  if (format === "json") {
    content = JSON.stringify(
      colors.map(({ name, hex, rgb, rgba, hsl, group }) => {
        const entry = { name, hex, rgb, hsl, ...(group ? { group } : {}) };
        if (rgba && !rgba.endsWith(', 1)') && !rgba.endsWith(',1)')) entry.rgba = rgba;
        return entry;
      }),
      null, 2
    );
    defaultName = "palette.json";
  } else if (format === "css") {
    const vars = colors.map(c => {
      const val = (c.rgba && !c.rgba.endsWith(', 1)') && !c.rgba.endsWith(',1)')) ? c.rgba : c.hex;
      return `  --color-${c.slug || slugify(c.name)}: ${val};`;
    }).join("\n");
    content = `:root {\n${vars}\n}\n`;
    defaultName = "palette.css";
  } else if (format === "tailwind") {
    const entries = colors.map(c => {
      const val = (c.rgba && !c.rgba.endsWith(', 1)') && !c.rgba.endsWith(',1)')) ? c.rgba : c.hex;
      return `    '${c.slug || slugify(c.name)}': '${val}',`;
    }).join("\n");
    content = `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${entries}\n      },\n    },\n  },\n};\n`;
    defaultName = "tailwind.palette.js";
  } else if (format === "aco" || format === "ase") {
    // Binary export — write buffer directly
    const enriched = colors.map(c => ({
      name: c.name,
      rawRgb: c.rawRgb || { r: parseInt(c.hex.slice(1,3),16), g: parseInt(c.hex.slice(3,5),16), b: parseInt(c.hex.slice(5,7),16) },
    }));
    const buf = format === "aco" ? writeACO(enriched) : writeASE(enriched);
    defaultName = `palette.${format}`;
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(baseDir, defaultName)),
      filters: format === "aco"
        ? { 'Adobe Color': ['aco'], 'All Files': ['*'] }
        : { 'Adobe Swatch Exchange': ['ase'], 'All Files': ['*'] },
      title: format === "aco" ? 'Save ACO Palette' : 'Save ASE Palette',
    });
    if (saveUri) {
      fs.writeFileSync(saveUri.fsPath, buf);
      if (!uri && setUri) setUri(saveUri);
      vscode.window.showInformationMessage(`Exported to ${path.basename(saveUri.fsPath)}`);
    }
    return;
  }
  const filters = format === 'json'
    ? { 'JSON': ['json'], 'All Files': ['*'] }
    : format === 'css'
    ? { 'CSS': ['css'], 'All Files': ['*'] }
    : { 'JavaScript': ['js'], 'All Files': ['*'] };
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(baseDir, defaultName)),
    filters,
  });
  if (saveUri) {
    fs.writeFileSync(saveUri.fsPath, content, "utf8");
    if (!uri && setUri) setUri(saveUri);
    const doc = await vscode.workspace.openTextDocument(saveUri);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Exported to ${path.basename(saveUri.fsPath)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function escHtmlHost(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Webview HTML
// ─────────────────────────────────────────────────────────────────────────────

function getWebviewContent(nonce, colors, format, error, palettes = [], codiconUri = null, cspSource = '', fileName = null, fontFamily = '', untrusted = false) {
  const colorData = JSON.stringify(colors);
  const pickrJs  = fs.readFileSync(path.join(__dirname, '..', 'media', 'pickr.min.js'), 'utf8');
  const pickrCss = fs.readFileSync(path.join(__dirname, '..', 'media', 'classic.min.css'), 'utf8');
  const errorHtml = error
    ? `<div class="error-banner"><strong>Parse error:</strong> ${escHtmlHost(error)}</div>`
    : "";
  const paletteOptions = palettes.map(p => {
    const safeName = p.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const safePath = p.filePath.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return `<option value="${safePath}">${safeName} (${p.format})</option>`;
  }).join('');
  const hasPalettes = palettes.length > 0;

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; style-src 'nonce-${nonce}' ${cspSource || ''}; font-src ${cspSource || 'none'}; script-src 'nonce-${nonce}'; img-src data:;">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
${codiconUri ? `<link rel="stylesheet" href="${codiconUri}" nonce="${nonce}">` : ''}
<title>Swatch Viewer</title>
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html {
    font-family: ${fontFamily || 'var(--vscode-font-family, sans-serif)'};
    font-size: var(--vscode-font-size, 13px);
    font-weight: var(--vscode-font-weight, normal);
  }
  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    padding: 10px;
  }

  /* ── Header ── */
  .header {
    margin-bottom: 10px;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
  }
  /* Top bar — back | Palette Menu | Save to Swatches | folder btn */
  .header-top {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 10px;
    margin: -10px -10px 0 -10px;
    background: color-mix(in srgb, var(--vscode-editor-background) 70%, black 30%);
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    min-height: 34px;
  }
  .header-top-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
    color: var(--vscode-descriptionForeground);
    flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .btn-back {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-icon-foreground); font-size: 16px; padding: 2px;
    display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;
  }
  .btn-back:hover { color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); }
  /* Prominent primary save button */
  .btn-save-primary {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--vscode-button-background);
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-foreground);
    padding: 4px 10px; border-radius: 2px; cursor: pointer;
    font-family: inherit; font-size: 11px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase;
    transition: background 0.15s; flex-shrink: 0;
  }
  .btn-save-primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); opacity: 0.9; }
  /* Folder icon — same style as import/export buttons */
  .btn-folder {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    padding: 4px 8px; border-radius: 2px; cursor: pointer;
    font-size: 15px; transition: opacity 0.15s; flex-shrink: 0;
  }
  .btn-folder:hover { opacity: 0.85; }

  /* Meta info strip — EXT • filename • count • unsaved */
  .header-meta {
    display: flex; align-items: center;
    padding: 5px 0 2px;
    font-size: 11px; color: var(--vscode-descriptionForeground);
    flex-wrap: wrap; row-gap: 2px;
  }
  .header-meta .fmt-badge {
    display: inline-block; padding: 1px 5px;
    border: 1px solid var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); border-radius: 2px;
    font-size: 10px; color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4));
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    margin-right: 6px; flex-shrink: 0;
  }
  .header-meta .sep { margin: 0 5px; opacity: 0.4; }
  .header-meta .meta-filename {
    max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .header-meta .meta-count { flex-shrink: 0; }
  .header-meta .meta-unsaved {
    color: var(--vscode-inputValidation-warningBorder, #e0a000);
    font-weight: 600; flex-shrink: 0; display: none;
  }
  .header-meta .meta-unsaved.visible { display: inline; }

  /* Controls below meta — import/export row + switcher+search row */
  .header-controls { padding: 5px 0 4px; display: flex; flex-direction: column; gap: 5px; }
  .controls-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

  /* ── Export — select styled like old version (visible dropdown arrow, native look) ── */
  .exports { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .exports select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-button-border, transparent));
    padding: 4px 24px 4px 8px;
    border-radius: 2px; font-size: 14px; font-family: inherit;
    appearance: auto; -webkit-appearance: auto;
    cursor: pointer;
  }
  .exports select:focus { border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); outline: none; }

  /* ── Palette switcher ── */
  .palette-switcher { flex: 1; min-width: 0; }
  .palette-switcher select {
    width: 100%;
    background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent);
    padding: 4px 8px; border-radius: 2px; font-size: 13px; font-family: inherit;
    outline: none; cursor: pointer;
  }
  .palette-switcher select:focus { border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); }

  /* Search inline with switcher */
  .search-inline {
    flex: 1; min-width: 80px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    color: var(--vscode-input-foreground);
    padding: 4px 8px; border-radius: 2px; font-family: inherit; font-size: 13px;
  }
  .search-inline:focus { border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); outline: none; }
  .search-inline::placeholder { color: var(--vscode-input-placeholderForeground); }

  .btn {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    padding: 4px 10px;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }

  /* ── Group label ── */
  .group-label {
    grid-column: 1 / -1;
    font-size: 12px;
    text-transform: uppercase;
    color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)));
    padding: 4px 0 2px;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    margin-bottom: 4px;
  }

  /* ── Grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 7px;
    align-items: start;
  }

  /* ── Card ── */
  .card {
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    border-radius: 5px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s;
    position: relative;
  }
  .card:hover  { border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); }
  .card.copied { border-color: var(--vscode-gitDecoration-addedResourceForeground) !important; }
  .card.drag-over { outline: 2px dashed var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); outline-offset: -2px; }

  /* Swatch with checkerboard underlay */
  .swatch {
    width: 100%; height: 90px;
    position: relative;
  }
  .swatch::before {
    content: '';
    position: absolute; inset: 0;
    background-image:
      linear-gradient(45deg,#2a2a2a 25%,transparent 25%),
      linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),
      linear-gradient(45deg,transparent 75%,#2a2a2a 75%),
      linear-gradient(-45deg,transparent 75%,#2a2a2a 75%);
    background-size: 10px 10px;
    background-position: 0 0,0 5px,5px -5px,-5px 0;
  }
  .swatch-color { position: absolute; inset: 0; z-index: 1; background: transparent; }

  /* delete button — shown on card hover */
  .btn-delete {
    position: absolute; top: 3px; right: 3px; z-index: 2;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--vscode-errorForeground);
    color: #fff; border: none; cursor: pointer;
    font-size: 15px; line-height: 15px; text-align: center;
    display: none; padding: 0;
  }
  .card:hover .btn-delete { display: block; }
  .btn-delete:hover { opacity: 0.75; }

  /* Spot color indicator */
  .spot-dot {
    position: absolute; top: 6px; right: 6px;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: rgba(255,255,255,0.9);
    border: 1px solid rgba(0,0,0,0.3);
    z-index: 2;
  }

  /* ── Card info — slightly darker bg ── */
  .card-info {
    padding: 6px 8px;
    background: color-mix(in srgb, var(--vscode-editor-background) 60%, black 40%);
    overflow: hidden;
  }

  .color-name {
    font-size: 15px; font-weight: 600;
    color: var(--vscode-editor-foreground);
    margin-bottom: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: text; border-radius: 1px; padding: 0 1px;
  }
  .color-name:hover { background: var(--vscode-input-background); }
  .color-name[contenteditable="true"] {
    background: var(--vscode-input-background);
    outline: 1px solid var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4));
    white-space: nowrap;
    overflow-x: auto;
    text-overflow: clip;
    scrollbar-width: none;
  }
  .color-name[contenteditable="true"]::-webkit-scrollbar { display: none; }

  .hex-val {
    font-size: 14px;
  }

  /* ── Format rows ── */
  .formats { display: flex; flex-direction: column; gap: 2px; }

  .fmt-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 2px 4px;
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.1s;
    gap: 4px;
  }
  .fmt-row:hover { background: var(--vscode-list-hoverBackground); }
  .fmt-row:hover .fmt-label { color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)); }

  .fmt-label {
    font-size: 12px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0; width: 56px;
  }

  .fmt-value {
    font-size: 14px; color: var(--vscode-editor-foreground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    text-align: right; flex: 1;
    min-width: 0;
    font-family: inherit;
  }

  .fmt-row.filter .fmt-value {
    font-size: 10px;
  }



  /* ── Add card (inline in grid) ── */
  .card-add {
    border: 1px dashed var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    min-height: 90px;
    padding: 8px 4px;
    transition: border-color 0.15s, background 0.15s;
    background: transparent;
  }
  .card-add:hover {
    border-color: var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4));
    background: var(--vscode-list-hoverBackground);
  }
  .btn-add-inline {
    width: 24px; height: 24px;
    border-radius: 50%;
    background: var(--vscode-gitDecoration-addedResourceForeground);
    color: var(--vscode-button-foreground);
    border: none; cursor: pointer;
    font-size: 18px; line-height: 23px; text-align: center; padding: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-add-inline:hover { background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 60%, transparent 40%) !important; }

  /* ── Toast ── */
.toast {
  position: fixed; bottom: 20px; left: 50%;
  transform: translateX(-50%) translateY(10px);
  background: var(--vscode-notificationCenterHeader-background, var(--vscode-editor-background)) !important;
  color: var(--vscode-notificationCenterHeader-foreground, var(--vscode-editor-foreground)) !important;
  border: 1px solid var(--vscode-panel-border, var(--vscode-activityBarBadge-background, rgba(128,128,128,0.4)));
  padding: 5px 14px; border-radius: 2px;
  font-size: 15px; font-weight: 600; letter-spacing: 0.08em;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 100;
}
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  /* ── Dirty notice ── */
  .dirty-notice {
    display: none; margin-top: 6px; padding: 5px 8px;
    background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,0.1));
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,200,0,0.4));
    border-radius: 2px; font-size: 14px;
    color: var(--vscode-editor-foreground); line-height: 1.5;
  }
  .dirty-notice.visible { display: block; }

  /* ── Error banner ── */
  .error-banner {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-errorForeground);
    padding: 8px 10px; border-radius: 2px;
    font-size: 13px; margin-bottom: 10px; line-height: 1.5;
  }
  .warning-banner {
    background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,0.1));
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,200,0,0.4));
    color: var(--vscode-editor-foreground);
    padding: 8px 10px; border-radius: 2px;
    font-size: 12px; margin-bottom: 10px; line-height: 1.5;
  }

  /* ── Empty / no-results ── */
  .empty, .no-results {
    grid-column: 1/-1; text-align: center;
    padding: 40px 20px; color: var(--vscode-descriptionForeground);
    font-size: 15px; letter-spacing: 0.1em; line-height: 2;
  }
</style>
<style nonce="${nonce}">${pickrCss}</style>
<style nonce="${nonce}">
  /* Pickr overrides for VS Code sidebar */
  #pickrAnchor { width: 1px; height: 1px; opacity: 0; pointer-events: none; margin-top: 8px; }
  .pcr-app { position: fixed !important; z-index: 10000 !important; }
  .pcr-button { display: none !important; }
  .pickr { display: none !important; }
  .pcr-app[data-theme=classic] { background: var(--vscode-editor-background) !important; border: 1px solid var(--vscode-activityBarBadge-background, var(--vscode-button-background, #0078d4)) !important; border-radius: 4px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important; }
  .pcr-app[data-theme=classic] .pcr-interaction input { background: var(--vscode-input-background) !important; color: var(--vscode-input-foreground) !important; border: 1px solid var(--vscode-input-border, transparent) !important; border-radius: 2px !important; font-family: inherit !important; }
  .pcr-app[data-theme=classic] .pcr-interaction .pcr-save { background: var(--vscode-button-background) !important; color: var(--vscode-button-foreground) !important; border-radius: 2px !important; }
  .pcr-app[data-theme=classic] .pcr-interaction .pcr-save:hover { background: var(--vscode-button-hoverBackground) !important; }
  .pcr-app[data-theme=classic] .pcr-interaction .pcr-cancel { background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2)) !important; color: var(--vscode-button-secondaryForeground, var(--vscode-descriptionForeground)) !important; border-radius: 2px !important; }
  .pcr-app[data-theme=classic] .pcr-interaction .pcr-cancel:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)) !important; }
  .pcr-app[data-theme=classic] .pcr-interaction .pcr-clear { background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2)) !important; color: var(--vscode-errorForeground) !important; border-radius: 2px !important; }
</style>
</head>
<body>

<div class="header">
  <!-- Top bar: ← back | Palette Menu | Save to Swatches (primary) | folder btn -->
  <div class="header-top">
    <button class="btn-back" id="btnBack" title="Back to palette list"><span class="codicon codicon-arrow-circle-left"></span></button>
    <span class="header-top-title">Palette Menu</span>
    <button class="btn-save-primary" id="btnSave"><span class="codicon codicon-save"></span> Save to Swatches</button>
    <button class="btn-folder" id="btnOpenFolder" title="Open .vscode/swatches folder"><span class="codicon codicon-folder-opened"></span></button>
  </div>

  <!-- Meta strip: [EXT] • filename • count • unsaved -->
  <div class="header-meta">
    <span class="fmt-badge">${format}</span>
    <span class="meta-filename" id="metaFilename"></span>
    <span class="sep">•</span>
    <span class="meta-count" id="metaCount"></span>
    <span class="meta-unsaved" id="metaUnsaved"><span class="sep">•</span> UNSAVED CHANGES</span>
  </div>

  <!-- Controls: row1 = import | export as: | format select; row2 = switcher + search -->
  <div class="header-controls">
    <div class="controls-row">
      <button class="btn" id="btnImport"><span class="codicon codicon-arrow-down"></span> Import</button>
      <button class="btn" id="btnExport"><span class="codicon codicon-arrow-up"></span> Export as:</button>
      <div class="exports">
        <select id="exportFormat">
          <option value="json">JSON</option>
          <option value="css">CSS</option>
          <option value="tailwind">Tailwind</option>
          <option value="aco">ACO</option>
          <option value="ase">ASE</option>
        </select>
      </div>
    </div>
    <div class="controls-row">
      ${hasPalettes ? `<div class="palette-switcher">
        <select id="paletteSwitcher">
          <option value="">— Switch palette —</option>
          ${paletteOptions}
        </select>
      </div>` : ''}
      <input class="search-inline" type="text" id="searchInput" placeholder="Search by name or value…">
    </div>
  </div>
</div>

${untrusted ? `<div class="warning-banner">Untrusted workspace — custom palette folder and font settings are disabled.</div>` : ''}
${errorHtml}

<div class="grid" id="grid"></div>

<div id="dirtyNotice" class="dirty-notice">
  Unsaved changes — export to keep, or they'll be lost when closed.
</div>

<div id="pickrAnchor"></div>

<div class="toast" id="toast"></div>

<script nonce="${nonce}">${pickrJs}</script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let colors = ${colorData};
const paletteFileName = ${fileName ? JSON.stringify(fileName) : 'null'};
let dirty  = false;
let dragSrcIndex = null;
let pickrInstance = null;
let cursorX = 0;
let cursorY = 0;

// ── Init ───────────────────────────────────────────────────────────────────
try {
  if (paletteFileName) {
    const el = document.getElementById('metaFilename');
    if (el) { el.textContent = paletteFileName; el.title = paletteFileName; }
  }
  updateCount();
  renderGrid(colors);
  wireStaticEvents();
} catch(err) {
  const d = document.createElement('div');
  d.textContent = 'Init error: ' + err.message;
  d.style.color = 'var(--vscode-errorForeground)';
  d.style.padding = '8px';
  d.style.fontWeight = 'bold';
  document.body.prepend(d);
}

function updateCount() {
  const total = colors.length;
  const text = total === 0 ? 'No colors' : \`\${total} color\${total !== 1 ? 's' : ''}\`;
  const mc = document.getElementById('metaCount');
  if (mc) mc.textContent = text;
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderGrid(list) {
  const grid = document.getElementById('grid');

  if (colors.length === 0) {
    // Empty palette — still show the add card so user can add colors
    grid.innerHTML = \`<div class="card-add" id="cardAdd" title="Add new color">
      <div class="btn-add-inline">+</div>
    </div>\`;
    document.getElementById('cardAdd').addEventListener('click', function(e) {
      e.stopPropagation();
      if (pickrInstance) pickrInstance.show();
    });
    return;
  }
  if (list.length === 0) {
    grid.innerHTML = '<div class="no-results">No colors match your search.</div>';
    return;
  }

  const hasGroups = list.some(c => c.group);
  let html = '';

  if (hasGroups) {
    const groups = {};
    const ungrouped = [];
    list.forEach(c => {
      if (c.group) {
        (groups[c.group] = groups[c.group] || []).push(c);
      } else {
        ungrouped.push(c);
      }
    });
    Object.entries(groups).forEach(([groupName, groupColors]) => {
      html += \`<div class="group-label">\${escHtml(groupName)}</div>\`;
      html += groupColors.map(cardHtml).join('');
    });
    if (ungrouped.length) html += ungrouped.map(cardHtml).join('');
  } else {
    if (paletteFileName) {
      html += \`<div class="group-label">\${escHtml(paletteFileName)}</div>\`;
    }
    html += list.map(cardHtml).join('');
  }

  // Inline add card at the end of the grid
  html += \`<div class="card-add" id="cardAdd" title="Add new color">
    <div class="btn-add-inline">+</div>
  </div>\`;

  grid.innerHTML = html;

  // Apply background colors via JS (CSP-safe)
  list.forEach(c => {
    const el = document.querySelector(\`[data-index="\${c.index}"] .swatch-color\`);
    if (el) el.style.backgroundColor = c.rgba || c.hex;
  });

  wireCardEvents();

  // Wire inline add card
  document.getElementById('cardAdd').addEventListener('click', function(e) {
    e.stopPropagation();
    if (pickrInstance) pickrInstance.show();
  });
}

function cardHtml(c) {
  const hasAlpha   = c.rgba && !/,\\s*1\\)$/.test(c.rgba);
  const safeFilter = escHtml(c.cssFilter);
  const safeName   = escHtml(c.name);
  const safeHex    = escHtml(c.hex);
  const safeRgb    = escHtml(c.rgb);
  const safeHsl    = escHtml(c.hsl);
  const safeRgba   = escHtml(c.rgba || '');
  const safeHexa   = escHtml(c.hexa || '');
  const safeHsla   = escHtml(c.hsla || '');

  // For transparent swatches replace HEX/RGB/HSL with HEXA/RGBA/HSLA
  const colorRows = hasAlpha ? \`
          <div class="fmt-row" data-copy="\${safeHexa || safeHex}">
            <span class="fmt-label">HEXA</span>
            <span class="fmt-value">\${safeHexa || safeHex}</span>
          </div>
          <div class="fmt-row" data-copy="\${safeRgba}">
            <span class="fmt-label">RGBA</span>
            <span class="fmt-value">\${safeRgba}</span>
          </div>
          <div class="fmt-row" data-copy="\${safeHsla || safeHsl}">
            <span class="fmt-label">HSLA</span>
            <span class="fmt-value">\${safeHsla || safeHsl}</span>
          </div>\` : \`
          <div class="fmt-row" data-copy="\${safeHex}">
            <span class="fmt-label">HEX</span>
            <span class="fmt-value">\${safeHex}</span>
          </div>
          <div class="fmt-row" data-copy="\${safeRgb}">
            <span class="fmt-label">RGB</span>
            <span class="fmt-value">\${safeRgb}</span>
          </div>
          <div class="fmt-row" data-copy="\${safeHsl}">
            <span class="fmt-label">HSL</span>
            <span class="fmt-value">\${safeHsl}</span>
          </div>\`;

  const spotDot = c.colorType === 1 ? '<div class="spot-dot" title="Spot color"></div>' : '';
  return \`
    <div class="card" draggable="true" data-index="\${c.index}" data-hex="\${hasAlpha ? safeRgba : safeHex}" data-filter="\${safeFilter}">
      <div class="swatch">
        <div class="swatch-color"></div>
        \${spotDot}
        <button class="btn-delete" data-index="\${c.index}" title="Remove">×</button>
      </div>
      <div class="card-info">
        <div class="color-name" data-index="\${c.index}" title="Click to rename">\${safeName}</div>
        <div class="hex-val">\${hasAlpha ? (safeHexa || safeRgba) : safeHex}</div>
        <div class="formats">
          \${colorRows}
          <div class="fmt-row filter" data-copy-filter="true">
            <span class="fmt-label">FILTER</span>
            <span class="fmt-value" title="\${safeFilter}">\${safeFilter}</span>
          </div>
        </div>
      </div>
    </div>
  \`;
}

// ── Wire card events (re-run after each render) ────────────────────────────
function wireCardEvents() {
  // Delete buttons
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.index);
      colors = colors.filter(c => c.index !== idx);
      markDirty();
      updateCount();
      applyFilter();
    });
  });

  // Rename on name click
  document.querySelectorAll('.color-name').forEach(el => {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      if (this.contentEditable === 'true') return;
      this.contentEditable = 'true';
      this.focus();
      const range = document.createRange();
      range.selectNodeContents(this);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    el.addEventListener('blur', function() {
      this.contentEditable = 'false';
      const idx = parseInt(this.dataset.index);
      const newName = this.textContent.trim() || 'Color';
      const color = colors.find(c => c.index === idx);
      if (color && color.name !== newName) {
        color.name = newName;
        markDirty();
      }
      this.textContent = color ? color.name : newName;
    });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
      if (e.key === 'Escape') {
        const color = colors.find(c => c.index === parseInt(this.dataset.index));
        this.textContent = color ? color.name : '';
        this.blur();
      }
    });
  });

  // Drag to reorder
  document.querySelectorAll('.card[draggable]').forEach(card => {
    card.addEventListener('dragstart', function() {
      dragSrcIndex = parseInt(this.dataset.index);
    });
    card.addEventListener('dragover', function(e) {
      e.preventDefault();
      this.classList.add('drag-over');
    });
    card.addEventListener('dragleave', function() {
      this.classList.remove('drag-over');
    });
    card.addEventListener('drop', function(e) {
      e.preventDefault();
      this.classList.remove('drag-over');
      const targetIndex = parseInt(this.dataset.index);
      if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
      const srcPos = colors.findIndex(c => c.index === dragSrcIndex);
      const tgtPos = colors.findIndex(c => c.index === targetIndex);
      if (srcPos === -1 || tgtPos === -1) return;
      const tmp = colors[srcPos];
      colors[srcPos] = colors[tgtPos];
      colors[tgtPos] = tmp;
      dragSrcIndex = null;
      markDirty();
      applyFilter();
    });
  });
}

// ── Static events (wire once) ──────────────────────────────────────────────
function wireStaticEvents() {
  document.getElementById('searchInput').addEventListener('input', applyFilter);

  // Back button — return to palette list
  document.getElementById('btnBack').addEventListener('click', () => {
    vscode.postMessage({ type: 'showPaletteList' });
  });

  // Palette switcher — load selected palette
  const switcher = document.getElementById('paletteSwitcher');
  if (switcher) {
    switcher.addEventListener('change', () => {
      const filePath = switcher.value;
      if (filePath) vscode.postMessage({ type: 'loadPalette', filePath });
    });
  }

  // Import button — open file picker
  document.getElementById('btnImport').addEventListener('click', () => {
    vscode.postMessage({ type: 'openFile' });
  });

  // Folder shortcut — open .vscode/swatches in OS explorer
  document.getElementById('btnOpenFolder').addEventListener('click', () => {
    vscode.postMessage({ type: 'openWatchFolder' });
  });

  // Save button — save to palettes folder
  document.getElementById('btnSave').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveToPalettes', colors, paletteName: null });
  });

  // Export — send current in-memory colors so edits are included
  document.getElementById('btnExport').addEventListener('click', () => {
    const fmt = document.getElementById('exportFormat').value;
    vscode.postMessage({ type: 'export', format: fmt, colors });
  });

  // Grid click delegation
  document.getElementById('grid').addEventListener('click', function(e) {
    const fmtRow = e.target.closest('[data-copy]');
    if (fmtRow) {
      e.stopPropagation();
      copy(fmtRow.dataset.copy);
      return;
    }
    const filterRow = e.target.closest('[data-copy-filter]');
    if (filterRow) {
      e.stopPropagation();
      const card = filterRow.closest('.card');
      if (card) copy(card.dataset.filter);
      return;
    }
    const card = e.target.closest('.card');
    if (card && !e.target.closest('.color-name') && !e.target.closest('.btn-delete')) {
      copy(card.dataset.hex);
      card.classList.add('copied');
      setTimeout(() => card.classList.remove('copied'), 800);
    }
  });

  // Track cursor position for picker placement
  document.addEventListener('mousemove', (e) => { cursorX = e.clientX; cursorY = e.clientY; });

  // Pickr color picker — inline add card opens it, save adds color
  pickrInstance = Pickr.create({
    el: '#pickrAnchor',
    theme: 'classic',
    default: '#FF0000',
    useAsButton: false,
    position: 'bottom-start',
    lockOpacity: false,
    swatches: [],
    components: {
      preview: true,
      opacity: true,
      hue: true,
      interaction: {
        hex: true,
        rgba: true,
        hsla: true,
        input: true,
        clear: true,
        save: true,
        cancel: true
      }
    }
  });

pickrInstance.on('show', () => {
  const app = document.querySelector('.pcr-app');
  if (!app) return;
  const h = app.offsetHeight || 300;
  const vh = window.innerHeight;
  let y = cursorY + 8;
  if (y + h > vh) y = cursorY - h - 8;
  if (y < 0) y = 8;
  app.style.left      = '50%';
  app.style.transform = 'translateX(-50%)';
  app.style.top       = y + 'px';
  app.style.bottom    = 'auto';
});

  pickrInstance.on('save', (color) => {
    if (!color) return;
    // Extract via toRGBA immediately — toHEXA can return stale value on repeat saves
    const rgba = color.toRGBA();
    const r = Math.round(rgba[0]);
    const g = Math.round(rgba[1]);
    const b = Math.round(rgba[2]);
    const a = Math.round((rgba[3] ?? 1) * 100) / 100;
    const hex = '#' + [r, g, b]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('').toUpperCase();
    pickrInstance.hide();
    // Defer re-render until after Pickr fully resets its internal state
    setTimeout(() => addColorFromHex(hex, r, g, b, a), 0);
  });

  pickrInstance.on('cancel', () => pickrInstance.hide());

}

// ── Add color ──────────────────────────────────────────────────────────────
function addColorFromHex(hex, rIn, gIn, bIn, aIn) {
  const newIndex = colors.length ? Math.max(...colors.map(c => c.index)) + 1 : 0;
  const r = rIn !== undefined ? rIn : parseInt(hex.slice(1,3), 16);
  const g = gIn !== undefined ? gIn : parseInt(hex.slice(3,5), 16);
  const b = bIn !== undefined ? bIn : parseInt(hex.slice(5,7), 16);
  const a = aIn !== undefined ? aIn : 1;
  const rgb  = \`rgb(\${r}, \${g}, \${b})\`;
  const rgba = \`rgba(\${r}, \${g}, \${b}, \${a})\`;
  const hsl  = rgbToHslStr(r, g, b);
  const hsla = a < 1 ? rgbToHslaStr(r, g, b, a) : null;
  const hexa = a < 1 ? toHexa(r, g, b, a) : null;
  const cssFilter = buildCssFilter(r, g, b, a);
  const name = hex;

  colors.push({
    index: newIndex, name, hex, rgb, rgba, hsl, hsla, hexa, cssFilter,
    rawRgb: { r, g, b },
    slug: hex.slice(1).toLowerCase(),
    group: null, colorType: null
  });

  markDirty();
  updateCount();
  applyFilter();
  // After render, auto-focus the new card's name for immediate renaming
  setTimeout(() => {
    const nameEl = document.querySelector(\`[data-index="\${newIndex}"] .color-name\`);
    if (nameEl) nameEl.click();
  }, 50);
}

function rgbToHslStr(r, g, b) {
  const rn=r/255, gn=g/255, bn=b/255;
  const max=Math.max(rn,gn,bn), min=Math.min(rn,gn,bn), l=(max+min)/2;
  if (max===min) return \`hsl(0, 0%, \${Math.round(l*100)}%)\`;
  const d=max-min, s=l>0.5?d/(2-max-min):d/(max+min);
  let h;
  if (max===rn) h=((gn-bn)/d+(gn<bn?6:0))/6;
  else if (max===gn) h=((bn-rn)/d+2)/6;
  else h=((rn-gn)/d+4)/6;
  return \`hsl(\${Math.round(h*360)}, \${Math.round(s*100)}%, \${Math.round(l*100)}%)\`;
}

function rgbToHslaStr(r, g, b, a) {
  const rn=r/255, gn=g/255, bn=b/255;
  const max=Math.max(rn,gn,bn), min=Math.min(rn,gn,bn), l=(max+min)/2;
  if (max===min) return \`hsla(0, 0%, \${Math.round(l*100)}%, \${a})\`;
  const d=max-min, s=l>0.5?d/(2-max-min):d/(max+min);
  let h;
  if (max===rn) h=((gn-bn)/d+(gn<bn?6:0))/6;
  else if (max===gn) h=((bn-rn)/d+2)/6;
  else h=((rn-gn)/d+4)/6;
  return \`hsla(\${Math.round(h*360)}, \${Math.round(s*100)}%, \${Math.round(l*100)}%, \${a})\`;
}

function toHexa(r, g, b, a) {
  const ah = Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase();
  return \`#\${[r,g,b].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join('')}\${ah}\`;
}

function buildCssFilter(r, g, b, a = 1) {
  const rn=r/255, gn=g/255, bn=b/255;
  const max=Math.max(rn,gn,bn), min=Math.min(rn,gn,bn), l=(max+min)/2;
  const d=max-min, s=d===0?0:(l>0.5?d/(2-max-min):d/(max+min));
  let h=0;
  if(d!==0){
    if(max===rn) h=((gn-bn)/d+(gn<bn?6:0))/6;
    else if(max===gn) h=((bn-rn)/d+2)/6;
    else h=((rn-gn)/d+4)/6;
  }
  const hd=Math.round(h*360), sp=Math.round(s*100), lp=Math.round(l*100);
  const base = \`brightness(0) saturate(100%) invert(\${Math.round(lp*0.8)}%) sepia(100%) saturate(\${Math.round(sp*7.5)}%) hue-rotate(\${hd}deg) brightness(\${Math.round(lp*1.8)}%) contrast(\${sp>50?110:100}%)\`;
  return a < 1 ? \`\${base} opacity(\${Math.round(a*100)}%)\` : base;
}

// ── Search ─────────────────────────────────────────────────────────────────
function applyFilter() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  if (!q) { renderGrid(colors); return; }
  renderGrid(colors.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.hex.toLowerCase().includes(q)  ||
    c.rgb.toLowerCase().includes(q)  ||
    c.hsl.toLowerCase().includes(q)  ||
    (c.group || '').toLowerCase().includes(q)
  ));
}

// ── Dirty state ────────────────────────────────────────────────────────────
function markDirty() {
  dirty = true;
  document.getElementById('dirtyNotice').classList.add('visible');
  const mu = document.getElementById('metaUnsaved');
  if (mu) mu.classList.add('visible');
}

// ── Copy ───────────────────────────────────────────────────────────────────
function copy(val) {
  if (!val) return;
  vscode.postMessage({ type: 'copy', value: val });
  const t = document.getElementById('toast');
  t.textContent = 'Copied: ' + (val.length > 32 ? val.slice(0, 30) + '…' : val);
  t.classList.add('show');
  clearTimeout(copy._timer);
  copy._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ── Escape HTML ────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
}

module.exports = { activate, deactivate };