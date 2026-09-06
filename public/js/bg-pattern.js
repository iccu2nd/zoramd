/* Background pattern handled by CSS (dot grid). Canvas disabled for clean design. */
(function () {
  'use strict'
  // Ensure a single .app-background exists if pages expect it
  if (!document.querySelector('.app-background')) {
    var el = document.createElement('div')
    el.className = 'app-background'
    el.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(el, document.body.firstChild)
  }
})()
