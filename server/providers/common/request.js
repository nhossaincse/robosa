/** Read a request body with a hard byte cap; throws { code:'BODY_TOO_LARGE' } past the cap. */
async function readRequestBodyCapped(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > maxBytes) {
        // Keep draining without retaining bytes so the API can deliver a 413.
        // Throwing inside a stream iterator destroys the incoming HTTP socket.
        tooLarge = true;
        chunks.length = 0;
        const error = new Error('Request body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request body was interrupted')));
  });
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let bodyTooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      // Keep draining after the cap without retaining more bytes. Destroying
      // the request also destroys its socket, so the handler cannot deliver
      // the fixed error response it constructs for BODY_TOO_LARGE.
      if (bodyTooLarge) return;
      total += chunk.length;
      if (total > maxBytes) {
        // Same marker readRequestBodyCapped sets, so a caller can tell an
        // oversized body from a genuine failure without matching on text.
        bodyTooLarge = true;
        chunks.length = 0;
        const error = new Error(`Request body exceeds ${maxBytes} bytes`);
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!bodyTooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

export { readRequestBodyCapped, readRequestBody };
