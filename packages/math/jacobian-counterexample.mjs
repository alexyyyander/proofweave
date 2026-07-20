/**
 * Exact, dependency-free reproduction of the three-dimensional polynomial
 * counterexample announced on 2026-07-20. Polynomial coefficients and point
 * coordinates are BigInt rationals; no floating-point arithmetic is used.
 */

const ZERO_KEY = "0,0,0";

function polynomial(terms = []) {
  const result = new Map();
  for (const [exponents, coefficient] of terms) {
    const key = exponents.join(",");
    const next = (result.get(key) ?? 0n) + BigInt(coefficient);
    if (next === 0n) result.delete(key);
    else result.set(key, next);
  }
  return result;
}

function constant(value) {
  return polynomial([[[0, 0, 0], value]]);
}

function variable(index) {
  const exponents = [0, 0, 0];
  exponents[index] = 1;
  return polynomial([[exponents, 1n]]);
}

function add(...values) {
  return polynomial(values.flatMap((value) => [...value.entries()].map(([key, coefficient]) => [key.split(",").map(Number), coefficient])));
}

function scale(value, coefficient) {
  return polynomial([...value.entries()].map(([key, current]) => [key.split(",").map(Number), current * BigInt(coefficient)]));
}

function multiply(left, right) {
  const terms = [];
  for (const [leftKey, leftCoefficient] of left) {
    const leftExponents = leftKey.split(",").map(Number);
    for (const [rightKey, rightCoefficient] of right) {
      const rightExponents = rightKey.split(",").map(Number);
      terms.push([
        leftExponents.map((exponent, index) => exponent + rightExponents[index]),
        leftCoefficient * rightCoefficient,
      ]);
    }
  }
  return polynomial(terms);
}

function power(value, exponent) {
  let result = constant(1n);
  for (let index = 0; index < exponent; index += 1) result = multiply(result, value);
  return result;
}

function derivative(value, variableIndex) {
  const terms = [];
  for (const [key, coefficient] of value) {
    const exponents = key.split(",").map(Number);
    if (exponents[variableIndex] === 0) continue;
    const factor = BigInt(exponents[variableIndex]);
    exponents[variableIndex] -= 1;
    terms.push([exponents, coefficient * factor]);
  }
  return polynomial(terms);
}

function determinant3(matrix) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  return add(
    multiply(a, add(multiply(e, i), scale(multiply(f, h), -1n))),
    scale(multiply(b, add(multiply(d, i), scale(multiply(f, g), -1n))), -1n),
    multiply(c, add(multiply(d, h), scale(multiply(e, g), -1n))),
  );
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rational(numerator, denominator = 1n) {
  if (denominator === 0n) throw new RangeError("A rational denominator cannot be zero.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: sign * numerator / divisor, denominator: sign * denominator / divisor };
}

function rationalAdd(left, right) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function rationalMultiply(left, right) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function rationalPower(value, exponent) {
  return rational(value.numerator ** BigInt(exponent), value.denominator ** BigInt(exponent));
}

function rationalEqual(left, right) {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}

function formatRational(value) {
  return value.denominator === 1n ? `${value.numerator}` : `${value.numerator}/${value.denominator}`;
}

function evaluate(value, point) {
  let result = rational(0n);
  for (const [key, coefficient] of value) {
    const exponents = key.split(",").map(Number);
    let term = rational(coefficient);
    for (let index = 0; index < 3; index += 1) {
      term = rationalMultiply(term, rationalPower(point[index], exponents[index]));
    }
    result = rationalAdd(result, term);
  }
  return result;
}

function buildMap() {
  const x = variable(0);
  const y = variable(1);
  const z = variable(2);
  const xy = multiply(x, y);
  const onePlusXy = add(constant(1n), xy);
  const fourPlusThreeXy = add(constant(4n), scale(xy, 3n));

  const first = add(
    multiply(power(onePlusXy, 3), z),
    multiply(power(y, 2), multiply(onePlusXy, fourPlusThreeXy)),
  );
  const second = add(
    y,
    scale(multiply(x, multiply(power(onePlusXy, 2), z)), 3n),
    scale(multiply(x, multiply(power(y, 2), fourPlusThreeXy)), 3n),
  );
  const third = add(
    scale(x, 2n),
    scale(multiply(power(x, 2), y), -3n),
    scale(multiply(power(x, 3), z), -1n),
  );
  return [first, second, third];
}

export function verifyJacobianCounterexample() {
  const map = buildMap();
  const jacobian = map.map((component) => [0, 1, 2].map((index) => derivative(component, index)));
  const determinant = determinant3(jacobian);
  const determinantIsMinusTwo = determinant.size === 1 && determinant.get(ZERO_KEY) === -2n;
  const points = [
    [rational(0n), rational(0n), rational(-1n, 4n)],
    [rational(1n), rational(-3n, 2n), rational(13n, 2n)],
    [rational(-1n), rational(3n, 2n), rational(13n, 2n)],
  ];
  const images = points.map((point) => map.map((component) => evaluate(component, point)));
  const expectedImage = [rational(-1n, 4n), rational(0n), rational(0n)];
  const exactCollision = images.every((image) => image.every((value, index) => rationalEqual(value, expectedImage[index])));

  return Object.freeze({
    exactArithmetic: true,
    determinant: determinantIsMinusTwo ? "-2" : "unexpected",
    determinantIsConstantAndNonzero: determinantIsMinusTwo,
    distinctPreimages: points.map((point) => point.map(formatRational)),
    commonImage: expectedImage.map(formatRational),
    evaluatedImages: images.map((image) => image.map(formatRational)),
    exactCollision,
    algebraicCounterexampleConditionsSatisfied: determinantIsMinusTwo && exactCollision,
  });
}
