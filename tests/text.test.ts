import { describe, expect, it } from 'vitest'
import { countProfileText, validateProjectText } from '../src/domain/text'

describe('repeatable Chinese-character / English-word counting', () => {
  it.each([
    ['', 0],
    [' \t\n\r\u3000', 0],
    ['，。！？—… / + - _ 👩‍💻', 0],
    ['开发项目', 4],
    ['𠀀研究', 3],
    ['Build a reliable profile', 4],
    ['开发React项目2026版', 7],
    ['中文 English 2026', 4],
    ['负责API设计，提升30%效率。', 10],
    ["don't user’s O'Reilly", 3],
    ["'word' '' word''word", 3],
    ['full-stack foo_bar UI/UX', 6],
    ['2024 2025 １２３', 3],
    ['12.5 -30 1,000', 5],
    ['C++ C# v2', 3],
    ['café cafe\u0301 naïve', 3],
    ['\u0301 e\u0301', 1],
    ['A\nB\tC\u3000D', 4],
    ['中👩‍💻文', 2],
    ['日本語 한국어', 4],
  ])('counts %j as %i', (text, expected) => {
    expect(countProfileText(text)).toBe(expected)
    expect(countProfileText(text)).toBe(countProfileText(text))
  })

  it.each([
    ['中'.repeat(500), 500],
    [Array(500).fill('word').join(' '), 500],
    ['中'.repeat(250) + Array(250).fill('word').join(' '), 500],
  ])('accepts the exact limit in Chinese, English and mixed text', (text, count) => {
    expect(validateProjectText(text)).toEqual({ count, issues: [] })
  })

  it.each(['中'.repeat(501), Array(501).fill('word').join(' ')])('rejects 501 without truncating', text => {
    expect(validateProjectText(text)).toEqual({ count: 501, issues: ['too_long'] })
    expect(countProfileText(text)).toBe(501)
  })

  it.each(['', ' \n\t', '，。 🎉'])('rejects content with no counted characters or words', text => {
    expect(validateProjectText(text).issues).toEqual(['empty'])
  })

  it('has no minimum beyond nonempty countable text and preserves the source', () => {
    const original = ' \r\n 一 \t'
    expect(validateProjectText(original)).toEqual({ count: 1, issues: [] })
    expect(original).toBe(' \r\n 一 \t')
  })
})
