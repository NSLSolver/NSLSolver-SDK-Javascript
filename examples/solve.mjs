// Runnable examples for every NSLSolver target.
// Usage: NSL_API_KEY=nsl_xxx node examples/solve.mjs
import { NSLSolver, NSLSolverError } from "nslsolver";

const solver = new NSLSolver(process.env.NSL_API_KEY ?? "nsl_your_api_key");

try {
  // Cloudflare Turnstile
  const turnstile = await solver.solveTurnstile({
    siteKey: "0x4AAAAAAAB...",
    url: "https://example.com",
  });
  console.log("turnstile token:", turnstile.token);

  // Cloudflare Challenge (proxy required)
  const challenge = await solver.solveChallenge({
    url: "https://example.com/protected",
    proxy: "http://user:pass@host:port",
  });
  console.log("challenge cookies:", challenge.cookies);

  // Kasada
  const kasada = await solver.solveKasada({
    url: "https://example.com/api",
    userAgent: "Mozilla/5.0 ... Chrome/131.0.0.0 ...",
    uaVersion: 131,
    kasadaConfig: {
      pJsPath: "/149e9513-.../p.js",
      fpHost: "fp.example.com",
      tlHost: "tl.example.com",
    },
  });
  console.log("kasada headers:", kasada.headers);

  // Akamai Bot Manager (userAgent + proxy required)
  const akamai = await solver.solveAkamai({
    url: "https://example.com",
    userAgent: "Mozilla/5.0 ... Chrome/131.0.0.0 ...",
    proxy: "http://user:pass@host:port",
  });
  console.log("akamai _abck:", akamai.cookies["_abck"]);

  // reCAPTCHA v3 (proxy required; enterprise + action optional)
  const recaptcha = await solver.solveRecaptchaV3({
    siteKey: "6Lc...",
    url: "https://example.com",
    proxy: "http://user:pass@host:port",
    action: "login",
    enterprise: false,
  });
  console.log("recaptchav3 token:", recaptcha.token);
} catch (err) {
  if (err instanceof NSLSolverError) {
    console.error(`NSLSolver error (HTTP ${err.statusCode}): ${err.message}`);
  } else {
    throw err;
  }
}
