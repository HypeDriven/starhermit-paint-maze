// The look of the menus, HUD and cards: the browser build's styles.css,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (scroll bars, tooltips)
// take, in the system sans. The world colours (body[data-world] overriding
// --bg, --bg2, --accent and --line) are token swaps here; high contrast (the
// runtime's option) darkens the ink and lines.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

let base: Record<string, string | number> = {};
/** styles.css body[data-world] (studio is :root). */
export const WORLD_TOKENS: Record<string, { bg: string; bg2: string; accent: string; line: string }> = {
  studio: { bg: "#fbf3ea", bg2: "#f1e2d6", accent: "#ff5a5f", line: "#e4d9cd" },
  gallery: { bg: "#eef4fc", bg2: "#dde7f5", accent: "#2f8cff", line: "#d3dcea" },
  workshop: { bg: "#fbf6ea", bg2: "#efe4cf", accent: "#d97f06", line: "#e3d7bf" },
  atelier: { bg: "#eaf6f2", bg2: "#d6ebe4", accent: "#0e9f71", line: "#cfe2db" },
};
const HIGH_CONTRAST = { ink: "#000000", muted: "#2b2638", line: "#2b2638" };

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Record<string, string | number>) };
  ui.setFont({ family: "system-ui" });
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 24, padding: 8, spacing: 8, radius: 12,
    text: "#2b2638", muted: "#6b6478", panel: "#ffffff", control: "#ffffff", hovered: "#fbf3ea",
    pressed: "#f1e2d6", field: "#ffffff", accent: "#ff5a5f", focus: "#ff5a5f", outline: "#e4d9cd",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$accent", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "#6b647866", radius: 4 } } },
    tooltip: { background: "$surface", text: { color: "$ink" }, radius: 6, padding: 6 },
  });
}

let key = "";
/** The world's colours (and high contrast) as the page's tokens. */
export function applyWorld(world: string, highContrast: boolean): void {
  const k = `${world}:${highContrast}`;
  if (k === key) return;
  key = k;
  const w = WORLD_TOKENS[world] ?? WORLD_TOKENS.studio!;
  ui.setTokens({ ...base, ...w, ...(highContrast ? HIGH_CONTRAST : {}) });
}
export function worldColors(world: string): { bg: string; bg2: string; accent: string; line: string } {
  return WORLD_TOKENS[world] ?? WORLD_TOKENS.studio!;
}
