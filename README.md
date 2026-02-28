# NSLSolver Node.js SDK

Node.js client for the [NSLSolver](https://nslsolver.com) captcha API. Zero dependencies, TypeScript support, uses native `fetch`.

Requires Node.js 18+.

## Install

```bash
npm install nslsolver
```

## Usage

```js
import { NSLSolver } from 'nslsolver';
// or: const { NSLSolver } = require('nslsolver');

const solver = new NSLSolver('your-api-key');
```

### Turnstile

```js
const { token } = await solver.solveTurnstile({
  siteKey: '0x4AAAAAAAB...',
  url: 'https://example.com',
  // action, cdata, proxy, userAgent are optional
});
```

### Challenge

```js
const { cookies, userAgent } = await solver.solveChallenge({
  url: 'https://example.com/protected',
  proxy: 'http://user:pass@host:port',
});
```

### Balance

```js
const { balance, maxThreads, allowedTypes } = await solver.getBalance();
```

## Config

```js
const solver = new NSLSolver('your-api-key', {
  timeout: 60_000,
  maxRetries: 5,
  baseUrl: 'https://api.nslsolver.com',
});
```

Defaults: 120s timeout, 3 retries.

## Errors

All errors extend `NSLSolverError`. 429 and 503 are retried automatically before throwing.

```js
import { AuthenticationError, InsufficientBalanceError, RateLimitError, SolveError } from 'nslsolver';

try {
  const { token } = await solver.solveTurnstile({ siteKey: '...', url: '...' });
} catch (err) {
  if (err instanceof AuthenticationError)      { /* 401 - bad key */ }
  if (err instanceof InsufficientBalanceError) { /* 402 - top up */ }
  if (err instanceof RateLimitError)           { /* 429 - after retries */ }
  if (err instanceof SolveError)               { /* 400/503 */ }
}
```

## Documentation

For more information, check out the full documentation at https://docs.nslsolver.com

## License

MIT
