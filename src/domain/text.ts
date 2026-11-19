export const PROJECT_TEXT_LIMIT = 500

const HAN = /\p{Script=Han}/u
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const MARK = /\p{M}/u

/** Count only. Never normalize, trim, or truncate the stored original text. */
export function countProfileText(text: string): number {
  const characters = Array.from(text)
  let count = 0
  let inWord = false

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (HAN.test(character)) {
      count += 1
      inWord = false
    } else if (LETTER_OR_NUMBER.test(character)) {
      if (!inWord) count += 1
      inWord = true
    } else if (MARK.test(character) && inWord) {
      continue
    } else if (
      (character === "'" || character === '’') &&
      inWord &&
      characters[index + 1] !== undefined &&
      LETTER_OR_NUMBER.test(characters[index + 1]) &&
      !HAN.test(characters[index + 1])
    ) {
      // Internal English apostrophes stay in the word: don't, user’s.
      continue
    } else {
      inWord = false
    }
  }

  return count
}

export type ProjectTextIssue = 'empty' | 'too_long'

export function validateProjectText(text: string): {
  count: number
  issues: ProjectTextIssue[]
} {
  const count = countProfileText(text)
  const issues: ProjectTextIssue[] = []
  if (count === 0) issues.push('empty')
  if (count > PROJECT_TEXT_LIMIT) issues.push('too_long')
  return { count, issues }
}
