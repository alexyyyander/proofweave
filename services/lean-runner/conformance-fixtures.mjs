import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";

export const conformanceFixtureSchemaVersion = "pw-runner-conformance-fixtures-v1";

const coreLakefile = [
  'name = "proofweaveConformance"',
  'defaultTargets = ["ProofweaveConformance"]',
  "",
  "[[lean_lib]]",
  'name = "ProofweaveConformance"',
  "",
].join("\n");

function fixture(value) {
  return Object.freeze({
    ...value,
    files: Object.freeze({ ...value.files }),
    expected: Object.freeze({
      ...value.expected,
      checks: Object.freeze({ ...value.expected.checks }),
    }),
  });
}

/**
 * Version-independent fixture set for the exact Container audit pipeline.
 * Each case reconstructs one minimal Lake workspace and runs the real
 * ContainerLeanExecutor, so noSorry, build, namespace, import, and axiom
 * behavior are exercised rather than inferred from a bare Lean invocation.
 */
export const conformanceFixtures = Object.freeze([
  fixture({
    id: "accepted-basic",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Basic.lean"],
    target: "ProofweaveConformance.basic_true",
    allowedAxioms: [],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Basic.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem basic_true : True := True.intro",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "sorry-rejected",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Sorry.lean"],
    target: "ProofweaveConformance.sorry_true",
    allowedAxioms: [],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Sorry.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem sorry_true : True := by sorry",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "rejected",
      kernelStatus: "rejected",
      checks: { network: "passed", noSorry: "failed", allowedAxioms: "failed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "compiler-error",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Broken.lean"],
    target: "ProofweaveConformance.broken",
    allowedAxioms: [],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Broken.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem broken : True := 1",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "failed",
      kernelStatus: "not_run",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "not_run", leanBuild: "failed" },
    },
  }),
  fixture({
    id: "classical-choice",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Classical.lean"],
    target: "ProofweaveConformance.choice_exists",
    allowedAxioms: ["Classical.choice"],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Classical.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem choice_exists (α : Type) (h : Nonempty α) : ∃ x : α, x = Classical.choice h := by",
        "  exact ⟨Classical.choice h, rfl⟩",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "root-qualified-target",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Root.lean"],
    target: "_root_.ProofweaveConformance.root_true",
    allowedAxioms: [],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Root.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem root_true : True := True.intro",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "imported-module",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Main.lean"],
    target: "ProofweaveConformance.main_true",
    allowedAxioms: [],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Dep.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem dep_true : True := True.intro",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
      "ProofweaveConformance/Main.lean": [
        "import ProofweaveConformance.Dep",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem main_true : True := dep_true",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "native-decide",
    kind: "core",
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Native.lean"],
    target: "ProofweaveConformance.native_arithmetic",
    allowedAxioms: ["Lean.ofReduceBool"],
    files: {
      "lakefile.toml": coreLakefile,
      "ProofweaveConformance/Native.lean": [
        "import Lean",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem native_arithmetic : (2 + 2 = 4) := by native_decide",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "rejected",
      kernelStatus: "rejected",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "failed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "mathlib-import-legacy",
    kind: "mathlib",
    appliesToToolchains: ["leanprover/lean4:v4.27.0", "leanprover/lean4:v4.31.0"],
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Mathlib.lean"],
    target: "ProofweaveConformance.mathlib_true",
    allowedAxioms: [],
    files: {
      "ProofweaveConformance/Mathlib.lean": [
        "import Mathlib",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem mathlib_true : True := True.intro",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "mathlib-import-module",
    kind: "mathlib",
    appliesToToolchains: ["leanprover/lean4:v4.35.0"],
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/Mathlib.lean"],
    target: "ProofweaveConformance.mathlib_true",
    allowedAxioms: [],
    files: {
      "ProofweaveConformance/Mathlib.lean": [
        "module",
        "import Mathlib",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem mathlib_true : True := True.intro",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
  fixture({
    id: "module-syntax",
    kind: "mathlib",
    appliesToToolchains: ["leanprover/lean4:v4.35.0"],
    entryCommand: ["lake", "env", "lean", "ProofweaveConformance/ModuleSyntax.lean"],
    target: "ProofweaveConformance.module_true",
    allowedAxioms: [],
    files: {
      "ProofweaveConformance/ModuleSyntax.lean": [
        "module",
        "import Mathlib",
        "",
        "namespace ProofweaveConformance",
        "",
        "theorem module_true : True := True.intro",
        "",
        "end ProofweaveConformance",
        "",
      ].join("\n"),
    },
    expected: {
      status: "succeeded",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  }),
]);

export const conformanceFixtureSet = Object.freeze({
  schemaVersion: conformanceFixtureSchemaVersion,
  fixtures: conformanceFixtures,
});

export async function conformanceFixtureSetHash() {
  return sha256Canonical(conformanceFixtureSet);
}
