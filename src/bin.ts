#!/usr/bin/env node
import Optimizer, { OptimizerConfig } from './index';
import path from 'path';
import fs from 'fs';
import { Command } from 'commander';

const program = new Command('optimize');

const cwd = process.cwd();
program
  .usage('<path> [options]')
  .option('-t, --type <type>', 'type of mini app wx or my', 'wx')
  .option('-c, --config <path>', 'path to config file', './optimizer.config.json')
  .option('-o, --output <path to fold>', 'redirect output to the fold')
  .option('--remove-useless-file', 'remove useless file')
  .option('--minify-css', 'minify css')
  .option('--minify-js', 'minify js')
  .option('--minify-xs', 'minify xs (.sjs|.wxs)')
  .option('--minify-xml', 'minify xml')
  .option('--minify-json', 'minify json')
  .option('--rename-file', 'rename file')
  .option('--renamed-files-map <file path>', 'write renamed file map to the file', './renamed-files-map.json')
  .option('--rename-component', 'rename component')
  .option(
    '--renamed-components-map <file path>',
    'write renamed component map to the file',
    './renamed-components-map.json'
  );

program.parse(process.argv);

interface Options {
  type: 'wx' | 'my';
  config: string;
  output?: string;
  renameFile?: boolean;
  renamedFilesMap?: string;
  renameComponent?: boolean;
  renamedComponentsMap?: string;
  removeUselessFile?: boolean;
  minifyCss?: boolean;
  minifyJs?: boolean;
  minifyXml?: boolean;
  minifyJson?: boolean;
  minifyXs?: boolean;
}

const options = program.opts<Options>();
const config_path = path.join(cwd, options.config);

const config: OptimizerConfig = {};

if (fs.existsSync(config_path)) {
  Object.assign(config, JSON.parse(fs.readFileSync(path.join(cwd, options.config), 'utf-8')));
}

const keys: Array<keyof Options> = [
  'type',
  'renameComponent',
  'renamedComponentsMap',
  'removeUselessFile',
  'renameFile',
  'minifyCss',
  'minifyJs',
  'minifyJson',
  'minifyXml',
  'minifyXs',
  'renamedFilesMap',
  'output',
];

for (const item of keys) {
  if (item in options) {
    // @ts-ignore
    config[item] = options[item];
  }
}

// 转换路径
['output', 'renamedComponentsMap', 'renamedFilesMap'].forEach((item) => {
  // @ts-ignore
  if (config[item]) {
    // @ts-ignore
    config[item] = path.resolve(cwd, config[item]);
  }
});
const [t] = program.args;
const target = path.resolve(cwd, t);

async function run() {
  const optimizer = new Optimizer(target, options.type, config);
  await optimizer.run();
}

run();
