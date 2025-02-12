import {
  Attributor,
  BlockBlot,
  ClassAttributor,
  EmbedBlot,
  Scope,
  ScrollBlot,
  StyleAttributor,
} from 'parchment';
import Delta from 'quill-delta';
import { BlockEmbed } from '../blots/block';
import { EmitterSource } from '../core/emitter';
import logger from '../core/logger';
import Module from '../core/module';
import Quill from '../core/quill';
import { Range } from '../core/selection';
import { AlignAttribute, AlignStyle } from '../formats/align';
import { BackgroundStyle } from '../formats/background';
import CodeBlock from '../formats/code';
import { ColorStyle } from '../formats/color';
import { DirectionAttribute, DirectionStyle } from '../formats/direction';
import { FontStyle } from '../formats/font';
import { SizeStyle } from '../formats/size';
import { deleteRange } from './keyboard';
import { extend } from 'lodash';

const debug = logger('quill:clipboard');

type Selector = string | Node['TEXT_NODE'] | Node['ELEMENT_NODE'];
type Matcher = (
  node: Node,
  delta: Delta,
  scroll: ScrollBlot,
  isInsideTable?: Boolean,
) => Delta;

const CLIPBOARD_CONFIG: [Selector, Matcher][] = [
  [Node.TEXT_NODE, matchText],
  [Node.TEXT_NODE, matchNewline],
  ['br', matchBreak],
  [Node.ELEMENT_NODE, matchNewline],
  [Node.ELEMENT_NODE, matchBlot],
  [Node.ELEMENT_NODE, matchAttributor],
  [Node.ELEMENT_NODE, matchStyles],
  ['li', matchIndent],
  ['ol, ul', matchList],
  ['pre', matchCodeBlock],
  ['tr', matchTable],
  ['b', matchAlias.bind(matchAlias, 'bold')],
  ['i', matchAlias.bind(matchAlias, 'italic')],
  ['strike', matchAlias.bind(matchAlias, 'strike')],
  ['style', matchIgnore],
];

const ATTRIBUTE_ATTRIBUTORS = [AlignAttribute, DirectionAttribute].reduce(
  (memo, attr) => {
    memo[attr.keyName] = attr;
    return memo;
  },
  {},
);

const STYLE_ATTRIBUTORS = [
  AlignStyle,
  BackgroundStyle,
  ColorStyle,
  DirectionStyle,
  FontStyle,
  SizeStyle,
].reduce((memo, attr) => {
  memo[attr.keyName] = attr;
  return memo;
}, {});

interface ClipboardOptions {
  matchers: [Selector, Matcher][];
}

class Clipboard extends Module<ClipboardOptions> {
  static DEFAULTS: ClipboardOptions;

  matchers: [Selector, Matcher][];

  constructor(quill: Quill, options: Partial<ClipboardOptions>) {
    super(quill, options);
    this.quill.root.addEventListener('copy', e => this.onCaptureCopy(e, false));
    this.quill.root.addEventListener('cut', e => this.onCaptureCopy(e, true));
    this.quill.root.addEventListener('paste', this.onCapturePaste.bind(this));
    this.matchers = [];
    // @ts-expect-error Fix me later
    CLIPBOARD_CONFIG.concat(this.options.matchers).forEach(
      ([selector, matcher]) => {
        this.addMatcher(selector, matcher);
      },
    );
  }

  addMatcher(selector: Selector, matcher: Matcher) {
    this.matchers.push([selector, matcher]);
  }

  convert(
    { html, text }: { html?: string; text?: string },
    formats: Record<string, unknown> = {},
    isInsideTable = false,
  ) {
    if (formats[CodeBlock.blotName]) {
      return new Delta().insert(text || '', {
        [CodeBlock.blotName]: formats[CodeBlock.blotName],
      });
    }
    if (!html) {
      if (text) {
        const deltaSplit = new Delta();
        for (const textPart of text.split('\n')) {
          deltaSplit.insert(textPart).insert('\n', {
            spacing_before: '0px',
            spacing_after: '0px',
            indent_right: '0px',
            indent_left: '0px',
            text_indent: '0px',
            line_spacing: '16px',
          });
        }
        return deltaSplit;
      }
      return new Delta().insert(text || '');
    }
    const delta = this.convertHTML(html, isInsideTable);
    // Remove trailing newline
    if (
      deltaEndsWith(delta, '\n') &&
      (delta.ops[delta.ops.length - 1].attributes == null || formats.table)
    ) {
      return delta.compose(new Delta().retain(delta.length() - 1).delete(1));
    } else if (
      delta.ops.find(
        op =>
          op.attributes &&
          Object.prototype.hasOwnProperty.call(
            op.attributes,
            'table-cell-line',
          ),
      ) &&
      isInsideTable
    ) {
      for (let i = 0; i < delta.ops.length; i++) {
        const op = delta.ops[i];
        if (
          op.attributes &&
          Object.prototype.hasOwnProperty.call(op.attributes, 'table-cell-line')
        ) {
          op.attributes['table-cell-line'] = formats['table-cell-line'];
        }
      }
    }
    return delta;
  }

  convertHTML(html: string, isInsideTable = false) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const container = doc.body;
    const nodeMatches = new WeakMap();
    const [elementMatchers, textMatchers] = this.prepareMatching(
      container,
      nodeMatches,
    );
    return traverse(
      this.quill.scroll,
      container,
      elementMatchers,
      textMatchers,
      nodeMatches,
      isInsideTable,
    );
  }

  dangerouslyPasteHTML(html: string, source?: EmitterSource): void;
  dangerouslyPasteHTML(
    index: number,
    html: string,
    source?: EmitterSource,
  ): void;
  dangerouslyPasteHTML(
    index: number | string,
    html?: string,
    source: EmitterSource = Quill.sources.API,
  ) {
    if (typeof index === 'string') {
      const delta = this.convert({ html: index, text: '' });
      // @ts-expect-error
      this.quill.setContents(delta, html);
      this.quill.setSelection(0, Quill.sources.SILENT);
    } else {
      const paste = this.convert({ html, text: '' });
      this.quill.updateContents(
        new Delta().retain(index).concat(paste),
        source,
      );
      this.quill.setSelection(index + paste.length(), Quill.sources.SILENT);
    }
  }

  onCaptureCopy(e: ClipboardEvent, isCut = false) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const [range] = this.quill.selection.getRange();
    if (range == null) return;
    const { html, text } = this.onCopy(range, isCut);
    e.clipboardData?.setData('text/plain', text);
    e.clipboardData?.setData('text/html', html);
    if (isCut) {
      deleteRange({ range, quill: this.quill });
    }
  }

  onCapturePaste(e: ClipboardEvent) {
    if (e.defaultPrevented || !this.quill.isEnabled()) return;
    e.preventDefault();
    const range = this.quill.getSelection(true);
    if (range == null) return;
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain');
    const files = Array.from(e.clipboardData?.files || []);
    if (!html && files.length > 0) {
      this.quill.uploader.upload(range, files);
      return;
    }
    if (html && files.length > 0) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (
        doc.body.childElementCount === 1 &&
        doc.body.firstElementChild?.tagName === 'IMG'
      ) {
        this.quill.uploader.upload(range, files);
        return;
      }
    }
    this.onPaste(range, { html, text });
  }

  onCopy(range: Range, isCut: boolean): { html: string; text: string };
  onCopy(range: Range) {
    const text = this.quill.getText(range);
    const html = this.quill.getSemanticHTML(range);
    return { html, text };
  }

  onPaste(range: Range, { text, html }: { text?: string; html?: string }) {
    const formats = this.quill.getFormat(range.index);
    const isInsideTable = 'table-cell-line' in formats;
    let pastedDelta = this.convert({ text, html }, formats, isInsideTable);
    if (isInsideTable) {
      const [line] = this.quill.getLine(range.index);
      const lineFormats = line ? line.formats() : {};
      pastedDelta = pastedDelta.reduce((newDelta, op) => {
        if (op.insert && typeof op.insert === 'string') {
          const lines: string[] = [];
          const insertStr = op.insert;
          let start = 0;
          for (let i = 0; i < op.insert.length; i++) {
            if (insertStr.charAt(i) === '\n') {
              if (i === 0) {
                lines.push('\n');
              } else {
                lines.push(insertStr.substring(start, i));
                lines.push('\n');
              }
              start = i + 1;
            }
          }
          const tailStr = insertStr.substring(start);
          if (tailStr) lines.push(tailStr);

          lines.forEach(text => {
            text === '\n'
              ? newDelta.insert('\n', extend({}, op.attributes, lineFormats))
              : newDelta.insert(text, op.attributes);
          });
        } else {
          newDelta.insert(op.insert, op.attributes);
        }

        return newDelta;
      }, new Delta());
    }
    debug.log('onPaste', pastedDelta, { text, html });
    const delta = new Delta()
      .retain(range.index)
      .delete(range.length)
      .concat(pastedDelta);
    this.setPastingVariable(true);
    this.quill.updateContents(delta, Quill.sources.USER);
    this.setPastingVariable(false);
    // range.length contributes to delta.length()
    this.quill.setSelection(
      delta.length() - range.length,
      Quill.sources.SILENT,
    );
    this.quill.scrollIntoView();
  }

  prepareMatching(container: Element, nodeMatches: WeakMap<Node, Matcher[]>) {
    const elementMatchers: Matcher[] = [];
    const textMatchers: Matcher[] = [];
    this.matchers.forEach(pair => {
      const [selector, matcher] = pair;
      switch (selector) {
        case Node.TEXT_NODE:
          textMatchers.push(matcher);
          break;
        case Node.ELEMENT_NODE:
          elementMatchers.push(matcher);
          break;
        default:
          Array.from(container.querySelectorAll(selector)).forEach(node => {
            if (nodeMatches.has(node)) {
              const matches = nodeMatches.get(node);
              matches?.push(matcher);
            } else {
              nodeMatches.set(node, [matcher]);
            }
          });
          break;
      }
    });
    return [elementMatchers, textMatchers];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setPastingVariable(value: boolean) {}
}
Clipboard.DEFAULTS = {
  matchers: [],
};

function applyFormat(delta: Delta, formats: Record<string, unknown>): Delta;
function applyFormat(delta: Delta, format: string, value: unknown): Delta;
function applyFormat(
  delta: Delta,
  format: string | Record<string, unknown>,
  value?: unknown,
): Delta {
  if (typeof format === 'object') {
    return Object.keys(format).reduce((newDelta, key) => {
      return applyFormat(newDelta, key, format[key]);
    }, delta);
  }
  return delta.reduce((newDelta, op) => {
    if (op.attributes && op.attributes[format]) {
      return newDelta.push(op);
    }
    const formats = value ? { [format]: value } : {};
    // @ts-expect-error Fix me later
    return newDelta.insert(op.insert, { ...formats, ...op.attributes });
  }, new Delta());
}

function deltaEndsWith(delta: Delta, text: string) {
  let endText = '';
  for (
    let i = delta.ops.length - 1;
    i >= 0 && endText.length < text.length;
    --i // eslint-disable-line no-plusplus
  ) {
    const op = delta.ops[i];
    if (typeof op.insert !== 'string') break;
    endText = op.insert + endText;
  }
  return endText.slice(-1 * text.length) === text;
}

function isLine(node: Element) {
  if (node.childNodes.length === 0) return false; // Exclude embed blocks
  return [
    'address',
    'article',
    'blockquote',
    'canvas',
    'dd',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'iframe',
    'li',
    'main',
    'nav',
    'ol',
    'output',
    'p',
    'pre',
    'section',
    'table',
    'td',
    'tr',
    'ul',
    'video',
  ].includes(node.tagName.toLowerCase());
}

const preNodes = new WeakMap();
function isPre(node: Node | null) {
  if (node == null) return false;
  if (!preNodes.has(node)) {
    // @ts-expect-error
    if (node.tagName === 'PRE') {
      preNodes.set(node, true);
    } else {
      preNodes.set(node, isPre(node.parentNode));
    }
  }
  return preNodes.get(node);
}

function traverse(
  scroll: ScrollBlot,
  node: ChildNode,
  elementMatchers: Matcher[],
  textMatchers: Matcher[],
  nodeMatches: WeakMap<Node, Matcher[]>,
  isInsideTable = false,
) {
  // Post-order
  if (node.nodeType === node.TEXT_NODE) {
    return textMatchers.reduce((delta: Delta, matcher) => {
      return matcher(node, delta, scroll, isInsideTable);
    }, new Delta());
  }
  if (node.nodeType === node.ELEMENT_NODE) {
    return Array.from(node.childNodes || []).reduce((delta, childNode) => {
      let childrenDelta = traverse(
        scroll,
        childNode,
        elementMatchers,
        textMatchers,
        nodeMatches,
        isInsideTable,
      );
      if (childNode.nodeType === node.ELEMENT_NODE) {
        childrenDelta = elementMatchers.reduce((reducedDelta, matcher) => {
          return matcher(
            childNode as HTMLElement,
            reducedDelta,
            scroll,
            isInsideTable,
          );
        }, childrenDelta);
        childrenDelta = (nodeMatches.get(childNode) || []).reduce(
          (reducedDelta, matcher) => {
            return matcher(childNode, reducedDelta, scroll, isInsideTable);
          },
          childrenDelta,
        );
      }
      return delta.concat(childrenDelta);
    }, new Delta());
  }
  return new Delta();
}

function matchAlias(format: string, node: Element, delta: Delta) {
  return applyFormat(delta, format, true);
}

function matchAttributor(node: HTMLElement, delta: Delta, scroll: ScrollBlot) {
  const attributes = Attributor.keys(node);
  const classes = ClassAttributor.keys(node);
  const styles = StyleAttributor.keys(node);
  const formats = {};
  attributes
    .concat(classes)
    .concat(styles)
    .forEach(name => {
      let attr = scroll.query(name, Scope.ATTRIBUTE) as Attributor;
      if (attr != null) {
        formats[attr.attrName] = attr.value(node);
        if (formats[attr.attrName]) return;
      }
      attr = ATTRIBUTE_ATTRIBUTORS[name];
      if (attr != null && (attr.attrName === name || attr.keyName === name)) {
        formats[attr.attrName] = attr.value(node) || undefined;
      }
      attr = STYLE_ATTRIBUTORS[name];
      if (attr != null && (attr.attrName === name || attr.keyName === name)) {
        attr = STYLE_ATTRIBUTORS[name];
        formats[attr.attrName] = attr.value(node) || undefined;
      }
    });
  if (Object.keys(formats).length > 0) {
    return applyFormat(delta, formats);
  }
  return delta;
}

function matchBlot(node: Node, delta: Delta, scroll: ScrollBlot) {
  const match = scroll.query(node);
  if (match == null) return delta;
  // @ts-expect-error
  if (match.prototype instanceof EmbedBlot) {
    const embed = {};
    // @ts-expect-error
    const value = match.value(node);
    if (value != null) {
      // @ts-expect-error
      embed[match.blotName] = value;
      // @ts-expect-error
      return new Delta().insert(embed, match.formats(node, scroll));
    }
  } else {
    // @ts-expect-error
    if (match.prototype instanceof BlockBlot && !deltaEndsWith(delta, '\n')) {
      delta.insert('\n');
    }
    // @ts-expect-error
    if (typeof match.formats === 'function') {
      // @ts-expect-error
      return applyFormat(delta, match.blotName, match.formats(node, scroll));
    }
  }
  return delta;
}

function matchBreak(node: Node, delta: Delta) {
  if (!deltaEndsWith(delta, '\n')) {
    delta.insert('\n');
  }
  return delta;
}

function matchCodeBlock(node, delta, scroll) {
  const match = scroll.query('code-block');
  const language = match ? match.formats(node, scroll) : true;
  return applyFormat(delta, 'code-block', language);
}

function matchIgnore() {
  return new Delta();
}

function matchIndent(node: Node, delta: Delta, scroll: ScrollBlot) {
  const match = scroll.query(node);
  if (
    match == null ||
    // @ts-expect-error
    match.blotName !== 'list' ||
    !deltaEndsWith(delta, '\n')
  ) {
    return delta;
  }
  let indent = -1;
  let parent = node.parentNode;
  while (parent != null) {
    // @ts-expect-error
    if (['OL', 'UL'].includes(parent.tagName)) {
      indent += 1;
    }
    parent = parent.parentNode;
  }
  if (indent <= 0) return delta;
  return delta.reduce((composed, op) => {
    if (op.attributes && typeof op.attributes.indent === 'number') {
      return composed.push(op);
    }
    // @ts-expect-error Fix me later
    return composed.insert(op.insert, { indent, ...(op.attributes || {}) });
  }, new Delta());
}

function matchList(node: Node, delta: Delta) {
  // @ts-expect-error
  const list = node.tagName === 'OL' ? 'ordered' : 'bullet';
  return applyFormat(delta, 'list', list);
}

function matchNewline(node: Node, delta: Delta, scroll: ScrollBlot) {
  if (!deltaEndsWith(delta, '\n')) {
    // @ts-expect-error
    if (isLine(node)) {
      return delta.insert('\n', {
        spacing_before: '0px',
        spacing_after: '0px',
        indent_right: '0px',
        indent_left: '0px',
        text_indent: '0px',
        line_spacing: '16px',
      });
    }
    if (delta.length() > 0 && node.nextSibling) {
      let nextSibling: Node | null = node.nextSibling;
      while (nextSibling != null) {
        // @ts-expect-error
        if (isLine(nextSibling)) {
          return delta.insert('\n', {
            spacing_before: '0px',
            spacing_after: '0px',
            indent_right: '0px',
            indent_left: '0px',
            text_indent: '0px',
            line_spacing: '16px',
          });
        }
        const match = scroll.query(nextSibling);
        // @ts-expect-error
        if (match && match.prototype instanceof BlockEmbed) {
          return delta.insert('\n', {
            spacing_before: '0px',
            spacing_after: '0px',
            indent_right: '0px',
            indent_left: '0px',
            text_indent: '0px',
            line_spacing: '16px',
          });
        }
        nextSibling = nextSibling.firstChild;
      }
    }
  }
  return delta;
}

function matchStyles(node: HTMLElement, delta: Delta) {
  const formats: Record<string, unknown> = {};
  const style: Partial<CSSStyleDeclaration> = node.style || {};
  if (style.fontStyle === 'italic') {
    formats.italic = true;
  }
  if (style.textDecoration === 'underline') {
    formats.underline = true;
  }
  if (style.textDecoration === 'line-through') {
    formats.strike = true;
  }
  if (
    style.fontWeight?.startsWith('bold') ||
    // @ts-expect-error Fix me later
    parseInt(style.fontWeight, 10) >= 700
  ) {
    formats.bold = true;
  }
  if (Object.keys(formats).length > 0) {
    delta = applyFormat(delta, formats);
  }
  // @ts-expect-error
  if (parseFloat(style.textIndent || 0) > 0) {
    // Could be 0.5in
    return new Delta().insert('\t').concat(delta);
  }
  return delta;
}

function matchTable(node, delta) {
  const table =
    node.parentNode.tagName === 'TABLE'
      ? node.parentNode
      : node.parentNode.parentNode;
  const rows = Array.from(table.querySelectorAll('tr'));
  const row = rows.indexOf(node) + 1;
  return applyFormat(delta, 'table', row);
}

function matchText(node, delta) {
  let text = node.data;
  // Word represents empty line with <o:p>&nbsp;</o:p>
  if (node.parentNode.tagName === 'O:P') {
    return delta.insert(text.trim());
  }
  if (!isPre(node)) {
    if (text.trim().length === 0 && text.includes('\n')) {
      return delta;
    }
    const replacer = (collapse, match) => {
      const replaced = match.replace(/[^\u00a0]/g, ''); // \u00a0 is nbsp;
      return replaced.length < 1 && collapse ? ' ' : replaced;
    };
    text = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
    text = text.replace(/\s\s+/g, replacer.bind(replacer, true)); // collapse whitespace
    if (
      (node.previousSibling == null && isLine(node.parentNode)) ||
      (node.previousSibling != null && isLine(node.previousSibling))
    ) {
      text = text.replace(/^\s+/, replacer.bind(replacer, false));
    }
    if (
      (node.nextSibling == null && isLine(node.parentNode)) ||
      (node.nextSibling != null && isLine(node.nextSibling))
    ) {
      text = text.replace(/\s+$/, replacer.bind(replacer, false));
    }
  }
  return delta.insert(text);
}

export {
  Clipboard as default,
  matchAttributor,
  matchBlot,
  matchNewline,
  matchText,
  traverse,
};
