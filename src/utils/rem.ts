function setRem() {
  let fontSize = 0;
  let clientWidth = document.documentElement.clientWidth;
  let clientHeight = document.documentElement.clientHeight;
  if (clientWidth / clientHeight >= 1.78) {
    fontSize = 10 * (clientHeight / 1080);
  } else if (clientWidth / clientHeight < 1.78) {
    fontSize = 10 * (clientWidth / 1920);
  }
  document.documentElement.style.fontSize = fontSize + "px";
}
setRem();
window.onresize = function () {
  setRem();
};
