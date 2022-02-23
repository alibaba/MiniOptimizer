import { correct_path, resolve_path } from '../src/utils';


test('basic utils', () => {
  expect(correct_path('/a/b', '.js')).toEqual('/a/b.js');
  expect(correct_path('/a/b', '.wxss')).toEqual('/a/b.wxss');
  expect(resolve_path('/a/b.js', '/a', '/c')).toEqual('/c/a/b.js');
  expect(resolve_path('../a/b.js', '/d/e', '/c')).toEqual('/d/a/b.js');
});