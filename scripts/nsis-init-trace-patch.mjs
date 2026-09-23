import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Temporary, opt-in runtime diagnostics for the exact locked NSIS templates.
// CM_INIT_TRACE is provided by this project's installer include and preserves
// the NSIS error flag without loading System.dll. Original instructions remain
// byte-for-byte unchanged; unknown or mixed upstream templates stop packaging.
export const nsisInitTraceBuilderVersion = '26.15.3';
export const nsisInitTraceTemplates = {
  "installer.nsi": {
    "originalSha256": "8811964416d122612c3e7601728af5d3f998d677918df829a4e8b4c739c8b9f8",
    "patches": [
      {
        "anchor": "    !insertmacro check64BitAndSetRegView\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_CHECK64\n    !insertmacro check64BitAndSetRegView\n    !insertmacro CM_INIT_TRACE AFTER_CHECK64\n",
        "count": 1
      },
      {
        "anchor": "    !ifdef ONE_CLICK\n      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MUTEX_CONDITION\n    !ifdef ONE_CLICK\n      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE\n",
        "count": 1
      },
      {
        "anchor": "      ${IfNot} ${UAC_IsInnerInstance}\n",
        "replacement": "      !insertmacro CM_INIT_TRACE BEFORE_MUTEX_UAC_INNER\n      ${IfNot} ${UAC_IsInnerInstance}\n      !insertmacro CM_INIT_TRACE AFTER_MUTEX_UAC_INNER\n",
        "count": 1
      },
      {
        "anchor": "    !insertmacro initMultiUser\n",
        "replacement": "    !insertmacro CM_INIT_TRACE AFTER_MUTEX_CONDITION\n    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER\n    !insertmacro initMultiUser\n    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER\n",
        "count": 1
      }
    ],
    "patchedSha256": "094fd512e583f4854e384ba2b9181f043bd30940d7ede0b8d37da35e0d292f85"
  },
  "multiUser.nsh": {
    "originalSha256": "9aca256695c289ec8a875143101fae8c6236bc8c6a7cf369bbe8b4986e09c9cb",
    "patches": [
      {
        "anchor": "    StrCpy $installMode CurrentUser\n",
        "replacement": "    !insertmacro CM_INIT_TRACE PER_USER_ENTER\n    StrCpy $installMode CurrentUser\n",
        "count": 1
      },
      {
        "anchor": "    ReadRegStr $perUserInstallationFolder HKCU \"${INSTALL_REGISTRY_KEY}\" InstallLocation\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_PER_USER_REGISTRY\n    ReadRegStr $perUserInstallationFolder HKCU \"${INSTALL_REGISTRY_KEY}\" InstallLocation\n    !insertmacro CM_INIT_TRACE AFTER_PER_USER_REGISTRY\n",
        "count": 1
      },
      {
        "anchor": "      System::Call 'SHELL32::SHGetKnownFolderPath(g \"${FOLDERID_UserProgramFiles}\", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'\n",
        "replacement": "      !insertmacro CM_INIT_TRACE BEFORE_KNOWN_FOLDER\n      System::Call 'SHELL32::SHGetKnownFolderPath(g \"${FOLDERID_UserProgramFiles}\", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'\n      !insertmacro CM_INIT_TRACE AFTER_KNOWN_FOLDER\n",
        "count": 1
      },
      {
        "anchor": "        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'\n",
        "replacement": "        !insertmacro CM_INIT_TRACE BEFORE_COPY_KNOWN_FOLDER\n        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'\n        !insertmacro CM_INIT_TRACE AFTER_COPY_KNOWN_FOLDER\n",
        "count": 1
      },
      {
        "anchor": "        System::Call 'OLE32::CoTaskMemFree(p r2)'\n",
        "replacement": "        !insertmacro CM_INIT_TRACE BEFORE_FREE_KNOWN_FOLDER\n        System::Call 'OLE32::CoTaskMemFree(p r2)'\n        !insertmacro CM_INIT_TRACE AFTER_FREE_KNOWN_FOLDER\n",
        "count": 1
      },
      {
        "anchor": "    StrCpy $installMode all\n",
        "replacement": "    !insertmacro CM_INIT_TRACE PER_MACHINE_ENTER\n    StrCpy $installMode all\n",
        "count": 1
      },
      {
        "anchor": "    !insertmacro GetDParameter $R0\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_GETD_PARAMETER\n    !insertmacro GetDParameter $R0\n    !insertmacro CM_INIT_TRACE AFTER_GETD_PARAMETER\n",
        "count": 2
      },
      {
        "anchor": "  ${StdUtils.GetAllParameters} $R8 \"0\"\n",
        "replacement": "  !insertmacro CM_INIT_TRACE BEFORE_STDUTILS_PARAMETERS\n  ${StdUtils.GetAllParameters} $R8 \"0\"\n  !insertmacro CM_INIT_TRACE AFTER_STDUTILS_PARAMETERS\n",
        "count": 1
      },
      {
        "anchor": "  ${Do}\n",
        "replacement": "  !insertmacro CM_INIT_TRACE BEFORE_D_PARAMETER_PARSE\n  ${Do}\n",
        "count": 1
      },
      {
        "anchor": "  ${LoopUntil} $R6 > $R7\n",
        "replacement": "  ${LoopUntil} $R6 > $R7\n  !insertmacro CM_INIT_TRACE AFTER_D_PARAMETER_PARSE\n",
        "count": 1
      }
    ],
    "patchedSha256": "f09fce4429bed7f29f8f080f77d7b3c588554254fead9fe36d39a02442940575"
  },
  "assistedInstaller.nsh": {
    "originalSha256": "8aa1230e9717b428664d613fcc5c6a060883410b34cb7853b517fe11b4ee0a76",
    "patches": [
      {
        "anchor": "!macro initMultiUser\n",
        "replacement": "!macro initMultiUser\n!insertmacro CM_INIT_TRACE MULTIUSER_ENTER\n",
        "count": 1
      },
      {
        "anchor": "    ${If} ${UAC_IsInnerInstance}\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_UAC_INNER\n    ${If} ${UAC_IsInnerInstance}\n",
        "count": 1
      },
      {
        "anchor": "    !ifndef MULTIUSER_INIT_TEXT_ADMINREQUIRED\n",
        "replacement": "    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER_UAC_INNER\n    !ifndef MULTIUSER_INIT_TEXT_ADMINREQUIRED\n",
        "count": 1
      },
      {
        "anchor": "    ReadRegStr $perMachineInstallationFolder HKLM \"${INSTALL_REGISTRY_KEY}\" InstallLocation\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_MACHINE_REGISTRY\n    ReadRegStr $perMachineInstallationFolder HKLM \"${INSTALL_REGISTRY_KEY}\" InstallLocation\n    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER_MACHINE_REGISTRY\n",
        "count": 1
      },
      {
        "anchor": "    ReadRegStr $perUserInstallationFolder HKCU \"${INSTALL_REGISTRY_KEY}\" InstallLocation\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_USER_REGISTRY\n    ReadRegStr $perUserInstallationFolder HKCU \"${INSTALL_REGISTRY_KEY}\" InstallLocation\n    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER_USER_REGISTRY\n",
        "count": 1
      },
      {
        "anchor": "    ${GetParameters} $R0\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_PARAMETERS\n    ${GetParameters} $R0\n    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER_PARAMETERS\n",
        "count": 1
      },
      {
        "anchor": "    ${GetOptions} $R0 \"/allusers\" $R1\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_ALLUSER_OPTION\n    ${GetOptions} $R0 \"/allusers\" $R1\n    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER_ALLUSER_OPTION\n",
        "count": 1
      },
      {
        "anchor": "    ${GetOptions} $R0 \"/currentuser\" $R1\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_CURRENTUSER_OPTION\n    ${GetOptions} $R0 \"/currentuser\" $R1\n    !insertmacro CM_INIT_TRACE AFTER_MULTIUSER_CURRENTUSER_OPTION\n",
        "count": 1
      },
      {
        "anchor": "    ${if} $hasPerUserInstallation == \"1\"\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MULTIUSER_SELECT_MODE\n    ${if} $hasPerUserInstallation == \"1\"\n",
        "count": 1
      }
    ],
    "patchedSha256": "48dce1b57423685730e1483e0ba6127df43c38e7d94c9292db804fc6bd35dcf0"
  },
  "include/allowOnlyOneInstallerInstance.nsh": {
    "originalSha256": "0d4ae12cf0bd177cb85cb77680add3135108ddd21ab5730426e4600e2aaad18f",
    "patches": [
      {
        "anchor": "  BringToFront\n",
        "replacement": "  !insertmacro CM_INIT_TRACE BEFORE_MUTEX_BRING_TO_FRONT\n  BringToFront\n  !insertmacro CM_INIT_TRACE AFTER_MUTEX_BRING_TO_FRONT\n",
        "count": 1
      },
      {
        "anchor": "  System::Call 'kernel32::CreateMutex(${SYSTYPE_PTR}0, i1, t\"${APP_GUID}\")?e'\n",
        "replacement": "  !insertmacro CM_INIT_TRACE BEFORE_CREATE_MUTEX\n  System::Call 'kernel32::CreateMutex(${SYSTYPE_PTR}0, i1, t\"${APP_GUID}\")?e'\n",
        "count": 1
      },
      {
        "anchor": "  Pop $0\n  IntCmpU $0 183 0 launch launch ; ERROR_ALREADY_EXISTS\n",
        "replacement": "  !insertmacro CM_INIT_TRACE AFTER_CREATE_MUTEX\n  Pop $0\n  IntCmpU $0 183 0 launch launch ; ERROR_ALREADY_EXISTS\n",
        "count": 1
      },
      {
        "anchor": "    StrLen $0 \"$(^SetupCaption)\"\n",
        "replacement": "    !insertmacro CM_INIT_TRACE MUTEX_ALREADY_EXISTS\n    StrLen $0 \"$(^SetupCaption)\"\n",
        "count": 1
      },
      {
        "anchor": "    StrCpy $1 \"\" ; Start FindWindow with NULL\n",
        "replacement": "    !insertmacro CM_INIT_TRACE BEFORE_MUTEX_WINDOW_SEARCH\n    StrCpy $1 \"\" ; Start FindWindow with NULL\n",
        "count": 1
      },
      {
        "anchor": "      SendMessage $1 0x112 0xF120 0 /TIMEOUT=2000 ; WM_SYSCOMMAND:SC_RESTORE to restore the window if it is minimized\n",
        "replacement": "      !insertmacro CM_INIT_TRACE MUTEX_WINDOW_FOUND\n      SendMessage $1 0x112 0xF120 0 /TIMEOUT=2000 ; WM_SYSCOMMAND:SC_RESTORE to restore the window if it is minimized\n",
        "count": 1
      },
      {
        "anchor": "  launch:\n",
        "replacement": "  launch:\n  !insertmacro CM_INIT_TRACE MUTEX_DONE\n",
        "count": 1
      }
    ],
    "patchedSha256": "a2583ceba5c86df7e2647d53815122664cd009add5344536c12384fc32c5ba8a"
  }
};
const sha256 = source => createHash('sha256').update(source).digest('hex');

export function patchNsisInitTraceTemplate(name, source) {
  const spec = nsisInitTraceTemplates[name];
  assert.ok(spec, 'Unknown NSIS initialization template');
  assert.equal(typeof source, 'string');
  const digest = sha256(source);
  if (digest === spec.patchedSha256) return source;
  assert.equal(digest, spec.originalSha256, 'Unknown NSIS initialization template; review the upstream change before packaging');
  let patched = source;
  for (const { anchor, replacement, count } of spec.patches) {
    assert.equal(patched.split(anchor).length - 1, count, 'Ambiguous NSIS initialization trace anchor');
    patched = patched.split(anchor).join(replacement);
  }
  assert.equal(sha256(patched), spec.patchedSha256, 'NSIS initialization trace output changed');
  return patched;
}

export async function prepareNsisInitTrace(root) {
  const directory = path.join(root, 'node_modules', 'app-builder-lib');
  const installed = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(installed.version, nsisInitTraceBuilderVersion, 'NSIS trace patch requires the reviewed app-builder-lib version');
  assert.equal(lock.packages?.['node_modules/app-builder-lib']?.version, installed.version, 'Packaging dependencies must match the lockfile');
  // Validate every input before writing any template, so an unexpected final
  // input cannot leave an earlier template modified.
  const changes = [];
  for (const name of Object.keys(nsisInitTraceTemplates)) {
    const file = path.join(directory, 'templates', 'nsis', ...name.split('/'));
    const source = await fs.readFile(file, 'utf8');
    const patched = patchNsisInitTraceTemplate(name, source);
    if (source !== patched) changes.push({ file, patched });
  }
  for (const { file, patched } of changes) await fs.writeFile(file, patched);
}
