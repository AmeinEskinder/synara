import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRpmInstallIntegrity } from "./rpm-install-integrity.mjs";

function fixture() {
  return {
    verification: {
      status: 1,
      stdout: ".M.......    /opt/Synara/chrome-sandbox\n",
      stderr: "",
      error: null,
    },
    installedScript: `postinstall scriptlet (using /bin/sh):
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/Synara/chrome-sandbox' || true
else
    chmod 0755 '/opt/Synara/chrome-sandbox' || true
fi`,
    sandbox: {
      path: "/opt/Synara/chrome-sandbox",
      regularFile: true,
      uid: 0,
      gid: 0,
      archiveMode: 0o100755,
      permissions: 0o4755,
    },
    namespaces: { hasUserNamespaceLink: true, status: 1, error: null },
  };
}

test("accepts only the actual conditional postinstall permission change", () => {
  const result = assertRpmInstallIntegrity(fixture());
  assert.equal(result.userNamespacesAvailable, false);
  assert.equal(result.installedPermissions, "4755");
  assert.equal(result.allOtherRpmFieldsMatch, true);
});
test("requires 0755 when user namespaces work and every field matches", () => {
  const input = fixture();
  input.namespaces.status = 0;
  input.sandbox.permissions = 0o755;
  input.verification = { status: 0, stdout: "", stderr: "", error: null };
  assert.equal(assertRpmInstallIntegrity(input).installedPermissions, "755");
});
test("also verifies removal of a packaged SUID bit when namespaces work", () => {
  const input = fixture();
  input.namespaces.status = 0;
  input.sandbox.archiveMode = 0o104755;
  input.sandbox.permissions = 0o755;
  assert.equal(assertRpmInstallIntegrity(input).installedPermissions, "755");
});
test("handles systems without a user namespace link", () => {
  const input = fixture();
  input.namespaces = { hasUserNamespaceLink: false, status: null, error: null };
  assert.equal(assertRpmInstallIntegrity(input).installedPermissions, "4755");
});
for (const [name, change] of [
  [
    "unknown postinstall",
    (x) => {
      x.installedScript = "chmod 777 /opt/Synara/chrome-sandbox";
    },
  ],
  [
    "unexpected permission",
    (x) => {
      x.sandbox.permissions = 0o777;
    },
  ],
  [
    "non-root owner",
    (x) => {
      x.sandbox.uid = 1000;
    },
  ],
  [
    "non-root group",
    (x) => {
      x.sandbox.gid = 1000;
    },
  ],
  [
    "non-file sandbox",
    (x) => {
      x.sandbox.regularFile = false;
    },
  ],
  [
    "unsafe archive mode",
    (x) => {
      x.sandbox.archiveMode = 0o100777;
    },
  ],
  [
    "namespace probe error",
    (x) => {
      x.namespaces.error = "spawn failed";
    },
  ],
  [
    "RPM tool error",
    (x) => {
      x.verification.error = "spawn failed";
    },
  ],
  [
    "RPM warnings",
    (x) => {
      x.verification.stderr = "verification error";
    },
  ],
  [
    "wrong RPM exit",
    (x) => {
      x.verification.status = 0;
    },
  ],
  [
    "digest mismatch",
    (x) => {
      x.verification.stdout = "SM5......    /opt/Synara/chrome-sandbox\n";
    },
  ],
  [
    "different changed file",
    (x) => {
      x.verification.stdout = ".M.......    /opt/Synara/synara\n";
    },
  ],
  [
    "extra mismatch",
    (x) => {
      x.verification.stdout += ".M.......    /opt/Synara/synara\n";
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const input = fixture();
    change(input);
    assert.throws(() => assertRpmInstallIntegrity(input));
  });
}
