/* ==========================================================================
   Shared CRT / phosphor-FX toggle for the Viva New Vegas — Fauxvale Edition
   installation guide. Load this in <head> (synchronously) on every page:

     <script src="crt.js"></script>

   It sets data-crt before first paint (no flash), persists the choice in
   localStorage under "vnv-crt" so it applies across all pages, and wires up
   the .crt-toggle button once the DOM is ready.
   ========================================================================== */
(function () {
  var KEY = "vnv-crt";
  var root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  // Pre-paint: apply the stored state immediately. Default is ON.
  root.setAttribute("data-crt", saved() === "off" ? "off" : "on");

  function wire() {
    var btn = document.querySelector(".crt-toggle");
    if (!btn) return;

    function sync() {
      btn.setAttribute("aria-pressed", root.getAttribute("data-crt") !== "off");
    }
    sync();

    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-crt") === "off" ? "on" : "off";
      root.setAttribute("data-crt", next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      sync();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
