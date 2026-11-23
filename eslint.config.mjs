import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", ".next-dev/**", "node_modules/**", "prisma/migrations/**"] },
  {
    // SECURITY RULE: the database client may only be used inside src/server/**.
    // Pages, components and route handlers must go through the guarded data layer
    // (src/server/data) so visibility / permission rules can never be skipped.
    files: ["src/app/**", "src/components/**", "src/config/**", "src/lib/**", "src/i18n/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "@/server/db", message: "Use the guarded data layer in @/server/data instead." },
          { name: "@prisma/client", importNames: ["PrismaClient"], message: "Use the guarded data layer." },
        ],
      }],
    },
  },
];
