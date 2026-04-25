import { codexLoginStatus, codexVersion, codexVersionSupport, findCodexCommand, findNpmCommand, unsupportedCodexVersionMessage } from "../shared/codexSetup.js";

try {
  const npm = await findNpmCommand();
  console.log(`npm: ${npm.ok ? npm.command : "missing"}`);

  const found = await findCodexCommand(process.env.CODEX_MESSENGER_CODEX_PATH?.trim() || "");
  const version = await codexVersion(found.command);
  const support = codexVersionSupport(version);

  console.log(`Codex detected (${found.source}): ${found.command}`);
  console.log(version);
  if (!support.ok) {
    console.error(unsupportedCodexVersionMessage(version, support.minimumVersion));
    process.exitCode = 1;
  } else {
    const login = await codexLoginStatus(found.command);
    console.log(login.ok ? login.text : `Codex login required: ${login.text}`);
    if (!login.ok) process.exitCode = 1;
  }
} catch (error) {
  console.error("Codex CLI was not detected or is not ready.");
  console.error("Install Node.js/npm if needed, then run: npm install -g @openai/codex && codex login");
  console.error("You can also run: npm run setup:codex");
  console.error(error.message);
  process.exitCode = 1;
}
