import { BProgress } from "@/config/progress";
import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: "/", name: "root", component: () => import("@/views/home.vue") }],
});

router.beforeEach(() => {
  BProgress.start();
});

router.afterEach(() => {
  BProgress.done();
});

router.onError((error) => {
  BProgress.done(true);
  console.warn("路由错误", error.message);
});

export default router;
