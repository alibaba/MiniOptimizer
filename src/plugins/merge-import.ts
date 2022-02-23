import Optimizer from '../index';
import { assert_file, correct_path, id_generator, relative_path } from '../utils';
import { parse } from '@babel/parser';
import path from 'path';
import traverse from '@babel/traverse';
import { isIdentifier, isImportDefaultSpecifier, isImportNamespaceSpecifier, isImportSpecifier } from '@babel/types';
import Generator from '@babel/generator';

const ENTRY_JS_FILENAME = '__entry__.js';

interface ImportInfo {
  file: string;
  imports: Record<string, string> | 'ALL';
}

export function gen_entry_js(infos: Record<string, ImportInfo[]>): [string, Record<string, Record<string, string>>] {
  const file_used_exports_map: Record<string, { has_default: boolean; used_exports: string[]; has_all: boolean }> = {};
  Object.keys(infos).forEach((key) => {
    infos[key].forEach((item) => {
      const { file, imports } = item;
      if (!file_used_exports_map[file]) {
        file_used_exports_map[file] = { has_default: false, used_exports: [], has_all: false };
      }
      const target = file_used_exports_map[file];
      if (imports === 'ALL') {
        target.has_all = true;
      } else {
        Object.values(imports).forEach((item) => {
          if (item === 'default') target.has_default = true;
          else target.used_exports.push(item);
        });
      }
      target.used_exports = [...new Set(target.used_exports)]; // 唯一化
    });
  });
  const content: string[] = [];
  const rename_export_map: Record<string, Record<string, string>> = {};
  Object.keys(file_used_exports_map).forEach((key) => {
    const item = file_used_exports_map[key];
    const { has_all, has_default, used_exports } = item;
    const file = key.slice(0, -3);
    const map: Record<string, string> = {};
    if (has_all) {
      const v = id_generator();
      content.push(`import * as ${v} from './${file}}';`);
      map['*'] = v;
    }
    const exs /** exports */ = used_exports.map((item) => {
      const v = id_generator();
      map[item] = v;
      return `${item} as ${v}`;
    });
    if (has_default) {
      const v = id_generator();
      map['default'] = v;
      if (exs.length > 0) {
        content.push(`import ${v}, { ${exs.join(', ')} } from './${file}';`);
      } else content.push(`import ${v} from './${file}';`);
    } else {
      if (exs.length > 0) {
        content.push(`import { ${exs.join(', ')} } from './${file}';`);
      } else if (!has_all) {
        content.push(`import './${file}';`);
      }
    }
    rename_export_map[key] = map;
  });
  const variables = Object.values(rename_export_map)
    .map((item) => Object.values(item))
    .flat(1);
  content.push(`module.exports = { ${variables.join(', ')} }`);
  return [content.join('\n'), rename_export_map];
}

function gather_import_infos(this: Optimizer, file: string): ImportInfo[] {
  const { file_contents, cwd, extnames } = this;
  const content = assert_file(file_contents, file, extnames.js);
  const ast = parse(content, { sourceType: 'module' });
  const file_dir = path.dirname(path.join(cwd, file));
  const imports: ImportInfo[] = [];
  traverse(ast, {
    ImportDeclaration(nodepath) {
      const {
        node: { specifiers, source },
      } = nodepath;
      const ref = source.value;
      const import_file = correct_path(path.resolve(file_dir, ref), extnames.js).slice(cwd.length + 1);
      const info: { file: string; imports: Record<string, string> } = {
        file: import_file,
        imports: {},
      };
      specifiers.forEach((item) => {
        if (isImportDefaultSpecifier(item)) {
          info.imports[item.local.name] = 'default';
        } else if (isImportSpecifier(item) && isIdentifier(item.imported)) {
          info.imports[item.local.name] = item.imported.name;
        } else if (isImportNamespaceSpecifier(item)) {
          info.imports[item.local.name] = 'ALL';
        }
      });
      imports.push(info);
    },
  });
  return imports;
}

function optimize_import(this: Optimizer, file: string, rename_export_map: Record<string, Record<string, string>>) {
  const { file_contents, cwd, extnames, file_dependencies } = this;
  const content = assert_file(file_contents, file, extnames.js);
  const ast = parse(content, { sourceType: 'module' });
  const file_dir = path.dirname(path.join(cwd, file));
  const exports: string[] = [];
  const removed_imports: string[] = [];
  traverse(ast, {
    ImportDeclaration(nodepath) {
      const {
        node: { specifiers, source },
      } = nodepath;
      const ref = source.value;
      const import_file = correct_path(path.resolve(file_dir, ref), extnames.js).slice(cwd.length + 1);
      removed_imports.push(import_file);
      const variable_map = rename_export_map[import_file];
      specifiers.forEach((item) => {
        if (isImportDefaultSpecifier(item)) {
          exports.push(`${variable_map['default']} as ${item.local.name}`);
        } else if (isImportSpecifier(item) && isIdentifier(item.imported)) {
          const imported_name = item.imported.name;
          exports.push(`${variable_map[imported_name]} as ${item.local.name}`);
        } else if (isImportNamespaceSpecifier(item)) {
          exports.push(`${variable_map['*']} as ${item.local.name}`);
        }
      });
      nodepath.remove();
    },
  });
  const entry_file_path = path.join(cwd, ENTRY_JS_FILENAME);
  const new_code = Generator(ast).code;
  file_contents[file] = [
    `import { ${exports.join(', ')} } from '${relative_path(file_dir, entry_file_path).slice(0, -3)}';`,
    new_code,
  ].join('\n');
  file_dependencies[file].push(ENTRY_JS_FILENAME);
  file_dependencies[file] = file_dependencies[file].filter((item) => !removed_imports.includes(item));
}

export default {
  name: 'merge-import',
  run(this: Optimizer) {
    const { extnames, file_contents, file_dependencies } = this;
    const main_used_files = this.get_main_files();
    const imports_info: Record<string, ImportInfo[]> = {};
    const isTarget = (file: string) => {
      const filename = file.slice(0, -extnames.json.length);
      const is_page = this.main_pages.includes(filename);
      const is_component = this.components.includes(filename);
      return is_page || is_component || file === 'app.json' || file === 'custom-tab-bar/index.json';
    };
    main_used_files.forEach((file) => {
      const extname = path.extname(file);
      if (extname === extnames.json) {
        const filename = file.slice(0, -extnames.json.length);
        if (isTarget(file)) {
          const js_file = `${filename}${extnames.js}`;
          imports_info[js_file] = gather_import_infos.call(this, js_file);
        }
      }
    });
    const [entry_js_content, rename_export_map] = gen_entry_js(imports_info);
    main_used_files.forEach((file) => {
      const extname = path.extname(file);
      if (extname === extnames.json) {
        const filename = file.slice(0, -extnames.json.length);
        if (isTarget(file)) {
          const js_file = `${filename}${extnames.js}`;
          optimize_import.call(this, js_file, rename_export_map);
        }
      }
    });
    file_contents[ENTRY_JS_FILENAME] = entry_js_content;
    file_dependencies[ENTRY_JS_FILENAME] = Object.keys(rename_export_map);
  },
};
