import { inject } from '@vercel/analytics';

inject();

const tabs = document.querySelectorAll('.pkg-manager');
const codeEl = document.getElementById('cmdCode');
const copyBtn = document.getElementById('copyBtn');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    if (codeEl) codeEl.textContent = tab.dataset.cmd ?? '';
  });
});

copyBtn?.addEventListener('click', () => {
  if (!codeEl?.textContent) return;
  void navigator.clipboard.writeText(codeEl.textContent);
  copyBtn.classList.add('copied');
  setTimeout(() => copyBtn.classList.remove('copied'), 2000);
});
