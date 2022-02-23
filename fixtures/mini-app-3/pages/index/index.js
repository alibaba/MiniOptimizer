var globalVariableName = 42;
export function foo() {
  var longLocalVariableName = 1;
  if (longLocalVariableName) {
    console.log(longLocalVariableName);
  }
}

Page({
  data: a,
  ready() {
    const name = '1234';
    const c = name + '123';
    console.log(c);
    console.log(b)
  }
});

export * from './ab.js';