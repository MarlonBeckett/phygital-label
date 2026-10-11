// Tag pages: swap a video thumbnail for the privacy-friendly YouTube player
// only when someone taps it. Without this script the thumbnail still links
// to the video on YouTube.
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[data-yt]');
  if (!a) return;
  var id = a.getAttribute('data-yt');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  e.preventDefault();
  var frame = document.createElement('iframe');
  frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
  frame.title = a.getAttribute('aria-label') || 'YouTube video';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  var box = document.createElement('div');
  box.className = 'lt-player';
  box.appendChild(frame);
  a.replaceWith(box);
});
