import pluginVue from "eslint-plugin-vue";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"]
  },
  {
    name: "app/files-to-ignore",
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/public/**",
      "**/docs/**",
      "**/.husky/**",
      "**/src/mock/**",
      "**/*.md",
      "**/*.sh",
      "stats.html"
    ]
  },
  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    name: "app/rules",
    rules: {
      "no-var": "error",
      "no-multiple-empty-lines": ["error", { max: 1 }],
      "prefer-const": "off",
      "no-use-before-define": "off",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/prefer-ts-expect-error": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "vue/v-slot-style": "error",
      "vue/no-mutating-props": "error",
      "vue/custom-event-name-casing": "error",
      "vue/html-closing-bracket-newline": "off",
      "vue/attribute-hyphenation": "error",
      "vue/attributes-order": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      "vue/multi-word-component-names": "off"
    }
  }
);
