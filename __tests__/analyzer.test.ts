import path from 'path';
import Analyzer from '../src/analyzer';

jest.setTimeout(60 * 1e3);

function T(appname: string) {
  return path.resolve(__dirname, `../fixtures/${appname}`);
}

test('New Analyze with sub packages', async () => {
  const analyzer = new Analyzer(T('mini-app-3'), 'wx');
  await analyzer.analyze();
  const all_files = analyzer.all_files;
  const main_files = analyzer.get_main_files();
  expect(all_files.filter((item) => !item.startsWith('pages/home/')).sort()).toEqual(main_files.sort());
  const main_unused_files = analyzer.get_main_unused_files();
  const useless_files = analyzer.get_useless_files();
  expect(main_unused_files.sort()).toEqual(
    [
      'abc.json',
      'common/a.js',
      'assets/demo.png',
      'common/b.js',
      'common/c.js',
      'common/d.js',
      'components/com-a/header.wxml',
      'components/com-a/index.js',
      'components/com-a/index.json',
      'components/com-a/index.wxml',
      'components/com-a/index.wxss',
      'styles/b.wxss',
    ].sort()
  );
  expect(useless_files.sort()).toEqual(['abc.json', 'common/d.js', 'pages/home/xxx.js'].sort());
  const main_used_files = analyzer.get_main_used_files();
  expect(main_used_files.sort()).toEqual(
    [
      'pages/index/index.js',
      'pages/index/ab.js',
      'pages/index/index.json',
      'pages/index/index.wxml',
      'pages/index/header.wxml',
      'pages/index/templates.wxml',
      'pages/index/tool.wxs',
      'pages/index/index.wxss',
      'sitemap.json',
      'app.js',
      'common/config.js',
      'others/a.js',
      'others/b.js',
      'app.json',
      'assets/tab/home.png',
      'assets/tab/home_select.png',
      'assets/tab/demo.png',
      'assets/tab/demo_select.png',
      'app.wxss',
    ].sort()
  );
});

test('New Analyze only main', async () => {
  const analyzer = new Analyzer(T('mini-app-1'), 'wx');
  await analyzer.analyze();
  const all_files = analyzer.all_files;
  const main_files = analyzer.get_main_files();
  const main_used_files = analyzer.get_main_used_files();
  const main_unused_files = analyzer.get_main_unused_files();
  const useless_files = analyzer.get_useless_files();
  expect(all_files).toMatchSnapshot();
  expect(main_files).toMatchSnapshot();
  expect(main_used_files).toMatchSnapshot();
  expect(main_unused_files).toMatchSnapshot();
  expect(useless_files).toMatchSnapshot();
});

test('get_sub_main_deps', async () => {
  const analyzer = new Analyzer(T('mini-app-5'), 'wx');
  await analyzer.analyze();
  const sub_deps = analyzer.get_sub_outside_files();
  expect(sub_deps).toHaveProperty('pages/home');
  expect(sub_deps['pages/home']).toHaveLength(10);
  expect(
    [
      'assets/demo.png',
      'common/a.js',
      'common/b.js',
      'common/c.js',
      'styles/b.wxss',
      'components/com-a/index.js',
      'components/com-a/index.wxml',
      'components/com-a/index.json',
      'components/com-a/index.wxss',
      'components/com-a/header.wxml',
    ].every((item) => sub_deps['pages/home'].includes(item))
  ).toBe(true);
});
