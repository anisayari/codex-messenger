import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const clone = (value) => structuredClone(value);

export function createSettingsStore({ settingsFilePath, defaultSettings, fileSystem = fs }) {
  let cache = null;
  let loadedStoredSettings = false;
  let loading = null;
  let writeQueue = Promise.resolve();

  async function loadRaw() {
    if (cache) return { settings: clone(cache), loadedStoredSettings };
    if (!loading) {
      loading = (async () => {
        try {
          const raw = await fileSystem.readFile(settingsFilePath(), "utf8");
          const stored = JSON.parse(raw);
          if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("Invalid stored settings");
          cache = { ...clone(defaultSettings), ...stored };
          loadedStoredSettings = true;
        } catch (error) {
          if (error?.code !== "ENOENT") {
            await fileSystem.copyFile(settingsFilePath(), `${settingsFilePath()}.corrupt-${Date.now()}`).catch(() => {});
          }
          cache = clone(defaultSettings);
          loadedStoredSettings = false;
        }
      })().finally(() => { loading = null; });
    }
    await loading;
    return { settings: clone(cache), loadedStoredSettings };
  }

  function save(nextSettings) {
    const snapshot = clone(nextSettings);
    const persist = async () => {
      const targetPath = settingsFilePath();
      await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
      const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
      let file;
      try {
        file = await fileSystem.open(temporaryPath, "wx", 0o600);
        await file.writeFile(JSON.stringify(snapshot, null, 2), "utf8");
        await file.sync();
        await file.close();
        file = null;
        await fileSystem.rename(temporaryPath, targetPath);
      } catch (error) {
        await file?.close().catch(() => {});
        await fileSystem.unlink(temporaryPath).catch(() => {});
        throw error;
      }
      cache = snapshot;
      loadedStoredSettings = true;
      return clone(cache);
    };
    const result = writeQueue.then(persist);
    writeQueue = result.catch(() => {});
    return result;
  }

  function current() {
    return cache ? clone(cache) : null;
  }

  function replace(nextSettings) {
    cache = clone(nextSettings);
    return clone(cache);
  }

  return {
    loadRaw,
    save,
    current,
    replace
  };
}
