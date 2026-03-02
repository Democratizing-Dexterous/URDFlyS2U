//基准大小
// const baseSize = 16;
// 设置 rem 函数
function setRem() {
  let fontSize = 0;
  let clientWidth = document.documentElement.clientWidth;
  let clientHeight = document.documentElement.clientHeight;
  if (clientWidth / clientHeight >= 1.78) {
    fontSize = 10 * (clientHeight / 1080);
  } else if (clientWidth / clientHeight < 1.78) {
    fontSize = 10 * (clientWidth / 1920);
  }
  // 当前页面宽度相对于 750 宽的缩放比例，可根据自己需要修改.
  // 设置页面根节点字体大小
  document.documentElement.style.fontSize = fontSize + "px";
}
// 初始化
setRem();
// 改变窗口大小时重新设置 rem
window.onresize = function () {
  setRem();
};
