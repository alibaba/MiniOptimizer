import { transformSync } from '@babel/core';
import Generator from '@babel/generator';
import type { Node } from 'domhandler';
// @ts-ignore
import utils from 'html-minifier/src/utils';
// hack inline tag
const old = utils.createMapFromString;
utils.createMapFromString = function (value: string, ignoreCase: boolean) {
  if (
    value ===
    'a,abbr,acronym,b,bdi,bdo,big,button,cite,code,del,dfn,em,font,i,ins,kbd,label,mark,math,nobr,object,q,rp,rt,rtc,ruby,s,samp,select,small,span,strike,strong,sub,sup,svg,textarea,time,tt,u,var'
  ) {
    return old(`text`, ignoreCase);
  }
  if (
    value ===
    'a,abbr,acronym,b,big,del,em,font,i,ins,kbd,mark,nobr,rp,s,samp,small,span,strike,strong,sub,sup,time,tt,u,var'
  ) {
    return old(`text`, ignoreCase);
  }
  return old(value, ignoreCase);
};
import { minify } from 'html-minifier';
import { MINIFY_XML_CONFIG, XML_BABLE_CONFIG, SERIALIZER_CONFIG } from './constants';
import render from './dom-serializer';
import type { AppType } from './analyzer';
import { is_element, is_text, xml2json } from './utils';

interface Actions {
  mark: () => void;
  rollback: () => void;
  next: () => string;
  peek: () => string;
  eof: () => boolean;
  croak: (msg: string) => never;
}

function InputStream(input: string): Actions {
  let pos = 0,
    line = 1,
    col = 0;
  const _pos: { pos: number; line: number; col: number } = { pos: 0, line: 1, col: 0 };
  return {
    mark,
    rollback,
    next,
    peek,
    eof,
    croak,
  };

  function mark() {
    Object.assign(_pos, { pos, line, col });
  }
  function rollback() {
    ({ pos, line, col } = _pos);
  }
  function next() {
    const ch = input.charAt(pos++);
    if (ch == '\n') line++, (col = 0);
    else col++;
    return ch;
  }
  function peek() {
    return input.charAt(pos);
  }
  function eof() {
    return peek() == '';
  }
  function croak(msg: string): never {
    throw new Error(msg + ' (' + line + ':' + col + ')');
  }
}

interface Token {
  type: string;
  value: any;
}

function ETokenStream(input: Actions) {
  let current: Token | null = null;

  return { next, eof: eof };

  function read_while(predicate: () => boolean) {
    let str = '';
    while (!input.eof() && !predicate()) str += input.next();
    return str;
  }

  function read_expr() {
    let str = '';
    let num = 0;
    input.next();
    input.next();
    while (!input.eof()) {
      const ch = input.next();
      if (ch === "'" || ch === '"') {
        str += ch;
        str += read_escaped(ch);
      } else if (ch === '{') {
        num += 1;
      } else if (ch === '}') {
        if (num === 0) {
          if (is_expr_end()) {
            break;
          } else {
            input.croak('parse error');
          }
        } else {
          num -= 1;
        }
      }
      str += ch;
    }
    input.next();
    return { type: 'expr', value: str };
  }

  function read_escaped(end: string) {
    let escaped = false,
      str = '';
    while (!input.eof()) {
      const ch = input.next();
      if (escaped) {
        str += ch;
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === end) {
        break;
      } else {
        str += ch;
      }
    }
    return str;
  }

  function is_expr_start() {
    input.mark();
    const ch = input.peek();
    if (ch === '{') {
      input.next();
      if (input.peek() === '{') {
        input.next();
        input.rollback();
        return true;
      }
    }
    input.rollback();
    return false;
  }

  function is_expr_end() {
    input.mark();
    const ch = input.peek();
    if (ch === '}') {
      if (input.next() === '}') {
        input.rollback();
        return true;
      }
    }
    input.rollback();
    return false;
  }

  function read_next(): Token | null {
    if (input.eof()) return null;
    if (is_expr_start()) return read_expr();
    return { type: 'str', value: read_while(is_expr_start) };
  }

  function peek(): Token | null {
    return current || (current = read_next());
  }

  function next(): Token | null {
    const tok = current;
    current = null;
    return tok || read_next();
  }

  function eof(): boolean {
    return peek() == null;
  }
}

const E_CACHES = new Map<string, Token[]>();
/**
 * 分析字符串
 * @param source
 * @returns
 */
function parse_str(source: string): Token[] {
  if (!E_CACHES.get(source)) {
    const exprs: Token[] = [];
    const stream = ETokenStream(InputStream(source));
    while (!stream.eof()) {
      exprs.push(stream.next() as Token);
    }
    E_CACHES.set(source, exprs);
  }
  return E_CACHES.get(source) as Token[];
}

/**
 * 优化标签属性
 * @param attr
 * @param type
 * @returns
 */
export function minify_attr(attr: string, type: 'default' | 'data' | 'class' | 'style' = 'default') {
  const is_data = type === 'data';
  const tokens = parse_str(is_data ? `{${attr}}` : attr);
  const prefix = 'var a=';
  const list = tokens.map((item) => {
    if (item.type === 'str') return item.value;
    if (item.type === 'expr') {
      const code = `${prefix}${item.value.trim()};`;
      const result = transformSync(code, {
        sourceType: 'script',
        minified: true,
        ast: true,
        ...XML_BABLE_CONFIG,
      });
      if (!result || !result.ast) return;
      const new_code = Generator(result.ast, {
        comments: false,
        minified: true,
        jsescOption: { quotes: 'single', wrap: true },
      }).code.slice(prefix.length, -1);
      if (!is_data && /\{.*?\}$/.test(new_code)) return `{{ ${new_code} }}`;
      return is_data ? `{${new_code}}` : `{{${new_code}}}`; // 移除 `;`
    }
    return '';
  });
  if (type === 'style') {
    return list
      .map((item, i) => {
        if (tokens[i].type === 'expr') return item.trim();
        return item
          .replace(/\s+(?=:)|(?<=:)\s+|\s+(?=;)|(?<=;)\s+/g, '') // 去除 : ; 前后的空格
          .replace(/;+/g, ';') // 去除 : ; 前后的空格
          .split(/(?=;)/)
          .map((item: string) => {
            return item.replace(/^\s+|\s+$/, ' '); // 如果结尾没有分号 替换末尾多余的空格为一个
          })
          .join('');
      })
      .join('')
      .trim()
      .replace(/;+$/, ''); // 移出末尾多余分号;
  }
  if (type === 'class') {
    return list
      .map((item, i) => {
        if (tokens[i].type === 'expr') return item.trim();
        return item.trim().split(/ +/).join(' ');
      })
      .filter((item) => item.trim())
      .join(' ');
  }
  return list.filter((item) => item.trim()).join('');
}

const LOGICAL_REG = /^(wx|a):(if|elif|else)$/;
const FOR_REG = /^(wx|a):(for|for-item|for-index|key)$/;

export default function minify_xml(source: string, type: AppType = 'wx') {
  source = minify(source, MINIFY_XML_CONFIG);
  const nodes = xml2json(source);
  const loop = (node: Node) => {
    if (is_element(node)) {
      const { name, attribs, children, parent } = node;
      let need_process = true;
      if (parent && name === 'block' && children.length === 1 && is_element(children[0])) {
        const index = parent.children.indexOf(node);
        const next = parent.children[index + 1];
        const attr_keys = Object.keys(attribs);
        const child_attr_keys = Object.keys(children[0].attribs);
        if (!attr_keys.some((item) => child_attr_keys.includes(item))) {
          // 属性存在冲突无法合并，例如block和子标签都存在wx:if
          const has_if = attr_keys.some((item) => LOGICAL_REG.test(item));
          const only_if = attr_keys.some((item) => /^(wx|a):if$/.test(item));
          const child_has_if = child_attr_keys.some((item) => LOGICAL_REG.test(item));
          // const has_for = attr_keys.some((item) => FOR_REG.test(item));
          const child_has_for = child_attr_keys.some((item) => FOR_REG.test(item));
          if (
            !(has_if && (child_has_for || child_has_if)) || // block 包含 if elif else 子节点包含 if 或者 for
            (only_if && // block 是 if
              (!next ||
                (is_element(next) && !Object.keys(next.attribs).some((item) => /^(wx|a):(elif|else)$/.test(item))))) // 没有下一个节点或者下一个阶段不是elif 或者else的
          ) {
            Object.assign(children[0].attribs, attribs);
            need_process = false;
            if (index !== -1) {
              children[0].parent = parent;
              parent.children.splice(index, 1, children[0]);
            }
          }
        }
      }
      if (need_process) {
        for (const key in attribs) {
          const attr = attribs[key];
          if (typeof attr !== 'string') continue;
          let new_attr;
          if (key === 'class') new_attr = minify_attr(attr, 'class');
          else if (key === 'style') new_attr = minify_attr(attr, 'style');
          else if (name === 'template' && key === 'data') new_attr = minify_attr(attr, 'data');
          else new_attr = minify_attr(attr);
          // @ts-ignore
          attribs[key] = new_attr === '{{true}}' ? true : new_attr;
          if (type === 'wx') {
            if (/^(bind|catch):(.*)$/.test(key)) {
              attribs[`${RegExp.$1}${RegExp.$2}`] = attribs[key];
              delete attribs[key];
            }
            if (
              (key === 'wx:for-index' && new_attr === 'index') ||
              (key === 'wx:for-item' && new_attr === 'item') ||
              (key === 'style' && new_attr === '') ||
              (key === 'class' && new_attr === '')
            ) {
              delete attribs[key];
            }
          }
        }
      }
      if (children && children.length > 0) {
        children.forEach(loop);
      }
    } else if (is_text(node)) {
      if (node.data) node.data = minify_attr(node.data);
    }
  };
  nodes.forEach(loop);
  return minify(render(nodes, SERIALIZER_CONFIG), MINIFY_XML_CONFIG);
}
