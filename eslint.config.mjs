import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Плоский конфиг вместо .eslintrc.json: в eslint 9 старый формат не читается,
// а next lint, который раньше его подхватывал, вырезан из Next 16.
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "public/**",
      "data/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
