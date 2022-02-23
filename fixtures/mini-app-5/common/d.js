var globalVariableName = 42;
export function foo() {
  var longLocalVariableName = 1;
  if (longLocalVariableName) {
    console.log(longLocalVariableName);
  }
}
export default {
  path: 'd.js'
}