import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * Flat config, because `next lint` no longer exists — it was removed in
 * Next.js 16, which meant `npm run lint` had been silently broken (it resolved
 * "lint" as a directory name) and nothing in this project had ever been linted.
 *
 * eslint-config-next 16 ships flat config natively, so these spread straight in
 * — no FlatCompat wrapper needed.
 */
const config = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "coverage/**",
      "e2e/.artifacts/**",
      "next-env.d.ts",
      // Generated to match wrangler.jsonc's bindings — regenerate with
      // `npm run cf:typegen`, don't hand-edit, don't lint.
      "cloudflare-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      /**
       * Every server action in this app takes a leading `_prev` it never reads —
       * that argument is React's previous form state, and the signature is fixed
       * by useActionState, not by us. The underscore prefix is the deliberate
       * convention for "required by a contract, intentionally unused", so honor
       * it rather than sprinkling 20+ disable comments.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // src/worker/index.ts imports .open-next/worker.js, a build artifact that
    // doesn't exist until `npm run cf:build` has run, so the file is excluded
    // from tsconfig and needs @ts-nocheck. Wrangler transpiles it at deploy
    // time. See the comment at the top of that file.
    files: ["src/worker/index.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
];

export default config;
