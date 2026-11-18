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

export const TEST_SENTENCES: Readonly<Record<TalkLanguage, string>> = {
  fr: "Bonjour ! On teste la voix du mode conversation. Le repository est sur GitHub, et la méthode findByUserId lit la table user_subscriptions.",
  en: "Hello! This is a test of the talk mode voice. The repository is on GitHub, and the findByUserId method reads the user_subscriptions table.",
  es: "¡Hola! Esto es una prueba de la voz del modo conversación. El repositorio está en GitHub.",
  de: "Hallo! Das ist ein Test der Stimme des Gesprächsmodus. Das Repository liegt auf GitHub.",
  it: "Ciao! Questa è una prova della voce della modalità conversazione. Il repository è su GitHub.",
}
