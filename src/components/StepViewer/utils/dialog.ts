import { nextTick } from "vue";
import { ElMessageBox } from "element-plus";
import type { ElMessageBoxOptions, MessageBoxData, MessageBoxInputData } from "element-plus";

export function isDialogDismissed(error: unknown): boolean {
  return error === "cancel" || error === "close";
}

export async function promptDialog(
  message: string,
  title: string,
  options?: ElMessageBoxOptions,
): Promise<MessageBoxInputData> {
  await nextTick();
  return ElMessageBox.prompt(message, title, options);
}

export async function confirmDialog(
  message: string,
  title: string,
  options?: ElMessageBoxOptions,
): Promise<MessageBoxData> {
  await nextTick();
  return ElMessageBox.confirm(message, title, options);
}

export async function alertDialog(
  message: string,
  title: string,
  options?: ElMessageBoxOptions,
): Promise<MessageBoxData> {
  await nextTick();
  return ElMessageBox.alert(message, title, options);
}
