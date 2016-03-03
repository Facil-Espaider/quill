import Emitter from '../core/emitter';
import Theme from '../core/theme';
import Picker from '../ui/picker';
import icons from '../ui/icons';


class BubbleTheme extends Theme {
  constructor(quill, options) {
    super(quill);
    this.quill.container.classList.add('ql-bubble');
  }

  extendToolbar(toolbar) {
    this.quill.addContainer(toolbar.container, this.quill.root);
    [].forEach.call(toolbar.container.querySelectorAll('button'), (button) => {
      let className = button.getAttribute('class') || '';
      let names = className.split(/\s+/);
      for (let i in names) {
        let name = names[i].slice('ql-'.length);
        if (icons[name] == null) return;
        if (typeof icons[name] === 'string') {
          button.innerHTML = icons[name];
        } else {
          let value = button.getAttribute('data-value') || '';
          if (value != null && icons[name][value]) {
            button.innerHTML = icons[name][value];
          }
        }
      }
    });
    toolbar.container.classList.add('ql-hidden');
    this.quill.on(Emitter.events.SELECTION_CHANGE, (range) => {
      if (range != null && range.length > 0) {
        toolbar.container.classList.remove('ql-hidden');
        let bounds = this.quill.getBounds(range);
        toolbar.container.style.left = (bounds.left + bounds.width/2 - toolbar.container.offsetWidth/2) + 'px';
        toolbar.container.style.top = (bounds.bottom + 10) + 'px';
      } else {
        toolbar.container.classList.add('ql-hidden');
      }
    });
  }
}
BubbleTheme.DEFAULTS = {
  modules: {
    toolbar: [
      ['bold', 'italic', 'link'],
      [{ header: 1 }, { header: 2 }, 'blockquote']
    ]
  }
}


export default BubbleTheme;
