import { describe, it, expect } from 'vitest'
import { parseRepoUrl, decodeBase64Utf8 } from './github'

describe('parseRepoUrl', () => {
  it('parses a plain repo URL', () => {
    expect(parseRepoUrl('https://github.com/tomasssalles/jade-lens'))
      .toEqual({ owner: 'tomasssalles', repo: 'jade-lens' })
  })
  it('tolerates a trailing slash', () => {
    expect(parseRepoUrl('https://github.com/owner/repo/'))
      .toEqual({ owner: 'owner', repo: 'repo' })
  })
  it('strips a trailing .git', () => {
    expect(parseRepoUrl('https://github.com/owner/repo.git'))
      .toEqual({ owner: 'owner', repo: 'repo' })
  })
  it('strips .git with a trailing slash', () => {
    expect(parseRepoUrl('https://github.com/owner/repo.git/'))
      .toEqual({ owner: 'owner', repo: 'repo' })
  })
  it('rejects a non-github URL', () => {
    expect(parseRepoUrl('https://gitlab.com/owner/repo')).toBeNull()
  })
  it('rejects a URL with no repo', () => {
    expect(parseRepoUrl('https://github.com/owner')).toBeNull()
  })
})

describe('decodeBase64Utf8', () => {
  it('decodes plain ASCII', () => {
    expect(decodeBase64Utf8(btoa('hello world'))).toBe('hello world')
  })
  it('decodes multi-byte UTF-8 (e.g. accented + emoji)', () => {
    const text = 'Tomás 🏋️ café'
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    expect(decodeBase64Utf8(b64)).toBe(text)
  })
  it('ignores embedded newlines in the base64 (GitHub wraps at 60 cols)', () => {
    const b64 = btoa('hello world')
    const wrapped = b64.slice(0, 4) + '\n' + b64.slice(4)
    expect(decodeBase64Utf8(wrapped)).toBe('hello world')
  })
})
