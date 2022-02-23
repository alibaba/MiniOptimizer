import Analyzer from './analyzer';
import type { AppType } from './analyzer';
import micromatch from 'micromatch';
import path from 'path';
import fs from 'fs-extra';
import { parse } from '@babel/parser';
import type { Node } from 'domhandler';
import { transformSync } from '@babel/core';
import { isExportAllDeclaration, isExportNamedDeclaration, isIdentifier, isStringLiteral } from '@babel/types';
import postcss from 'postcss';
import traverse from '@babel/traverse';
import Generator from '@babel/generator';
import cssnano from 'cssnano';
import render from './dom-serializer';
import {
  get_new_path,
  resolve_path,
  xml2json,
  is_element,
  rename_files,
  assert_file,
  get_source_tags,
  tag_generator,
} from './utils';
import minify_xml from './minify-xml';
import { SERIALIZER_CONFIG, JS_BABEL_CONFIG, CONFIG_FILES, WX_PAGE_JSON_KEYS, XS_BABEL_CONFIG } from './constants';

const CWD = process.cwd();

interface Plugin<T = any> {
  name?: string;
  run: (this: Optimizer, config: T) => void;
}

type PluginConfig<T = any> = string | [string, T] | Plugin<T> | [Plugin<T>, T];

export interface OptimizerConfig {
  output?: string;
  removeUselessFile?: boolean;
  uselessExculde?: string[];
  renameFile?: boolean;
  renameExculde?: string[];
  renamedFilesMap?: string;
  renameComponent?: boolean;
  renamedComponentsMap?: string;
  minifyJs?: boolean;
  mergeImport?: boolean;
  minifyJson?: boolean;
  minifyXml?: boolean;
  minifyCss?: boolean;
  minifyXs?: boolean;
  plugins?: PluginConfig[];
}

export default class Optimizer extends Analyzer {
  config: OptimizerConfig;

  constructor(cwd: string, type: AppType, config: OptimizerConfig = {}) {
    super(cwd, type);
    this.config = config;
  }

  /**
   * 移除文件
   */
  remove_files(files: string[]) {
    const { extnames, components } = this;
    files.forEach((file) => {
      const name = file.slice(0, -extnames.json.length);
      const index = components.indexOf(name);
      if (index !== -1) components.splice(index, 1);
      delete this.file_contents[file];
      delete this.file_dependencies[file];
    });
  }

  /**
   * 获取所有可以重命名的文件
   *
   * @remarks
   * 仅处理主包的文件
   *
   * 1. 不重命名 `app.js` `app.json` 等
   * 2. 页面路由的四个文件不重命名
   * 3. custom-tab-bar 文件夹下四个文件不重命名
   *
   */
  private get_renamable_files() {
    const {
      main_pages,
      extnames: { js, json, xml, css },
      file_contents,
      file_dependencies,
      config: { renameExculde },
    } = this;
    const main_used_files = this.get_main_used_files();
    const rename_exculdes = [...main_pages, 'custom-tab-bar/index', 'app'].reduce((p, item) => {
      [js, json, xml, css].forEach((extname) => {
        const file = `${item}${extname}`;
        if (file in file_contents) {
          p.push(file);
        }
      });
      return p;
    }, [] as string[]);
    rename_exculdes.push(...CONFIG_FILES);
    const renameable_files = main_used_files.filter((file) => {
      if (rename_exculdes.includes(file)) return false;
      if (!renameExculde) return true;
      return !micromatch.isMatch(file, renameExculde);
    });
    const file_times_map: Record<string, number> = {};
    const add = (file: string) => {
      if (!file_times_map[file]) file_times_map[file] = 0;
      file_times_map[file] += 1;
    };
    main_used_files.forEach((file) => {
      if (file.endsWith(js)) {
        add(file);
        const dependencies = file_dependencies[file];
        if (dependencies && dependencies.length > 0) {
          dependencies.forEach(add);
        }
      }
    });
    return renameable_files.sort((a, b) => {
      const ta = file_times_map[a] || 0;
      const tb = file_times_map[b] || 0;
      if (ta > tb) return -1;
      if (ta < tb) return 1;
      return 0;
    });
  }

  /**
   * 移动主包文件到子包的 _ 目录或者重命名主包文件
   * @param files
   * @param key
   */
  private move_files(files: string[], key: string | Record<string, string>) {
    const { all_files, file_contents, extnames, file_dependencies, components } = this;
    const old_new_map: Record<string, string> = {};
    files.forEach((item) => {
      const extname = path.extname(item);
      const name = item.slice(0, extname ? -extname.length : undefined);
      const new_name = typeof key === 'string' ? `${key}/_/${item}` : `${key[name]}${extname}`;
      if (item in file_contents) {
        file_contents[new_name] = file_contents[item];
        file_dependencies[new_name] = file_dependencies[item];
      }
      old_new_map[item] = new_name;
    });
    Object.keys(old_new_map)
      .filter((item) => item.endsWith(extnames.json))
      .forEach((item) => {
        const extname_len = extnames.json.length;
        const name = item.slice(0, -extname_len);
        if (components.includes(name)) components.push(old_new_map[item].slice(0, -extname_len));
      });
    const all_relate_files =
      typeof key === 'string' ? Object.keys(file_contents).filter((item) => item.startsWith(`${key}/`)) : all_files;
    all_relate_files.forEach((file) => {
      const extname = path.extname(file);
      if (extname === extnames.json) {
        this.convert_json(file, old_new_map);
      } else if (extname === extnames.js) {
        this.convert_js(file, old_new_map);
      } else if (extname === extnames.xml) {
        this.convert_xml(file, old_new_map);
      } else if (extname === extnames.css) {
        this.convert_css(file, old_new_map);
      } else if (extname === extnames.xs) {
        this.convert_xs(file, old_new_map);
      }
      const dependencies = file_dependencies[file];
      if (dependencies && dependencies.length > 0)
        file_dependencies[old_new_map[file] || file] = dependencies.map((item) => old_new_map[item] || item);
    });
  }

  async run(write = true) {
    await this.analyze();
    const { extnames, file_contents, type } = this;
    const {
      removeUselessFile = false,
      uselessExculde,
      renameFile = false,
      renamedFilesMap,
      renameComponent = false,
      renamedComponentsMap,
      minifyXml = false,
      minifyJs = false,
      minifyCss = false,
      minifyXs = false,
      minifyJson = false,
      plugins = [],
    } = this.config;
    // 处理子包依赖文件
    const sub_outside_files = this.get_sub_outside_files();
    for (const pkg in sub_outside_files) {
      this.move_files(sub_outside_files[pkg], pkg);
    }
    for (const pkg in sub_outside_files) {
      this.remove_files(sub_outside_files[pkg]);
    }

    plugins
      .map((item) => (Array.isArray(item) ? item : [item, undefined]))
      .forEach(([item, config]) => {
        if (typeof item !== 'string') {
          // @ts-ignore
          if (item && item.run) {
            // @ts-ignore
            item.run.call(this, config);
          }
        } else {
          const file_path = /^\.{1,2}\//.test(item) ? path.resolve(CWD, item) : item;
          // eslint-disable-next-line
          const plugin = require(file_path);
          if (plugin.default) plugin.default.run.call(this, config);
          else plugin.run.call(this, config);
        }
      });

    // 重命名自定义标签名
    if (renameComponent) {
      const main_used_files = this.get_main_used_files();
      const all_json_files = main_used_files.filter((item) => item.endsWith('.json'));
      const component_hash_map: Record<string, string> = {};
      all_json_files.forEach((file) => Object.assign(component_hash_map, this.rename_component(file)));
      if (Object.keys(component_hash_map).length !== new Set(Object.values(component_hash_map)).size)
        throw new Error('标签重命名错误');
      if (renamedComponentsMap)
        fs.writeFileSync(renamedComponentsMap, JSON.stringify(component_hash_map, null, 2), 'utf-8');
    }

    if (renameFile === true) {
      const renameable_files = this.get_renamable_files();
      const old_new_map = rename_files(renameable_files);
      if (new Set(Object.values(old_new_map)).size !== Object.keys(old_new_map).length)
        throw new Error('文件重命名失败');
      this.move_files(renameable_files, old_new_map);
      this.remove_files(renameable_files);
      if (renamedFilesMap) fs.writeFileSync(renamedFilesMap, JSON.stringify(old_new_map, null, 2), 'utf-8');
    }

    const main_used_files = this.get_main_used_files();

    if (minifyJson === true && type === 'wx') {
      // 先不处理支付宝
      const all_json_files = main_used_files.filter((item) => item.endsWith(extnames.json));
      all_json_files.forEach((item) => this.optimize_json(item));
    }

    if (minifyCss === true) {
      const all_css_files = main_used_files.filter((item) => item.endsWith(extnames.css));
      await Promise.all(all_css_files.map((item) => this.optimize_css(item)));
    }

    if (minifyJs === true) {
      const all_js_files = main_used_files.filter((item) => item.endsWith(extnames.js));
      all_js_files.forEach((file) => this.optimize_js(file));
    }

    if (minifyXs === true) {
      const all_xs_files = main_used_files.filter((item) => item.endsWith(extnames.xs));
      all_xs_files.forEach((file) => this.optimize_xs(file));
    }

    if (minifyXml === true) {
      const all_xml_files = main_used_files.filter((item) => item.endsWith(extnames.xml));
      all_xml_files.forEach((file) => this.optimize_xml(file));
    }

    if (removeUselessFile === true) {
      const useless_files = this.get_useless_files();
      this.remove_files(
        useless_files.filter((file) => {
          if (!uselessExculde) return true;
          if (Array.isArray(uselessExculde) && uselessExculde.length === 0) return true;
          return !micromatch.isMatch(file, uselessExculde);
        })
      );
    }

    if (write) await this.write();
    return file_contents;
  }

  write() {
    const {
      file_contents,
      config: { output },
    } = this;
    const cwd = output || this.cwd;
    fs.removeSync(cwd);
    return Promise.all(
      [...Object.entries(file_contents)].map(async ([file, content]) => {
        const file_path = path.join(cwd, file);
        const file_dir = path.dirname(file_path);
        await fs.ensureDir(file_dir);
        if (typeof content === 'string') return fs.writeFile(file_path, content, 'utf-8');
        return fs.writeFile(file_path, content);
      })
    );
  }

  protected optimize_js(file: string) {
    const { file_contents, extnames } = this;
    const content = assert_file(file_contents, file, extnames.js);
    const result = transformSync(content, { ...JS_BABEL_CONFIG });
    if (!result || !result.code) return;
    file_contents[file] = result.code;
  }

  private optimize_xs(file: string) {
    const { file_contents, extnames } = this;
    const content = assert_file(file_contents, file, extnames.xs);
    const result = transformSync(content, { ...XS_BABEL_CONFIG });
    if (!result || !result.code) return;
    file_contents[file] = result.code;
  }

  private rename_component(file: string): Record<string, string> {
    const { extnames, file_contents, cwd } = this;
    const content = assert_file(file_contents, file, extnames.json);
    const component_hash_map: Record<string, string> = {};
    const json = JSON.parse(content);
    const usingComponents = json.usingComponents;
    if (!usingComponents || Object.keys(usingComponents).length === 0) return {};
    const file_dir = path.dirname(path.join(cwd, file));
    const old_new_map: Record<string, string> = {};
    for (const key in usingComponents) {
      const p = resolve_path(usingComponents[key], file_dir, cwd).slice(cwd.length + 1);
      const ext = path.extname(p);
      const id = p.slice(0, ext ? -ext.length : undefined);
      const new_key = tag_generator(id);
      component_hash_map[id] = new_key;
      old_new_map[key] = new_key;
      usingComponents[new_key] = usingComponents[key];
      delete usingComponents[key];
    }
    const xml_path = `${file.slice(0, -extnames.json.length)}${extnames.xml}`;
    const dependencies = this.get_file_dependencies(xml_path);
    dependencies.forEach((dep) => {
      const extname = path.extname(dep);
      if (extname === extnames.xml) {
        this.rename_tag(dep, old_new_map);
      }
    });
    if (Object.keys(old_new_map).length !== new Set(Object.values(old_new_map)).size) {
      throw new Error('组件重命名错误');
    }
    file_contents[file] = JSON.stringify(json, null, 2);
    return component_hash_map;
  }

  protected rename_tag(file: string, old_new_map: Record<string, string>) {
    const { extnames, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.xml);
    let new_content = content;
    Object.keys(old_new_map).forEach((key) => {
      const new_key = old_new_map[key];
      new_content = new_content
        .replace(new RegExp(`(?<=<)${key}(?=\\s+|>)`, 'gm'), new_key)
        .replace(new RegExp(`(?<=</)${key}(?=>)`, 'gm'), new_key);
    });
    file_contents[file] = new_content;
  }

  protected optimize_css(file: string) {
    const { extnames, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.css);
    return postcss([cssnano({ preset: ['default', { reduceIdents: true, mergeIdents: true, discardUnused: true }] })])
      .process(content, { from: 'post.css' })
      .then((result) => {
        return (file_contents[file] = result.css);
      });
  }

  protected optimize_xml(file: string) {
    const { extnames, file_contents, type } = this;
    const content = assert_file(file_contents, file, extnames.xml);
    file_contents[file] = minify_xml(content, type);
  }

  protected optimize_json(file: string) {
    const { extnames, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.json);
    const filename = file.slice(0, -extnames.json.length);
    const json = JSON.parse(content);
    const is_page = this.main_pages.includes(filename);
    const is_component = this.components.includes(filename);
    if (is_component) {
      Object.keys(json).forEach((key) => {
        if (key !== 'usingComponents') {
          delete json[key];
        }
      });
    } else if (is_page) {
      Object.keys(json).forEach((key) => {
        if (!WX_PAGE_JSON_KEYS.includes(key)) delete json[key];
      });
    } else {
      // TODO: app.json ext.json sitemap.json
    }
    file_contents[file] = JSON.stringify(json, null, 2);
  }

  /**
   * 变更`import` `require` `export .. from`的引用路径
   * @param file - 原始文件
   * @param old_new_map - 新旧文件名Map
   */
  private convert_js(file: string, old_new_map: Record<string, string>) {
    const { cwd, file_contents, extnames } = this;
    const content = assert_file(file_contents, file, extnames.js);
    const ast = parse(content, { sourceType: 'module', sourceFilename: file });
    const p = (ref: string) => get_new_path(file, ref, old_new_map, cwd, extnames.js).slice(0, -extnames.js.length);
    traverse(ast, {
      ImportDeclaration(nodepath) {
        const ref = nodepath.node.source.value;
        nodepath.node.source.value = p(ref);
      },
      ExportDeclaration(nodepath) {
        const { node } = nodepath;
        if ((isExportAllDeclaration(node) || isExportNamedDeclaration(node)) && node.source) {
          const ref = node.source.value;
          node.source.value = p(ref);
        }
      },
      CallExpression(nodepath) {
        const { node, scope } = nodepath;
        const { callee, arguments: args } = node;
        const first_args = args[0];
        if (
          scope.block.type === 'Program' &&
          isIdentifier(callee) &&
          callee.name === 'require' &&
          isStringLiteral(first_args)
        ) {
          const ref = first_args.value;
          first_args.value = p(ref);
        }
      },
    });
    file_contents[old_new_map[file] || file] = Generator(ast).code;
  }

  /**
   * 变更`require`的引用路径
   * @param file - 原始文件
   * @param old_new_map - 新旧文件名Map
   */
  private convert_xs(file: string, old_new_map: Record<string, string>) {
    const { cwd, file_contents, extnames } = this;
    const content = assert_file(file_contents, file, extnames.xs);
    const ast = parse(content, { sourceType: 'module', sourceFilename: file });
    traverse(ast, {
      CallExpression(nodepath) {
        const { node, scope } = nodepath;
        const { callee, arguments: args } = node;
        const first_args = args[0];
        if (
          scope.block.type === 'Program' &&
          isIdentifier(callee) &&
          callee.name === 'require' &&
          isStringLiteral(first_args)
        ) {
          const ref = first_args.value;
          first_args.value = get_new_path(file, ref, old_new_map, cwd, extnames.js).slice(0, -extnames.xs.length);
        }
      },
    });
    file_contents[old_new_map[file] || file] = Generator(ast, { minified: true }).code;
  }

  /**
   * 修改 xml 的引用路径
   * @param file - 原始文件
   * @param old_new_map - 新旧文件名Map
   */
  private convert_xml(file: string, old_new_map: Record<string, string>) {
    const { cwd, type, file_contents, extnames } = this;
    const content = assert_file(file_contents, file, extnames.xml);
    const nodes = xml2json(content);
    const source_tags = get_source_tags(type);
    const loop = (node: Node) => {
      if (is_element(node)) {
        const { name, attribs, children } = node;
        const attrs = source_tags[name];
        (Array.isArray(attrs) ? attrs : [attrs]).forEach((attr) => {
          const ref = attribs[attr];
          if (attribs[attr] && typeof attribs[attr] === 'string' && /^\.{0,2}\//.test(attribs[attr])) {
            attribs[attr] = get_new_path(
              file,
              ref,
              old_new_map,
              cwd,
              ['include', 'import'].includes(name) ? extnames.xml : undefined
            );
          }
        });
        if (children && children.length > 0) {
          children.forEach(loop);
        }
      }
    };
    nodes.forEach(loop);
    const new_conent = render(nodes, SERIALIZER_CONFIG);
    file_contents[old_new_map[file] || file] = new_conent;
  }
  /**
   * 替换 `@import` 的引用路径
   * @param file - 原始文件
   * @param old_new_map - 新旧文件名Map
   */
  private convert_css(file: string, old_new_map: Record<string, string>) {
    const { cwd, extnames, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.css);
    const ast = postcss.parse(content);
    ast.nodes.forEach((rule) => {
      if (rule.type === 'atrule' && rule.name === 'import') {
        const ref = rule.params.slice(1, -1);
        rule.params = `"${get_new_path(file, ref, old_new_map, cwd, extnames.css)}"`;
      }
    });
    file_contents[old_new_map[file] || file] = ast.toString();
  }
  /**
   *
   * @param file
   * @param old_new_map
   */
  private convert_json(file: string, old_new_map: Record<string, string>) {
    const { cwd, file_contents, extnames } = this;
    const content = assert_file(file_contents, file, extnames.json);
    const json = JSON.parse(content);
    if (json && json.usingComponents) {
      Object.keys(json.usingComponents).forEach((item) => {
        const ref = json.usingComponents[item];
        if (ref.startsWith('plugin://')) return;
        json.usingComponents[item] = get_new_path(file, ref, old_new_map, cwd, extnames.json, true).slice(
          0,
          -extnames.json.length
        );
      });
    }
    if (file === 'app.json') {
      const { tabBar } = json;
      if (tabBar && tabBar.list && Array.isArray(tabBar.list)) {
        tabBar.list.forEach((item: any = {}) => {
          const { iconPath, selectedIconPath } = item;
          if (iconPath) {
            item.iconPath = get_new_path(file, iconPath, old_new_map, cwd, undefined, true);
          }
          if (selectedIconPath) {
            item.selectedIconPath = get_new_path(file, selectedIconPath, old_new_map, cwd, undefined, true);
          }
        });
      }
    }
    file_contents[old_new_map[file] || file] = JSON.stringify(json, null, 2);
  }
}
