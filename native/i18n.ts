// Localization: the engine's string tables (assets/strings.json, the nine StarHermit
// locales) in the interface language the runtime reports (the player's choice in
// Options › Language, else the account's preferred language or the device's). The
// runtime's Options replace the game's own Language setting; every string is drawn
// through t() each frame, so a change shows on the next frame (the level in progress
// is untouched). The account lines are the engine's `starhermit.*` keys.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

type Vars = Record<string, string | number>;
/** A string by its key in the player's language; `{name}` placeholders from vars. */
export function t(key: string, vars?: Vars): string {
  const k = String(key ?? "");
  if (strings.has(k)) return strings.t(k, vars);
  return vars ? k.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m)) : k;
}
/** An account or leaderboard line: the engine's `starhermit.<key>` string. */
export function account(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
