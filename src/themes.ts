export const themeStyles = [
  { id: 'default', name: '默认主题', description: '原有灰白 / 石墨灰与蓝色强调', colors: ['#f5f6f8', '#3d5fad', '#141518'] },
  { id: 'minimal', name: '极简扁平', description: '黑白层次、克制留白与清晰边界', colors: ['#fafafa', '#27272a', '#18181b'] },
  { id: 'organic', name: '自然有机', description: '暖米色、森林绿与柔和圆角', colors: ['#f5f3ea', '#356345', '#18231c'] },
  { id: 'editorial', name: '编辑杂志', description: '纸张色、酒红强调与衬线标题', colors: ['#f7f1e8', '#963d50', '#261d21'] },
  { id: 'brutalist', name: '新野兽派', description: '硬边框、实色阴影与鲜明色块', colors: ['#fff9e8', '#5941b5', '#22202b'] },
  { id: 'soft', name: '柔和界面', description: '低饱和藕紫、圆润面板与柔软阴影', colors: ['#f7f3f8', '#815276', '#28212e'] },
  { id: 'glass', name: 'macOS 毛玻璃', description: '冷灰层次、半透明表面与背景模糊', colors: ['#edf2f8', '#316391', '#202936'] },
  { id: 'gradient', name: '现代渐变', description: '紫蓝渐变、通透卡片与柔和光影', colors: ['#f2f3fd', '#6244b4', '#222039'] },
  { id: 'retro', name: '复古怀旧', description: '奶油纸色、铜橙强调与复古衬线标题', colors: ['#f5ecd9', '#955024', '#2e251e'] },
] as const;

export type ThemeStyle = typeof themeStyles[number]['id'];
export function normalizeThemeStyle(value: unknown): ThemeStyle {
  return themeStyles.find(style => style.id === value)?.id ?? 'default';
}
