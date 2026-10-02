import * as YAML from 'yaml'
import type { DocumentOptions, ParseOptions, Scalar, SchemaOptions } from 'yaml'

type Options = ParseOptions & DocumentOptions & SchemaOptions

const schemaCases: Array<[string, Options]> = [
  ['core schema', { schema: 'core' }],
  ['yaml-1.1 schema', { schema: 'yaml-1.1' }],
  ['custom schema tags', { schema: 'core', customTags: [] }]
]

/**
 * Regression tests for non-finite floats (`.inf`, `-.inf`, `.nan` and
 * explicitly tagged `!!float` scalars).
 *
 * The contract tested here is that, within a schema that supports such
 * literals, parsing, `toJS()`, stringifying and re-parsing preserve both
 * the JS meaning (Infinity / -Infinity / NaN / finite numbers) and the
 * node tags, while strings that merely look numeric stay strings.
 */

const FLOAT_TAG = 'tag:yaml.org,2002:float'
const STR_TAG = 'tag:yaml.org,2002:str'

const SOURCE = `pos: .inf
neg: -.Inf
nan: .NAN
upper: .INF
lowerNan: .nan
num: 42
flt: 3.5
exp: 1.0e2
plainString: Infinity
quotedString: ".inf"
taggedInf: !!float .inf
taggedNeg: !!float -.inf
taggedNan: !!float .NAN
taggedString: !!str .inf
flow: [ .inf, -.inf, .nan, 42, 2.5 ]
flowTagged: [ !!float .inf, !!float -.inf, !!float .nan ]
flowMap: { kk: !!float .nan, jj: .inf }
`

type Row = {
  key: string
  want: unknown
  tag?: string
  isNaN?: boolean
}

const rows: Row[] = [
  { key: 'pos', want: Number.POSITIVE_INFINITY },
  { key: 'neg', want: Number.NEGATIVE_INFINITY },
  { key: 'nan', want: NaN, isNaN: true },
  { key: 'upper', want: Number.POSITIVE_INFINITY },
  { key: 'lowerNan', want: NaN, isNaN: true },
  { key: 'num', want: 42 },
  { key: 'flt', want: 3.5 },
  { key: 'exp', want: 100 },
  { key: 'plainString', want: 'Infinity' },
  { key: 'quotedString', want: '.inf' },
  { key: 'taggedInf', want: Number.POSITIVE_INFINITY, tag: FLOAT_TAG },
  { key: 'taggedNeg', want: Number.NEGATIVE_INFINITY, tag: FLOAT_TAG },
  { key: 'taggedNan', want: NaN, isNaN: true, tag: FLOAT_TAG },
  { key: 'taggedString', want: '.inf', tag: STR_TAG }
]

function assertValue(actual: unknown, row: Row, where: string) {
  if (row.isNaN) {
    expect(actual, `${where} ${row.key}`).toEqual(Number.NaN)
    expect(
      typeof actual === 'number' && Number.isNaN(actual),
      `${where} ${row.key} is a NaN number`
    ).toBe(true)
  } else if (typeof row.want === 'number' && !Number.isFinite(row.want)) {
    expect(actual, `${where} ${row.key}`).toBe(row.want)
    // -0 aside, Object.is distinguishes Infinity from stringy values
    expect(Object.is(actual, row.want), `${where} ${row.key} Object.is`).toBe(
      true
    )
  } else {
    expect(actual, `${where} ${row.key}`).toBe(row.want)
  }
}

for (const [label, options] of schemaCases) {
  describe(`non-finite floats: ${label}`, () => {
    test('parse() resolves supported literals and leaves strings alone', () => {
      const js = YAML.parse(SOURCE, options) as Record<string, unknown>
      for (const row of rows) assertValue(js[row.key], row, 'parse')
      expect(js.flow).toEqual([
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
        42,
        2.5
      ])
      expect(Number.isNaN((js.flow as unknown[])[2])).toBe(true)
      expect(js.flowTagged).toEqual([
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN
      ])
    })

    test('parseDocument() nodes keep the right values, types and tags', () => {
      const doc = YAML.parseDocument(SOURCE, options)
      expect(doc.errors).toHaveLength(0)
      for (const row of rows) {
        const scalar = doc.get(row.key) as Scalar
        expect(typeof scalar.value, `${row.key} node type`).toBe(
          row.tag === STR_TAG || typeof row.want === 'string'
            ? 'string'
            : 'number'
        )
        assertValue(scalar.value, row, 'node')
        if (row.tag) expect(scalar.tag, `${row.key} tag`).toBe(row.tag)
        else expect(scalar.tag, `${row.key} implicit tag`).toBeUndefined()
      }
      const flow = doc.get('flow') as unknown as Scalar[]
      expect(flow).toHaveLength(5)
      for (const item of flow) expect(item.tag).toBeUndefined()
      const tagged = doc.get('flowTagged') as unknown as Scalar[]
      for (const item of tagged) expect(item.tag).toBe(FLOAT_TAG)
    })

    test('toJS() preserves NaN via Number.isNaN/Object.is', () => {
      const doc = YAML.parseDocument(
        'aa: .nan\nbb: .NAN\ncc: 3\ndd: .inf\n',
        options
      )
      const js = doc.toJS() as Record<string, number>
      expect(Number.isNaN(js.aa)).toBe(true)
      expect(Object.is(js.bb, Number.NaN)).toBe(true)
      expect(Object.is(js.dd, Number.POSITIVE_INFINITY)).toBe(true)
      expect(js.cc).toBe(3)
      // NaN values must not collide with each other just because
      // String(NaN) === 'NaN' or because NaN itself is falsy.
      expect(Object.keys(js)).toEqual(['aa', 'bb', 'cc', 'dd'])
    })

    test('toString() output survives a second parse unchanged', () => {
      const doc = YAML.parseDocument(SOURCE, options)
      const str = doc.toString()
      const reparsed = YAML.parse(str, options) as Record<string, unknown>
      for (const row of rows) assertValue(reparsed[row.key], row, 'reparse')
      expect(reparsed.flow).toEqual([
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
        42,
        2.5
      ])
      expect(reparsed.flowTagged).toEqual([
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN
      ])

      const doc2 = YAML.parseDocument(str, options)
      expect(doc2.errors).toHaveLength(0)
      for (const row of rows) {
        if (!row.tag) continue
        const scalar2 = doc2.get(row.key) as Scalar
        expect(scalar2.tag, `${row.key} retag`).toBe(row.tag)
      }
    })
  })
}

describe('non-finite floats: anchors, aliases and comments', () => {
  const src = `# header
aa: &inf .inf # infinite
bb: *inf
cc: &nan .NAN # not a number
dd: *nan
ee: [ *inf, *nan ]
`
  for (const schema of ['core', 'yaml-1.1'] as const) {
    test(`values and node metadata round-trip under ${schema}`, () => {
      const doc = YAML.parseDocument(src, { schema })
      expect(doc.errors).toHaveLength(0)
      const js1 = doc.toJS() as Record<string, unknown>
      expect(js1.aa).toBe(Number.POSITIVE_INFINITY)
      expect(js1.bb).toBe(Number.POSITIVE_INFINITY)
      expect(Number.isNaN(js1.cc)).toBe(true)
      expect(Number.isNaN(js1.dd)).toBe(true)
      expect(js1.ee).toEqual([Number.POSITIVE_INFINITY, Number.NaN])

      const infNode = doc.get('aa') as Scalar
      expect(infNode.anchor).toBe('inf')
      expect(infNode.comment).toBe(' infinite')

      const out = doc.toString()
      const doc2 = YAML.parseDocument(out, { schema })
      expect(doc2.errors).toHaveLength(0)
      const js2 = doc2.toJS() as Record<string, unknown>
      expect(Object.is(js2.aa, Number.POSITIVE_INFINITY)).toBe(true)
      expect(Object.is(js2.bb, Number.POSITIVE_INFINITY)).toBe(true)
      expect(Number.isNaN(js2.cc)).toBe(true)
      expect(Number.isNaN(js2.dd)).toBe(true)

      const inf2 = doc2.get('aa') as Scalar
      expect(inf2.anchor).toBe('inf')
      expect(inf2.comment).toBe(' infinite')
    })
  }
})

describe('non-finite floats: toJS reviver', () => {
  test('reviver sees Infinity and NaN as numbers', () => {
    const doc = YAML.parseDocument('a: .inf\nb: -.inf\nc: .nan\nd: 7\n')
    const seen: unknown[] = []
    doc.toJS({
      reviver: (_key: unknown, value: unknown) => {
        seen.push([
          typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value,
          typeof value
        ])
        return value
      }
    })
    expect(seen).toContainEqual([Number.POSITIVE_INFINITY, 'number'])
    expect(seen).toContainEqual([Number.NEGATIVE_INFINITY, 'number'])
    expect(seen).toContainEqual(['NaN', 'number'])
    expect(seen).toContainEqual([7, 'number'])
  })
})

describe('non-finite floats: stringify of JS values', () => {
  for (const [value, expected] of [
    [Number.POSITIVE_INFINITY, '.inf\n'],
    [Number.NEGATIVE_INFINITY, '-.inf\n'],
    [Number.NaN, '.nan\n'],
    [0, '0\n'],
    [3.5, '3.5\n']
  ] as const) {
    test(`${String(expected).trim()} under both schemas`, () => {
      expect(YAML.stringify(value)).toBe(expected)
      expect(YAML.stringify(value, { schema: 'yaml-1.1' })).toBe(expected)
      const reparsed = YAML.parse(expected, { schema: 'yaml-1.1' })
      if (Number.isNaN(value)) expect(Number.isNaN(reparsed)).toBe(true)
      else expect(Object.is(reparsed, value)).toBe(true)
    })
  }
})

describe('non-finite floats: invalid explicitly tagged values', () => {
  // A value tagged !!float/!!int which does not resolve as a number must
  // remain a string; it must never be silently serialised as .nan.
  for (const [src, tag] of [
    ['!!float abc\n', FLOAT_TAG],
    ['!!float "abc"\n', FLOAT_TAG],
    ['!!int hello\n', 'tag:yaml.org,2002:int'],
    ['a: !!float "abc"\n', FLOAT_TAG]
  ] as const) {
    test(`${src.trim()} stays a string across a round-trip`, () => {
      const doc = YAML.parseDocument(src)
      const scalar = (src.startsWith('a:') ? doc.get('a') : doc.value) as Scalar
      expect(typeof scalar.value).toBe('string')
      expect(scalar.tag).toBe(tag)

      const out = doc.toString()
      expect(out).not.toContain('.nan')
      const doc2 = YAML.parseDocument(out)
      const scalar2 = (
        src.startsWith('a:') ? doc2.get('a') : doc2.value
      ) as Scalar
      expect(typeof scalar2.value).toBe('string')
      expect(scalar2.value).toBe(scalar.value)
      expect(scalar2.tag).toBe(tag)
      expect(doc2.errors).toHaveLength(0)
    })
  }
})

describe('non-finite floats: unsupported schema literals', () => {
  test('json schema does not resolve .inf/.nan as numbers', () => {
    const doc = YAML.parseDocument('.inf\n', { schema: 'json' })
    expect(doc.errors.length).toBeGreaterThan(0)
    expect(doc.toJS()).not.toBe(Number.POSITIVE_INFINITY)
  })

  test('failsafe schema keeps the literal as a string', () => {
    expect(YAML.parse('.inf\n', { schema: 'failsafe' })).toBe('.inf')
    expect(YAML.parse('.nan\n', { schema: 'failsafe' })).toBe('.nan')
  })
})
