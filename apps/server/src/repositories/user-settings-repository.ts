import type { Database } from "bun:sqlite";
import {
  DEFAULT_USER_PREFERENCES,
  type UpdateUserPreferencesRequest,
  type UserPreferences
} from "@maple/protocol";
import { nowIso } from "../lib/time";

const THEME_KEY = "ui.theme";
const FONT_KEY = "ui.font";
const LANGUAGE_KEY = "ui.language";

export class UserSettingsRepository {
  constructor(private readonly database: Database) {}

  get(userId: string): UserPreferences {
    const rows = this.database
      .query("SELECT key, value FROM user_settings WHERE user_id = ?")
      .all(userId) as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const theme = values.get(THEME_KEY);
    const uiFont = values.get(FONT_KEY);
    const uiLanguage = values.get(LANGUAGE_KEY);
    return {
      theme: theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : DEFAULT_USER_PREFERENCES.theme,
      uiFont: uiFont === "chill-round" || uiFont === "default"
        ? uiFont
        : DEFAULT_USER_PREFERENCES.uiFont,
      uiLanguage: uiLanguage === "en" || uiLanguage === "zh"
        ? uiLanguage
        : DEFAULT_USER_PREFERENCES.uiLanguage
    };
  }

  seedDefaults(userId: string): void {
    const now = nowIso();
    const insert = this.database.query(
      "INSERT OR IGNORE INTO user_settings(user_id, key, value, updated_at) VALUES (?, ?, ?, ?)"
    );
    insert.run(userId, THEME_KEY, DEFAULT_USER_PREFERENCES.theme, now);
    insert.run(userId, FONT_KEY, DEFAULT_USER_PREFERENCES.uiFont, now);
    insert.run(userId, LANGUAGE_KEY, DEFAULT_USER_PREFERENCES.uiLanguage, now);
  }

  update(userId: string, input: UpdateUserPreferencesRequest): UserPreferences {
    const current = this.get(userId);
    const next: UserPreferences = {
      theme: input.theme ?? current.theme,
      uiFont: input.uiFont ?? current.uiFont,
      uiLanguage: input.uiLanguage ?? current.uiLanguage
    };
    const updatedAt = nowIso();
    const write = this.database.query(
      `INSERT INTO user_settings(user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    this.database.transaction(() => {
      if (next.theme !== current.theme) write.run(userId, THEME_KEY, next.theme, updatedAt);
      if (next.uiFont !== current.uiFont) write.run(userId, FONT_KEY, next.uiFont, updatedAt);
      if (next.uiLanguage !== current.uiLanguage) write.run(userId, LANGUAGE_KEY, next.uiLanguage, updatedAt);
    }).immediate();
    return next;
  }
}
