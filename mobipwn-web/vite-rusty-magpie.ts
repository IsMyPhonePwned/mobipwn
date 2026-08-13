import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const BINARY_URL = "/vendor/rusty-magpie/rusty_magpie";

/** Do not SPA-fallback to index.html when the device binary is missing. */
export function rustyMagpieBinaryPlugin(publicDir: string): Plugin {
  const binPath = path.join(publicDir, "vendor/rusty-magpie/rusty_magpie");

  return {
    name: "rusty-magpie-binary",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== BINARY_URL) {
          next();
          return;
        }
        if (!fs.existsSync(binPath)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(
            "Rusty Magpie binary missing. Run scripts/ensure-rusty-magpie.sh (prebuilt fetch or ANDROID_NDK_HOME build)."
          );
          return;
        }
        next();
      });
    },
  };
}
