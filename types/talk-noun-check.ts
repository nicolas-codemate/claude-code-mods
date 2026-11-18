// diff-review declares the talk mod's noun on its own, so as not to depend on talk: this fails the typecheck when the
// two declarations drift apart, which TypeScript does not report between declaration files.
import type { TalkNoun } from '../plugins/diff-review/types/talk-noun'
import type { Talk } from '../plugins/talk/types'

type IsSameType<First, Second> = (<Probe>() => Probe extends First ? 1 : 2) extends <Probe>() => Probe extends Second ? 1 : 2 ? true : false

export const isTalkNounDeclaredAlike: IsSameType<Talk, TalkNoun> = true
