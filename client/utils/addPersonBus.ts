/**
 * 「新增人物」全局事件总线
 * 底栏中间按钮点击后：先切到人物页，再触发该事件让首页弹出建档 Modal
 */
type Handler = () => void;

let handler: Handler | null = null;

export function setAddPersonHandler(fn: Handler | null) {
  handler = fn;
}

export function requestAddPerson() {
  if (handler) handler();
}
