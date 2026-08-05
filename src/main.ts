import "element-plus/dist/index.css";
import "@/styles/reset.scss";
import "@/styles/index.css";
import "@/utils/rem";
import { Object3D } from "three";
import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import App from "./App.vue";
import router from "./router";

Object3D.DEFAULT_UP.set(0, 0, 1);

createApp(App).use(createPinia()).use(router).use(ElementPlus, { locale: zhCn }).mount("#app");
