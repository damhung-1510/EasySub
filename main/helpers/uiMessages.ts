/**
 * 主进程面向用户的文案选择。
 *
 * 主进程里大量报错/提示原本只有中文。这里按设置里的界面语言返回对应文案：
 * 越南语（vi）取越南语，其余（zh / en / 未设置）保持原有中文行为不变。
 * 需要英文时第三个参数传入英文版；传了英文版且界面语言是 en 就用英文。
 *
 * store 在函数内懒加载：纯函数单测在 node 下没有 Electron，也能 import 本模块。
 */
export type UiLanguage = 'zh' | 'en' | 'vi';

export function getUiLanguage(): UiLanguage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { store } = require('./store') as typeof import('./store');
    const language = (
      store.get('settings') as { language?: string } | undefined
    )?.language;
    if (language === 'vi' || language === 'en' || language === 'zh') {
      return language;
    }
  } catch {
    /* 无 Electron / store 不可用（单测）：落回默认 */
  }
  return 'zh';
}

/** 选文案：vi → 越南语；en 且提供了英文 → 英文；否则中文原文。 */
export function msg(zh: string, vi: string, en?: string): string {
  const language = getUiLanguage();
  if (language === 'vi') return vi;
  if (language === 'en' && en !== undefined) return en;
  return zh;
}
