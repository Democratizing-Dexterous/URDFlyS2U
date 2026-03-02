// import "./assets/main.css";
import "@/styles/reset.scss";
import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "@/styles/index.css"
import "element-plus/dist/index.css";
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from "./App.vue";
import router from "./router";
import "@/utils/rem";
const app = createApp(App);
import "virtual:svg-icons-register";
app.use(createPinia());
app.use(router);
app.use(ElementPlus,{locale: zhCn});
app.mount("#app");
