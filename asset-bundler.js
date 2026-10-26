// Boot-time bundling for the HTML shells. A run of consecutive local
// <link rel="stylesheet"> or <script src> tags becomes one content-hashed file
// served with an immutable cache header, so the dashboard loads 2 bundles
// instead of 41 separate requests. Source files are untouched and still served,
// and there is no build step to forget: bundles are rebuilt from the deployed
// sources whenever an instance starts.
const crypto = require("node:crypto");

const stylesheetRun = /(?:<link rel="stylesheet" href="[^"]+">\s*){2,}/g;
const scriptRun = /(?:<script src="[^"]+"><\/script>\s*){2,}/g;
const importRule = /@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g;

function hrefs(run, attribute) {
  return [...run.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map(match => match[1]);
}

// CSS ignores @import after the first rule, so imports from every file are
// hoisted to the top of the bundle to keep fonts loading as before.
function joinCss(bodies) {
  const imports = [];
  const rules = bodies.map(body => body.replace(importRule, rule => { imports.push(rule); return ""; }));
  return [...new Set(imports), ...rules].join("\n");
}

// Each classic script stays a separate statement sequence; the semicolon guards
// against a file that ends without one.
function joinJs(bodies) {
  return bodies.map(body => `${body}\n;`).join("\n");
}

function createBundler({ resolve, read, emit }) {
  const routes = new Map();
  function bundle(paths, extension) {
    const key = `${extension}:${paths.join("|")}`;
    if (routes.has(key)) return routes.get(key);
    const bodies = paths.map(file => read(file).toString("utf8"));
    const body = Buffer.from(extension === ".css" ? joinCss(bodies) : joinJs(bodies));
    const route = `/bundle-${crypto.createHash("sha256").update(body).digest("base64url").slice(0, 16)}${extension}`;
    emit(route, body);
    routes.set(key, route);
    return route;
  }
  function replaceRuns(html, pattern, attribute, extension, tag) {
    return html.replace(pattern, run => {
      const paths = hrefs(run, attribute).map(resolve);
      if (paths.some(file => !file)) return run;
      const trailing = run.match(/\s*$/)[0];
      return tag(bundle(paths, extension)) + trailing;
    });
  }
  return function bundleHtml(html) {
    const withCss = replaceRuns(html, stylesheetRun, "href", ".css", route => `<link rel="stylesheet" href="${route}">`);
    return replaceRuns(withCss, scriptRun, "src", ".js", route => `<script src="${route}"></script>`);
  };
}

module.exports = { createBundler, joinCss, joinJs };
