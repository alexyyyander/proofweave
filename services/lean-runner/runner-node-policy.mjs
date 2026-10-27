// Node 22.23.4 is the reviewed security floor for this image family. A change
// to the Node major requires a separate compatibility review.
export function assertReviewedRunnerNode(actual, expected) {
  const parse = (value) => typeof value === "string"
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    ? value.split(".").map(Number)
    : null;
  const selected = parse(expected);
  if (!selected || selected[0] !== 22 || selected[1] < 23
    || (selected[1] === 23 && selected[2] < 4)) {
    throw new Error("EXPECTED_NODE_VERSION must select reviewed Node 22.23.4 or newer within Node 22.");
  }
  if (!parse(actual) || actual !== expected) {
    throw new Error(`Runner Node version ${actual} does not match reviewed version ${expected}.`);
  }
  return actual;
}
