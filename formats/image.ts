import { EmbedBlot } from 'parchment';
import { sanitize } from './link';

const ATTRIBUTES = [
  'alt',
  'height',
  'width',
  'naturalWidth',
  'behindText',
  'wrapType',
  'top',
  'left',
  // Âncoras da forma no Word (página x margem). Sem elas na lista, o Delta perde a referência de
  // posicionamento da imagem ao passar pelo editor, e o cabeçalho/rodapé importado do Word volta
  // a renderizar as imagens flutuantes fora da faixa visível.
  'relative-h',
  'relative-v',
];

class Image extends EmbedBlot {
  static blotName = 'image';
  static tagName = 'IMG';

  static create(value) {
    const node = super.create(value) as Element;
    if (typeof value === 'string') {
      node.setAttribute('src', this.sanitize(value));
    }
    return node;
  }

  static formats(domNode: Element) {
    return ATTRIBUTES.reduce((formats, attribute) => {
      if (domNode.hasAttribute(attribute)) {
        formats[attribute] = domNode.getAttribute(attribute);
      }
      return formats;
    }, {});
  }

  static match(url: string) {
    return /\.(jpe?g|gif|png)$/.test(url) || /^data:image\/.+;base64/.test(url);
  }

  static register() {
    if (/Firefox/i.test(navigator.userAgent)) {
      setTimeout(() => {
        // Disable image resizing in Firefox
        // @ts-expect-error
        document.execCommand('enableObjectResizing', false, false);
      }, 1);
    }
  }

  static sanitize(url: string) {
    return sanitize(url, ['http', 'https', 'data']) ? url : '//:0';
  }

  static value(domNode: Element) {
    return domNode.getAttribute('src');
  }

  domNode: HTMLImageElement;

  format(name, value) {
    if (ATTRIBUTES.indexOf(name) > -1) {
      if (value != null) {
        this.domNode.setAttribute(name, value);
      } else {
        this.domNode.removeAttribute(name);
      }
    } else {
      super.format(name, value);
    }
  }
}

export default Image;
