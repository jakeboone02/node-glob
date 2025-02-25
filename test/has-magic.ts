import t from 'tap'
import glob from '../'
process.chdir(__dirname)

t.test('non-string pattern is evil magic', async t => {
  const patterns = [0, null, 12, { x: 1 }, undefined, /x/, NaN]
  patterns.forEach(function (p) {
    t.throws(function () {
      // @ts-expect-error
      glob.hasMagic(p)
    })
  })
})

t.test('detect magic in glob patterns', async t => {
  t.notOk(glob.hasMagic(''), "no magic in ''")
  t.notOk(glob.hasMagic('a/b/c/'), 'no magic a/b/c/')
  t.ok(glob.hasMagic('a/b/**/'), 'magic in a/b/**/')
  t.ok(glob.hasMagic('a/b/?/'), 'magic in a/b/?/')
  t.ok(glob.hasMagic('a/b/+(x|y)'), 'magic in a/b/+(x|y)')
  t.notOk(
    glob.hasMagic('a/b/+(x|y)', { noext: true }),
    'no magic in a/b/+(x|y) noext'
  )
  t.notOk(glob.hasMagic('{a,b}'), 'no magic in {a,b}')
  t.notOk(
    glob.hasMagic('{a,b}', { nobrace: true }),
    'no magic in {a,b} nobrace:true'
  )
})
