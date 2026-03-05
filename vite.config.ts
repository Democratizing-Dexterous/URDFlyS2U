import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { createSvgIconsPlugin } from "vite-plugin-svg-icons";
// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), createSvgIconsPlugin({
    iconDirs: [resolve(process.cwd(), "src/assets/svgs")],
    symbolId: "icon-[dir]-[name]"
  })],
  // 包含 wasm 文件作为静态资源
  assetsInclude: ['**/*.wasm'],
  // opencascade.js 不能被 Vite 预构建优化
  optimizeDeps: {
    exclude: ['opencascade.js']
  },
  // Worker 构建配置
  worker: {
    format: 'es', // 使用 ES module 格式，支持 Worker 内 dynamic import
    rollupOptions: {
      output: {
        // Worker 输出格式
        format: 'es'
      }
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5678,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000/", // 目标服务器地址
        changeOrigin: true, // 支持虚拟托管
        rewrite: path => path.replace(/^\/api/, "") // 可选：重写路径
      }
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern',
      }
    }
  },
  build: {
    outDir: "dist",
    minify: "esbuild",
    // esbuild 打包更快，但是不能去除 console.log，terser打包慢，但能去除 console.log
    // minify: "terser",
    // terserOptions: {
    // 	compress: {
    // 		drop_console: viteEnv.VITE_DROP_CONSOLE,
    // 		drop_debugger: true
    // 	}
    // },
    sourcemap: false,
    // 禁用 gzip 压缩大小报告，可略微减少打包时间
    reportCompressedSize: false,
    // 规定触发警告的 chunk 大小
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Static resource classification and packaging
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]"
      }
    }
  }
});
