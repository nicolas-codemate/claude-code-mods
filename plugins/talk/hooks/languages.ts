import type { TalkLanguage } from '../types'

const LANGUAGE_NAMES: Readonly<Record<TalkLanguage, string>> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
}

export const languageNameOf = (language: TalkLanguage): string => LANGUAGE_NAMES[language]

export const LANGUAGES = Object.keys(LANGUAGE_NAMES) as readonly TalkLanguage[]

export const isLanguage = (value: string): value is TalkLanguage => LANGUAGES.some(language => language === value)
