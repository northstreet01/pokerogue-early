import BBCodeText from "phaser3-rex-plugins/plugins/gameobjects/tagtext/bbcodetext/BBCodeText";
import InputText from "phaser3-rex-plugins/plugins/inputtext";
import { ModifierTier } from "../modifier/modifier-tier";
import { EggTier } from "../data/enums/egg-type";
import i18next from '../i18n';

export enum TextStyle {
  MESSAGE,
  WINDOW,
  BATTLE_INFO,
  PARTY,
  PARTY_RED,
  SUMMARY,
  SUMMARY_RED,
  SUMMARY_BLUE,
  SUMMARY_PINK,
  SUMMARY_GOLD,
  MONEY,
  SETTINGS_LABEL,
  SETTINGS_SELECTED,
  TOOLTIP_TITLE,
  TOOLTIP_CONTENT
};

export function addTextObject(scene: Phaser.Scene, x: number, y: number, content: string, style: TextStyle, extraStyleOptions?: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
  const [ styleOptions, shadowColor, shadowSize ] = getTextStyleOptions(style, extraStyleOptions);

  const ret = scene.add.text(x, y, content, styleOptions);
  ret.setScale(0.1666666667);
  ret.setShadow(shadowSize, shadowSize, shadowColor);
  if (!(styleOptions as Phaser.Types.GameObjects.Text.TextStyle).lineSpacing)
    ret.setLineSpacing(5);

  return ret;
}

/** Re-apply the same language/scene metrics to an existing original text object. */
export function setTextStyle(obj: Phaser.GameObjects.Text, style: TextStyle, extraStyleOptions?: Phaser.Types.GameObjects.Text.TextStyle): void {
  const [ styleOptions, shadowColor, shadowSize ] = getTextStyleOptions(style, extraStyleOptions);
  obj.setStyle(styleOptions as Phaser.Types.GameObjects.Text.TextStyle);
  obj.setScale(0.1666666667);
  obj.setShadow(shadowSize, shadowSize, shadowColor);
  if (!(styleOptions as Phaser.Types.GameObjects.Text.TextStyle).lineSpacing)
    obj.setLineSpacing(5);
}

export function addBBCodeTextObject(scene: Phaser.Scene, x: number, y: number, content: string, style: TextStyle, extraStyleOptions?: Phaser.Types.GameObjects.Text.TextStyle): BBCodeText {
  const [ styleOptions, shadowColor, shadowSize ] = getTextStyleOptions(style, extraStyleOptions);

  const ret = new BBCodeText(scene, x, y, content, styleOptions as BBCodeText.TextStyle);
  scene.add.existing(ret);
  ret.setScale(0.1666666667);
  ret.setShadow(shadowSize, shadowSize, shadowColor);
  if (!(styleOptions as BBCodeText.TextStyle).lineSpacing)
    ret.setLineSpacing(i18next.resolvedLanguage === 'zh-Hans' ? 8 : 10);

  return ret;
}

export function addTextInputObject(scene: Phaser.Scene, x: number, y: number, width: number, height: number, style: TextStyle, extraStyleOptions?: InputText.IConfig): InputText {
  const [ styleOptions ] = getTextStyleOptions(style, extraStyleOptions);

  const ret = new InputText(scene, x, y, width, height, styleOptions as InputText.IConfig);
  scene.add.existing(ret);
  ret.setScale(0.1666666667);

  return ret;
}

export function getTextStyleOptions(style: TextStyle, extraStyleOptions?: Phaser.Types.GameObjects.Text.TextStyle): [ Phaser.Types.GameObjects.Text.TextStyle | InputText.IConfig, string, integer ] {
  const language = i18next.resolvedLanguage ?? i18next.language;
  const cjk = language === 'zh-Hans' || language === 'zh-Hant' || language === 'ja';
  // Phaser/Canvas does not synthesize a CJK face for the pixel font. Keep the
  // original face first and fall back only for scripts it cannot render.
  const fontFamily = cjk ? 'emerald, "Noto Sans SC", "Microsoft YaHei", sans-serif' : 'emerald';
  let shadowColor: string;
  let shadowSize = 4.5;

  let styleOptions: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily,
    fontSize: '96px',
    color: getTextColor(style, false),
    padding: {
      bottom: cjk ? 8 : 6
    },
    wordWrap: { useAdvancedWrap: cjk }
  };

  switch (style) {
    case TextStyle.SUMMARY:
    case TextStyle.SUMMARY_RED:
    case TextStyle.SUMMARY_PINK:
    case TextStyle.SUMMARY_GOLD:
    case TextStyle.WINDOW:
    case TextStyle.MESSAGE:
    case TextStyle.SETTINGS_LABEL:
    case TextStyle.SETTINGS_SELECTED:
      styleOptions.fontSize = cjk ? '88px' : '96px';
      shadowSize = 3.5;
      break;
    case TextStyle.BATTLE_INFO:
    case TextStyle.MONEY:
    case TextStyle.TOOLTIP_TITLE:
      styleOptions.fontSize = cjk ? '68px' : '72px';
      shadowSize = 4;
      break;
    case TextStyle.PARTY:
    case TextStyle.PARTY_RED:
      styleOptions.fontFamily = cjk ? 'pkmnems, "Noto Sans SC", "Microsoft YaHei", sans-serif' : 'pkmnems';
      styleOptions.fontSize = cjk ? '62px' : '66px';
      shadowSize = 3.5;
      break;
    case TextStyle.TOOLTIP_CONTENT:
      styleOptions.fontSize = cjk ? '60px' : '64px';
      shadowSize = 4;
      break;
  }

  shadowColor = getTextColor(style, true);

  if (extraStyleOptions) {
    if (extraStyleOptions.fontSize) {
      const requested = Number.parseInt(String(extraStyleOptions.fontSize), 10);
      const base = Number.parseInt(String(styleOptions.fontSize), 10);
      if (Number.isFinite(requested) && Number.isFinite(base) && base > 0)
        shadowSize *= requested / base;
    }
    styleOptions = Object.assign(styleOptions, extraStyleOptions);
  }

  // Phaser's advanced wrapping also breaks CJK text that has no spaces.
  styleOptions.wordWrap = { useAdvancedWrap: cjk, ...styleOptions.wordWrap };
  return [ styleOptions, shadowColor, shadowSize ];
}

export function getBBCodeFrag(content: string, textStyle: TextStyle): string {
  return `[color=${getTextColor(textStyle)}][shadow=${getTextColor(textStyle, true)}]${content}`;
}

export function getTextColor(textStyle: TextStyle, shadow?: boolean): string {
  switch (textStyle) {
    case TextStyle.MESSAGE:
      return !shadow ? '#f8f8f8' : '#6b5a73';
    case TextStyle.WINDOW:
    case TextStyle.TOOLTIP_CONTENT:
      return !shadow ? '#484848' : '#d0d0c8';
    case TextStyle.BATTLE_INFO:
      return !shadow ? '#404040' : '#ded6b5';
    case TextStyle.PARTY:
      return !shadow ? '#f8f8f8' : '#707070';
    case TextStyle.PARTY_RED:
      return !shadow ? '#f89890' : '#984038';
    case TextStyle.SUMMARY:
      return !shadow ? '#ffffff' : '#636363';
    case TextStyle.SUMMARY_RED:
    case TextStyle.TOOLTIP_TITLE:
      return !shadow ? '#e70808' : '#ffbd73';
    case TextStyle.SUMMARY_BLUE:
      return !shadow ? '#40c8f8' : '#006090';
    case TextStyle.SUMMARY_PINK:
      return !shadow ? '#f89890' : '#984038';
    case TextStyle.SUMMARY_GOLD:
    case TextStyle.MONEY:
      return !shadow ? '#e8e8a8' : '#a0a060'
    case TextStyle.SETTINGS_LABEL:
      return !shadow ? '#f8b050' : '#c07800';
    case TextStyle.SETTINGS_SELECTED:
      return !shadow ? '#f88880' : '#f83018';
  }
}

export function getModifierTierTextTint(tier: ModifierTier): integer {
  switch (tier) {
    case ModifierTier.COMMON:
      return 0xffffff;
    case ModifierTier.GREAT:
      return 0x3890f8;
    case ModifierTier.ULTRA:
      return 0xf8d038;
    case ModifierTier.ROGUE:
      return 0xd52929;
    case ModifierTier.MASTER:
      return 0xe020c0;
    case ModifierTier.LUXURY:
      return 0xe64a18;
  }
}

export function getEggTierTextTint(tier: EggTier): integer {
  switch (tier) {
    case EggTier.COMMON:
      return getModifierTierTextTint(ModifierTier.COMMON);
    case EggTier.GREAT:
      return getModifierTierTextTint(ModifierTier.GREAT);
    case EggTier.ULTRA:
      return getModifierTierTextTint(ModifierTier.ULTRA);
    case EggTier.MASTER:
      return getModifierTierTextTint(ModifierTier.MASTER);
  }
}
