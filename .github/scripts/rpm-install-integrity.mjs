import assert from "node:assert/strict";

const sandboxPath = "/opt/Synara/chrome-sandbox";
const sandboxScript = `if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/Synara/chrome-sandbox' || true
else
    chmod 0755 '/opt/Synara/chrome-sandbox' || true
fi`;

/** Verify the actual conditional mode adjustment made by the packaged script. */
export function assertRpmInstallIntegrity({ verification, installedScript, sandbox, namespaces }) {
  assert.ok(installedScript.includes(sandboxScript), "Unknown installed sandbox permission policy");
  assert.equal(sandbox.path, sandboxPath);
  assert.equal(sandbox.regularFile, true);
  assert.equal(sandbox.uid, 0);
  assert.equal(sandbox.gid, 0);
  assert.equal(sandbox.archiveMode & 0o170000, 0o100000);
  const archivePermissions = sandbox.archiveMode & 0o7777;
  assert.ok([0o755, 0o4755].includes(archivePermissions));
  assert.equal(typeof namespaces.hasUserNamespaceLink, "boolean");
  assert.equal(namespaces.error, null);
  if (namespaces.hasUserNamespaceLink) {
    assert.ok(Number.isInteger(namespaces.status) && namespaces.status >= 0);
  } else {
    assert.equal(namespaces.status, null);
  }
  const userNamespacesAvailable = namespaces.hasUserNamespaceLink && namespaces.status === 0;
  const expectedPermissions = userNamespacesAvailable ? 0o755 : 0o4755;
  assert.equal(
    sandbox.permissions,
    expectedPermissions,
    "Installed sandbox mode contradicts postinstall",
  );
  assert.equal(verification.error, null);
  assert.equal(verification.stderr.trim(), "");
  const modeChanged = archivePermissions !== expectedPermissions;
  assert.equal(verification.status, modeChanged ? 1 : 0);
  if (modeChanged) {
    assert.match(verification.stdout.trim(), /^\.M\.{7}[ \t]+\/opt\/Synara\/chrome-sandbox$/);
  } else {
    assert.equal(verification.stdout.trim(), "");
  }
  return {
    userNamespacesAvailable,
    archivePermissions: archivePermissions.toString(8),
    installedPermissions: sandbox.permissions.toString(8),
    policy:
      "Unchanged packaged postinstall chooses 4755 only without working user namespaces, otherwise 0755.",
    verification: modeChanged
      ? "Only the proven postinstall sandbox mode differs"
      : "All RPM fields match",
    allOtherRpmFieldsMatch: true,
  };
}
