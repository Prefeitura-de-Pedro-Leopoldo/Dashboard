/**
 * api-base.js — redireciona TODAS as chamadas /api/* para as Edge Functions do
 * Supabase, num único ponto (intercepta window.fetch). Assim o frontend deixa de
 * usar a API da Vercel sem editar cada chamada.
 *
 * Mapa de rotas: /api/<nome> -> <BASE>/<nome>, com um caso especial
 * /api/auth/google -> <BASE>/google (as Edge Functions são "planas").
 *
 * REVERSÍVEL: troque ENABLED para false (ou remova o <script>) e o frontend
 * volta a usar /api/* na Vercel, sem mais nenhuma mudança.
 *
 * Deve ser carregado ANTES de qualquer outro script (primeiro no <head>).
 */
(function () {
  "use strict";
  var BASE = "https://gbtbkviprqnblgdwkaxk.supabase.co/functions/v1";
  var ENABLED = true;
  if (!ENABLED || typeof window === "undefined" || !window.fetch) return;

  function rewrite(rawUrl) {
    var u;
    try { u = new URL(rawUrl, window.location.origin); } catch (e) { return null; }
    if (u.pathname.indexOf("/api/") !== 0) return null;
    var rest = u.pathname.slice(5).replace(/^auth\/google/, "google");
    return BASE + "/" + rest + u.search;
  }

  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (typeof input === "string") {
        var r = rewrite(input);
        if (r) return orig(r, init);
      } else if (input && typeof input.url === "string") {
        var r2 = rewrite(input.url);
        if (r2) return orig(new Request(r2, input), init);
      }
    } catch (e) { /* em erro, segue o fluxo normal */ }
    return orig(input, init);
  };
})();
