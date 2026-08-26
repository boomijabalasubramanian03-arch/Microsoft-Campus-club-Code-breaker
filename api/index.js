import { ensureDailyChallenge, getDb } from "../server/db.js";
import { mountRoutes } from "../server/routes.js";
import app from '../server/app.js';

export default function handler(req, res) {
  return app(req, res);
}

const handlers = [];

const app = {};

app.get = (route, ...fns) => {
  handlers.push({ method: "GET", route, fns });
};

app.post = (route, ...fns) => {
  handlers.push({ method: "POST", route, fns });
};

app.use = () => {};

let startupError = null;

try {
  getDb();
  ensureDailyChallenge();
  mountRoutes(app);
} catch (error) {
  startupError = error;
  console.error("STARTUP ERROR:", error);
}

function parseCookies(header) {
  const result = {};

  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    result[part.slice(0, index).trim()] =
      decodeURIComponent(part.slice(index + 1).trim());
  }

  return result;
}

function createResponse(res) {
  const cookies = [];

  return {
    status(code) {
      res.statusCode = code;
      return this;
    },

    setHeader(name, value) {
      res.setHeader(name, value);
      return this;
    },

    cookie(name, value, options = {}) {
      let cookie =
        `${name}=${encodeURIComponent(value)}; Path=${options.path || "/"}`;

      if (options.httpOnly) cookie += "; HttpOnly";
      if (options.secure) cookie += "; Secure";
      if (options.sameSite) {
        cookie += `; SameSite=${options.sameSite}`;
      }

      cookies.push(cookie);
      return this;
    },

    clearCookie(name, options = {}) {
      cookies.push(
        `${name}=; Max-Age=0; Path=${options.path || "/"}`
      );

      return this;
    },

    json(data) {
      if (cookies.length) {
        res.setHeader("Set-Cookie", cookies);
      }

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );

      res.end(JSON.stringify(data));
    },

    send(data) {
      if (cookies.length) {
        res.setHeader("Set-Cookie", cookies);
      }

      res.end(data);
    }
  };
}

async function runMiddleware(fns, req, res) {
  let index = 0;

  const next = async () => {
    const fn = fns[index++];

    if (!fn) return;

    await fn(req, res, next);
  };

  await next();
}

export default async function handler(req, res) {
  try {
    if (startupError) {
      res.statusCode = 500;

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.end(
        JSON.stringify({
          error: "Backend startup failed",
          message: startupError.message,
          stack: startupError.stack
        })
      );

      return;
    }

    const url = new URL(
      req.url || "/",
      `https://${req.headers.host || "localhost"}`
    );

    req.cookies = parseCookies(
      req.headers.cookie
    );

    req.query = Object.fromEntries(
      url.searchParams.entries()
    );

    if (!req.body) {
      req.body = {};
    }

    const route = handlers.find(
      (item) =>
        item.method === req.method &&
        item.route === url.pathname
    );

    if (!route) {
      res.statusCode = 404;

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.end(
        JSON.stringify({
          error: "Route not found",
          method: req.method,
          path: url.pathname,
          routes: handlers.map(
            (x) => `${x.method} ${x.route}`
          )
        })
      );

      return;
    }

    const response = createResponse(res);

    await runMiddleware(
      route.fns,
      req,
      response
    );

  } catch (error) {
    console.error("API ERROR:", error);

    res.statusCode = 500;

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    res.end(
      JSON.stringify({
        error: "API request failed",
        message: error.message,
        stack: error.stack
      })
    );
  }
}
