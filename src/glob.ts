import { Minimatch, MinimatchOptions } from 'minimatch'
import Minipass from 'minipass'
import {
  Path,
  PathScurry,
  PathScurryDarwin,
  PathScurryPosix,
  PathScurryWin32,
} from 'path-scurry'
import { fileURLToPath } from 'url'
import { Ignore } from './ignore.js'
import { Pattern } from './pattern.js'
import { GlobStream, GlobWalker } from './walker.js'

export type MatchSet = Minimatch['set']
export type GlobParts = Exclude<Minimatch['globParts'], undefined>

// if no process global, just call it linux.
// so we default to case-sensitive, / separators
const defaultPlatform: NodeJS.Platform =
  typeof process === 'object' &&
  process &&
  typeof process.platform === 'string'
    ? process.platform
    : 'linux'

/**
 * A `GlobOptions` object may be provided to any of the exported methods, and
 * must be provided to the `Glob` constructor.
 *
 * All options are optional, boolean, and false by default, unless otherwise
 * noted.
 *
 * All resolved options are added to the Glob object as properties.
 *
 * If you are running many `glob` operations, you can pass a Glob object as the
 * `options` argument to a subsequent operation to share the previously loaded
 * cache.
 */
export interface GlobOptions {
  /**
   * Set to true to always receive absolute paths for
   * matched files. This does _not_ make an extra system call to get
   * the realpath, it only does string path resolution.
   *
   * By default, when this option is not set, absolute paths are
   * returned for patterns that are absolute, and otherwise paths
   * are returned that are relative to the `cwd` setting.
   *
   * Conflicts with {@link withFileTypes}
   */
  absolute?: boolean
  /**
   * Set to false to enable {@link windowsPathsNoEscape}
   *
   * @deprecated
   */
  allowWindowsEscape?: boolean
  /**
   * The current working directory in which to search. Defaults to
   * `process.cwd()`.
   *
   * May be eiher a string path or a `file://` URL object or string.
   */
  cwd?: string | URL
  /**
   * Include `.dot` files in normal matches and `globstar`
   * matches. Note that an explicit dot in a portion of the pattern
   * will always match dot files.
   */
  dot?: boolean
  /**
   * Follow symlinked directories when expanding `**`
   * patterns. This can result in a lot of duplicate references in
   * the presence of cyclic links, and make performance quite bad.
   *
   * By default, a `**` in a pattern will follow 1 symbolic link if
   * it is not the first item in the pattern, or none if it is the
   * first item in the pattern, following the same behavior as Bash.
   */
  follow?: boolean
  /**
   * A glob pattern or array of glob patterns to exclude from matches. To
   * ignore all children within a directory, as well as the entry itself,
   * append `/**'` to the ignore pattern.
   */
  ignore?: string | string[] | Ignore
  /**
   * Add a `/` character to directory matches. Note that this requires
   * additional stat calls in some cases.
   */
  mark?: boolean
  /**
   * Perform a basename-only match if the pattern does not contain any slash
   * characters. That is, `*.js` would be treated as equivalent to
   * `**\/*.js`, matching all js files in all directories.
   */
  matchBase?: boolean
  /**
   * Do not expand `{a,b}` and `{1..3}` brace sets.
   */
  nobrace?: boolean
  /**
   * Perform a case-insensitive match. This defaults to `true` on macOS and
   * Windows systems, and `false` on all others.
   *
   * **Note** `nocase` should only be explicitly set when it is
   * known that the filesystem's case sensitivity differs from the
   * platform default. If set `true` on case-sensitive file
   * systems, or `false` on case-insensitive file systems, then the
   * walk may return more or less results than expected.
   */
  nocase?: boolean
  /**
   * Do not match directories, only files. (Note: to match
   * _only_ directories, put a `/` at the end of the pattern.)
   */
  nodir?: boolean
  /**
   * Do not match "extglob" patterns such as `+(a|b)`.
   */
  noext?: boolean
  /**
   * Do not match `**` against multiple filenames. (Ie, treat it as a normal
   * `*` instead.)
   *
   * Conflicts with {@link matchBase}
   */
  noglobstar?: boolean
  /**
   * Defaults to value of `process.platform` if available, or `'linux'` if
   * not. Setting `platform:'win32'` on non-Windows systems may cause strange
   * behavior.
   */
  platform?: NodeJS.Platform
  /**
   * Set to true to call `fs.realpath` on all of the
   * results. In the case of an entry that cannot be resolved, the
   * entry is omitted. This incurs a slight performance penalty, of
   * course, because of the added system calls.
   */
  realpath?: boolean
  /**
   * A [PathScurry](http://npm.im/path-scurry) object used
   * to traverse the file system. If the `nocase` option is set
   * explicitly, then any provided `scurry` object must match this
   * setting.
   */
  scurry?: PathScurry
  /**
   * An AbortSignal which will cancel the Glob walk when
   * triggered.
   */
  signal?: AbortSignal
  /**
   * Use `\\` as a path separator _only_, and
   *  _never_ as an escape character. If set, all `\\` characters are
   *  replaced with `/` in the pattern.
   *
   *  Note that this makes it **impossible** to match against paths
   *  containing literal glob pattern characters, but allows matching
   *  with patterns constructed using `path.join()` and
   *  `path.resolve()` on Windows platforms, mimicking the (buggy!)
   *  behavior of Glob v7 and before on Windows. Please use with
   *  caution, and be mindful of [the caveat below about Windows
   *  paths](#windows). (For legacy reasons, this is also set if
   *  `allowWindowsEscape` is set to the exact value `false`.)
   */
  windowsPathsNoEscape?: boolean
  /**
   * Return [PathScurry](http://npm.im/path-scurry)
   * `Path` objects instead of strings. These are similar to a
   * NodeJS `Dirent` object, but with additional methods and
   * properties.
   *
   * Conflicts with {@link absolute}
   */
  withFileTypes?: boolean
}

export type GlobOptionsWithFileTypesTrue = GlobOptions & {
  withFileTypes: true
  absolute?: false
}

export type GlobOptionsWithFileTypesFalse = GlobOptions & {
  withFileTypes?: false
}

export type GlobOptionsWithFileTypesUnset = GlobOptions & {
  withFileTypes?: undefined
}

export type Result<Opts> = Opts extends GlobOptionsWithFileTypesTrue
  ? Path
  : Opts extends GlobOptionsWithFileTypesFalse
  ? string
  : Opts extends GlobOptionsWithFileTypesUnset
  ? string
  : string | Path
export type Results<Opts> = Result<Opts>[]

export type FileTypes<Opts> = Opts extends GlobOptionsWithFileTypesTrue
  ? true
  : Opts extends GlobOptionsWithFileTypesFalse
  ? false
  : Opts extends GlobOptionsWithFileTypesUnset
  ? false
  : boolean

/**
 * An object that can perform glob pattern traversals.
 */
export class Glob<Opts extends GlobOptions> implements GlobOptions {
  absolute: boolean
  cwd: string
  dot: boolean
  follow: boolean
  ignore?: Ignore
  mark: boolean
  matchBase: boolean
  nobrace: boolean
  nocase: boolean
  nodir: boolean
  noext: boolean
  noglobstar: boolean
  pattern: string[]
  platform: NodeJS.Platform
  realpath: boolean
  scurry: PathScurry
  signal?: AbortSignal
  windowsPathsNoEscape: boolean
  withFileTypes: FileTypes<Opts>

  /**
   * The options provided to the constructor.
   */
  opts: Opts

  /**
   * An array of parsed immutable {@link Pattern} objects.
   */
  patterns: Pattern[]

  /**
   * All options are stored as properties on the `Glob` object.
   *
   * See {@link GlobOptions} for full options descriptions.
   *
   * Note that a previous `Glob` object can be passed as the
   * `GlobOptions` to another `Glob` instantiation to re-use settings
   * and caches with a new pattern.
   *
   * Traversal functions can be called multiple times to run the walk
   * again.
   */
  constructor(pattern: string | string[], opts: Opts) {
    this.withFileTypes = !!opts.withFileTypes as FileTypes<Opts>
    this.signal = opts.signal
    this.follow = !!opts.follow
    this.dot = !!opts.dot
    this.nodir = !!opts.nodir
    this.mark = !!opts.mark
    if (!opts.cwd) {
      this.cwd = ''
    } else if (opts.cwd instanceof URL || opts.cwd.startsWith('file://')) {
      opts.cwd = fileURLToPath(opts.cwd)
    }
    this.cwd = opts.cwd || ''
    this.nobrace = !!opts.nobrace
    this.noext = !!opts.noext
    this.realpath = !!opts.realpath
    this.absolute = !!opts.absolute

    this.noglobstar = !!opts.noglobstar
    this.matchBase = !!opts.matchBase

    if (this.withFileTypes && this.absolute) {
      throw new Error('cannot set absolute:true and withFileTypes:true')
    }

    if (typeof pattern === 'string') {
      pattern = [pattern]
    }

    this.windowsPathsNoEscape =
      !!opts.windowsPathsNoEscape ||
      (opts as GlobOptions).allowWindowsEscape === false

    if (this.windowsPathsNoEscape) {
      pattern = pattern.map(p => p.replace(/\\/g, '/'))
    }

    if (this.matchBase) {
      if (opts.noglobstar) {
        throw new TypeError('base matching requires globstar')
      }
      pattern = pattern.map(p => (p.includes('/') ? p : `./**/${p}`))
    }

    this.pattern = pattern

    this.platform = opts.platform || defaultPlatform
    this.opts = { ...opts, platform: this.platform }
    if (opts.scurry) {
      this.scurry = opts.scurry
      if (
        opts.nocase !== undefined &&
        opts.nocase !== opts.scurry.nocase
      ) {
        throw new Error('nocase option contradicts provided scurry option')
      }
    } else {
      const Scurry =
        opts.platform === 'win32'
          ? PathScurryWin32
          : opts.platform === 'darwin'
          ? PathScurryDarwin
          : opts.platform
          ? PathScurryPosix
          : PathScurry
      this.scurry = new Scurry(this.cwd, { nocase: opts.nocase })
    }
    this.nocase = this.scurry.nocase

    const mmo: MinimatchOptions = {
      // default nocase based on platform
      ...opts,
      dot: this.dot,
      matchBase: this.matchBase,
      nobrace: this.nobrace,
      nocase: this.nocase,
      nocaseMagicOnly: true,
      nocomment: true,
      noext: this.noext,
      nonegate: true,
      optimizationLevel: 2,
      platform: this.platform,
      windowsPathsNoEscape: this.windowsPathsNoEscape,
    }

    const mms = this.pattern.map(p => new Minimatch(p, mmo))
    const [matchSet, globParts] = mms.reduce(
      (set: [MatchSet, GlobParts], m) => {
        set[0].push(...m.set)
        set[1].push(...m.globParts)
        return set
      },
      [[], []]
    )
    this.patterns = matchSet.map((set, i) => {
      return new Pattern(set, globParts[i], 0, this.platform)
    })
  }

  /**
   * Returns a Promise that resolves to the results array.
   */
  async walk(): Promise<Results<Opts>>
  async walk(): Promise<(string | Path)[]> {
    // Walkers always return array of Path objects, so we just have to
    // coerce them into the right shape.  It will have already called
    // realpath() if the option was set to do so, so we know that's cached.
    // start out knowing the cwd, at least
    return [
      ...(await new GlobWalker(this.patterns, this.scurry.cwd, {
        ...this.opts,
        platform: this.platform,
        nocase: this.nocase,
      }).walk()),
    ]
  }

  /**
   * synchronous {@link Glob.walk}
   */
  walkSync(): Results<Opts>
  walkSync(): (string | Path)[] {
    return [
      ...new GlobWalker(this.patterns, this.scurry.cwd, {
        ...this.opts,
        platform: this.platform,
        nocase: this.nocase,
      }).walkSync(),
    ]
  }

  /**
   * Stream results asynchronously.
   */
  stream(): Minipass<Result<Opts>, Result<Opts>>
  stream(): Minipass<string | Path, string | Path> {
    return new GlobStream(this.patterns, this.scurry.cwd, {
      ...this.opts,
      platform: this.platform,
      nocase: this.nocase,
    }).stream()
  }

  /**
   * Stream results synchronously.
   */
  streamSync(): Minipass<Result<Opts>, Result<Opts>>
  streamSync(): Minipass<string | Path, string | Path> {
    return new GlobStream(this.patterns, this.scurry.cwd, {
      ...this.opts,
      platform: this.platform,
      nocase: this.nocase,
    }).streamSync()
  }

  /**
   * Default sync iteration function. Returns a Generator that
   * iterates over the results.
   */
  iterateSync(): Generator<Result<Opts>, void, void> {
    return this.streamSync()[Symbol.iterator]()
  }
  [Symbol.iterator]() {
    return this.iterateSync()
  }

  /**
   * Default async iteration function. Returns an AsyncGenerator that
   * iterates over the results.
   */
  iterate(): AsyncGenerator<Result<Opts>, void, void> {
    return this.stream()[Symbol.asyncIterator]()
  }
  [Symbol.asyncIterator]() {
    return this.iterate()
  }
}
