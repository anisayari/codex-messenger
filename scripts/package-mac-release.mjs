import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultAppleTeamId = "T99D3SZXLB";
const defaultNotaryProfile = "codex-messenger";
const developerIdIdentityName = `ANIS AYARI (${defaultAppleTeamId})`;

function hasDeveloperIdApplicationIdentity(output, teamId = defaultAppleTeamId) {
  return new RegExp(`"Developer ID Application: .+\\(${teamId}\\)"`).test(output);
}

async function hasKeychainNotaryProfile(profile = defaultNotaryProfile, teamId = defaultAppleTeamId) {
  try {
    await execFileAsync("xcrun", ["notarytool", "history", "--keychain-profile", profile, "--team-id", teamId], {
      timeout: 15000
    });
    return true;
  } catch {
    return false;
  }
}

async function notarizationCredentialSource(env = process.env) {
  const hasApiKey = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER;
  if (hasApiKey) return "App Store Connect API key";

  const hasAppleId = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && (env.APPLE_TEAM_ID || defaultAppleTeamId);
  if (hasAppleId) return "Apple ID app-specific password";

  const hasKeychainProfile = env.APPLE_KEYCHAIN_PROFILE;
  if (hasKeychainProfile) return "notarytool keychain profile";

  if (await hasKeychainNotaryProfile()) {
    env.APPLE_KEYCHAIN_PROFILE = defaultNotaryProfile;
    return `notarytool keychain profile "${defaultNotaryProfile}"`;
  }

  return "";
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function assertReleasePrerequisites() {
  if (process.platform !== "darwin") {
    throw new Error("macOS release packaging must be run on macOS.");
  }

  process.env.APPLE_TEAM_ID ||= defaultAppleTeamId;

  const { stdout } = await execFileAsync("security", ["find-identity", "-v", "-p", "codesigning"]);
  if (!hasDeveloperIdApplicationIdentity(stdout)) {
    throw new Error(
      [
        `Developer ID Application certificate for team ${defaultAppleTeamId} not found in the login keychain.`,
        "Install it from Xcode or Apple Developer Certificates before running this release build.",
        `Expected identity format: Developer ID Application: <Name> (${defaultAppleTeamId}).`
      ].join("\n")
    );
  }

  const credentials = await notarizationCredentialSource();
  if (!credentials) {
    throw new Error(
      [
        "Notarization credentials were not found.",
        "Set one of these before running the release build:",
        "- APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER",
        `- APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID=${defaultAppleTeamId}`,
        `- APPLE_KEYCHAIN_PROFILE=${defaultNotaryProfile}, optionally APPLE_KEYCHAIN`,
        "",
        "One-time local setup with an app-specific Apple password:",
        `xcrun notarytool store-credentials ${defaultNotaryProfile} --apple-id <apple-id> --team-id ${defaultAppleTeamId}`
      ].join("\n")
    );
  }

  console.log(`macOS release prerequisites OK: Developer ID Application (${defaultAppleTeamId}) + ${credentials}.`);
}

await assertReleasePrerequisites();
await run("npm", ["run", "build"]);
await run(process.execPath, [
  path.join(rootDir, "scripts/electron-builder-release-version.mjs"),
  "--mac",
  "dmg",
  "zip",
  `-c.mac.identity=${developerIdIdentityName}`,
  "-c.mac.forceCodeSigning=true",
  "-c.directories.output=release/macos"
]);
console.log("Signed/notarized macOS artifacts generated in release/macos/.");
