import path from 'path';
import fs from 'fs-extra';
import Optimizer from '../src';
import MergeImport from '../src/plugins/merge-import';

function T(appname: string) {
  return path.resolve(__dirname, `../fixtures/${appname}`);
}

function ran(len = 5) {
  return new Array(len)
    .fill(null)
    .map(() => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)])
    .join('');
}

interface TestFnThis {
  dir: string;
}

beforeEach(function (this: TestFnThis) {
  const src = T('mini-app-5');
  const target = path.resolve(__dirname, `../copy/${ran()}`);
  fs.copySync(src, target);
  this.dir = target;
});

afterEach(function (this: TestFnThis) {
  fs.removeSync(this.dir);
});

function _exist(file_contents: any, file: string): boolean {
  return file in file_contents;
}
function _read(file_contents: any, file: string): string {
  return file_contents[file];
}

test('basic', async function (this: TestFnThis) {
  const optimizer = new Optimizer(this.dir, 'wx', { plugins: [MergeImport] });
  await optimizer.run();
  const all_files = optimizer.all_files.sort();
  expect(all_files).toMatchSnapshot();
  const main_files = optimizer.get_main_files().sort();
  expect(main_files).toMatchSnapshot();
  const main_used_files = optimizer.get_main_used_files().sort();
  expect(main_used_files).toMatchSnapshot();
  const main_unused_files = optimizer.get_main_unused_files().sort();
  expect(main_unused_files).toMatchSnapshot();
  const useless_files = optimizer.get_useless_files().sort();
  expect(useless_files).toMatchSnapshot();
  const sub_used_files = optimizer.get_sub_used_files().sort();
  expect(sub_used_files).toMatchSnapshot();
  const sub_outside_files = optimizer.get_sub_outside_files();
  expect(sub_outside_files['pages/home']).toEqual([]);
});

test('removeUselessFiles ', async function (this: TestFnThis) {
  const optimizer = new Optimizer(this.dir, 'wx', { removeUselessFile: true, plugins: [MergeImport] });
  await optimizer.run();
  const all_files = optimizer.all_files.sort();
  expect(all_files).toMatchSnapshot();
});

test('uselessExculdes', async function (this: TestFnThis) {
  const optimizer = new Optimizer(this.dir, 'wx', {
    removeUselessFile: true,
    uselessExculde: ['abc.json'],
    plugins: [MergeImport],
  });
  await optimizer.run();
  const all_files = optimizer.all_files.sort();
  expect(all_files).toMatchSnapshot();
});

test('rename files', async function (this: TestFnThis) {
  const optimizer = new Optimizer(this.dir, 'wx', {
    removeUselessFile: true,
    renameFile: true,
    plugins: [MergeImport],
  });
  await optimizer.run();
  const all_files = optimizer.all_files.sort();
  expect(all_files).toMatchSnapshot();
  const main_files = optimizer.get_main_files().sort();
  expect(main_files).toMatchSnapshot();
  const main_used_files = optimizer.get_main_used_files().sort();
  expect(main_used_files).toMatchSnapshot();
  const main_unused_files = optimizer.get_main_unused_files().sort();
  expect(main_unused_files).toMatchSnapshot();
  const sub_used_files = optimizer.get_sub_used_files().sort();
  expect(sub_used_files).toMatchSnapshot();
  const sub_outside_files = optimizer.get_sub_outside_files();
  expect(sub_outside_files['pages/home']).toEqual([]);
});

test('minfiy js', async function (this: TestFnThis) {
  const optimizer = new Optimizer(this.dir, 'wx', { minifyJs: true, plugins: [MergeImport] });
  await optimizer.run();
  const all_files = optimizer.all_files.sort();
  expect(all_files).toMatchSnapshot();
});

test('optimizer with copy', async () => {
  const optimizer = new Optimizer(T('mini-app-5'), 'wx', {
    output: path.resolve(__dirname, '../app5'),
    plugins: [MergeImport],
  });
  await optimizer.run();
  expect(fs.existsSync(path.resolve(__dirname, '../app5/pages/home/_/assets/demo.png')));
  expect(fs.existsSync(path.resolve(__dirname, '../app5/pages/home/_/common/a.js')));
  expect(fs.existsSync(path.resolve(__dirname, '../app5/pages/home/_/common/b.js')));
  expect(fs.existsSync(path.resolve(__dirname, '../app5/pages/home/_/common/c.js')));
  expect(fs.existsSync(path.resolve(__dirname, '../app5/pages/home/_/styles/b.wxss')));
  expect(fs.existsSync(path.resolve(__dirname, '../app5/pages/home/_/components/com-a/index.wxss')));
  const index_js = fs.readFileSync(path.resolve(__dirname, '../app5/pages/home/index.js'), 'utf-8').split(/\n/g);
  expect(index_js[0]).toBe('import a from "./_/common/a";');
  expect(index_js[2]).toBe(`const b = require("./_/common/b");`);
  const index_wxss = fs.readFileSync(path.resolve(__dirname, '../app5/pages/home/index.wxss'), 'utf-8').split(/\n/g);
  expect(index_wxss[0]).toBe(`@import "./_/styles/b.wxss";`);

  const index_wxml = fs.readFileSync(path.resolve(__dirname, '../app5/pages/home/index.wxml'), 'utf-8').split(/\n/g);
  expect(index_wxml[0]).toBe(`<include src="./header.wxml"/>`);
  expect(index_wxml[1]).toBe(`<import src="./templates.wxml"/>`);
  expect(index_wxml[2]).toBe(`<wxs src="./tool.wxs" module="tools"/>`);

  expect(index_wxml[10]).toBe(`<include src="./header.wxml"/>`);
  expect(index_wxml[11]).toBe(`<import src="./templates.wxml"/>`);
  expect(index_wxml[12]).toBe(`<wxs src="./tool.wxs" module="tools"/>`);

  const header_wxml = fs.readFileSync(path.resolve(__dirname, '../app5/pages/home/header.wxml'), 'utf-8').split(/\n/g);
  expect(header_wxml[3]).toBe(`<image src="./_/assets/demo.png"/>`);

  const templates_wxml = fs
    .readFileSync(path.resolve(__dirname, '../app5/pages/home/templates.wxml'), 'utf-8')
    .split(/\n/g);
  expect(templates_wxml[2].trim()).toBe(`<cook-image default-source="./_/assets/demo.png"/>`);

  const common_b_js = fs
    .readFileSync(path.resolve(__dirname, '../app5/pages/home/_/common/b.js'), 'utf-8')
    .split(/\n/g);
  expect(common_b_js[0].trim()).toBe(`import c from './c';`);

  const com_a_index_js = fs
    .readFileSync(path.resolve(__dirname, '../app5/pages/home/_/components/com-a/index.js'), 'utf-8')
    .split(/\n/g);
  expect(com_a_index_js[0].trim()).toBe(`import a from '../../common/a';`);

  const com_a_index_wxml = fs
    .readFileSync(path.resolve(__dirname, '../app5/pages/home/_/components/com-a/index.wxml'), 'utf-8')
    .split(/\n/g);
  expect(com_a_index_wxml[0].trim()).toBe(`<image src="../../assets/demo.png"/>`);
  expect(com_a_index_wxml[1].trim()).toBe(`<image src="../../assets/demo.png"/>`);
  expect(com_a_index_wxml[2].trim()).toBe(`<include src="./header.wxml"/>`);
});

test('optimizer', async function (this: TestFnThis) {
  const optimizer = new Optimizer(this.dir, 'wx', { plugins: [MergeImport] });
  await optimizer.run(false);
  const { file_contents } = optimizer;
  const exist = _exist.bind(null, file_contents);
  const read = _read.bind(null, file_contents);
  expect(exist('pages/home/_/assets/demo.png')).toBe(true);
  expect(exist('pages/home/_/common/a.js')).toBe(true);
  expect(exist('pages/home/_/common/b.js')).toBe(true);
  expect(exist('pages/home/_/common/c.js')).toBe(true);
  expect(exist('pages/home/_/styles/b.wxss')).toBe(true);
  const index_js = read('pages/home/index.js').split(/\n/g);
  expect(index_js[0]).toBe('import a from "./_/common/a";');
  expect(index_js[2]).toBe(`const b = require("./_/common/b");`);
  const index_wxss = read('pages/home/index.wxss').split(/\n/g);
  expect(index_wxss[0]).toBe(`@import "./_/styles/b.wxss";`);

  const index_wxml = read('pages/home/index.wxml').split(/\n/g);
  expect(index_wxml[0]).toBe(`<include src="./header.wxml"/>`);
  expect(index_wxml[1]).toBe(`<import src="./templates.wxml"/>`);
  expect(index_wxml[2]).toBe(`<wxs src="./tool.wxs" module="tools"/>`);

  expect(index_wxml[10]).toBe(`<include src="./header.wxml"/>`);
  expect(index_wxml[11]).toBe(`<import src="./templates.wxml"/>`);
  expect(index_wxml[12]).toBe(`<wxs src="./tool.wxs" module="tools"/>`);
  expect(index_wxml[14]).toBe(`<view dot/>`);

  const header_wxml = read('pages/home/header.wxml').split(/\n/g);
  expect(header_wxml[3]).toBe(`<image src="./_/assets/demo.png"/>`);

  const templates_wxml = read('pages/home/templates.wxml').split(/\n/g);
  expect(templates_wxml[2].trim()).toBe(`<cook-image default-source="./_/assets/demo.png"/>`);

  const common_b_js = read('pages/home/_/common/b.js').split(/\n/g);
  expect(common_b_js[0].trim()).toBe(`import c from './c';`);

  const com_a_index_js = read('pages/home/_/components/com-a/index.js').split(/\n/g);
  expect(com_a_index_js[0].trim()).toBe(`import a from '../../common/a';`);

  const com_a_index_wxml = read('pages/home/_/components/com-a/index.wxml').split(/\n/g);
  expect(com_a_index_wxml[0].trim()).toBe(`<image src="../../assets/demo.png"/>`);
  expect(com_a_index_wxml[1].trim()).toBe(`<image src="../../assets/demo.png"/>`);
  expect(com_a_index_wxml[2].trim()).toBe(`<include src="./header.wxml"/>`);
});

test('plugin', async function (this: TestFnThis) {
  const TestPlugin = {
    name: 'test-plugin',
    run(this: Optimizer) {
      this.file_contents['xxxx.wxml'] = `<view>123</view>`;
    }
  }
  const optimizer = new Optimizer(this.dir, 'wx', { removeUselessFile: false, plugins: [TestPlugin] });
  await optimizer.run(false);
  expect(_exist(optimizer.file_contents, 'xxxx.wxml')).toBe(true);
  expect(_read(optimizer.file_contents, 'xxxx.wxml')).toBe(`<view>123</view>`);
});