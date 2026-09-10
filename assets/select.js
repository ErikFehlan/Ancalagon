(function () {
  'use strict';

  const instances = new WeakMap();
  let openInstance = null;

  function close(instance, restoreFocus) {
    if (!instance || !instance.wrapper.classList.contains('open')) return;
    instance.wrapper.classList.remove('open');
    instance.button.setAttribute('aria-expanded', 'false');
    if (openInstance === instance) openInstance = null;
    if (restoreFocus) instance.button.focus();
  }

  function enhance(select) {
    if (instances.has(select) || select.multiple || select.size > 1) return;

    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    const menu = document.createElement('div');
    const menuId = `${select.id || 'select'}-options-${Math.random().toString(36).slice(2, 8)}`;
    wrapper.className = 'rf-select';
    button.className = 'rf-select-button';
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', menuId);
    menu.className = 'rf-select-menu';
    menu.id = menuId;
    menu.setAttribute('role', 'listbox');

    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, button, menu);
    select.classList.add('rf-native-select');

    const instance = { select, wrapper, button, menu, activeIndex: -1 };
    instances.set(select, instance);

    function options() { return Array.from(select.options); }
    function enabledIndexes() { return options().map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0); }

    function sync() {
      const list = options();
      const selectedIndex = select.selectedIndex;
      const selected = list[selectedIndex];
      button.textContent = selected ? selected.textContent : 'Select an option';
      button.disabled = select.disabled;
      button.setAttribute('aria-label', select.getAttribute('aria-label') || selected?.textContent || 'Select an option');
      menu.innerHTML = '';
      list.forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'rf-select-option';
        if (!option.value) item.classList.add('rf-select-empty');
        if (index === selectedIndex) item.classList.add('selected');
        item.textContent = option.textContent;
        item.disabled = option.disabled;
        item.dataset.index = String(index);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(index === selectedIndex));
        item.addEventListener('click', () => choose(index));
        menu.appendChild(item);
      });
      instance.activeIndex = selectedIndex;
    }

    function setActive(index) {
      const items = Array.from(menu.children);
      items.forEach(item => item.classList.remove('active'));
      const item = items[index];
      if (!item || item.disabled) return;
      instance.activeIndex = index;
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    }

    function choose(index) {
      const option = select.options[index];
      if (!option || option.disabled) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      sync();
      close(instance, true);
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    function open() {
      if (button.disabled) return;
      if (openInstance && openInstance !== instance) close(openInstance);
      sync();
      wrapper.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      openInstance = instance;
      const available = enabledIndexes();
      setActive(available.includes(select.selectedIndex) ? select.selectedIndex : available[0]);
    }

    button.addEventListener('click', () => wrapper.classList.contains('open') ? close(instance) : open());
    button.addEventListener('keydown', event => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') return close(instance, true);
      if (!wrapper.classList.contains('open')) {
        open();
        if (event.key === 'Enter' || event.key === ' ') return;
      }
      const available = enabledIndexes();
      if (!available.length) return;
      let position = available.indexOf(instance.activeIndex);
      if (event.key === 'ArrowDown') position = Math.min(available.length - 1, position + 1);
      if (event.key === 'ArrowUp') position = Math.max(0, position < 0 ? 0 : position - 1);
      if (event.key === 'Home') position = 0;
      if (event.key === 'End') position = available.length - 1;
      if (event.key === 'Enter' || event.key === ' ') return choose(instance.activeIndex);
      setActive(available[position]);
    });

    select.addEventListener('change', sync);
    select.addEventListener('focus', () => button.focus());
    select.form?.addEventListener('reset', () => setTimeout(sync));
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
    sync();
  }

  function enhanceAll(root) {
    root.querySelectorAll?.('select').forEach(enhance);
  }

  document.addEventListener('click', event => {
    if (openInstance && !openInstance.wrapper.contains(event.target)) close(openInstance);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openInstance) close(openInstance, true);
  });

  enhanceAll(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    if (node.matches?.('select')) enhance(node);
    enhanceAll(node);
  }))).observe(document.body, { childList: true, subtree: true });
})();
