import { displayVersion } from "../shared/versionUtils.js";

export function versionLabel(value, unknown = "inconnue") {
  return displayVersion(value) || unknown;
}
