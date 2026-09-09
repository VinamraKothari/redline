// A bundler-style entry: like Turbopack, it identifies itself by the literal
// src attribute and only "starts" when that is the root-relative path it was
// emitted with. It must also run same-origin so errors are readable.
(function () {
  var src = document.currentScript && document.currentScript.getAttribute("src");
  window.__appSrcAttr = src;
  if (src === "/app.js") window.__appStarted = true;
})();
