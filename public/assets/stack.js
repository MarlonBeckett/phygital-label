// File stacks: swipe through the files (the browser does that on its own),
// or use the ‹ › buttons. Keeps the "2 / 5" count and the Download button on
// the file in view. Loaded by the label pages and the label maker's preview.
(function () {
  function slides(stack) { return stack.querySelectorAll('.lt-file-stack > li'); }

  // Which file is in view.
  function current(stack) {
    var list = stack.querySelector('.lt-file-stack');
    var lis = slides(stack);
    if (!list || lis.length < 2) return 0;
    if (list.scrollLeft >= list.scrollWidth - list.clientWidth - 2) return lis.length - 1;
    var step = (lis[1].offsetLeft - lis[0].offsetLeft) || list.clientWidth || 1;
    return Math.max(0, Math.min(lis.length - 1, Math.round(list.scrollLeft / step)));
  }

  function go(stack, i) {
    var list = stack.querySelector('.lt-file-stack');
    var lis = slides(stack);
    if (!list || !lis.length) return;
    i = Math.max(0, Math.min(lis.length - 1, i));
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ left: lis[i].offsetLeft - lis[0].offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
  }

  // Brings the count, buttons and Download up to date (also after a file is
  // added or a broken one taken out).
  function refresh(stack) {
    var list = stack.querySelector('.lt-file-stack');
    var lis = slides(stack);
    var n = lis.length;
    var i = current(stack);
    if (list) list.classList.toggle('lt-many', n > 1);
    var nav = stack.querySelector('.lt-stack-nav');
    if (nav) {
      nav.hidden = n < 2;
      nav.querySelector('.lt-stack-count').textContent = (i + 1) + ' / ' + n;
      nav.querySelector('.lt-stack-prev').disabled = i === 0;
      nav.querySelector('.lt-stack-next').disabled = i >= n - 1;
    }
    var dl = stack.querySelector('.lt-download-btn');
    var card = n ? lis[i].querySelector('.lt-file-card') : null;
    if (dl) {
      dl.hidden = !card;
      if (card) {
        var name = card.getAttribute('data-name') || '';
        dl.href = card.getAttribute('href');
        dl.setAttribute('download', name);
        dl.setAttribute('aria-label', 'Download ' + name);
      }
    }
    if (!n && !stack.querySelector('.lt-stack-empty') && list) {
      var empty = document.createElement('p');
      empty.className = 'lt-stack-empty';
      empty.textContent = 'No files yet.';
      list.parentNode.insertBefore(empty, list.nextSibling);
    }
  }

  var pending = null;
  document.addEventListener('scroll', function (e) {
    var list = e.target;
    if (!list || !list.classList || !list.classList.contains('lt-file-stack')) return;
    if (pending) return;
    pending = list;
    requestAnimationFrame(function () {
      var stack = pending.closest('.lt-files');
      pending = null;
      if (stack) refresh(stack);
    });
  }, true);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.lt-stack-prev, .lt-stack-next');
    if (!btn) return;
    var stack = btn.closest('.lt-files');
    if (!stack) return;
    // Quick taps add up, even while the last one is still sliding.
    var from = stack.ltTarget != null ? stack.ltTarget : current(stack);
    var n = slides(stack).length;
    var to = Math.max(0, Math.min(n - 1, from + (btn.classList.contains('lt-stack-next') ? 1 : -1)));
    stack.ltTarget = to;
    clearTimeout(stack.ltTimer);
    stack.ltTimer = setTimeout(function () { stack.ltTarget = null; refresh(stack); }, 700);
    go(stack, to);
  });

  window.ltStack = { refresh: refresh, go: go, current: current };
})();
