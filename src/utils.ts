import { Parser } from 'htmlparser2';
import type { Node, Element, Text } from 'domhandler';
import { DomHandler } from 'domhandler';
import path from 'path';
import glob from 'glob';
import { C, N, UC } from './constants';

export function get_extnames(type: 'wx' | 'my') {
  if (type === 'wx') return { js: '.js', json: '.json', xml: '.wxml', css: '.wxss', xs: '.wxs', svg: '.svg' };
  return { js: '.js', json: '.json', xml: '.axml', css: '.acss', xs: '.sjs', svg: '.svg' };
}

export function is_element(node: Node): node is Element {
  return node.type === 'tag';
}

export function is_text(node: Node): node is Text {
  return node.type === 'text';
}

const oldonopentag = DomHandler.prototype.onopentag;
DomHandler.prototype.onopentag = function (
  this: { __attribs__: any },
  name: string,
  attribs: { [key: string]: string }
) {
  const attrs = this.__attribs__;
  oldonopentag.call(this, name, { ...attribs, ...attrs } as { [key: string]: string });
  this.__attribs__ = undefined;
};

//@ts-ignore
DomHandler.prototype.onattribute = function (
  this: { __attribs__: any },
  name: string,
  value: string,
  quote?: string | undefined | null
) {
  if (quote === undefined) {
    if (!this.__attribs__) this.__attribs__ = {};
    this.__attribs__[name] = true;
  }
};

export function assert_file(file_contents: Record<string, string | Buffer>, file: string, type: string): string {
  const extname = path.extname(file);
  if (extname !== type) throw new Error(`${file} is not ${type} file`);
  if (!(file in file_contents)) throw new Error(`${file} is not found`);
  const content = file_contents[file];
  if (typeof content !== 'string') throw new Error(`${file}'s content is not string`);
  return content;
}

export function get_source_tags(type: 'wx' | 'my'): Record<string, string[] | string> {
  if (type === 'wx') {
    return { wxs: 'src', import: 'src', include: 'src', image: 'src', 'cook-image': ['src', 'default-source'] };
  }
  return { 'import-sjs': 'from', import: 'src', include: 'src', image: 'src', 'cook-image': ['src', 'default-source'] };
}

export function xml2json(source: string) {
  let result: Node[] = [];
  const handler = new DomHandler((error, dom) => {
    if (!error) {
      result = dom;
    }
  });
  const parser = new Parser(handler, {
    xmlMode: true,
    recognizeSelfClosing: true,
  });
  // 手动添加一个根节点
  parser.write(`${source.trim()}`);
  parser.end();
  return result;
}

export function correct_path(apath: string, ext?: string): string {
  if (!ext) return apath;
  return apath.endsWith(ext) ? apath : `${apath}${ext}`;
}

export function resolve_path(apath: string, dir: string, cwd: string) {
  if (/^\//.test(apath)) return path.join(cwd, apath);
  return path.resolve(dir, apath);
}

export function relative_path(from: string, to: string) {
  const p = path.relative(from, to);
  if (/^\.{1,2}\//.test(p)) return p;
  return `./${p}`;
}

export function search(pattern: string, cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    glob(pattern, { cwd, nodir: true }, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
}

const gen_id = generator_generator(`${C}${UC}$_${N}`);

export function id_generator(): string {
  const id = gen_id();
  if (['of', 'do', 'if', 'in', 'for', 'new', 'try', 'int', 'var', 'let'].includes(id) || /^\d/.test(id))
    return id_generator();
  return id;
}

export const filename_generator = generator_generator(`${C}${N}$-_`);

export const tag_generator = generator_generator(`${C}`, true);

/**
 *
 * @param files
 * @returns
 */
export function rename_files(files: string[]): Record<string, string> {
  const names = [
    ...new Set(
      files.map((item) => {
        const ext = path.extname(item);
        return item.slice(0, ext ? -ext.length : undefined);
      })
    ),
  ];
  return names.reduce((prev, item) => {
    prev[item] = filename_generator();
    return prev;
  }, {} as Record<string, string>);
}

export function generator_generator(chars: string, idempotent?: false): () => string;
export function generator_generator(chars: string, idempotent?: true): (source: string) => string;
export function generator_generator(chars: string, idempotent = false) {
  const len = chars.length;
  let index = 0;
  const CACHE_MAP: Record<string, string> = {};
  function generator(index: number) {
    if (index < len) {
      return chars[index];
    } else if (index < Math.pow(len, 2)) {
      const c_1 = chars[Math.floor(index / len)];
      const c_2 = chars[index % len];
      return `${c_1}${c_2}`;
    } else if (index < Math.pow(len, 3)) {
      const c_1 = chars[Math.floor(index / Math.pow(len, 2))];
      const c_2 = chars[Math.floor(index / len) % len];
      const c_3 = chars[index % len];
      return `${c_1}${c_2}${c_3}`;
    }
    throw new Error('Gen Error');
  }
  if (idempotent)
    return (source: string): string => {
      if (!CACHE_MAP[source]) CACHE_MAP[source] = generator(index++);
      return CACHE_MAP[source];
    };
  return (): string => generator(index++);
}

/**
 * 生成新的路径
 * @param filename 文件名
 * @param ref 引用的文件
 * @param cwd cwd
 * @param ext 文件后缀
 * @returns
 */
export function get_new_path(
  filename: string,
  ref: string,
  old_new_map: Record<string, string>,
  cwd: string,
  ext?: string,
  optimize?: boolean
): string {
  ext = ext || path.extname(ref);
  const old_names = Object.keys(old_new_map);
  const new_names = Object.values(old_new_map);
  filename = old_names[new_names.indexOf(filename)] || filename; // 获取文件的原始路径
  const file_path = path.join(cwd, filename);
  const ref_path = correct_path(resolve_path(ref, path.dirname(file_path), cwd), ext);
  const refname = ref_path.slice(cwd.length + 1);
  const new_refname = old_new_map[refname] || refname;
  const new_filename = old_new_map[filename] || filename;
  const new_file_dir = path.dirname(path.join(cwd, new_filename));
  const new_ref_path = path.join(cwd, new_refname);
  let new_ref = path.relative(new_file_dir, new_ref_path);
  if (!/^\.{0,2}\//.test(new_ref)) new_ref = `./${new_ref}`;
  if (!optimize) return new_ref;
  const new_absolute_ref = new_ref_path.slice(cwd.length);
  if (new_absolute_ref.length > new_ref.length) return new_ref;
  return new_absolute_ref;
}
