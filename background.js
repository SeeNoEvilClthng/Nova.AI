// Keeps work running after the response is sent. On Vercel, waitUntil holds
// the function open until the promise settles; locally the promise simply
// continues in the Node process.
function runInBackground(promise, label = "Background task") {
  try { require("@vercel/functions").waitUntil(promise); } catch { /* not on Vercel */ }
  promise.catch(error => console.error(`${label} failed:`, error.message));
  return promise;
}

module.exports = { runInBackground };
