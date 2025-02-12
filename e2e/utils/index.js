export const SHORTKEY = process.platform === 'darwin' ? 'Meta' : 'Control';
export function getSelectionInTextNode() {
    const selection = document.getSelection();
    if (!selection) {
        throw new Error('Selection is null');
    }
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
    return JSON.stringify([
        anchorNode.data,
        anchorOffset,
        focusNode.data,
        focusOffset,
    ]);
}
//# sourceMappingURL=index.js.map