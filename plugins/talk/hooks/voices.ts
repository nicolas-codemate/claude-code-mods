import type { TalkLanguage } from '../types'

// The sentence every voice is heard on, to compare them: a question as Claude asks one, with the English words of a
// developer.
export const SAMPLE_SENTENCES: Readonly<Record<TalkLanguage, string>> = {
  fr: 'Tu veux que je crée la pull request sur GitHub ? On attend la CI, et après on fait la code review ensemble.',
  en: 'Shall I open the pull request on GitHub? We wait for the CI, and then we do the code review together.',
  es: '¿Quieres que cree la pull request en GitHub? Esperamos la CI, y después hacemos la code review juntos.',
  de: 'Soll ich den Pull Request auf GitHub anlegen? Wir warten auf die CI, und dann machen wir zusammen das Code Review.',
  it: 'Vuoi che apra la pull request su GitHub? Aspettiamo la CI, e poi facciamo insieme la code review.',
}
