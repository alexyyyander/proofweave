export type JacobianCounterexampleVerification = Readonly<{
  exactArithmetic: true;
  determinant: string;
  determinantIsConstantAndNonzero: boolean;
  distinctPreimages: string[][];
  commonImage: string[];
  evaluatedImages: string[][];
  exactCollision: boolean;
  algebraicCounterexampleConditionsSatisfied: boolean;
}>;

export function verifyJacobianCounterexample(): JacobianCounterexampleVerification;
