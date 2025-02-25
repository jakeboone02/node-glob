// this is just a very light wrapper around 2 arrays with an offset index

import { GLOBSTAR } from 'minimatch'
export type MMPattern = string | RegExp | typeof GLOBSTAR

// an array of length >= 1
export type PatternList = [p: MMPattern, ...rest: MMPattern[]]
export type UNCPatternList = [
  p0: '',
  p1: '',
  p2: string,
  p3: string,
  ...rest: MMPattern[]
]
export type DrivePatternList = [p0: string, ...rest: MMPattern[]]
export type AbsolutePatternList = [p0: '', ...rest: MMPattern[]]
export type GlobList = [p: string, ...rest: string[]]

const isPatternList = (pl: MMPattern[]): pl is PatternList =>
  pl.length >= 1
const isGlobList = (gl: string[]): gl is GlobList => gl.length >= 1

/**
 * An immutable-ish view on an array of glob parts and their parsed
 * results
 */
export class Pattern {
  readonly #patternList: PatternList
  readonly #globList: GlobList
  readonly #index: number
  readonly length: number
  readonly #platform: NodeJS.Platform
  #rest?: Pattern | null
  #globString?: string
  #isDrive?: boolean
  #isUNC?: boolean
  #isAbsolute?: boolean
  #followGlobstar: boolean = true

  constructor(
    patternList: MMPattern[],
    globList: string[],
    index: number,
    platform: NodeJS.Platform
  ) {
    if (!isPatternList(patternList)) {
      throw new TypeError('empty pattern list')
    }
    if (!isGlobList(globList)) {
      throw new TypeError('empty glob list')
    }
    if (globList.length !== patternList.length) {
      throw new TypeError('mismatched pattern list and glob list lengths')
    }
    this.length = patternList.length
    if (index < 0 || index >= this.length) {
      throw new TypeError('index out of range')
    }
    this.#patternList = patternList
    this.#globList = globList
    this.#index = index
    this.#platform = platform

    // normalize root entries of absolute patterns on initial creation.
    if (this.#index === 0) {
      // c: => ['c:/']
      // C:/ => ['C:/']
      // C:/x => ['C:/', 'x']
      // //host/share => ['//host/share/']
      // //host/share/ => ['//host/share/']
      // //host/share/x => ['//host/share/', 'x']
      // /etc => ['/', 'etc']
      // / => ['/']
      if (this.isUNC()) {
        // '' / '' / 'host' / 'share'
        const [p0, p1, p2, p3, ...prest] = this.#patternList
        const [g0, g1, g2, g3, ...grest] = this.#globList
        if (prest[0] === '') {
          // ends in /
          prest.shift()
          grest.shift()
        }
        const p = [p0, p1, p2, p3, ''].join('/')
        const g = [g0, g1, g2, g3, ''].join('/')
        this.#patternList = [p, ...prest]
        this.#globList = [g, ...grest]
        this.length = this.#patternList.length
      } else if (this.isDrive() || this.isAbsolute()) {
        const [p1, ...prest] = this.#patternList
        const [g1, ...grest] = this.#globList
        if (prest[0] === '') {
          // ends in /
          prest.shift()
          grest.shift()
        }
        const p = (p1 as string) + '/'
        const g = g1 + '/'
        this.#patternList = [p, ...prest]
        this.#globList = [g, ...grest]
        this.length = this.#patternList.length
      }
    }
  }

  /**
   * The first entry in the parsed list of patterns
   */
  pattern(): MMPattern {
    return this.#patternList[this.#index]
  }

  /**
   * true of if pattern() returns a string
   */
  isString(): boolean {
    return typeof this.#patternList[this.#index] === 'string'
  }
  /**
   * true of if pattern() returns GLOBSTAR
   */
  isGlobstar(): boolean {
    return this.#patternList[this.#index] === GLOBSTAR
  }
  /**
   * true if pattern() returns a regexp
   */
  isRegExp(): boolean {
    return this.#patternList[this.#index] instanceof RegExp
  }

  /**
   * The /-joined set of glob parts that make up this pattern
   */
  globString(): string {
    return (this.#globString =
      this.#globString ||
      (this.#index === 0
        ? this.isAbsolute()
          ? this.#globList[0] + this.#globList.slice(1).join('/')
          : this.#globList.join('/')
        : this.#globList.slice(this.#index).join('/')))
  }

  /**
   * true if there are more pattern parts after this one
   */
  hasMore(): boolean {
    return this.length > this.#index + 1
  }

  /**
   * The rest of the pattern after this part, or null if this is the end
   */
  rest(): Pattern | null {
    if (this.#rest !== undefined) return this.#rest
    if (!this.hasMore()) return (this.#rest = null)
    this.#rest = new Pattern(
      this.#patternList,
      this.#globList,
      this.#index + 1,
      this.#platform
    )
    this.#rest.#isAbsolute = this.#isAbsolute
    this.#rest.#isUNC = this.#isUNC
    this.#rest.#isDrive = this.#isDrive
    return this.#rest
  }

  /**
   * true if the pattern represents a //unc/path/ on windows
   */
  isUNC(): boolean {
    const pl = this.#patternList
    return this.#isUNC !== undefined
      ? this.#isUNC
      : (this.#isUNC =
          this.#platform === 'win32' &&
          this.#index === 0 &&
          pl[0] === '' &&
          pl[1] === '' &&
          typeof pl[2] === 'string' &&
          !!pl[2] &&
          typeof pl[3] === 'string' &&
          !!pl[3])
  }

  // pattern like C:/...
  // split = ['C:', ...]
  // XXX: would be nice to handle patterns like `c:*` to test the cwd
  // in c: for *, but I don't know of a way to even figure out what that
  // cwd is without actually chdir'ing into it?
  /**
   * True if the pattern starts with a drive letter on Windows
   */
  isDrive(): boolean {
    const pl = this.#patternList
    return this.#isDrive !== undefined
      ? this.#isDrive
      : (this.#isDrive =
          this.#platform === 'win32' &&
          this.#index === 0 &&
          this.length > 1 &&
          typeof pl[0] === 'string' &&
          /^[a-z]:$/i.test(pl[0]))
  }

  // pattern = '/' or '/...' or '/x/...'
  // split = ['', ''] or ['', ...] or ['', 'x', ...]
  // Drive and UNC both considered absolute on windows
  /**
   * True if the pattern is rooted on an absolute path
   */
  isAbsolute(): boolean {
    const pl = this.#patternList
    return this.#isAbsolute !== undefined
      ? this.#isAbsolute
      : (this.#isAbsolute =
          (pl[0] === '' && pl.length > 1) ||
          this.isDrive() ||
          this.isUNC())
  }

  /**
   * consume the root of the pattern, and return it
   */
  root(): string {
    const p = this.#patternList[0]
    return typeof p === 'string' && this.isAbsolute() && this.#index === 0
      ? p
      : ''
  }

  /**
   * True if the pattern has any non-string components
   */
  hasMagic(): boolean {
    for (let i = 0; i < this.length; i++) {
      if (typeof this.#patternList[i] !== 'string') {
        return true
      }
    }
    return false
  }

  /**
   * Check to see if the current globstar pattern is allowed to follow
   * a symbolic link.
   */
  checkFollowGlobstar(): boolean {
    return !(
      this.#index === 0 ||
      !this.isGlobstar() ||
      !this.#followGlobstar
    )
  }

  /**
   * Mark that the current globstar pattern is following a symbolic link
   */
  markFollowGlobstar(): boolean {
    if (this.#index === 0 || !this.isGlobstar() || !this.#followGlobstar)
      return false
    this.#followGlobstar = false
    return true
  }
}
