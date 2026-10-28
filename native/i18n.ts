// Localization: the browser build's tables (src/i18n.js, the nine StarHermit
// locales) in the interface language the runtime reports (preferences().language:
// the player's choice in Options › Language, else the account's preferred
// language or the device's), matched to the nearest shipped locale as
// sh-language.js did (es-MX → es-419, fr-BE → fr-FR, en-AU → en-GB, pt-PT →
// pt-BR). The runtime's Options replace the game's own Language setting; every
// string is drawn through t() each frame, so a change shows on the next frame
// (the level in progress is untouched).
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { i18n } from "./game.ts";

function apply(tag: string): void {
  const loc = i18n.matchLocale(tag);
  if (loc === i18n.getLocale() && applied) return;
  applied = true;
  i18n.setLocale(loc);
  ui.setLanguage(loc);
}
let applied = false;
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export const t = i18n.t;
