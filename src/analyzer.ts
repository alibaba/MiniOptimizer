import fs from 'fs-extra';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { Node } from 'domhandler';
import {
  isIdentifier,
  isStringLiteral,
  isExportAllDeclaration,
  isExportNamedDeclaration,
  isProgram,
} from '@babel/types';
import postcss from 'postcss';
import {
  correct_path,
  resolve_path,
  get_extnames,
  search,
  xml2json,
  is_element,
  assert_file,
  get_source_tags,
} from './utils';
import { BASE_TARGET, CONFIG_FILES, PERMISSIBLE_FILE_TYPES } from './constants';

export type AppType = 'wx' | 'my';

interface SubPackage {
  root: string;
  pages: string[];
}

interface APP {
  subPackages?: SubPackage[];
  subpackages?: SubPackage[];
  pages: string[];
}

export default class Analyzer {
  cwd: string;
  type: AppType;

  get extnames() {
    return get_extnames(this.type);
  }

  /**
   * 所有文件路径
   */
  get all_files() {
    return Object.keys(this.file_contents);
  }

  /**
   * 文件路径 => 文件内容
   */
  file_contents: Record<string, string | Buffer> = {};

  /**
   * 文件路径 => 文件依赖
   */
  file_dependencies: Record<string, string[]> = {};
  /**
   * 所有组件
   */
  components: string[] = [];
  /**
   * 所有页面
   */
  all_pages: string[] = [];
  /**
   * 主包包含的页面
   */
  main_pages: string[] = [];
  /**
   * 所有的子包
   */
  sub_packages: SubPackage[] = [];

  /**
   *
   * @param cwd - 要分析的路径
   * @param type - 小程序类型
   */
  constructor(cwd: string, type: AppType) {
    this.cwd = cwd;
    this.type = type;
  }

  /**
   * 分析
   */
  async analyze() {
    const { cwd, extnames, file_contents } = this;
    const _extnames = Object.values(extnames);
    const all_allowed_extnames = [..._extnames, ...PERMISSIBLE_FILE_TYPES.map((item) => `.${item}`)];
    // TODO: 判断 app.json app.js 是否存在
    const all_files = (await search('**/*.*', this.cwd)).filter((item) => {
      const extname = path.extname(item);
      return all_allowed_extnames.includes(extname);
    });
    (
      await Promise.all(
        all_files.map((item) => {
          const extname = path.extname(item);
          const file_path = path.join(cwd, item);
          if (_extnames.includes(extname)) return fs.readFile(file_path, 'utf-8');
          return fs.readFile(file_path);
        })
      )
    ).forEach((content, index) => {
      const file = all_files[index];
      file_contents[file] = content;
    });
    const content = assert_file(file_contents, 'app.json', extnames.json);
    const { pages, subPackages, subpackages }: APP = JSON.parse(content);
    this.main_pages = [...pages];
    this.all_pages = [...pages];
    const sub_packages = subPackages || subpackages || <SubPackage[]>[];
    this.sub_packages = sub_packages;
    sub_packages.forEach(({ root, pages }) => {
      this.all_pages.push(...pages.map((page) => `${root}/${page}`));
    });
    all_files.forEach((file) => {
      const extname = path.extname(file);
      if (extname === extnames.js) {
        this.analyze_js(file);
      } else if (extname === extnames.json) {
        this.analyze_json(file);
      } else if (extname === extnames.css) {
        this.analyze_css(file);
      } else if (extname === extnames.xml) {
        this.analyze_xml(file);
      } else if (extname === extnames.xs) {
        this.analyze_xs(file);
      }
    });
  }

  /**
   * 获取所有会被打包入主包的文件
   */
  get_main_files(): string[] {
    const { sub_packages, all_files } = this;
    const sub_package_roots = sub_packages.map((item) => `${item.root}/`);
    return all_files.filter((file) => !sub_package_roots.some((root) => file.startsWith(root)));
  }

  /**
   * 获取所有主包依赖的文件
   */
  get_main_used_files() {
    const { main_pages, file_contents } = this;
    const dependencies = new Set<string>();
    // TODO: 微信自定义tab bar
    [...BASE_TARGET, ...main_pages].forEach((page) => {
      this.get_page_dependencies(page).forEach((file) => {
        dependencies.add(file);
      });
    });
    CONFIG_FILES.forEach((file) => {
      if (file in file_contents) {
        dependencies.add(file);
      }
    });
    return [...dependencies];
  }

  /**
   * 获取被打包入主包但主包并不依赖的文件
   */
  get_main_unused_files() {
    const main_files = this.get_main_files();
    const main_used_files = this.get_main_used_files();
    return main_files.filter((file) => !main_used_files.includes(file));
  }

  /**
   * 获取主子包都不需要的文件
   */
  get_useless_files() {
    const { all_files } = this;
    const main_used_files = this.get_main_used_files();
    const sub_used_files = this.get_sub_used_files();
    const used_files = new Set([...main_used_files, ...sub_used_files]);
    return all_files.filter((item) => !used_files.has(item));
  }

  /**
   * 获取所有子包的依赖文件
   */
  get_sub_used_files() {
    const { sub_packages } = this;
    const dependencies = new Set<string>();
    sub_packages.forEach((pkg) => {
      this.get_package_dependencies(pkg).forEach((file) => {
        dependencies.add(file);
      });
    });
    return [...dependencies];
  }

  get_package_dependencies(pkg: SubPackage): string[] {
    const { root, pages } = pkg;
    const dependencies = new Set<string>();
    pages.forEach((page) => {
      this.get_page_dependencies(`${root}/${page}`).forEach((item) => {
        dependencies.add(item);
      });
    });
    return [...dependencies];
  }

  /**
   * 获取子包依赖但主包不依赖的主包文件
   */
  get_sub_outside_files(): Record<string, string[]> {
    const { sub_packages } = this;
    const main_used_files = this.get_main_unused_files();
    const sub_outside_files: Record<string, string[]> = {};
    sub_packages.forEach((item) => {
      const dependencies = this.get_package_dependencies(item);
      sub_outside_files[item.root] = dependencies.filter((item) => main_used_files.includes(item));
    });
    return sub_outside_files;
  }

  private get_page_dependencies(page: string) {
    const {
      extnames: { js, json, xml, css },
      file_contents,
    } = this;
    const dependencies = new Set<string>();
    [js, json, xml, css].forEach((item) => {
      const file = `${page}${item}`;
      if (file in file_contents) {
        this.get_file_dependencies(file).forEach((item) => {
          dependencies.add(item);
        });
      }
    });
    return [...dependencies];
  }

  /**
   * 获取文件依赖
   *
   * @remarks
   * 包含文件本身
   *
   * @param file - 文件名称
   */
  protected get_file_dependencies(file: string, ignores: string[] = []) {
    const { file_dependencies } = this;
    const dependencies = new Set([file]);
    if (file_dependencies[file]) {
      file_dependencies[file].forEach((dep) => {
        const exist_files = [...dependencies, ...ignores];
        if (!exist_files.includes(dep)) {
          this.get_file_dependencies(dep, exist_files).forEach((item) => dependencies.add(item));
        }
      });
    }
    return [...dependencies];
  }

  private analyze_js(file: string) {
    const { cwd, extnames, file_dependencies, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.js);
    const file_path = path.join(cwd, file);
    const file_dir = path.dirname(file_path);
    const ast = parse(content, { sourceType: 'module', sourceFilename: file });
    const dependencies = new Set<string>();
    const add_file = (ref: string) => {
      const import_file_path = correct_path(resolve_path(ref, file_dir, cwd), extnames.js);
      dependencies.add(import_file_path.slice(cwd.length + 1));
    };
    traverse(ast, {
      ImportDeclaration(nodepath) {
        add_file(nodepath.node.source.value);
      },
      ExportDeclaration(nodepath) {
        const { node } = nodepath;
        if ((isExportAllDeclaration(node) || isExportNamedDeclaration(node)) && node.source) {
          add_file(node.source.value);
        }
      },
      CallExpression(nodepath) {
        const { node, scope } = nodepath;
        const { callee, arguments: args } = node;
        const first_args = args[0];
        if (
          isProgram(scope.block) &&
          isIdentifier(callee) &&
          callee.name === 'require' &&
          isStringLiteral(first_args)
        ) {
          add_file(first_args.value);
        }
      },
    });
    file_dependencies[file] = [...dependencies];
  }

  private analyze_xs(file: string) {
    const { cwd, extnames, file_dependencies, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.xs);
    const file_path = path.join(cwd, file);
    const file_dir = path.dirname(file_path);
    const ast = parse(content, { sourceType: 'module', sourceFilename: file });
    const dependencies = new Set<string>();
    traverse(ast, {
      CallExpression(nodepath) {
        const { node, scope } = nodepath;
        const { callee, arguments: args } = node;
        const first_args = args[0];
        if (
          isProgram(scope.block) &&
          isIdentifier(callee) &&
          callee.name === 'require' &&
          isStringLiteral(first_args)
        ) {
          const import_file_path = correct_path(resolve_path(first_args.value, file_dir, cwd), extnames.xs);
          dependencies.add(import_file_path.slice(cwd.length + 1));
        }
      },
    });
    file_dependencies[file] = [...dependencies];
  }

  private analyze_css(file: string) {
    const { cwd, extnames, file_dependencies, file_contents } = this;
    const content = assert_file(file_contents, file, extnames.css);
    const file_path = path.join(cwd, file);
    const file_dir = path.dirname(file_path);
    const ast = postcss.parse(content);
    const dependencies = new Set<string>();
    const add_file = (ref: string) => {
      const import_file_path = correct_path(resolve_path(ref, file_dir, cwd), extnames.css);
      dependencies.add(import_file_path.slice(cwd.length + 1));
    };
    ast.nodes.forEach((rule) => {
      if (rule.type === 'atrule' && rule.name === 'import') {
        add_file(rule.params.slice(1, -1));
      }
      // TODO: css 引用的其他文件
    });
    file_dependencies[file] = [...dependencies];
  }

  private analyze_xml(file: string) {
    const { cwd, extnames, file_dependencies, file_contents, type } = this;
    const content = assert_file(file_contents, file, extnames.xml);
    const file_path = path.join(cwd, file);
    const file_dir = path.dirname(file_path);
    const nodes = xml2json(content);
    const dependencies = new Set<string>();
    const add_file = (ref: string, tagname: string) => {
      const import_file_path = correct_path(
        resolve_path(ref, file_dir, cwd),
        ['import', 'include'].includes(tagname) ? extnames.xml : undefined
      );
      dependencies.add(import_file_path.slice(cwd.length + 1));
    };
    const source_tags = get_source_tags(type);
    const loop = (node: Node) => {
      if (is_element(node)) {
        const { name, attribs, children } = node;
        const attrs = source_tags[name];
        if (attrs) {
          (Array.isArray(attrs) ? attrs : [attrs]).forEach((attr) => {
            if (attribs[attr] && /^\.{0,2}\/(?!\/)/.test(attribs[attr])) {
              add_file(attribs[attr], name);
            }
          });
        }
        if (children && children.length > 0) {
          children.forEach(loop);
        }
      }
    };
    if (nodes.length > 0) {
      nodes.forEach(loop);
    }
    file_dependencies[file] = [...dependencies];
  }

  private analyze_json(file: string) {
    const { cwd, extnames, file_dependencies, file_contents, components } = this;
    const content = assert_file(file_contents, file, extnames.json);
    const file_path = path.join(cwd, file);
    const file_dir = path.dirname(file_path);
    const dependencies = new Set<string>();
    const json = JSON.parse(content);
    const { usingComponents, tabBar } = json;
    const component_file_extnames = [extnames.json, extnames.js, extnames.xml, extnames.css];
    if (usingComponents && Object.keys(usingComponents).length > 0) {
      Object.keys(usingComponents).forEach((item) => {
        if (usingComponents[item].startsWith('plugin://')) return;
        const ref = usingComponents[item];
        const import_file_path = correct_path(resolve_path(ref, file_dir, cwd), extnames.json);
        const component = import_file_path.slice(cwd.length + 1, -extnames.json.length); // 组件
        if (!components.includes(component)) components.push(component);
        component_file_extnames.forEach((extname) => {
          const file = `${component}${extname}`;
          if (file in file_contents) dependencies.add(`${component}${extname}`);
        }); // 组件依赖四个文件
      });
    }
    if (file === 'app.json' && tabBar) {
      // TODO: worker
      const { list } = tabBar;
      if (list && Array.isArray(list) && list.length > 0) {
        list.forEach(({ iconPath, selectedIconPath }) => {
          if (iconPath) dependencies.add(resolve_path(iconPath, file_dir, cwd).slice(cwd.length + 1));
          if (selectedIconPath) dependencies.add(resolve_path(selectedIconPath, file_dir, cwd).slice(cwd.length + 1));
        });
      }
    }
    file_dependencies[file] = [...dependencies];
  }
}
