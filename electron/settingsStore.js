import fs from "node:fs/promises";
import path from "node:path";

export function createSettingsStore({ settingsFilePath, defaultSettings }) {
  let cache = null;
  let loadedStoredSettings = false;

  async function loadRaw() {
    if (cache) return { settings: cache, loadedStoredSettings };
    try {
      const raw = await fs.readFile(settingsFilePath(), "utf8");
      cache = { ...defaultSettings, ...JSON.parse(raw) };
      loadedStoredSettings = true;
    } catch {
      cache = { ...defaultSettings };
      loadedStoredSettings = false;
    }
    return { settings: cache, loadedStoredSettings };
  }

  async function save(nextSettings) {
    cache = nextSettings;
    loadedStoredSettings = true;
    await fs.mkdir(path.dirname(settingsFilePath()), { recursive: true });
    await fs.writeFile(settingsFilePath(), JSON.stringify(cache, null, 2), "utf8");
    return cache;
  }

  function current() {
    return cache;
  }

  function replace(nextSettings) {
    cache = nextSettings;
    return cache;
  }

  return {
    loadRaw,
    save,
    current,
    replace
  };
}
