import assert from "node:assert/strict";
import test from "node:test";
import { assertSecurityVersion, checkSecurityLockfile } from "../scripts/lib/security-baseline.mjs";

test("accepts fixed releases in each supported security branch", () => {
  for (const [name, versions] of Object.entries({ node: ["22.23.4", "24.22.1", "26.12.1"], next: ["15.5.28", "16.4.1", "16.4.2"], "react-server-dom-webpack": ["19.0.9", "19.1.10", "19.2.9", "19.3.1"], sharp: ["0.35.5"] })) {
    for (const version of versions) assert.doesNotThrow(() => assertSecurityVersion(name, version));
  }
});
test("rejects older patches, unsupported Node lines and prereleases", () => {
  for (const [name, versions] of Object.entries({ node: ["22.14.0", "22.23.3", "24.19.0", "26.12.0", "25.9.0", "20.99.0", "22.23.4-rc.1"], next: ["16.4.0", "15.5.27"], "react-server-dom-webpack": ["19.0.8", "19.1.9", "19.2.8", "19.3.0"], sharp: ["0.35.4"] })) {
    for (const version of versions) assert.throws(() => assertSecurityVersion(name, version), /Security baseline rejected/);
  }
});
test("finds vulnerable nested RSC decoders even when marked dev-only", () => {
  for (const name of ["react-server-dom-webpack", "react-server-dom-turbopack", "react-server-dom-parcel"]) {
    const lock = { lockfileVersion: 3, packages: { ["node_modules/plugin/node_modules/" + name]: { version: "19.2.8", dev: true } } };
    assert.throws(() => checkSecurityLockfile(lock), /Security baseline rejected/);
    lock.packages["node_modules/plugin/node_modules/" + name].version = "19.2.9";
    assert.doesNotThrow(() => checkSecurityLockfile(lock));
  }
});
test("rejects incomplete lockfiles and missing dependency versions", () => {
  for (const lock of [{}, { lockfileVersion: 2, packages: {} }, { lockfileVersion: 3, packages: { "node_modules/next": {} } }]) {
    assert.throws(() => checkSecurityLockfile(lock));
  }
});

test("enforces patched body-parser, undici and Zod release boundaries", () => {
  for (const [name, versions] of Object.entries({
    "body-parser": ["1.20.9", "2.4.0"], undici: ["6.29.1", "7.30.1", "8.12.2"], zod: ["4.6.6", "4.6.7"],
  })) {
    for (const version of versions) assert.doesNotThrow(() => assertSecurityVersion(name, version));
  }
  for (const [name, versions] of Object.entries({
    "body-parser": ["1.20.8", "2.3.0"], undici: ["6.29.0", "7.29.1", "7.30.0", "8.11.2", "8.12.1"], zod: ["3.25.76", "4.4.3", "4.6.5", "4.6.6-rc.1"],
  })) {
    for (const version of versions) assert.throws(() => assertSecurityVersion(name, version), /Security baseline rejected/);
  }
});

test("finds old dependencies in nested, optional and renamed lockfile entries", () => {
  for (const [pathName, actualName, version, fixed] of [
    ["body-parser", "body-parser", "2.3.0", "2.4.0"],
    ["undici8", "undici", "8.11.2", "8.12.2"],
    ["transport", "undici", "7.30.0", "7.30.1"],
    ["schema", "zod", "4.6.5", "4.6.6"],
  ]) {
    const entry = { name: actualName, version, optional: true, dev: true };
    const lock = { lockfileVersion: 3, packages: { [`node_modules/provider/node_modules/${pathName}`]: entry } };
    assert.throws(() => checkSecurityLockfile(lock), /Security baseline rejected/);
    entry.version = fixed;
    assert.doesNotThrow(() => checkSecurityLockfile(lock));
    delete entry.version;
    assert.throws(() => checkSecurityLockfile(lock), /Security baseline rejected/);
  }
});
