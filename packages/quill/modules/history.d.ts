import type Delta from 'quill-delta';
import Module from '../core/module';
import Quill from '../core/quill';
import type Scroll from '../blots/scroll';
import type { Range } from '../core/selection';
export interface HistoryOptions {
    userOnly: boolean;
    delay: number;
    maxStack: number;
}
export interface StackItem {
    delta: Delta;
    range: Range | null;
}
interface Stack {
    undo: StackItem[];
    redo: StackItem[];
}
declare class History extends Module<HistoryOptions> {
    static DEFAULTS: HistoryOptions;
    lastRecorded: number;
    ignoreChange: boolean;
    stack: Stack;
    currentRange: Range | null;
    constructor(quill: Quill, options: Partial<HistoryOptions>);
    change(source: 'undo' | 'redo', dest: 'redo' | 'undo'): void;
    clear(): void;
    cutoff(): void;
    record(changeDelta: Delta, oldDelta: Delta): void;
    redo(): void;
    transform(delta: Delta): void;
    undo(): void;
    setIsChangeFromHistory(value: boolean): void;
    protected restoreSelection(stackItem: StackItem): void;
}
declare function getLastChangeIndex(scroll: Scroll, delta: Delta): number;
export { History as default, getLastChangeIndex };
