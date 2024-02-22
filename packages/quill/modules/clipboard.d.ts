import type { ScrollBlot } from 'parchment';
import Delta from 'quill-delta';
import type { EmitterSource } from '../core/emitter';
import Module from '../core/module';
import Quill from '../core/quill';
import type { Range } from '../core/selection';
type Selector = string | Node['TEXT_NODE'] | Node['ELEMENT_NODE'];
type Matcher = (node: Node, delta: Delta, scroll: ScrollBlot, isInsideTable?: Boolean) => Delta;
interface ClipboardOptions {
    matchers: [Selector, Matcher][];
}
declare class Clipboard extends Module<ClipboardOptions> {
    static DEFAULTS: ClipboardOptions;
    matchers: [Selector, Matcher][];
    constructor(quill: Quill, options: Partial<ClipboardOptions>);
    addMatcher(selector: Selector, matcher: Matcher): void;
    convert({ html, text }: {
        html?: string;
        text?: string;
    }, formats?: Record<string, unknown>): Delta;
    protected normalizeHTML(doc: Document): void;
    protected convertHTML(html: string, isInsideTable?: boolean): Delta;
    dangerouslyPasteHTML(html: string, source?: EmitterSource): void;
    dangerouslyPasteHTML(index: number, html: string, source?: EmitterSource): void;
    onCaptureCopy(e: ClipboardEvent, isCut?: boolean): void;
    onCapturePaste(e: ClipboardEvent): void;
    onCopy(range: Range, isCut: boolean): {
        html: string;
        text: string;
    };
    onPaste(range: Range, { text, html }: {
        text?: string;
        html?: string;
    }): void;
    prepareMatching(container: Element, nodeMatches: WeakMap<Node, Matcher[]>): Matcher[][];
    setPastingVariable(value: boolean): void;
}
declare function traverse(scroll: ScrollBlot, node: ChildNode, elementMatchers: Matcher[], textMatchers: Matcher[], nodeMatches: WeakMap<Node, Matcher[]>, isInsideTable?: boolean): Delta;
declare function matchAttributor(node: HTMLElement, delta: Delta, scroll: ScrollBlot): Delta;
declare function matchBlot(node: Node, delta: Delta, scroll: ScrollBlot): Delta;
declare function matchNewline(node: Node, delta: Delta, scroll: ScrollBlot): Delta;
declare function matchText(node: HTMLElement, delta: Delta, scroll: ScrollBlot): Delta;
export { Clipboard as default, matchAttributor, matchBlot, matchNewline, matchText, traverse, };
