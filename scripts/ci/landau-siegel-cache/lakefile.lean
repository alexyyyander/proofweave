import Lake
open Lake DSL
package ProofweaveSiegelAcceptance where
  leanOptions := #[⟨`autoImplicit, false⟩]
require mathlib from git "https://github.com/leanprover-community/mathlib4.git" @ "d13f23b723b8a846827a245b89c10fc7d3f11612"
lean_lib OAI
lean_lib PrimeNumberTheoremAnd
lean_lib StacksCore
lean_lib PaperStatement
lean_lib StatementReview
lean_lib ReviewAudit
lean_lib ReviewChain
lean_lib DependencyAudit
lean_lib FoundationBridge
lean_lib ReplayTargets
lean_lib ProofweaveCloudSmoke
