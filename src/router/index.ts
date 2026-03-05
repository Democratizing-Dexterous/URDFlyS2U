import NProgress from "@/config/nprogress";
import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "root", component: () => import("@/views/home.vue") },

  ]
});
/**
 * @description 路由拦截 beforeEach
 * */
router.beforeEach(async (to, from, next) => {
  NProgress.start();
  next();
});
/**
 * @description 路由跳转错误
 * */
router.onError(error => {
  NProgress.done();
  console.warn("路由错误", error.message);
});

/**
 * @description 路由跳转结束
 * */
router.afterEach(() => {
  NProgress.done();
});
export default router;
